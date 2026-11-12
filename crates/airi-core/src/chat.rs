// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Streaming chat service.
//!
//! [`ChatService`] turns user input into a persisted conversation: it appends
//! the user message to the store, streams the assistant reply through an
//! `airi-llm` provider (a registered [`airi_llm::ChatClient`] looked up by
//! provider id; the native `llama-cpp-local` id is intercepted before the
//! registry and served by `airi-local-llm`; anything else falls back to
//! `airi_llm::build_client` against the static registry), persists the
//! assistant message, and broadcasts typed
//! [`ChatEvent`]s for the UI layer to pump into the UI.
//!
//! Flow is one-way: core → broadcast → the UI pump. Events carry the session and
//! message ids so subscribers can correlate deltas to a rendered bubble.
//!
//! Current limitations (later phases):
//!
//! - No tool calling yet; [`ChatStatus::WaitingOnTool`] is reserved for the
//!   tool round trip to land with the LLM worker's `ToolSpec` API.
//! - The assistant message is persisted once the stream finishes (or is
//!   stopped); deltas are *not* written incrementally because
//!   `airi-store`'s `MessageRepo` has no update path yet.
//! - On stop, the partially accumulated text is persisted when non-empty and
//!   no `MessageDone` is emitted (no message exists to complete); a
//!   `StatusChanged { status: Idle }` always follows.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use airi_llm::{
    build_client, ChatMessage, ChatProvider, ChatRequest, ProviderConfig, ProviderRegistry, Role,
};
use airi_store::{Database, MessageRepo, SessionRepo, SettingsRepo, StoredMessage, StoredSession};
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::settings::{LocalLlmSettings, SettingsSection};
use crate::{new_id, now_ms};

/// Lifecycle status of a chat session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChatStatus {
    /// No generation in flight.
    Idle,
    /// A completion is streaming.
    Streaming,
    /// The model requested a tool call that has not completed yet.
    WaitingOnTool,
    /// The last generation failed; see the preceding [`ChatEvent::Error`].
    Error,
}

/// Typed chat events broadcast to subscribers (e.g. the UI pump).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ChatEvent {
    /// A text delta of the assistant reply arrived.
    Delta {
        /// session id
        session: String,
        /// assistant message id (stable for the whole generation)
        message: String,
        /// delta text to append
        delta: String,
    },
    /// The assistant message was finalized and persisted.
    MessageDone {
        /// session id
        session: String,
        /// assistant message id
        message: String,
    },
    /// Session status changed.
    StatusChanged {
        /// session id
        session: String,
        /// new status
        status: ChatStatus,
    },
    /// Generation failed.
    Error {
        /// session id
        session: String,
        /// human-readable error message
        message: String,
    },
}

/// Outcome of one streamed generation.
#[derive(Debug, Clone)]
pub struct StreamOutcome {
    /// Session the generation ran in (created on demand when the caller
    /// passed an empty or unknown id).
    pub session_id: String,
    /// Id of the persisted assistant message; `None` when the stream was
    /// stopped before any delta arrived.
    pub assistant_message_id: Option<String>,
    /// Full assistant text accumulated from deltas.
    pub content: String,
    /// Whether the generation was cancelled via [`ChatService::stop`].
    pub stopped: bool,
}

/// How often a running stream checks its stop flag while idle.
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Streaming chat service.
///
/// Cheap to clone; clones share the database, provider table, status table,
/// and event bus.
#[derive(Clone)]
pub struct ChatService {
    sessions: SessionRepo,
    messages: MessageRepo,
    /// Read access to `settings/local-llm` for the native llama.cpp provider.
    settings: SettingsRepo,
    /// LLM clients by provider id; checked before the static registry.
    pub providers: Arc<Mutex<HashMap<String, Arc<dyn ChatProvider>>>>,
    registry: ProviderRegistry,
    statuses: Arc<Mutex<HashMap<String, ChatStatus>>>,
    cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    bus: broadcast::Sender<ChatEvent>,
}

impl ChatService {
    /// Create a service with its own provider table.
    ///
    /// Clients must be registered via [`ChatService::register_client`];
    /// provider ids not present in the table are resolved through the static
    /// `airi_llm` registry and [`airi_llm::build_client`].
    pub fn new(db: Database) -> Self {
        Self::build(db, Arc::new(Mutex::new(HashMap::new())))
    }

    /// Create a service sharing an existing provider table (used by
    /// [`crate::AppCore`]).
    pub fn with_shared_providers(
        db: Database,
        providers: Arc<Mutex<HashMap<String, Arc<dyn ChatProvider>>>>,
    ) -> Self {
        Self::build(db, providers)
    }

