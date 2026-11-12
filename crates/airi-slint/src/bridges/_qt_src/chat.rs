// SPDX-License-Identifier: GPL-3.0-or-later
//! Chat bridge (`ChatController`, `ChatMessageEntry`, `ChatSessionEntry`,
//! `ChatCardEntry`) exposed to QML.
//!
//! Layering: QML → `qinvokable` methods → Tokio tasks → `ChatService`; events
//! flow core → broadcast → an unbounded channel drained by a Qt-thread pump
//! ([`qobject::ChatController::pump_events`]) driven from QML by a 33 ms timer.
//! No Tokio types cross the bridge; list properties use the `QObjectList`
//! fallback decided in `docs/bridge-pattern.md` (per-message QObjects appended
//! incrementally; delta notifications mutate only the streaming entry).
//!
//! Character cards live as `<profile>/cards/*.png|*.json` (CCv2/CCv3). The
//! bridge scans both the profile cards dir and (on Unix) the platform data
//! dir `<XDG_DATA_HOME|~/.local/share>/airi-slint/cards`; profile entries win on
//! id collisions. `--import-card <file>` (main.rs) copies a card into the
//! selected `--profile` or, failing that, the platform dir so the default
//! launch finds it.
//!
//! Provider resolution order: the smoke override (registered by `main` with
//! `--smoke`) → `AIRI_QT_PROVIDER` / `AIRI_QT_MODEL` / `AIRI_QT_API_KEY` /
//! `AIRI_QT_BASE_URL` env vars → the first enabled row in the `providers`
//! table (config JSON deserialized into `ProviderConfig`) → unconfigured
//! (sends fail with a user-facing error; the composer stays usable).
//!
//! Known limits: switching away mid-stream and back loses the un-persisted
//! partial reply (a fresh placeholder is seeded from the next delta only); the
//! assistant message is persisted when the stream ends, not per delta.
//!
//! Memory wiring (wave ⑬, behind `settings/memory.enabled`): when the flag
//! is on, a completed assistant turn (`ChatEvent::MessageDone`, same point
//! as the smoke `done` marker) journals `User: <user> / AI: <assistant>` as
//! a `note` entry (each side truncated to 800 scalars, one line) and embeds
//! it with one batched call against the *resolved chat provider* config
//! (`DEFAULT_EMBEDDING_MODEL`); embedding failures are
//! logged and leave the row unembedded for the "Index memories now"
//! backfill. Retrieval runs in the send-path task (never on the Qt
//! thread): `MemoryRetrieval::build_prompt_block` is prepended as a system
//! message *before* the card's system prompt, and every failure mode logs
//! and continues without memories. Flag off ⇒ byte-identical behavior.
//! See `docs/phase-notes/p13-lane-memory-wiring.md`.
//!
//! `openai-compatible` override; [`smoke_chat_outcome`] / [`smoke_delta_count`]
//! let `main` fail the smoke run when the end-to-end path breaks.

use cxx_qt::CxxQtType;
use cxx_qt_lib::{QList, QObjectMutPtr, QString, QVariant};
use std::collections::HashMap;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use airi_core::cards::{extract_card_from_png, parse_card_json, CharacterCard};
use airi_core::chat::{ChatEvent, ChatService, ChatStatus};
use airi_core::memory::embedding::{Embedder, EmbeddingClient, DEFAULT_EMBEDDING_MODEL};
use airi_core::memory::retrieval::{IndexEntry, MemoryIndexer, MemoryRetrieval};
use airi_core::memory::TextJournalService;
use airi_llm::{ChatMessage, ProviderConfig, Role};
use airi_store::{Database, MessageRepo, ProviderRepo, SessionRepo, StoredMessage, StoredSession};
use serde_json::json;

use crate::bridges::qstring_to_string;

// ---------------------------------------------------------------------------
// Process-lifetime context (registered by `main` before the engine loads)
// ---------------------------------------------------------------------------

/// Everything the chat bridge needs, registered once from `main`.
#[derive(Clone)]
pub struct ChatContext {
    /// The chat service (clones share the store, provider table, and bus).
    pub service: ChatService,
    /// The open store, used for provider lookup and ad-hoc queries.
    pub db: Database,
}

// OnceLock with runtime input registered by `main` — not a declaration-time
// initializer, so `LazyLock` does not apply.
static CHAT: OnceLock<ChatContext> = OnceLock::new();
static PROVIDER_OVERRIDE: OnceLock<ProviderResolution> = OnceLock::new();

#[derive(Clone)]
pub(crate) struct ProviderResolution {
    pub(crate) id: String,
    pub(crate) config: ProviderConfig,
    pub(crate) model: String,
}

impl ProviderResolution {
    fn label(&self) -> String {
        if self.model.trim().is_empty() {
            String::new()
        } else {
            format!("{} · {}", self.id, self.model)
        }
    }
}

/// Register the chat context. Silently keeps the first registration.
pub fn set_chat_context(service: ChatService, db: Database) {
    let _ = CHAT.set(ChatContext { service, db });
}

/// Borrow the registered context, if any.
pub(crate) fn chat_context() -> Option<&'static ChatContext> {
    CHAT.get()
}

/// Register a provider override (used by `--smoke` for the local SSE mock).
pub fn set_chat_provider_override(id: &str, model: &str, base_url: Option<&str>) {
    let _ = PROVIDER_OVERRIDE.set(ProviderResolution {
        id: id.to_string(),
        config: ProviderConfig {
            // The local mock does no auth; the key merely satisfies the
            // `openai-compatible` credential schema.
            api_key: Some("smoke-mock-key".to_string()),
            base_url: base_url.map(str::to_string),
            model: Some(model.to_string()),
            extra_json: Default::default(),
        },
        model: model.to_string(),
    });
}

// ---------------------------------------------------------------------------
// Smoke telemetry (set only when `--smoke`)
// ---------------------------------------------------------------------------

static SMOKE_DELTAS: AtomicU64 = AtomicU64::new(0);
static SMOKE_OUTCOME: Mutex<Option<&'static str>> = Mutex::new(None);

/// Record the smoke outcome (`done` / `error`). No-op outside smoke mode.
fn smoke_note_outcome(outcome: &'static str) {
    if !crate::bridges::smoke() {
        return;
    }
    if let Ok(mut guard) = SMOKE_OUTCOME.lock() {
        if guard.is_none() {
            *guard = Some(outcome);
        }
    }
}

/// `done` when the smoke ping completed, `error` when it failed, else missing.
pub fn smoke_chat_outcome() -> Option<&'static str> {
    SMOKE_OUTCOME.lock().ok().and_then(|g| *g)
}

/// Number of assistant deltas applied during the smoke run.
pub fn smoke_delta_count() -> u64 {
    SMOKE_DELTAS.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Smoke-only local SSE mock provider (real wire path, canned response)
// ---------------------------------------------------------------------------

/// Bind an ephemeral `127.0.0.1` port serving a canned OpenAI-compatible SSE
/// stream, then register it as the `openai-compatible` provider override.
///
/// Intended for `--smoke` only. Call after [`set_chat_context`].
pub fn smoke_register_mock_provider() {
    if chat_context().is_none() {
        eprintln!("[airi-slint] smoke: chat context not registered; skipping mock provider");
        return;
    }
    // reqwest honours *_proxy env vars; a corporate proxy would eat the canned
    // stream, so smoke clears them (smoke mode only, never in normal runs).
    for key in [
        "http_proxy",
        "https_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "all_proxy",
    ] {
        std::env::remove_var(key);
    }
    let listener = match std::net::TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[airi-slint] smoke: failed to bind mock provider: {e}");
            return;
        }
    };
    if let Err(e) = listener.set_nonblocking(true) {
        eprintln!("[airi-slint] smoke: failed to set nonblocking listener: {e}");
        return;
    }
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            eprintln!("[airi-slint] smoke: failed to read mock provider addr: {e}");
            return;
        }
    };
    let base_url = format!("http://127.0.0.1:{port}/v1");
    set_chat_provider_override("openai-compatible", "smoke-mock", Some(&base_url));
    eprintln!("[airi-slint] smoke: mock provider bound at {base_url}");

    let Some(handle) = crate::bridges::runtime_handle().cloned() else {
        eprintln!("[airi-slint] smoke: no runtime handle; mock provider unused");
        return;
    };
    handle.spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[airi-slint] smoke: mock provider listener failed: {e}");
                return;
            }
        };
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buf = Vec::with_capacity(8192);
                let mut chunk = [0u8; 4096];
                // Read the request head, then drain `content-length` bytes of
                // body so the client does not see a reset before our answer.
                let mut head_end: Option<usize> = None;
                let mut content_length = 0usize;
                loop {
                    match socket.read(&mut chunk).await {
                        Ok(0) => return,
                        Ok(n) => {
                            buf.extend_from_slice(&chunk[..n]);
                            if head_end.is_none() {
                                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                                    head_end = Some(pos + 4);
                                    content_length = parse_content_length(&buf[..pos]);
                                }
                            }
                            if let Some(body_start) = head_end {
                                if buf.len() >= body_start + content_length {
                                    break;
                                }
                            }
                        }
                        Err(_) => return,
                    }
                }
                let frames = [
                    "{\"choices\":[{\"delta\":{\"content\":\"Hello from the airi-slint smoke tour — \"}}]}",
                    "{\"choices\":[{\"delta\":{\"content\":\"the chat bridge is streaming.\"}}]}",
                    "{\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}",
                ];
                let mut body = String::new();
                for frame in frames {
                    body.push_str("data: ");
                    body.push_str(frame);
                    body.push_str("\n\n");
                }
                body.push_str("data: [DONE]\n\n");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn parse_content_length(head: &[u8]) -> usize {
    let text = String::from_utf8_lossy(head);
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            if let Ok(n) = value.trim().parse::<usize>() {
                return n;
            }
        }
    }
    0
}

// ---------------------------------------------------------------------------
// Card storage
// ---------------------------------------------------------------------------

/// Directories scanned for character cards, in ascending precedence.
pub(crate) fn card_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(base) = platform_data_dir() {
        dirs.push(base.join("airi-slint").join("cards"));
    }
    if let Some(local) = crate::bridges::profile_dir() {
        dirs.push(local.join("cards"));
    }
    dirs
}

/// Directory `--import-card` writes to when no explicit `--profile` is set.
/// The platform data dir so a card imported without `--profile` is found by
/// the default launch as well.
pub(crate) fn card_import_dir() -> Option<PathBuf> {
    platform_data_dir().map(|base| base.join("airi-slint").join("cards"))
}
/// Where a card imported from the GUI goes: the profile cards dir when
/// `--profile` was passed explicitly, otherwise the platform data dir (so
/// the default launch finds it), falling back to the profile dir. Shared
/// by `--import-card` and the in-app import button.
#[must_use]
pub(crate) fn card_gui_import_dir() -> Option<PathBuf> {
    if crate::bridges::profile_explicit() {
        return crate::bridges::profile_dir().map(|p| p.join("cards"));
    }
    card_import_dir().or_else(|| crate::bridges::profile_dir().map(|p| p.join("cards")))
}

/// Parse `src` as a character card (`.png` CCv2/CCv3 or `.json`), copy it
/// into `cards_dir` under `<slug>-<nanos>.<ext>`, and return the
/// destination path and the card's display name. `cards_dir` is created if
/// missing.
///
/// # Errors
///
/// Returns a human-readable message when the file is unreadable, is not a
/// parsable card, or the copy fails.
pub(crate) fn import_card_file(
    src: &std::path::Path,
    cards_dir: &std::path::Path,
) -> Result<(PathBuf, String), String> {
    std::fs::create_dir_all(cards_dir)
        .map_err(|e| format!("failed to create {}: {e}", cards_dir.display()))?;
    let bytes = std::fs::read(src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;
    let is_png = bytes.starts_with(&[0x89, b'P', b'N', b'G']);
    let parsed = if is_png {
        extract_card_from_png(&bytes).map(|c| c.name().to_string())
    } else {
        parse_card_json(&bytes).map(|c| c.name().to_string())
    };
    let name = parsed.map_err(|e| format!("{} is not a parsable card: {e}", src.display()))?;
    let mut slug = String::with_capacity(name.len());
    let mut last_was_dash = true;
    for c in name.chars().flat_map(|c| c.to_lowercase()) {
        if c.is_alphanumeric() {
            slug.push(c);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        slug = "card".to_string();
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ext = if is_png { "png" } else { "json" };
    let dest = cards_dir.join(format!("{slug}-{nanos:x}.{ext}"));
    std::fs::copy(src, &dest).map_err(|e| {
        format!(
            "failed to copy {} to {}: {e}",
            src.display(),
            dest.display()
        )
    })?;
    Ok((dest, name))
}

#[cfg(unix)]
fn platform_data_dir() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg));
        }
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
}

#[cfg(not(unix))]
fn platform_data_dir() -> Option<PathBuf> {
    None
}

pub(crate) struct CardEntryData {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) avatar: String,
    #[allow(dead_code)]
    pub(crate) system_prompt: Option<String>,
    pub(crate) greeting: Option<String>,
}

pub(crate) fn load_card_file(path: &std::path::Path) -> Option<CardEntryData> {
    let bytes = std::fs::read(path).ok()?;
    let is_png = bytes.starts_with(&[0x89, b'P', b'N', b'G']);
    let card = if is_png {
        extract_card_from_png(&bytes).ok()?
    } else {
        parse_card_json(&bytes).ok()?
    };
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| "card".to_string());
    let avatar = if is_png {
        path.to_string_lossy().into_owned()
    } else {
        String::new()
    };
    Some(CardEntryData {
        id,
        name: card.name().to_string(),
        avatar,
        system_prompt: compose_system_prompt(&card),
        greeting: card.primary_greeting().map(str::to_string),
    })
}

/// Scan the card dirs; the profile dir wins over the platform dir on id
/// collisions. Sorted by (lowercased) name.
pub(crate) fn scan_cards() -> Vec<CardEntryData> {
    let mut by_id: HashMap<String, CardEntryData> = HashMap::new();
    for dir in card_dirs() {
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            if !matches!(ext.as_deref(), Some("png" | "json")) {
                continue;
            }
            match load_card_file(&path) {
                Some(data) => {
                    by_id.insert(data.id.clone(), data);
                }
                None => {
                    eprintln!(
                        "[airi-slint] cards: skipping unparsable card {}",
                        path.display()
                    );
                }
            }
        }
    }
    let mut cards: Vec<CardEntryData> = by_id.into_values().collect();
    cards.sort_by_key(|c| c.name.to_lowercase());
    cards
}