    fn build(db: Database, providers: Arc<Mutex<HashMap<String, Arc<dyn ChatProvider>>>>) -> Self {
        let (bus, _) = broadcast::channel(64);
        let settings = SettingsRepo::new(db.clone());
        Self {
            sessions: SessionRepo::new(db.clone()),
            messages: MessageRepo::new(db),
            settings,
            providers,
            registry: ProviderRegistry::new(),
            statuses: Arc::new(Mutex::new(HashMap::new())),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            bus,
        }
    }

    /// Subscribe to chat events.
    pub fn subscribe(&self) -> broadcast::Receiver<ChatEvent> {
        self.bus.subscribe()
    }

    /// Current status of a session (defaults to [`ChatStatus::Idle`]).
    pub fn status(&self, session_id: &str) -> ChatStatus {
        self.statuses
            .lock()
            .expect("status mutex poisoned")
            .get(session_id)
            .copied()
            .unwrap_or(ChatStatus::Idle)
    }

    /// Register an LLM client under a provider id, replacing any previous one.
    pub fn register_client(&self, provider_id: impl Into<String>, client: Arc<dyn ChatProvider>) {
        self.providers
            .lock()
            .expect("providers mutex poisoned")
            .insert(provider_id.into(), client);
    }

    /// Create a new untitled session ("New chat") and return it.
    pub fn new_session(&self) -> Result<StoredSession> {
        self.new_session_with_title("New chat")
    }

    /// Create a new session with an explicit title and return it.
    pub fn new_session_with_title(&self, title: &str) -> Result<StoredSession> {
        let id = new_id();
        self.sessions.create(&id, title)
    }

    /// Delete a session and its messages; cancels any in-flight generation.
    /// Returns `true` when the session existed.
    pub async fn delete_session(&self, id: String) -> Result<bool> {
        let _ = self.stop(id.clone()).await;
        let removed = self.sessions.delete(&id)?;
        self.statuses
            .lock()
            .expect("status mutex poisoned")
            .remove(&id);
        Ok(removed)
    }