/// Compose the system prompt from a card: an explicit `system_prompt` wins,
/// otherwise description + personality + scenario are joined with headers.
pub(crate) fn compose_system_prompt(card: &CharacterCard) -> Option<String> {
    let explicit = card.data.system_prompt.trim();
    if !explicit.is_empty() {
        return Some(card.data.system_prompt.clone());
    }
    let mut parts: Vec<String> = Vec::new();
    let description = card.data.description.trim();
    if !description.is_empty() {
        parts.push(description.to_string());
    }
    let personality = card.data.personality.trim();
    if !personality.is_empty() {
        parts.push(format!("Personality: {personality}"));
    }
    let scenario = card.data.scenario.trim();
    if !scenario.is_empty() {
        parts.push(format!("Scenario: {scenario}"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("msg-{nanos:x}-{count}")
}

fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

// ---------------------------------------------------------------------------
// Memory wiring (wave ⑬) — all behind `settings/memory.enabled`
// ---------------------------------------------------------------------------

/// `memory_embeddings.kind` for chat-journaled turns. Matches
/// `MemoryIndexer::index_journal_entry` and the backfill dedup key used by
/// `MemoryIndexer::index_missing` (`kind = 'journal'`), so a completed turn
/// is embedded exactly once and never re-embedded by the backfill button.
const MEMORY_INDEX_KIND: &str = "journal";
/// Truncation budget per side (`User:` / `AI:`) of a journaled turn note.
const JOURNAL_SIDE_TRUNCATION: usize = 800;

/// Collapse every whitespace run (newlines, tabs, …) to a single space so a
/// journaled turn note stays on one line.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Append the completed turn as a `note` journal entry and return the
/// entry to (best-effort) index.
///
/// Format: `User: <user text> / AI: <assistant text>`, each side truncated
/// to [`JOURNAL_SIDE_TRUNCATION`] Unicode scalars, newlines collapsed.
/// Returns `None` (logged, never fatal) when the assistant message cannot
/// be found or the append fails; an empty completion journals nothing.
fn journal_completed_turn(
    db: &Database,
    session: &str,
    assistant_message_id: &str,
) -> Option<IndexEntry> {
    let messages = match MessageRepo::new(db.clone()).list(session) {
        Ok(messages) => messages,
        Err(e) => {
            eprintln!("[airi-slint] memory: failed to load session {session} for journaling: {e}");
            return None;
        }
    };
    let assistant_pos = messages
        .iter()
        .rposition(|m| m.id == assistant_message_id)
        .unwrap_or_else(|| {
            eprintln!(
                "[airi-slint] memory: assistant message {assistant_message_id} not found; turn not journaled"
            );
            usize::MAX
        });
    if assistant_pos == usize::MAX {
        return None;
    }
    let assistant = &messages[assistant_pos];
    if assistant.content.trim().is_empty() {
        return None;
    }
    let user_text = messages[..assistant_pos]
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| truncate_chars(&one_line(&m.content), JOURNAL_SIDE_TRUNCATION))
        .unwrap_or_default();
    let ai_text = truncate_chars(&one_line(&assistant.content), JOURNAL_SIDE_TRUNCATION);
    let content = format!("User: {user_text} / AI: {ai_text}");
    match TextJournalService::new(db.clone()).append_note(&content) {
        Ok(id) => Some(IndexEntry {
            source_id: id,
            kind: MEMORY_INDEX_KIND.to_string(),
            content,
        }),
        Err(e) => {
            eprintln!("[airi-slint] memory: failed to journal the completed turn: {e}");
            None
        }
    }
}

/// Journal the completed turn when the memory flag is enabled; returns the
/// entry to index (the caller spawns the one-shot embedding task).
fn completed_turn_journal(
    enabled: bool,
    db: &Database,
    session: &str,
    assistant_message_id: &str,
) -> Option<IndexEntry> {
    if !enabled {
        return None;
    }
    journal_completed_turn(db, session, assistant_message_id)
}

/// Best-effort one-shot index of a freshly journaled entry. Any failure is
/// logged and swallowed — the row stays unembedded until the next
/// `MemoryIndexer::index_missing` backfill ("Index memories now").
async fn index_entry_best_effort(
    db: Database,
    embedder: Arc<dyn Embedder>,
    entry: &IndexEntry,
) -> bool {
    match MemoryIndexer::new(db, embedder)
        .index_if_enabled(true, entry)
        .await
    {
        Ok(indexed) => indexed,
        Err(e) => {
            eprintln!(
                "[airi-slint] memory: failed to index journal entry {}: {e}",
                entry.source_id
            );
            false
        }
    }
}

/// When the memory flag is enabled, retrieve relevant memories and prepend
/// them as a system message *before* the first system message (e.g. the
/// character card's) — or as the first message when none exists. Every
/// failure mode logs and leaves `messages` unchanged — a chat turn is
/// never failed over memory. No embed call happens when disabled.
async fn inject_memory_if_enabled(
    enabled: bool,
    top_k: i32,
    db: Database,
    embedder: Option<Arc<dyn Embedder>>,
    user_text: &str,
    messages: &mut Vec<ChatMessage>,
) {
    if !enabled {
        return;
    }
    let Some(embedder) = embedder else {
        eprintln!("[airi-slint] memory: no embedding client; continuing without memories");
        return;
    };
    // topK is clamped to 1–20 by the writers; clamp again defensively.
    let top_k = usize::try_from(top_k.clamp(1, 20)).unwrap_or(5);
    let retrieval = MemoryRetrieval::new(db, embedder);
    match retrieval.build_prompt_block(user_text, top_k).await {
        Ok(block) if !block.is_empty() => {
            messages.insert(
                0,
                ChatMessage {
                    role: Role::System,
                    content: block,
                    tool_call_id: None,
                },
            );
        }
        Ok(_) => {}
        Err(e) => {
            eprintln!("[airi-slint] memory retrieval failed, continuing without: {e}");
        }
    }
}

/// Map a persisted message back into an LLM message (unknown roles skipped).
fn to_chat_message(message: &StoredMessage) -> Option<ChatMessage> {
    let role = match message.role.as_str() {
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "system" => Role::System,
        _ => return None,
    };
    Some(ChatMessage {
        role,
        content: message.content.clone(),
        tool_call_id: None,
    })
}

fn chat_status_label(status: ChatStatus) -> &'static str {
    match status {
        ChatStatus::Idle => "idle",
        ChatStatus::Streaming => "streaming",
        ChatStatus::WaitingOnTool => "waiting-on-tool",
        ChatStatus::Error => "error",
    }
}

/// Resolve the provider to send through (see the module docs for the order).
/// `pub(crate)` so the memory bridge can resolve the *same* provider when
/// building its embedding client.
pub(crate) fn resolve_provider(ctx: &ChatContext) -> ProviderResolution {
    if let Some(o) = PROVIDER_OVERRIDE.get() {
        return o.clone();
    }
    if let Ok(id) = std::env::var("AIRI_QT_PROVIDER") {
        let id = id.trim().to_string();
        if !id.is_empty() {
            let config = ProviderConfig {
                api_key: std::env::var("AIRI_QT_API_KEY").ok(),
                base_url: std::env::var("AIRI_QT_BASE_URL").ok(),
                model: std::env::var("AIRI_QT_MODEL").ok(),
                extra_json: Default::default(),
            };
            let model = config.model.clone().unwrap_or_default();
            return ProviderResolution { id, config, model };
        }
    }
    let stored = crate::bridges::provider_repo()
        .map(|repo| repo.list())
        .unwrap_or_else(|| ProviderRepo::new(ctx.db.clone()).list());
    if let Ok(rows) = stored {
        if let Some(provider) = rows.into_iter().find(|p| p.enabled) {
            let config: ProviderConfig =
                serde_json::from_value(provider.config.clone()).unwrap_or_default();
            let model = config.model.clone().unwrap_or_default();
            return ProviderResolution {
                id: provider.id,
                config,
                model,
            };
        }
    }
    ProviderResolution {
        id: "openai".to_string(),
        config: ProviderConfig::default(),
        model: String::new(),
    }
}

/// Events pumped from the backend onto the Qt thread.
enum ChatUiEvent {
    Broadcast(ChatEvent),
    SessionDeleted { id: String },
    SendFailed { message: String },
}

// ---------------------------------------------------------------------------
// cxx-qt bridge
// ---------------------------------------------------------------------------

/// cxx-qt bridge definitions for the chat bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;

        // Registers `IsRelocatable<QList<T>>` for Qt 6 so the list can move
        // across the bridge (needed for the model properties).
        // Using-declaration for `QList_QVariant` + IsRelocatable<QList<T>>.
        include!("cxx-qt-lib/core/qlist/qlist_QVariant.h");
        include!("cxx-qt-lib/qvariant.h");
        /// `QList<QVariant>` (QVariantList metatype) handed to QML delegates
        /// as a sequence (see docs/bridge-pattern.md).
        #[cxx_name = "QList_QVariant"]
        type QList_QVariant = cxx_qt_lib::QList<cxx_qt_lib::QVariant>;

        include!("cxx-qt-lib/common.h");
        /// Factory helpers generated by cxx-qt for instantiating QObjects.
        #[namespace = "rust::cxxqtlib1"]
        #[cxx_name = "make_unique"]
        #[doc(hidden)]
        fn chat_message_entry_make_unique() -> UniquePtr<ChatMessageEntry>;

        #[namespace = "rust::cxxqtlib1"]
        #[cxx_name = "make_unique"]
        #[doc(hidden)]
        fn chat_session_entry_make_unique() -> UniquePtr<ChatSessionEntry>;

        #[namespace = "rust::cxxqtlib1"]
        #[cxx_name = "make_unique"]
        #[doc(hidden)]
        fn chat_card_entry_make_unique() -> UniquePtr<ChatCardEntry>;
    }

    extern "RustQt" {
        /// One transcript message. `content` grows in place while streaming.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, id)]
        #[qproperty(QString, role)]
        #[qproperty(QString, content)]
        #[qproperty(i64, created_at, cxx_name = "createdAt")]
        type ChatMessageEntry = super::ChatMessageEntryRust;
    }

    extern "RustQt" {
        /// One row of the recent-sessions list.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, id)]
        #[qproperty(QString, title)]
        #[qproperty(i64, updated_at, cxx_name = "updatedAt")]
        type ChatSessionEntry = super::ChatSessionEntryRust;
    }

    extern "RustQt" {
        /// One importable character card.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, id)]
        #[qproperty(QString, name)]
        #[qproperty(QString, avatar_path, cxx_name = "avatarPath")]
        type ChatCardEntry = super::ChatCardEntryRust;
    }

    extern "RustQt" {
        /// Chat controller exposed to QML.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, streaming)]
        #[qproperty(QString, status)]
        #[qproperty(QString, error)]
        #[qproperty(QString, title)]
        #[qproperty(QString, session_id, cxx_name = "sessionId")]
        #[qproperty(QString, provider_label, cxx_name = "providerLabel")]
        #[qproperty(QString, assistant_name, cxx_name = "assistantName")]
        #[qproperty(QString, active_card_id, cxx_name = "activeCardId")]
        #[qproperty(QString, active_card_avatar, cxx_name = "activeCardAvatar")]
        #[qproperty(QString, streaming_message_id, cxx_name = "streamingMessageId")]
        #[qproperty(QList_QVariant, messages_model, cxx_name = "messagesModel")]
        #[qproperty(QList_QVariant, sessions_model, cxx_name = "sessionsModel")]
        #[qproperty(QList_QVariant, cards_model, cxx_name = "cardsModel")]
        type ChatController = super::ChatControllerRust;
    }

    extern "RustQt" {
        /// Drain backend events on the Qt thread (called by a QML timer).
        #[qinvokable]
        #[cxx_name = "pumpEvents"]
        fn pump_events(self: Pin<&mut ChatController>);

        /// Create a fresh session (applying the active card's greeting).
        #[qinvokable]
        #[cxx_name = "newSession"]
        fn new_session(self: Pin<&mut ChatController>);

        /// Switch to `id` and load its transcript.
        #[qinvokable]
        #[cxx_name = "selectSession"]
        fn select_session(self: Pin<&mut ChatController>, id: QString);

        /// Delete `id` and its messages. When the deleted session was
        /// current, a fresh session is created automatically.
        #[qinvokable]
        #[cxx_name = "deleteSession"]
        fn delete_session(self: Pin<&mut ChatController>, id: QString);

        /// Send `text` in the current session (creating one on demand).
        #[qinvokable]
        #[cxx_name = "send"]
        fn send(self: Pin<&mut ChatController>, text: QString);

        /// Request cancellation of the in-flight generation.
        #[qinvokable]
        fn stop(self: Pin<&mut ChatController>);

        /// Apply the character card `id` to the current (empty) session, or
        /// create one; new sessions keep the card's persona.
        #[qinvokable]
        #[cxx_name = "activateCard"]
        fn activate_card(self: Pin<&mut ChatController>, id: QString);

        /// Deactivate the current card.
        #[qinvokable]
        #[cxx_name = "clearCard"]
        fn clear_card(self: Pin<&mut ChatController>);

        /// Re-scan the card directories and rebuild the cards model.
        #[qinvokable]
        #[cxx_name = "listCards"]
        fn list_cards(self: Pin<&mut ChatController>);

        /// Import a character card (`.png` CCv2/CCv3 or `.json`) from the
        /// given filesystem path into the cards directory. Returns the
        /// absolute destination path, or `""` on failure. Re-scans the
        /// cards model on success.
        #[qinvokable]
        #[cxx_name = "importCard"]
        fn import_card(self: Pin<&mut ChatController>, src_path: QString) -> QString;

        /// Clear the error banner.
        #[qinvokable]
        #[cxx_name = "clearError"]
        fn clear_error(self: Pin<&mut ChatController>);

        /// `true` when the process was launched with `--smoke`.
        #[qinvokable]
        #[cxx_name = "isSmoke"]
        fn is_smoke(self: &ChatController) -> bool;
    }
}