    /// Request cancellation of the in-flight generation for `session_id`.
    ///
    /// Returns `true` when a generation was flagged; `false` when the session
    /// had nothing streaming. Cancellation is cooperative and takes effect at
    /// the next stream poll (see [`STOP_POLL_INTERVAL`]).
    pub async fn stop(&self, session_id: String) -> Result<bool> {
        let flag = self
            .cancels
            .lock()
            .expect("cancel mutex poisoned")
            .get(&session_id)
            .cloned();
        match flag {
            Some(flag) => {
                flag.store(true, Ordering::SeqCst);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Append `text` as a user message and stream the assistant reply.
    ///
    /// `session_id` may be `None`, an empty string, or an unknown id — a new
    /// session is created in that case (titled from the message text). The
    /// returned outcome reports the effective session id.
    pub async fn send_message(
        &self,
        session_id: Option<&str>,
        provider_id: &str,
        config: ProviderConfig,
        model: &str,
        text: &str,
    ) -> Result<StreamOutcome> {
        let session_id = self.ensure_session(session_id.unwrap_or(""), text)?;
        let user_message = StoredMessage {
            id: new_id(),
            session_id: session_id.clone(),
            role: "user".to_string(),
            content: text.to_string(),
            created_at: now_ms(),
            metadata: serde_json::json!({}),
        };
        self.messages.insert(&user_message)?;

        let history = self.messages.list(&session_id)?;
        let messages: Vec<ChatMessage> = history.into_iter().filter_map(to_chat_message).collect();
        self.run_stream(
            session_id,
            provider_id,
            config,
            ChatRequest {
                model: model.to_string(),
                messages,
                system: None,
                temperature: None,
                max_tokens: None,
                tools: Vec::new(),
            },
        )
        .await
    }

    /// Stream a completion over an explicit message list.
    ///
    /// Unlike [`ChatService::send_message`], this does **not** persist any
    /// user message; the caller owns the history. The session is created on
    /// demand when `session` is empty or unknown. The assistant reply is
    /// persisted and events are broadcast exactly as in `send_message`.
    pub async fn stream(
        &self,
        session: String,
        provider_id: String,
        config: ProviderConfig,
        model: String,
        messages: Vec<ChatMessage>,
    ) -> Result<StreamOutcome> {
        let session_id = self.ensure_session(&session, "New chat")?;
        self.run_stream(
            session_id,
            &provider_id,
            config,
            ChatRequest {
                model,
                messages,
                system: None,
                temperature: None,
                max_tokens: None,
                tools: Vec::new(),
            },
        )
        .await
    }

    /// Load the session or create it on demand.
    fn ensure_session(&self, session_id: &str, title_hint: &str) -> Result<String> {
        if !session_id.is_empty() {
            if let Some(existing) = self.sessions.get(session_id)? {
                return Ok(existing.id);
            }
        }
        let title: String = title_hint.chars().take(48).collect();
        let title = title.trim();
        let session =
            self.new_session_with_title(if title.is_empty() { "New chat" } else { title })?;
        Ok(session.id)
    }

    fn set_status(&self, session_id: &str, status: ChatStatus) {
        self.statuses
            .lock()
            .expect("status mutex poisoned")
            .insert(session_id.to_string(), status);
        let _ = self.bus.send(ChatEvent::StatusChanged {
            session: session_id.to_string(),
            status,
        });
    }

    async fn resolve_client(
        &self,
        provider_id: &str,
        config: ProviderConfig,
    ) -> Result<Arc<dyn ChatProvider>> {
        resolve_provider(
            &self.providers,
            &self.registry,
            provider_id,
            config,
            Some(&self.settings),
        )
        .await
    }

    async fn run_stream(
        &self,
        session_id: String,
        provider_id: &str,
        config: ProviderConfig,
        request: ChatRequest,
    ) -> Result<StreamOutcome> {
        let assistant_message_id = new_id();
        self.set_status(&session_id, ChatStatus::Streaming);
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .expect("cancel mutex poisoned")
            .insert(session_id.clone(), cancel.clone());

        let result = self
            .run_stream_inner(
                &session_id,
                &assistant_message_id,
                provider_id,
                config,
                request,
                &cancel,
            )
            .await;

        self.cancels
            .lock()
            .expect("cancel mutex poisoned")
            .remove(&session_id);

        match result {
            Ok(outcome) => {
                self.set_status(&session_id, ChatStatus::Idle);
                Ok(outcome)
            }
            Err(err) => {
                self.set_status(&session_id, ChatStatus::Error);
                let _ = self.bus.send(ChatEvent::Error {
                    session: session_id.clone(),
                    message: format!("{err:#}"),
                });
                Err(err)
            }
        }
    }

    async fn run_stream_inner(
        &self,
        session_id: &str,
        assistant_message_id: &str,
        provider_id: &str,
        config: ProviderConfig,
        request: ChatRequest,
        cancel: &AtomicBool,
    ) -> Result<StreamOutcome> {
        // Captured before `resolve_client` consumes `config` and `stream`
        // consumes `request` — needed for the post-reply auto-title call.
        let config_for_title = config.clone();
        let model_for_title = request.model.clone();
        let client = self.resolve_client(provider_id, config).await?;
        let mut stream = client.stream(request).await?;
        let mut content = String::new();
        let mut finish_reason: Option<String> = None;
        let mut stopped = false;

        let mut ticker = tokio::time::interval(STOP_POLL_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                maybe = stream.next() => {
                    match maybe {
                        Some(Ok(chunk)) => {
                            if !chunk.delta.is_empty() {
                                content.push_str(&chunk.delta);
                                let _ = self.bus.send(ChatEvent::Delta {
                                    session: session_id.to_string(),
                                    message: assistant_message_id.to_string(),
                                    delta: chunk.delta,
                                });
                            }
                            if let Some(reason) = chunk.finish_reason {
                                finish_reason = Some(reason);
                            }
                            // `reasoning` deltas (providers with a separate
                            // thinking channel) are dropped for now; a
                            // Reasoning SSE event can be added later.
                        }
                        Some(Err(err)) => {
                            return Err(anyhow!(err).context("llm stream failed"));
                        }
                        None => break,
                    }
                }
                _ = ticker.tick() => {
                    if cancel.load(Ordering::SeqCst) {
                        stopped = true;
                        break;
                    }
                }
            }
        }
        drop(stream);

        let persisted_id = if content.is_empty() {
            None
        } else {
            let message = StoredMessage {
                id: assistant_message_id.to_string(),
                session_id: session_id.to_string(),
                role: "assistant".to_string(),
                content: content.clone(),
                created_at: now_ms(),
                metadata: serde_json::json!({
                    "providerId": provider_id,
                    "finishReason": finish_reason,
                }),
            };
            self.messages.insert(&message)?;
            let _ = self.bus.send(ChatEvent::MessageDone {
                session: session_id.to_string(),
                message: assistant_message_id.to_string(),
            });
            Some(assistant_message_id.to_string())
        };

        // After the assistant's first reply completes, rename a default
        // "New chat" session via a bounded LLM call. Failure keeps the
        // existing title; an unconfigured provider skips silently.
        if persisted_id.is_some() && !stopped {
            match self
                .maybe_auto_title(session_id, provider_id, config_for_title, &model_for_title)
                .await
            {
                Ok(_) => {}
                Err(err) => {
                    tracing::warn!("auto-title failed; keeping existing title: {err:#}")
                }
            }
        }

        Ok(StreamOutcome {
            session_id: session_id.to_string(),
            assistant_message_id: persisted_id,
            content,
            stopped,
        })
    }

    /// Auto-title a session whose title is still the empty/default
    /// "New chat" placeholder, using the same provider/model that produced
    /// the assistant reply.
    ///
    /// Renames only on the session's first assistant reply; a custom title,
    /// an assistant-count other than 1, an unresolvable provider, or any
    /// provider failure (including a 10s timeout) keeps the existing title.
    /// Returns `true` when the title was changed.
    async fn maybe_auto_title(
        &self,
        session_id: &str,
        provider_id: &str,
        config: ProviderConfig,
        model: &str,
    ) -> Result<bool> {
        let session = self
            .sessions
            .get(session_id)?
            .with_context(|| format!("session vanished during auto-title: {session_id}"))?;
        if !is_default_title(&session.title) {
            return Ok(false);
        }

        let history = self.messages.list(session_id)?;
        let assistant_count = history.iter().filter(|m| m.role == "assistant").count();
        if assistant_count != 1 {
            return Ok(false);
        }

        let first_user = history
            .iter()
            .find(|m| m.role == "user")
            .map(|m| m.content.trim())
            .unwrap_or("");
        let first_assistant = history
            .iter()
            .find(|m| m.role == "assistant")
            .map(|m| m.content.trim())
            .unwrap_or("");
        let excerpt = |text: &str| text.chars().take(1000).collect::<String>();
        let transcript = format!(
            "User: {}\n\nAssistant: {}",
            excerpt(first_user),
            excerpt(first_assistant)
        );

        let messages = vec![
            ChatMessage {
                role: Role::System,
                content: "You write short, specific conversation titles. Reply with a 3-5 word title for this conversation. No quotes, no trailing punctuation, no preamble.".to_string(),
                tool_call_id: None,
            },
            ChatMessage {
                role: Role::User,
                content: format!("Reply with a 3-5 word title for this conversation.\n\n{transcript}"),
                tool_call_id: None,
            },
        ];
        let request = ChatRequest {
            model: model.to_string(),
            messages,
            system: None,
            temperature: None,
            max_tokens: Some(32),
            tools: Vec::new(),
        };

        // Provider unconfigured or missing credentials: skip silently and
        // keep the existing title.
        let client = match resolve_provider(
            &self.providers,
            &self.registry,
            provider_id,
            config,
            Some(&self.settings),
        )
        .await
        {
            Ok(client) => client,
            Err(err) => {
                tracing::debug!("auto-title skipped (provider unavailable): {err:#}");
                return Ok(false);
            }
        };
        let work = collect_completion(&*client, request);
        let raw = match tokio::time::timeout(AUTO_TITLE_TIMEOUT, work).await {
            Ok(result) => result?,
            Err(_) => {
                anyhow::bail!("title completion timed out after {AUTO_TITLE_TIMEOUT:?}")
            }
        };

        let title = sanitize_title(&raw);
        if title.is_empty() {
            return Ok(false);
        }

        // Re-check before writing so a concurrent rename (e.g. user edited
        // the title while the model call was in flight) is never clobbered.
        let current = self
            .sessions
            .get(session_id)?
            .with_context(|| format!("session vanished during auto-title: {session_id}"))?;
        if !is_default_title(&current.title) {
            return Ok(false);
        }
        self.sessions.update(session_id, Some(&title), None)
    }
}

/// How long auto-titling may take past the first reply completing.
/// The provider call is bounded with `tokio::time::timeout`; on expiry the
/// existing title is kept.
const AUTO_TITLE_TIMEOUT: Duration = Duration::from_secs(10);

/// Resolve a registered client or build one from the static registry.
///
/// The native `llama-cpp-local` provider id is intercepted *before* the
/// static registry: it is not an OpenAI-compatible HTTP endpoint and has
/// nowhere to point, so `airi-local-llm::LlamaChatProvider` is constructed
/// directly from `AIRI_QT_LLAMA_MODEL` / `settings/local-llm` instead.
pub(crate) async fn resolve_provider(
    providers: &Arc<Mutex<HashMap<String, Arc<dyn ChatProvider>>>>,
    registry: &ProviderRegistry,
    provider_id: &str,
    config: ProviderConfig,
    local_llm: Option<&SettingsRepo>,
) -> Result<Arc<dyn ChatProvider>> {
    if let Some(client) = providers
        .lock()
        .expect("providers mutex poisoned")
        .get(provider_id)
        .cloned()
    {
        return Ok(client);
    }
    if provider_id == airi_local_llm::PROVIDER_ID {
        return llama_cpp_provider(local_llm);
    }
    let def = registry.get(provider_id).with_context(|| {
        format!("provider not registered and unknown to registry: {provider_id}")
    })?;
    let client: Arc<dyn ChatProvider> = build_client(def, config)
        .with_context(|| format!("failed to build client for {provider_id}"))?;
    Ok(client)
}

/// Build the native llama.cpp GGUF provider from the environment and the
/// `settings/local-llm` section. `AIRI_QT_LLAMA_MODEL` wins over the stored
/// `modelPath`; the remaining fields always come from settings (spec
/// defaults apply when the section was never written).
fn llama_cpp_provider(local_llm: Option<&SettingsRepo>) -> Result<Arc<dyn ChatProvider>> {
    let stored = local_llm
        .and_then(|repo| {
            repo.get::<LocalLlmSettings>(LocalLlmSettings::KEY)
                .ok()
                .flatten()
        })
        .unwrap_or_default();
    let model_path = std::env::var("AIRI_QT_LLAMA_MODEL")
        .ok()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .unwrap_or(stored.model_path);
    if model_path.trim().is_empty() {
        anyhow::bail!(
            "llama-cpp-local: no model configured; set AIRI_QT_LLAMA_MODEL or \
             settings/local-llm.modelPath"
        );
    }
    Ok(Arc::new(airi_local_llm::LlamaChatProvider::new(
        airi_local_llm::LocalLlmConfig {
            model_path,
            context_size: stored.context_size,
            temperature: stored.temperature,
            max_tokens: stored.max_tokens,
            gpu_layers: stored.gpu_layers,
            seed: airi_local_llm::DEFAULT_SEED,
        },
    )))
}

/// Drain a streaming chat provider into a single completion string.
///
/// Used for non-streaming one-shot calls (auto-titling, summarization).
/// Reasoning-channel deltas are dropped; text deltas are concatenated.
pub(crate) async fn collect_completion(
    client: &dyn ChatProvider,
    request: ChatRequest,
) -> Result<String> {
    let mut stream = client.stream(request).await.map_err(anyhow::Error::from)?;
    let mut out = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| anyhow!(err).context("llm stream failed"))?;
        out.push_str(&chunk.delta);
    }
    Ok(out)
}