/// Rust storage for `ChatMessageEntry`.
#[derive(Default)]
pub struct ChatMessageEntryRust {
    id: QString,
    role: QString,
    content: QString,
    created_at: i64,
}

/// Rust storage for `ChatSessionEntry`.
#[derive(Default)]
pub struct ChatSessionEntryRust {
    id: QString,
    title: QString,
    updated_at: i64,
}

/// Rust storage for `ChatCardEntry`.
#[derive(Default)]
pub struct ChatCardEntryRust {
    id: QString,
    name: QString,
    avatar_path: QString,
}

/// Rust storage for `ChatController`.
pub struct ChatControllerRust {
    streaming: bool,
    status: QString,
    error: QString,
    title: QString,
    session_id: QString,
    provider_label: QString,
    assistant_name: QString,
    active_card_id: QString,
    active_card_avatar: QString,
    streaming_message_id: QString,
    messages_model: QList<QVariant>,
    sessions_model: QList<QVariant>,
    cards_model: QList<QVariant>,

    entries: Vec<cxx::UniquePtr<qobject::ChatMessageEntry>>,
    session_entries: Vec<cxx::UniquePtr<qobject::ChatSessionEntry>>,
    card_entries: Vec<cxx::UniquePtr<qobject::ChatCardEntry>>,

    streaming_content: String,
    current_entry: Option<usize>,
    current_assistant_id: Option<String>,
    pending_counter: u64,

    active_system_prompt: Option<String>,
    active_greeting: Option<String>,
    active_card_name: Option<String>,

    tx: tokio::sync::mpsc::UnboundedSender<ChatUiEvent>,
    rx: Option<tokio::sync::mpsc::UnboundedReceiver<ChatUiEvent>>,
}

// --- Construction-time helpers (storage only; no property notifications) --

fn build_message_parts(
    messages: &[StoredMessage],
) -> (
    Vec<cxx::UniquePtr<qobject::ChatMessageEntry>>,
    QList<QVariant>,
) {
    let mut entries = Vec::with_capacity(messages.len());
    let mut list = QList::default();
    for message in messages {
        if message.role != "user" && message.role != "assistant" {
            continue;
        }
        let mut unique = qobject::chat_message_entry_make_unique();
        {
            let mut entry = unique.pin_mut();
            entry.as_mut().set_id(QString::from(message.id.as_str()));
            entry
                .as_mut()
                .set_role(QString::from(message.role.as_str()));
            entry
                .as_mut()
                .set_content(QString::from(message.content.as_str()));
            entry.as_mut().set_created_at(message.created_at);
        }
        let ptr = unsafe { QObjectMutPtr::from_raw(unique.as_ptr() as *mut cxx_qt::QObject) };
        list.append(QVariant::from(&ptr));
        entries.push(unique);
    }
    (entries, list)
}

fn build_session_parts(
    sessions: &[StoredSession],
) -> (
    Vec<cxx::UniquePtr<qobject::ChatSessionEntry>>,
    QList<QVariant>,
) {
    let mut entries = Vec::with_capacity(sessions.len());
    let mut list = QList::default();
    for session in sessions {
        let mut unique = qobject::chat_session_entry_make_unique();
        {
            let mut entry = unique.pin_mut();
            entry.as_mut().set_id(QString::from(session.id.as_str()));
            entry
                .as_mut()
                .set_title(QString::from(session.title.as_str()));
            entry.as_mut().set_updated_at(session.updated_at);
        }
        let ptr = unsafe { QObjectMutPtr::from_raw(unique.as_ptr() as *mut cxx_qt::QObject) };
        list.append(QVariant::from(&ptr));
        entries.push(unique);
    }
    (entries, list)
}

fn build_card_parts(
    cards: &[CardEntryData],
) -> (Vec<cxx::UniquePtr<qobject::ChatCardEntry>>, QList<QVariant>) {
    let mut entries = Vec::with_capacity(cards.len());
    let mut list = QList::default();
    for card in cards {
        let mut unique = qobject::chat_card_entry_make_unique();
        {
            let mut entry = unique.pin_mut();
            entry.as_mut().set_id(QString::from(card.id.as_str()));
            entry.as_mut().set_name(QString::from(card.name.as_str()));
            entry
                .as_mut()
                .set_avatar_path(QString::from(card.avatar.as_str()));
        }
        let ptr = unsafe { QObjectMutPtr::from_raw(unique.as_ptr() as *mut cxx_qt::QObject) };
        list.append(QVariant::from(&ptr));
        entries.push(unique);
    }
    (entries, list)
}

fn load_session_storage(
    storage: &mut ChatControllerRust,
    ctx: &ChatContext,
    session: &StoredSession,
) {
    let messages = MessageRepo::new(ctx.db.clone())
        .list(&session.id)
        .unwrap_or_default();
    let (entries, list) = build_message_parts(&messages);
    storage.entries = entries;
    storage.messages_model = list;
    storage.session_id = QString::from(session.id.as_str());
    storage.title = QString::from(session.title.as_str());
    storage.error = QString::from("");
    storage.streaming_content.clear();
    storage.current_entry = None;
    storage.current_assistant_id = None;
    let status = ctx.service.status(&session.id);
    storage.status = QString::from(chat_status_label(status));
    storage.streaming = status == ChatStatus::Streaming;
    storage.streaming_message_id = QString::from("");
}

impl Default for ChatControllerRust {
    fn default() -> Self {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let mut storage = Self {
            streaming: false,
            status: QString::from("idle"),
            error: QString::from(""),
            title: QString::from(""),
            session_id: QString::from(""),
            provider_label: QString::from(""),
            assistant_name: QString::from("AIRI"),
            active_card_id: QString::from(""),
            active_card_avatar: QString::from(""),
            streaming_message_id: QString::from(""),
            messages_model: QList::default(),
            sessions_model: QList::default(),
            cards_model: QList::default(),
            entries: Vec::new(),
            session_entries: Vec::new(),
            card_entries: Vec::new(),
            streaming_content: String::new(),
            current_entry: None,
            current_assistant_id: None,
            pending_counter: 0,
            active_system_prompt: None,
            active_greeting: None,
            active_card_name: None,
            tx: tx.clone(),
            rx: Some(rx),
        };
        // Forward broadcast events into the Qt-thread pump channel.
        if let (Some(ctx), Some(handle)) =
            (chat_context(), crate::bridges::runtime_handle().cloned())
        {
            let mut broadcast_rx = ctx.service.subscribe();
            handle.spawn(async move {
                loop {
                    match broadcast_rx.recv().await {
                        Ok(event) => {
                            if tx.send(ChatUiEvent::Broadcast(event)).is_err() {
                                return;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            eprintln!("[airi-slint] chat: pump lagged, dropped {n} events");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    }
                }
            });
        } else {
            eprintln!("[airi-slint] chat: context/runtime not registered; controller inert");
        }
        // Restore the most recent session, if any, and pre-load the cards.
        if let Some(ctx) = chat_context() {
            storage.provider_label = QString::from(resolve_provider(ctx).label());
            if let Ok(sessions) = SessionRepo::new(ctx.db.clone()).list() {
                let (entries, list) = build_session_parts(&sessions);
                storage.session_entries = entries;
                storage.sessions_model = list;
                if let Some(latest) = sessions.first() {
                    load_session_storage(&mut storage, ctx, latest);
                }
            }
        }
        let cards = scan_cards();
        let (card_entries, card_list) = build_card_parts(&cards);
        storage.card_entries = card_entries;
        storage.cards_model = card_list;
        storage
    }
}

/// Persist a greeting as the assistant message of `session_id`; returns it.
fn persist_greeting(
    ctx: &ChatContext,
    session_id: &str,
    greeting: &str,
) -> anyhow::Result<StoredMessage> {
    let message = StoredMessage {
        id: new_id(),
        session_id: session_id.to_string(),
        role: "assistant".to_string(),
        content: greeting.to_string(),
        created_at: now_ms(),
        metadata: json!({ "cardGreeting": true }),
    };
    MessageRepo::new(ctx.db.clone()).insert(&message)?;
    Ok(message)
}

/// Create a session, optionally seeded with the card greeting; the greeting is
/// persisted (and returned) when present.
fn start_session(
    ctx: &ChatContext,
    title: &str,
    greeting: Option<&str>,
) -> anyhow::Result<(StoredSession, Option<StoredMessage>)> {
    let session = ctx.service.new_session_with_title(title)?;
    let greeting_message = match greeting {
        Some(g) if !g.trim().is_empty() => Some(persist_greeting(ctx, &session.id, g)?),
        _ => None,
    };
    Ok((session, greeting_message))
}

// ---------------------------------------------------------------------------
// ChatController
// ---------------------------------------------------------------------------

impl qobject::ChatController {
    /// Read the registered context or set the error banner.
    fn ctx(self: &Pin<&mut Self>) -> Option<&'static ChatContext> {
        let ctx = chat_context();
        if ctx.is_none() {
            eprintln!("[airi-slint] chat: context not registered; ignoring request");
        }
        ctx
    }

    fn set_error_text(mut self: Pin<&mut Self>, message: &str) {
        self.as_mut().set_error(QString::from(message));
        self.as_mut().set_status(QString::from("error"));
        self.as_mut().set_streaming(false);
        self.as_mut().set_streaming_message_id(QString::from(""));
        {
            let mut rust = self.as_mut().rust_mut();
            rust.streaming = false;
            rust.streaming_content.clear();
            rust.current_entry = None;
            rust.current_assistant_id = None;
        }
        smoke_note_outcome("error");
    }

    /// Push a fresh entry to the model; returns its index in `entries`.
    fn push_entry(
        mut self: Pin<&mut Self>,
        id: &str,
        role: &str,
        content: &str,
        created_at: i64,
    ) -> usize {
        let mut unique = qobject::chat_message_entry_make_unique();
        {
            let mut entry = unique.pin_mut();
            entry.as_mut().set_id(QString::from(id));
            entry.as_mut().set_role(QString::from(role));
            entry.as_mut().set_content(QString::from(content));
            entry.as_mut().set_created_at(created_at);
        }
        let ptr = unsafe { QObjectMutPtr::from_raw(unique.as_ptr() as *mut cxx_qt::QObject) };
        let list = {
            let rust = self.as_ref().get_ref();
            let mut list = rust.messages_model.clone();
            list.append(QVariant::from(&ptr));
            list
        };
        self.as_mut().set_messages_model(list);
        let idx = {
            let mut rust = self.as_mut().rust_mut();
            rust.entries.push(unique);
            rust.entries.len() - 1
        };
        idx
    }

    /// Pop the trailing assistant placeholder while it is still empty.
    fn remove_pending_placeholder(mut self: Pin<&mut Self>) {
        let should_remove = {
            let rust = self.as_ref().get_ref();
            rust.current_entry.is_some()
                && rust.current_assistant_id.is_none()
                && rust.streaming_content.is_empty()
                && rust.current_entry == Some(rust.entries.len().saturating_sub(1))
        };
        if !should_remove {
            return;
        }
        let list = {
            let mut rust = self.as_mut().rust_mut();
            rust.entries.pop();
            let mut list = rust.messages_model.clone();
            let last = list.len() - 1;
            list.remove(last);
            list
        };
        self.as_mut().set_messages_model(list);
        self.as_mut().rust_mut().current_entry = None;
    }

    /// Clear the transcript model and drop the old entries (after notify).
    fn clear_transcript(mut self: Pin<&mut Self>) {
        let old_entries = {
            let mut rust = self.as_mut().rust_mut();
            rust.current_entry = None;
            rust.current_assistant_id = None;
            rust.streaming_content.clear();
            std::mem::take(&mut rust.entries)
        };
        self.as_mut().set_messages_model(QList::default());
        drop(old_entries);
    }

    /// Rebuild the sessions model from the store.
    fn reload_sessions(mut self: Pin<&mut Self>) {
        let Some(ctx) = chat_context() else {
            return;
        };
        let Ok(sessions) = SessionRepo::new(ctx.db.clone()).list() else {
            return;
        };
        let (entries, list) = build_session_parts(&sessions);
        let old = {
            let mut rust = self.as_mut().rust_mut();
            std::mem::replace(&mut rust.session_entries, entries)
        };
        self.as_mut().set_sessions_model(list);
        drop(old);
    }

    /// Rebuild the cards model by re-scanning the card dirs.
    fn reload_cards(mut self: Pin<&mut Self>) {
        let cards = scan_cards();
        let (entries, list) = build_card_parts(&cards);
        let old = {
            let mut rust = self.as_mut().rust_mut();
            std::mem::replace(&mut rust.card_entries, entries)
        };
        self.as_mut().set_cards_model(list);
        drop(old);
    }

    /// Switch to session `id`: load history, swap the transcript model.
    fn switch_to_session(mut self: Pin<&mut Self>, id: &str) -> bool {
        let Some(ctx) = chat_context() else {
            return false;
        };
        let session = match SessionRepo::new(ctx.db.clone()).get(id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                eprintln!("[airi-slint] chat: selectSession: unknown session {id}");
                return false;
            }
            Err(e) => {
                eprintln!("[airi-slint] chat: selectSession failed: {e}");
                return false;
            }
        };
        let messages = MessageRepo::new(ctx.db.clone())
            .list(&session.id)
            .unwrap_or_default();
        let (entries, list) = build_message_parts(&messages);
        let old = {
            let mut rust = self.as_mut().rust_mut();
            std::mem::replace(&mut rust.entries, entries)
        };
        self.as_mut().set_messages_model(list);
        drop(old);
        let status = ctx.service.status(&session.id);
        self.as_mut()
            .set_session_id(QString::from(session.id.as_str()));
        self.as_mut()
            .set_title(QString::from(session.title.as_str()));
        self.as_mut().set_error(QString::from(""));
        self.as_mut()
            .set_status(QString::from(chat_status_label(status)));
        self.as_mut().set_streaming(status == ChatStatus::Streaming);
        self.as_mut().set_streaming_message_id(QString::from(""));
        self.as_mut().rust_mut().streaming = status == ChatStatus::Streaming;
        self.as_mut().rust_mut().streaming_content.clear();
        self.as_mut().rust_mut().current_entry = None;
        self.as_mut().rust_mut().current_assistant_id = None;
        true
    }

    fn is_current_session(self: &Pin<&mut Self>, session: &str) -> bool {
        qstring_to_string(&self.as_ref().get_ref().session_id) == session
    }

    fn apply_chat_event(mut self: Pin<&mut Self>, event: ChatEvent) -> bool {
        match event {
            ChatEvent::Delta {
                session,
                message,
                delta,
            } => {
                if !self.is_current_session(&session) {
                    return false;
                }
                if crate::bridges::smoke() {
                    SMOKE_DELTAS.fetch_add(1, Ordering::SeqCst);
                }
                self.as_mut().append_delta(&message, &delta);
                false
            }
            ChatEvent::MessageDone { session, message } => {
                if !self.is_current_session(&session) {
                    return false;
                }
                self.as_mut().set_streaming(false);
                self.as_mut().set_status(QString::from("idle"));
                self.as_mut().set_streaming_message_id(QString::from(""));
                {
                    let mut rust = self.as_mut().rust_mut();
                    rust.streaming = false;
                    rust.streaming_content.clear();
                    rust.current_entry = None;
                    rust.current_assistant_id = None;
                }
                smoke_note_outcome("done");
                // Memory wiring (behind settings/memory.enabled): journal the
                // completed turn, then embed it with one batched call against
                // the chat provider. Nothing is journaled or embedded when off.
                if let Some(ctx) = chat_context() {
                    let memory = crate::bridges::memory::memory_preferences();
                    if let Some(entry) =
                        completed_turn_journal(memory.enabled, &ctx.db, &session, &message)
                    {
                        let resolution = resolve_provider(ctx);
                        match EmbeddingClient::from_provider_config(
                            &resolution.config,
                            DEFAULT_EMBEDDING_MODEL,
                        ) {
                            Ok(client) => {
                                if let Some(handle) = crate::bridges::runtime_handle().cloned() {
                                    let db = ctx.db.clone();
                                    handle.spawn(async move {
                                        index_entry_best_effort(db, Arc::new(client), &entry)
                                            .await;
                                    });
                                } else {
                                    eprintln!(
                                        "[airi-slint] memory: no runtime handle; journal entry {} left unembedded",
                                        entry.source_id
                                    );
                                }
                            }
                            Err(e) => eprintln!(
                                "[airi-slint] memory: embedding client unavailable ({e}); journal entry {} left unembedded — run \"Index memories now\" on the memory settings page",
                                entry.source_id
                            ),
                        }
                    }
                }
                true
            }
            ChatEvent::StatusChanged { session, status } => {
                if !self.is_current_session(&session) {
                    return false;
                }
                self.as_mut()
                    .set_status(QString::from(chat_status_label(status)));
                let streaming = status == ChatStatus::Streaming;
                self.as_mut().set_streaming(streaming);
                self.as_mut().rust_mut().streaming = streaming;
                false
            }
            ChatEvent::Error { session, message } => {
                if !self.is_current_session(&session) {
                    return false;
                }
                self.as_mut().remove_pending_placeholder();
                self.as_mut().set_error_text(&message);
                true
            }
        }
    }

    fn append_delta(mut self: Pin<&mut Self>, message_id: &str, delta: &str) {
        // Bind the placeholder to the provider-reported message id on the
        // first delta.
        if self.as_ref().get_ref().current_assistant_id.is_none() {
            let idx = self.as_ref().get_ref().current_entry;
            if let Some(idx) = idx {
                let mut rust = self.as_mut().rust_mut();
                if let Some(mut entry) = rust.entries.get_mut(idx).map(|u| u.pin_mut()) {
                    entry.as_mut().set_id(QString::from(message_id));
                }
                rust.current_assistant_id = Some(message_id.to_string());
                self.as_mut()
                    .set_streaming_message_id(QString::from(message_id));
            }
        }
        let mut rust = self.as_mut().rust_mut();
        rust.streaming_content.push_str(delta);
        let content = QString::from(rust.streaming_content.as_str());
        if let Some(idx) = rust.current_entry {
            if let Some(unique) = rust.entries.get_mut(idx) {
                let mut entry = unique.pin_mut();
                entry.as_mut().set_content(content);
            }
        }
    }