/// Whether a session title is empty or the default "New chat" placeholder.
fn is_default_title(title: &str) -> bool {
    let trimmed = title.trim();
    trimmed.is_empty() || trimmed.eq_ignore_ascii_case("new chat")
}

/// Sanitize a raw model-produced title: first non-empty line, no wrapping
/// quotes, single-spaced, trailing punctuation stripped, capped at 6 words
/// and 64 characters. Returns an empty string when nothing usable remains.
fn sanitize_title(raw: &str) -> String {
    let first_line = raw
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let unquoted = first_line
        .trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .trim();
    let mut stripped = unquoted.trim_end_matches(['.', '!', '?', ',', ';', ':']);
    while stripped.ends_with(char::is_whitespace) {
        stripped = stripped.trim_end();
        stripped = stripped.trim_end_matches(['.', '!', '?', ',', ';', ':']);
    }
    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped = collapsed.split(' ').take(6).collect::<Vec<_>>().join(" ");
    if capped.chars().count() > 64 {
        return capped
            .chars()
            .take(64)
            .collect::<String>()
            .trim_end()
            .to_string();
    }
    capped
}

/// Map a persisted message back into an LLM chat message.
///
/// Messages with unrecognized roles (e.g. `tool` plumbing not yet
/// implemented, or app-internal rows) are skipped.
fn to_chat_message(message: StoredMessage) -> Option<ChatMessage> {
    let role = match message.role.as_str() {
        "system" => Role::System,
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "tool" => Role::Tool,
        _ => return None,
    };
    Some(ChatMessage {
        role,
        content: message.content,
        tool_call_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use airi_llm::{ChatChunk, ChatStream, ModelInfo};
    use async_trait::async_trait;
    use tempfile::tempdir;

    /// Scripted mock provider: emits the given deltas, or pends forever
    /// (for stop testing), or fails the stream on first poll.
    struct MockChatClient {
        deltas: Vec<String>,
        pace: Duration,
        fail_on_stream: bool,
    }

    impl MockChatClient {
        fn scripted(deltas: &[&str]) -> Self {
            Self {
                deltas: deltas.iter().map(|d| d.to_string()).collect(),
                pace: Duration::ZERO,
                fail_on_stream: false,
            }
        }

        fn pending() -> Self {
            Self {
                deltas: Vec::new(),
                pace: Duration::MAX,
                fail_on_stream: false,
            }
        }

        fn failing() -> Self {
            Self {
                deltas: Vec::new(),
                pace: Duration::ZERO,
                fail_on_stream: true,
            }
        }
    }

    #[async_trait]
    impl ChatProvider for MockChatClient {
        fn id(&self) -> &str {
            "mock"
        }

        async fn models(&self) -> Result<Vec<ModelInfo>, airi_llm::LlmError> {
            Ok(vec![ModelInfo {
                id: "mock-model".to_string(),
                owned_by: None,
            }])
        }

        async fn stream(&self, req: ChatRequest) -> Result<ChatStream, airi_llm::LlmError> {
            if self.fail_on_stream {
                return Err(airi_llm::LlmError::Provider(
                    "mock provider boom".to_string(),
                ));
            }
            if self.pace == Duration::MAX {
                // Never yields; the stop flag is exercised via the poll ticker.
                return Ok(Box::pin(futures_util::stream::pending()));
            }
            let mut events: Vec<Result<ChatChunk, airi_llm::LlmError>> = Vec::new();
            for delta in &self.deltas {
                events.push(Ok(ChatChunk::text(delta.clone())));
            }
            events.push(Ok(ChatChunk::finish("stop")));
            let _ = req;
            Ok(Box::pin(futures_util::stream::iter(events)))
        }
    }

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempdir().unwrap();
        let db = Database::open(&dir.path().join("chat.sqlite")).unwrap();
        (dir, db)
    }

    fn drain_events(rx: &mut broadcast::Receiver<ChatEvent>) -> Vec<ChatEvent> {
        let mut events = Vec::new();
        loop {
            match rx.try_recv() {
                Ok(ev) => events.push(ev),
                Err(broadcast::error::TryRecvError::Empty) => break,
                Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
                Err(broadcast::error::TryRecvError::Closed) => break,
            }
        }
        events
    }

    #[tokio::test]
    async fn send_message_streams_persists_and_broadcasts() {
        let (_dir, db) = test_db();
        let verify_db = db.clone();
        let service = ChatService::new(db);
        let mut rx = service.subscribe();
        service.register_client(
            "mock",
            Arc::new(MockChatClient::scripted(&["Hello", ", ", "world"])),
        );

        let outcome = service
            .send_message(
                None,
                "mock",
                ProviderConfig::default(),
                "mock-model",
                "hi there",
            )
            .await
            .unwrap();

        assert_eq!(outcome.content, "Hello, world");
        assert!(!outcome.stopped);
        assert!(outcome.assistant_message_id.is_some());

        // User + assistant messages persisted in order.
        let messages = airi_store::MessageRepo::new(verify_db)
            .list(&outcome.session_id)
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "hi there");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Hello, world");
        assert_eq!(
            Some(messages[1].id.as_str()),
            outcome.assistant_message_id.as_deref()
        );

        // Broadcast sequence: Streaming → Delta*3 → MessageDone → Idle.
        let events = drain_events(&mut rx);
        let deltas: Vec<&str> = events
            .iter()
            .filter_map(|ev| match ev {
                ChatEvent::Delta { delta, .. } => Some(delta.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(deltas, vec!["Hello", ", ", "world"]);

        let status_flow: Vec<ChatStatus> = events
            .iter()
            .filter_map(|ev| match ev {
                ChatEvent::StatusChanged { status, .. } => Some(*status),
                _ => None,
            })
            .collect();
        assert_eq!(status_flow, vec![ChatStatus::Streaming, ChatStatus::Idle]);

        let done = events.iter().find_map(|ev| match ev {
            ChatEvent::MessageDone { session, message } => Some((session.clone(), message.clone())),
            _ => None,
        });
        assert_eq!(
            done,
            Some((
                outcome.session_id.clone(),
                outcome.assistant_message_id.unwrap()
            ))
        );

        assert_eq!(service.status(&outcome.session_id), ChatStatus::Idle);
    }

    #[tokio::test]
    async fn stream_uses_explicit_messages_and_persists_assistant() {
        let (_dir, db) = test_db();
        let verify_db = db.clone();
        let service = ChatService::new(db);
        service.register_client("mock", Arc::new(MockChatClient::scripted(&["pong"])));

        let outcome = service
            .stream(
                String::new(),
                "mock".to_string(),
                ProviderConfig::default(),
                "mock-model".to_string(),
                vec![ChatMessage {
                    role: Role::User,
                    content: "ping".to_string(),
                    tool_call_id: None,
                }],
            )
            .await
            .unwrap();

        // Session was auto-created; only the assistant reply is persisted.
        let messages = airi_store::MessageRepo::new(verify_db)
            .list(&outcome.session_id)
            .unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "assistant");
        assert_eq!(messages[0].content, "pong");
    }

    #[tokio::test]
    async fn stop_cancels_a_pending_stream() {
        let (_dir, db) = test_db();
        let verify_db = db.clone();
        let service = ChatService::new(db);
        let mut rx = service.subscribe();
        service.register_client("mock", Arc::new(MockChatClient::pending()));

        let svc = service.clone();
        let handle = tokio::spawn(async move {
            svc.send_message(None, "mock", ProviderConfig::default(), "mock-model", "hi")
                .await
        });

        // Wait until the generation registered its stop flag.
        let mut session_id = None;
        for _ in 0..100 {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let guard = service.cancels.lock().unwrap();
            if let Some(id) = guard.keys().next() {
                session_id = Some(id.clone());
                break;
            }
        }
        let session_id = session_id.expect("stream never registered a stop flag");
        assert!(service.stop(session_id.clone()).await.unwrap());

        let outcome = handle.await.unwrap().unwrap();
        assert!(outcome.stopped);
        assert_eq!(outcome.session_id, session_id);
        assert_eq!(outcome.content, "");
        assert!(outcome.assistant_message_id.is_none());
        assert_eq!(service.status(&session_id), ChatStatus::Idle);

        // Stopping again reports nothing in flight.
        assert!(!service.stop(session_id).await.unwrap());

        // Only the user message was persisted.
        let messages = airi_store::MessageRepo::new(verify_db)
            .list(&outcome.session_id)
            .unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");

        let events = drain_events(&mut rx);
        assert!(events.iter().any(|ev| matches!(
            ev,
            ChatEvent::StatusChanged {
                status: ChatStatus::Idle,
                ..
            }
        )));
    }

    #[tokio::test]
    async fn provider_error_sets_error_status_and_broadcasts() {
        let (_dir, db) = test_db();
        let service = ChatService::new(db);
        let mut rx = service.subscribe();
        service.register_client("mock", Arc::new(MockChatClient::failing()));

        let err = service
            .send_message(None, "mock", ProviderConfig::default(), "mock-model", "hi")
            .await
            .unwrap_err();
        assert!(format!("{err:#}").contains("mock provider boom"));

        let events = drain_events(&mut rx);
        assert!(events
            .iter()
            .any(|ev| matches!(ev, ChatEvent::Error { .. })));
        assert_eq!(service.status(&drain_session(&events)), ChatStatus::Error);
    }

    fn drain_session(events: &[ChatEvent]) -> String {
        events
            .iter()
            .find_map(|ev| match ev {
                ChatEvent::StatusChanged { session, .. } => Some(session.clone()),
                _ => None,
            })
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn unknown_provider_without_registration_errors() {
        let (_dir, db) = test_db();
        let service = ChatService::new(db);
        let err = service
            .send_message(
                None,
                "no-such-provider",
                ProviderConfig::default(),
                "m",
                "hi",
            )
            .await
            .unwrap_err();
        assert!(format!("{err:#}").contains("no-such-provider"));
    }

    #[tokio::test]
    async fn delete_session_removes_messages() {
        let (_dir, db) = test_db();
        let service = ChatService::new(db.clone());
        service.register_client("mock", Arc::new(MockChatClient::scripted(&["done"])));

        let outcome = service
            .send_message(None, "mock", ProviderConfig::default(), "mock-model", "hi")
            .await
            .unwrap();

        assert!(service
            .delete_session(outcome.session_id.clone())
            .await
            .unwrap());
        let messages = airi_store::MessageRepo::new(db)
            .list(&outcome.session_id)
            .unwrap();
        assert!(messages.is_empty());
        assert_eq!(service.status(&outcome.session_id), ChatStatus::Idle);
    }

    #[test]
    fn is_default_title_recognizes_placeholder() {
        assert!(is_default_title("New chat"));
        assert!(is_default_title("  "));
        assert!(is_default_title("NEW CHAT"));
        assert!(is_default_title(""));
        assert!(!is_default_title("My chat"));
        assert!(!is_default_title("new chatbot"));
    }

    #[test]
    fn sanitize_title_strips_quotes_punctuation_and_caps() {
        assert_eq!(sanitize_title("\"My Weekend Plans.\""), "My Weekend Plans");
        assert_eq!(sanitize_title("hello world"), "hello world");
        assert_eq!(sanitize_title(""), "");
        assert_eq!(sanitize_title("   \n  "), "");
        assert_eq!(
            sanitize_title("one two three four five six seven eight nine"),
            "one two three four five six"
        );
        let long = format!("{} {} {}", "a".repeat(30), "b".repeat(30), "c".repeat(30));
        assert!(sanitize_title(&long).chars().count() <= 64);
    }

    #[tokio::test]
    async fn auto_title_renames_default_title_after_first_reply() {
        let (_dir, db) = test_db();
        let service = ChatService::new(db.clone());
        service.register_client(
            "mock",
            Arc::new(MockChatClient::scripted(&["Mock Title Here"])),
        );

        let session = service.new_session().unwrap();
        assert_eq!(session.title, "New chat");
        let outcome = service
            .send_message(
                Some(&session.id),
                "mock",
                ProviderConfig::default(),
                "mock-model",
                "hello",
            )
            .await
            .unwrap();
        assert!(outcome.assistant_message_id.is_some());

        let stored = airi_store::SessionRepo::new(db)
            .get(&session.id)
            .unwrap()
            .unwrap();
        assert_eq!(stored.title, "Mock Title Here");
    }

    #[tokio::test]
    async fn auto_title_keeps_custom_title() {
        let (_dir, db) = test_db();
        let service = ChatService::new(db.clone());
        service.register_client(
            "mock",
            Arc::new(MockChatClient::scripted(&["Mock Title Here"])),
        );

        let session = service.new_session_with_title("My custom title").unwrap();
        service
            .send_message(
                Some(&session.id),
                "mock",
                ProviderConfig::default(),
                "mock-model",
                "hello",
            )
            .await
            .unwrap();

        let stored = airi_store::SessionRepo::new(db)
            .get(&session.id)
            .unwrap()
            .unwrap();
        assert_eq!(stored.title, "My custom title");
    }

    #[tokio::test]
    async fn maybe_auto_title_skips_unconfigured_provider_and_multi_reply_sessions() {
        let (_dir, db) = test_db();
        let service = ChatService::new(db.clone());

        // No provider registered and none in the static registry: silent skip.
        let session = service.new_session().unwrap();
        let renamed = service
            .maybe_auto_title(
                &session.id,
                "no-such-provider",
                ProviderConfig::default(),
                "m",
            )
            .await
            .unwrap();
        assert!(!renamed);
        assert_eq!(
            airi_store::SessionRepo::new(db.clone())
                .get(&session.id)
                .unwrap()
                .unwrap()
                .title,
            "New chat"
        );

        // Two assistant messages already: not the first reply, no rename.
        service.register_client("mock", Arc::new(MockChatClient::scripted(&["Some Title"])));
        let session2 = service.new_session().unwrap();
        for role in ["user", "assistant", "user", "assistant"] {
            airi_store::MessageRepo::new(db.clone())
                .insert(&airi_store::StoredMessage {
                    id: new_id(),
                    session_id: session2.id.clone(),
                    role: role.to_string(),
                    content: format!("{role} content"),
                    created_at: now_ms(),
                    metadata: serde_json::json!({}),
                })
                .unwrap();
        }
        let renamed = service
            .maybe_auto_title(
                &session2.id,
                "mock",
                ProviderConfig::default(),
                "mock-model",
            )
            .await
            .unwrap();
        assert!(!renamed);
        assert_eq!(
            airi_store::SessionRepo::new(db)
                .get(&session2.id)
                .unwrap()
                .unwrap()
                .title,
            "New chat"
        );
    }

    #[tokio::test]
    async fn llama_cpp_local_resolves_from_settings() {
        let (_dir, db) = test_db();
        let settings = SettingsRepo::new(db);
        settings
            .set(
                LocalLlmSettings::KEY,
                &LocalLlmSettings {
                    model_path: "/models/test-model.gguf".to_string(),
                    context_size: 1024,
                    temperature: 0.4,
                    max_tokens: 64,
                    gpu_layers: -1,
                },
            )
            .unwrap();
        let providers = Arc::new(Mutex::new(HashMap::new()));
        let registry = ProviderRegistry::new();
        let client = resolve_provider(
            &providers,
            &registry,
            "llama-cpp-local",
            ProviderConfig::default(),
            Some(&settings),
        )
        .await
        .expect("llama-cpp-local resolves from settings");
        assert_eq!(client.id(), "llama-cpp-local");
    }

    #[tokio::test]
    async fn llama_cpp_local_without_model_configured_is_an_error() {
        let (_dir, db) = test_db();
        let settings = SettingsRepo::new(db);
        // Deterministic regardless of the developer's shell.
        std::env::remove_var("AIRI_QT_LLAMA_MODEL");
        let providers = Arc::new(Mutex::new(HashMap::new()));
        let registry = ProviderRegistry::new();
        let err = resolve_provider(
            &providers,
            &registry,
            "llama-cpp-local",
            ProviderConfig::default(),
            Some(&settings),
        )
        .await
        .err()
        .expect("must fail without a configured model");
        let message = format!("{err:#}");
        assert!(
            message.contains("AIRI_QT_LLAMA_MODEL") && message.contains("settings/local-llm"),
            "unexpected error: {message}"
        );
    }
}