    fn apply_session_deleted(mut self: Pin<&mut Self>, id: &str) -> bool {
        let was_current = qstring_to_string(&self.as_ref().get_ref().session_id) == id;
        if was_current {
            self.as_mut().set_session_id(QString::from(""));
            self.as_mut().set_title(QString::from(""));
            self.as_mut().clear_transcript();
            self.as_mut().set_status(QString::from("idle"));
            self.as_mut().set_streaming(false);
            self.as_mut().rust_mut().streaming = false;
            self.as_mut().set_streaming_message_id(QString::from(""));
            self.new_session();
        }
        true
    }

    fn apply_failure(mut self: Pin<&mut Self>, message: &str) {
        self.as_mut().remove_pending_placeholder();
        self.as_mut().set_error_text(message);
    }

    fn spawn_delete(self: &Pin<&Self>, session_id: &str) {
        let Some(ctx) = chat_context() else {
            return;
        };
        let Some(handle) = crate::bridges::runtime_handle().cloned() else {
            eprintln!("[airi-slint] chat: no runtime handle; delete skipped");
            return;
        };
        let service = ctx.service.clone();
        let tx = self.as_ref().get_ref().tx.clone();
        let id = session_id.to_string();
        handle.spawn(async move {
            let _ = service.delete_session(id.clone()).await;
            let _ = tx.send(ChatUiEvent::SessionDeleted { id });
        });
    }

    /// Drain backend events. QML calls this on a 33 ms timer.
    pub fn pump_events(mut self: Pin<&mut Self>) {
        use tokio::sync::mpsc::error::TryRecvError;
        let Some(mut rx) = self.as_mut().rust_mut().rx.take() else {
            return;
        };
        let mut sessions_dirty = false;
        loop {
            match rx.try_recv() {
                Ok(ChatUiEvent::Broadcast(event)) => {
                    sessions_dirty |= self.as_mut().apply_chat_event(event)
                }
                Ok(ChatUiEvent::SessionDeleted { id }) => {
                    sessions_dirty |= self.as_mut().apply_session_deleted(&id)
                }
                Ok(ChatUiEvent::SendFailed { message }) => {
                    self.as_mut().apply_failure(&message);
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
        if sessions_dirty {
            self.as_mut().reload_sessions();
        }
        self.as_mut().rust_mut().rx = Some(rx);
    }

    /// Create a fresh session (applying the active card's greeting).
    pub fn new_session(mut self: Pin<&mut Self>) {
        let Some(_ctx) = self.ctx() else {
            self.as_mut()
                .set_error_text("Chat unavailable: the local store failed to open.");
            return;
        };
        let ctx = chat_context().expect("checked above");
        let greeting = self.as_ref().get_ref().active_greeting.clone();
        match start_session(ctx, "New chat", greeting.as_deref()) {
            Ok((session, greeting_message)) => {
                self.as_mut().clear_transcript();
                self.as_mut()
                    .set_session_id(QString::from(session.id.as_str()));
                self.as_mut()
                    .set_title(QString::from(session.title.as_str()));
                self.as_mut().set_error(QString::from(""));
                self.as_mut().set_status(QString::from("idle"));
                self.as_mut().set_streaming(false);
                self.as_mut().rust_mut().streaming = false;
                self.as_mut().set_streaming_message_id(QString::from(""));
                if let Some(message) = greeting_message {
                    self.as_mut().push_entry(
                        &message.id,
                        "assistant",
                        &message.content,
                        message.created_at,
                    );
                }
                self.as_mut().reload_sessions();
            }
            Err(e) => {
                let message = format!("Failed to create a chat session: {e}");
                self.as_mut().set_error_text(&message);
            }
        }
    }

    /// Switch to `id` and load its transcript.
    pub fn select_session(mut self: Pin<&mut Self>, id: QString) {
        let id = qstring_to_string(&id);
        if id.is_empty() {
            return;
        }
        self.as_mut().switch_to_session(&id);
    }

    /// Delete `id` and its messages. When the deleted session was current, a
    /// fresh session is created automatically.
    pub fn delete_session(self: Pin<&mut Self>, id: QString) {
        let id = qstring_to_string(&id);
        if id.is_empty() {
            return;
        }
        self.as_ref().spawn_delete(&id);
    }

    /// Send `text` in the current session (creating one on demand).
    pub fn send(mut self: Pin<&mut Self>, text: QString) {
        let text = qstring_to_string(&text);
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            return;
        }
        if self.as_ref().get_ref().streaming {
            return;
        }
        let Some(ctx) = chat_context().cloned() else {
            self.as_mut()
                .set_error_text("Chat unavailable: the local store failed to open.");
            return;
        };

        // Ensure a session exists (create one, applying the card greeting).
        let mut session_id = qstring_to_string(&self.as_ref().get_ref().session_id);
        if session_id.is_empty() {
            let title = {
                let truncated = truncate_chars(&trimmed, 48);
                if truncated.is_empty() {
                    "New chat".to_string()
                } else {
                    truncated
                }
            };
            let greeting = self.as_ref().get_ref().active_greeting.clone();
            match start_session(&ctx, &title, greeting.as_deref()) {
                Ok((session, greeting_message)) => {
                    self.as_mut()
                        .set_session_id(QString::from(session.id.as_str()));
                    self.as_mut()
                        .set_title(QString::from(session.title.as_str()));
                    if let Some(message) = greeting_message {
                        self.as_mut().push_entry(
                            &message.id,
                            "assistant",
                            &message.content,
                            message.created_at,
                        );
                    }
                    session_id = session.id;
                    self.as_mut().reload_sessions();
                }
                Err(e) => {
                    let message = format!("Failed to create a chat session: {e}");
                    self.as_mut().set_error_text(&message);
                    return;
                }
            }
        }

        // Persist the user message and append it to the transcript.
        let user_message = StoredMessage {
            id: new_id(),
            session_id: session_id.clone(),
            role: "user".to_string(),
            content: trimmed.clone(),
            created_at: now_ms(),
            metadata: json!({}),
        };
        if let Err(e) = MessageRepo::new(ctx.db.clone()).insert(&user_message) {
            let message = format!("Failed to store the message: {e}");
            self.as_mut().set_error_text(&message);
            return;
        }
        self.as_mut().push_entry(
            &user_message.id,
            "user",
            &user_message.content,
            user_message.created_at,
        );

        // Placeholder assistant entry; bound to the real message id on the
        // first delta.
        let pending_id = {
            let mut rust = self.as_mut().rust_mut();
            rust.pending_counter += 1;
            format!("pending-{}", rust.pending_counter)
        };
        let idx = self
            .as_mut()
            .push_entry(&pending_id, "assistant", "", now_ms());
        {
            let mut rust = self.as_mut().rust_mut();
            rust.streaming = true;
            rust.current_entry = Some(idx);
            rust.current_assistant_id = None;
            rust.streaming_content.clear();
        }
        self.as_mut().set_streaming(true);
        self.as_mut().set_status(QString::from("streaming"));
        self.as_mut().set_error(QString::from(""));
        self.as_mut()
            .set_streaming_message_id(QString::from(pending_id.as_str()));

        // Build the LLM message list: card system prompt, then history
        // (which already includes the user message just persisted).
        let history = MessageRepo::new(ctx.db.clone())
            .list(&session_id)
            .unwrap_or_default();
        let mut messages: Vec<ChatMessage> = Vec::with_capacity(history.len() + 1);
        if let Some(system) = self.as_ref().get_ref().active_system_prompt.clone() {
            messages.push(ChatMessage {
                role: Role::System,
                content: system,
                tool_call_id: None,
            });
        }
        messages.extend(history.iter().filter_map(to_chat_message));

        // Memory wiring: read the flag once here (retrieval itself is
        // async and runs inside the send task; the Qt thread never blocks
        // on the network).
        let memory = crate::bridges::memory::memory_preferences();
        let memory_user_text = trimmed.clone();
        let memory_db = ctx.db.clone();

        // Resolve the provider.
        let resolution = resolve_provider(&ctx);
        self.as_mut()
            .set_provider_label(QString::from(resolution.label()));
        if resolution.model.trim().is_empty() {
            self.as_mut().remove_pending_placeholder();
            self.as_mut().set_error_text(
                "No model configured. Set AIRI_QT_PROVIDER / AIRI_QT_MODEL (plus AIRI_QT_API_KEY / AIRI_QT_BASE_URL), or add an enabled provider with a `model` in its config.",
            );
            return;
        }
        let Some(handle) = crate::bridges::runtime_handle().cloned() else {
            self.as_mut().set_error_text("Chat runtime unavailable.");
            return;
        };
        let service = ctx.service.clone();
        let tx = self.as_ref().get_ref().tx.clone();
        let session_for_task = session_id.clone();
        let provider = resolution.id;
        let config = resolution.config;
        let model = resolution.model;
        let memory_config = config.clone();
        handle.spawn(async move {
            let mut messages = messages;
            if memory.enabled {
                let embedder = EmbeddingClient::from_provider_config(
                    &memory_config,
                    DEFAULT_EMBEDDING_MODEL,
                )
                .map(|client| Arc::new(client) as Arc<dyn Embedder>)
                .map_err(|e| {
                    eprintln!(
                        "[airi-slint] memory: embedding client unavailable ({e}); continuing without memories"
                    );
                    e
                })
                .ok();
                inject_memory_if_enabled(
                    memory.enabled,
                    memory.top_k,
                    memory_db,
                    embedder,
                    &memory_user_text,
                    &mut messages,
                )
                .await;
            }
            let result = service
                .stream(session_for_task, provider, config, model, messages)
                .await;
            if let Err(err) = result {
                let _ = tx.send(ChatUiEvent::SendFailed {
                    message: format!("{err:#}"),
                });
            }
        });
        self.as_mut().reload_sessions();
    }

    /// Request cancellation of the in-flight generation.
    pub fn stop(self: Pin<&mut Self>) {
        let session_id = qstring_to_string(&self.as_ref().get_ref().session_id);
        if session_id.is_empty() {
            return;
        }
        let Some(ctx) = chat_context().cloned() else {
            return;
        };
        let Some(handle) = crate::bridges::runtime_handle().cloned() else {
            return;
        };
        handle.spawn(async move {
            let _ = ctx.service.stop(session_id).await;
        });
    }

    /// Apply the character card `id`. Applies to the empty current session
    /// (persisting the greeting) or seeds a fresh session; later sends build
    /// on the card's system prompt.
    pub fn activate_card(mut self: Pin<&mut Self>, id: QString) {
        let id = qstring_to_string(&id);
        if id.trim().is_empty() {
            self.clear_card();
            return;
        }
        let cards = scan_cards();
        let Some(card) = cards.into_iter().find(|c| c.id == id) else {
            eprintln!("[airi-slint] chat: activateCard: unknown card {id}");
            return;
        };
        {
            let mut rust = self.as_mut().rust_mut();
            rust.active_system_prompt = card.system_prompt.clone();
            rust.active_greeting = card.greeting.clone();
            rust.active_card_name = Some(card.name.clone());
        }
        self.as_mut()
            .set_active_card_id(QString::from(card.id.as_str()));
        self.as_mut()
            .set_active_card_avatar(QString::from(card.avatar.as_str()));
        self.as_mut()
            .set_assistant_name(QString::from(card.name.as_str()));

        // Greet immediately when the current session is empty.
        if !self.as_ref().get_ref().entries.is_empty() {
            return;
        }
        let greeting = card.greeting.clone();
        let Some(_ctx) = self.ctx() else { return };
        let ctx = chat_context().expect("checked above");
        let session_id = qstring_to_string(&self.as_ref().get_ref().session_id);
        if session_id.is_empty() {
            match start_session(ctx, &card.name, greeting.as_deref()) {
                Ok((session, greeting_message)) => {
                    self.as_mut()
                        .set_session_id(QString::from(session.id.as_str()));
                    self.as_mut()
                        .set_title(QString::from(session.title.as_str()));
                    if let Some(message) = greeting_message {
                        self.as_mut().push_entry(
                            &message.id,
                            "assistant",
                            &message.content,
                            message.created_at,
                        );
                    }
                    self.as_mut().reload_sessions();
                }
                Err(e) => {
                    let message = format!("Failed to create a chat session: {e}");
                    self.as_mut().set_error_text(&message);
                }
            }
        } else if let Some(greeting) = greeting.as_deref() {
            match persist_greeting(ctx, &session_id, greeting) {
                Ok(message) => {
                    self.as_mut().push_entry(
                        &message.id,
                        "assistant",
                        &message.content,
                        message.created_at,
                    );
                    self.as_mut().reload_sessions();
                }
                Err(e) => {
                    let message = format!("Failed to store the greeting: {e}");
                    self.as_mut().set_error_text(&message);
                }
            }
        }
    }

    /// Deactivate the current card.
    pub fn clear_card(mut self: Pin<&mut Self>) {
        {
            let mut rust = self.as_mut().rust_mut();
            rust.active_system_prompt = None;
            rust.active_greeting = None;
            rust.active_card_name = None;
        }
        self.as_mut().set_active_card_id(QString::from(""));
        self.as_mut().set_active_card_avatar(QString::from(""));
        self.as_mut().set_assistant_name(QString::from("AIRI"));
    }

    /// Re-scan the card directories and rebuild the cards model.
    pub fn list_cards(self: Pin<&mut Self>) {
        self.reload_cards();
    }

    /// Import a character card from a filesystem path into the cards dir.
    /// Returns the absolute destination path, or `""` on failure.
    pub fn import_card(self: Pin<&mut Self>, src_path: QString) -> QString {
        let path = qstring_to_string(&src_path);
        let Some(dir) = card_gui_import_dir() else {
            eprintln!("[airi-slint] import-card: no cards directory resolvable");
            return QString::from("");
        };
        match import_card_file(std::path::Path::new(path.trim()), &dir) {
            Ok((dest, name)) => {
                eprintln!(
                    "[airi-slint] import-card: imported card {name:?} to {}",
                    dest.display()
                );
                let out = dest.to_string_lossy().into_owned();
                let mut this = self;
                this.as_mut().reload_cards();
                QString::from(out.as_str())
            }
            Err(e) => {
                eprintln!("[airi-slint] import-card: {e}");
                QString::from("")
            }
        }
    }

    /// Clear the error banner.
    pub fn clear_error(self: Pin<&mut Self>) {
        let mut this = self;
        this.as_mut().set_error(QString::from(""));
        if qstring_to_string(&this.as_ref().get_ref().status) == "error" {
            this.as_mut().set_status(QString::from("idle"));
        }
    }

    /// `true` when the process was launched with `--smoke`.
    pub fn is_smoke(&self) -> bool {
        crate::bridges::smoke()
    }
}

#[cfg(test)]
mod tests {
    //! Memory-wiring unit tests. Style note: unlike the smoke harness (which
    //! drives the real SSE mock through `--smoke`), these mock at the
    //! `Embedder` trait level — no Qt, no HTTP, no QML event loop. The Qt
    //! glue that *spawns* these calls (the `MessageDone` branch and the
    //! send-path injection site) is documented in
    //! `docs/phase-notes/p13-lane-memory-wiring.md` and is not unit-testable
    //! without a QML engine.
    use super::*;

    use airi_core::memory::embedding::EmbeddingError;
    use airi_store::{MemoryEmbeddingRepo, SessionRepo};

    struct TestDb {
        dir: PathBuf,
        db: Database,
    }

    fn temp_db() -> TestDb {
        let unique = format!(
            "airi-slint-chat-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let db = Database::open(&dir.join("test.sqlite")).expect("open db");
        TestDb { dir, db }
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// Canned embedder: records every `embed` call (one batched call per
    /// invocation, texts kept for assertions) and returns a fixed vector
    /// per input — or an error when `fail` is set.
    struct CannedEmbedder {
        calls: Mutex<Vec<Vec<String>>>,
        fail: bool,
    }

    impl CannedEmbedder {
        fn ok() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail: false,
            }
        }
        fn failing() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail: true,
            }
        }
        fn call_count(&self) -> usize {
            self.calls.lock().expect("call log").len()
        }
    }

    impl Embedder for CannedEmbedder {
        // The `Embedder` trait is `#[async_trait]`; without the async-trait
        // crate here, the impl spells out the desugared signature (one
        // elided lifetime per reference, all bound to `'async_trait`).
        fn embed<'life0, 'life1, 'async_trait>(
            &'life0 self,
            texts: &'life1 [String],
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Vec<Vec<f32>>, EmbeddingError>>
                    + Send
                    + 'async_trait,
            >,
        >
        where
            'life0: 'async_trait,
            'life1: 'async_trait,
        {
            Box::pin(async move {
                self.calls.lock().expect("call log").push(texts.to_vec());
                if self.fail {
                    return Err(EmbeddingError::Empty);
                }
                Ok(texts
                    .iter()
                    .map(|_| vec![0.5_f32, 0.25, 0.125, 1.0])
                    .collect())
            })
        }
    }

    fn msg(role: Role, content: &str) -> ChatMessage {
        ChatMessage {
            role,
            content: content.to_string(),
            tool_call_id: None,
        }
    }

    async fn seed_embedded_note(
        db: &Database,
        embedder: Arc<dyn Embedder>,
        source_id: &str,
        content: &str,
    ) {
        MemoryIndexer::new(db.clone(), embedder)
            .index_entries(&[IndexEntry {
                source_id: source_id.to_string(),
                kind: MEMORY_INDEX_KIND.to_string(),
                content: content.to_string(),
            }])
            .await
            .expect("seed index");
    }

    fn seed_session_with_turn(db: &Database, user: &str, assistant: &str) {
        SessionRepo::new(db.clone())
            .create("s1", "test")
            .expect("create session");
        MessageRepo::new(db.clone())
            .insert(&StoredMessage {
                id: "u1".to_string(),
                session_id: "s1".to_string(),
                role: "user".to_string(),
                content: user.to_string(),
                created_at: now_ms(),
                metadata: json!({}),
            })
            .expect("insert user message");
        MessageRepo::new(db.clone())
            .insert(&StoredMessage {
                id: "a1".to_string(),
                session_id: "s1".to_string(),
                role: "assistant".to_string(),
                content: assistant.to_string(),
                created_at: now_ms(),
                metadata: json!({}),
            })
            .expect("insert assistant message");
    }

    // --- Retrieval injection -------------------------------------------------

    #[tokio::test]
    async fn inject_memory_if_enabled_prepends_block_before_card_system_prompt() {
        let t = temp_db();
        let canned = Arc::new(CannedEmbedder::ok());
        let embedder: Arc<dyn Embedder> = canned.clone();
        seed_embedded_note(&t.db, embedder, "j1", "The user's cat is named Miso").await;
        // The seed call consumed one embedding call; reset the log so the
        // injection assertion counts only the retrieval query embed.
        canned.calls.lock().expect("call log").clear();

        let mut messages = vec![msg(Role::System, "card persona"), msg(Role::User, "hi")];
        inject_memory_if_enabled(
            true,
            5,
            t.db.clone(),
            Some(canned.clone()),
            "cat Miso",
            &mut messages,
        )
        .await;

        assert_eq!(messages.len(), 3, "memory block must be inserted");
        assert_eq!(messages[0].role, Role::System);
        assert!(
            messages[0].content.starts_with("Relevant memories"),
            "block: {}",
            messages[0].content
        );
        assert!(messages[0].content.contains("Miso"));
        // The card's system prompt keeps the slot right after the block.
        assert_eq!(messages[1].content, "card persona");
        // One retrieval query embed happened.
        assert_eq!(canned.call_count(), 1);
    }

    #[tokio::test]
    async fn inject_memory_if_enabled_disabled_is_byte_identical_and_embeds_nothing() {
        let t = temp_db();
        let canned = Arc::new(CannedEmbedder::ok());
        let mut messages = vec![msg(Role::System, "card persona"), msg(Role::User, "hi")];
        let snapshot = [messages[0].content.clone(), messages[1].content.clone()];
        inject_memory_if_enabled(
            false,
            5,
            t.db.clone(),
            Some(canned.clone()),
            "cat Miso",
            &mut messages,
        )
        .await;
        assert_eq!(messages.len(), snapshot.len());
        assert_eq!(messages[0].content, snapshot[0]);
        assert_eq!(messages[1].content, snapshot[1]);
        assert_eq!(canned.call_count(), 0, "no embed call when disabled");
    }

    #[tokio::test]
    async fn inject_memory_if_enabled_degrades_to_lexical_when_embedder_fails() {
        let t = temp_db();
        let canned = Arc::new(CannedEmbedder::ok());
        let seed: Arc<dyn Embedder> = canned.clone();
        seed_embedded_note(&t.db, seed, "j1", "cat Miso hunts mice").await;

        let failing: Arc<dyn Embedder> = Arc::new(CannedEmbedder::failing());
        let mut messages = vec![msg(Role::User, "about my cat Miso")];
        inject_memory_if_enabled(
            true,
            5,
            t.db.clone(),
            Some(failing),
            "cat Miso",
            &mut messages,
        )
        .await;
        // Lexical overlap keeps the block alive without a working embedder.
        assert_eq!(messages.len(), 2);
        assert!(messages[0].content.starts_with("Relevant memories"));

        // No lexical overlap at all → no injection, chat proceeds untouched.
        let failing: Arc<dyn Embedder> = Arc::new(CannedEmbedder::failing());
        let mut messages = vec![msg(Role::User, "zz qqq")];
        inject_memory_if_enabled(
            true,
            5,
            t.db.clone(),
            Some(failing),
            "zz qqq",
            &mut messages,
        )
        .await;
        assert_eq!(messages.len(), 1);
    }

    #[tokio::test]
    async fn inject_memory_if_enabled_continues_when_retrieval_hard_fails() {
        let t = temp_db();
        // Force `build_prompt_block` to error out by dropping the index table.
        t.db.with_connection(|conn| {
            conn.execute_batch("drop table memory_embeddings")?;
            Ok(())
        })
        .expect("drop index table");
        let mut messages = vec![msg(Role::User, "hi")];
        inject_memory_if_enabled(
            true,
            5,
            t.db.clone(),
            Some(Arc::new(CannedEmbedder::ok())),
            "cat",
            &mut messages,
        )
        .await;
        assert_eq!(messages.len(), 1, "chat proceeds without memories");
    }

    #[tokio::test]
    async fn inject_memory_if_enabled_adds_nothing_when_index_is_empty() {
        let t = temp_db();
        let mut messages = vec![msg(Role::User, "hi")];
        inject_memory_if_enabled(
            true,
            5,
            t.db.clone(),
            Some(Arc::new(CannedEmbedder::ok())),
            "cat Miso",
            &mut messages,
        )
        .await;
        assert_eq!(messages.len(), 1);
    }

    // --- Journal write path (completed turn) ---------------------------------

    #[tokio::test]
    async fn completed_turn_journal_disabled_writes_nothing() {
        let t = temp_db();
        seed_session_with_turn(&t.db, "hello world", "hi there");
        assert!(completed_turn_journal(false, &t.db, "s1", "a1").is_none());
        assert_eq!(
            TextJournalService::new(t.db.clone()).count().unwrap(),
            0,
            "flag off ⇒ nothing journaled"
        );
    }

    #[tokio::test]
    async fn completed_turn_journal_enabled_writes_one_line_note() {
        let t = temp_db();
        seed_session_with_turn(&t.db, "hello world\nsecond line\tor\r\nmore", "hi there");
        let entry = completed_turn_journal(true, &t.db, "s1", "a1").expect("journaled");
        assert_eq!(entry.kind, MEMORY_INDEX_KIND);
        assert!(
            !entry
                .content
                .chars()
                .any(|c| c == '\n' || c == '\r' || c == '\t'),
            "one line: {}",
            entry.content
        );
        assert_eq!(
            entry.content,
            "User: hello world second line or more / AI: hi there"
        );
        assert_eq!(TextJournalService::new(t.db.clone()).count().unwrap(), 1);
    }

    #[tokio::test]
    async fn completed_turn_journal_truncates_each_side_to_800_scalars() {
        let t = temp_db();
        let user = "x".repeat(900);
        let assistant = "y".repeat(1200);
        seed_session_with_turn(&t.db, &user, &assistant);
        let entry = journal_completed_turn(&t.db, "s1", "a1").expect("journaled");
        let (left, right) = entry.content.split_once(" / AI: ").expect("join marker");
        assert_eq!(
            left.strip_prefix("User: ")
                .expect("user prefix")
                .chars()
                .count(),
            800
        );
        assert_eq!(right.chars().count(), 800);
    }

    #[tokio::test]
    async fn journal_completed_turn_skips_unknown_assistant_message() {
        let t = temp_db();
        seed_session_with_turn(&t.db, "hello", "hi");
        assert!(journal_completed_turn(&t.db, "s1", "missing").is_none());
        assert_eq!(TextJournalService::new(t.db.clone()).count().unwrap(), 0);
    }

    #[tokio::test]
    async fn journal_completed_turn_pairs_assistant_with_its_own_preceding_user() {
        let t = temp_db();
        // Two turns persisted; the OLDER assistant message's MessageDone is
        // applied after the newer turn already exists (stop/regenerate or
        // rapid resend). The older turn must pair with its own user text,
        // never the newest user message.
        SessionRepo::new(t.db.clone())
            .create("s1", "test")
            .expect("create session");
        let messages = MessageRepo::new(t.db.clone());
        let start = now_ms();
        for (index, (id, role, content)) in [
            ("u1", "user", "first question"),
            ("a1", "assistant", "first answer"),
            ("u2", "user", "second question"),
            ("a2", "assistant", "second answer"),
        ]
        .into_iter()
        .enumerate()
        {
            messages
                .insert(&StoredMessage {
                    id: id.to_string(),
                    session_id: "s1".to_string(),
                    role: role.to_string(),
                    content: content.to_string(),
                    // Distinct, strictly increasing: `MessageRepo::list` orders by
                    // `created_at, rowid`, so equal timestamps would leave the
                    // pairing ambiguous for exactly the case under test.
                    created_at: start + index as i64,
                    metadata: json!({}),
                })
                .expect("insert message");
        }
        let entry = journal_completed_turn(&t.db, "s1", "a1").expect("journaled");
        assert!(
            entry.content.starts_with("User: first question"),
            "older assistant pairs with its own user turn, got: {}",
            entry.content
        );
    }

    #[tokio::test]
    async fn index_entry_best_effort_makes_exactly_one_embed_call_per_turn() {
        let t = temp_db();
        seed_session_with_turn(&t.db, "hello world", "hi there");
        let entry = journal_completed_turn(&t.db, "s1", "a1").expect("journaled");
        let canned = Arc::new(CannedEmbedder::ok());
        let indexed = index_entry_best_effort(t.db.clone(), canned.clone(), &entry).await;
        assert!(indexed);
        assert_eq!(
            canned.call_count(),
            1,
            "one batched embed call per completed turn"
        );
        assert_eq!(MemoryEmbeddingRepo::new(t.db.clone()).count().unwrap(), 1);
    }

    #[tokio::test]
    async fn index_entry_best_effort_failure_leaves_row_unembedded_journal_intact() {
        let t = temp_db();
        seed_session_with_turn(&t.db, "hello world", "hi there");
        let entry = journal_completed_turn(&t.db, "s1", "a1").expect("journaled");
        let failing = Arc::new(CannedEmbedder::failing());
        let indexed = index_entry_best_effort(t.db.clone(), failing.clone(), &entry).await;
        assert!(!indexed);
        assert_eq!(failing.call_count(), 1, "exactly one attempt per turn");
        assert_eq!(
            MemoryEmbeddingRepo::new(t.db.clone()).count().unwrap(),
            0,
            "failed embed leaves the retrieval index untouched"
        );
        assert_eq!(
            TextJournalService::new(t.db.clone()).count().unwrap(),
            1,
            "the journal row survives for the backfill button"
        );
    }
}
