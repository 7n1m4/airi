// SPDX-License-Identifier: GPL-3.0-or-later
//! Discord gateway bridge (`DiscordGatewayState`) exposed to Slint — the
//! opt-in, human-driven, in-memory-only RECEIVE slice.
//!
//! Drives the "Gateway events (opt-in)" card in the Discord settings page. It
//! is the receive counterpart to [`super::discord`]'s send-only REST slice and
//! shares its config file (`<profile>/airi/discord.json`, or the platform data
//! dir when `--profile` is not set — same resolution, mirrored here, not
//! shared).
//!
//! Honesty contract:
//! * **Strictly opt-in, always human-driven.** The gateway thread starts ONLY
//!   from [`DiscordGatewayState::start`], i.e. from the page's Start button
//!   (or an explicit `--discord-gateway` autostart wired by the main agent in
//!   `main.rs` — never by default). No timer, no auto-connect, no
//!   resume-on-launch.
//! * **In-memory only.** Received `MESSAGE_CREATE` events live in a shared
//!   queue capped at 100 entries and are cleared on [`stop`](Self::stop) /
//!   [`clear_events`](Self::clear_events). Nothing is persisted, forwarded, or
//!   leaves the machine. Message content is personal data — treat it
//!   accordingly.
//! * **An inbox, not a command processor.** Events are surfaced unread,
//!   unmoderated. There is no parsing, no dispatch, no automation anywhere in
//!   this bridge — reacting to a message is a human job (see the REST slice's
//!   Send button).
//! * **Token posture.** The token is read from `discord.json` (0600 on unix,
//!   owned by the REST slice) and never logged, never placed in an event, a
//!   status line, or a state field. The `Debug` impl of the config holder
//!   prints `token: "***"`, mirroring the REST bridge and the `GatewayClient`.
//! * The privileged `MESSAGE_CONTENT` intent must be enabled for the bot in
//!   the Discord Developer Portal, or events arrive **without content**.
//! * The reconnect policy is **caller-driven and bounded** (see
//!   [`reconnect_with_backoff`]): this crate contract leaves backoff/lifecycle
//!   to the caller, and this bridge — specifically its background thread — is
//!   the caller. Five attempts with 1s/2s/4s/8s/16s backoff, then it gives up
//!   and the status goes to `error: …` until the human presses Start again.
//!
//! Boundary contract (same as the other bridges): JSON document strings cross
//! the boundary.
//!
//! Thread model: `start()` spawns one `std::thread`. The thread never touches
//! the UI state; it mutates the shared [`GatewayShared`] queue and status
//! fields. The page polls with a 1 s `Timer` calling
//! [`DiscordGatewayState::refresh`], which copies the shared state into the
//! state fields. [`stop`](DiscordGatewayState::stop) sets the stop flag and
//! waits up to 2 s for the thread to finish; if the thread is blocked inside
//! the socket read (the read timeout is the server's heartbeat interval,
//! typically ~41 s), the UI thread is NOT blocked — `stop()` returns
//! immediately and the worker exits at the next read boundary or when the
//! socket errors.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use airi_discord::{DiscordError, DiscordRestClient, GatewayClient, GatewayEvent, DEFAULT_INTENTS};

use crate::bridges;

/// Maximum number of received-message entries kept in memory (oldest dropped).
const MAX_EVENTS: usize = 100;
/// MESSAGE_CREATE content is truncated to this many chars (not bytes).
const CONTENT_MAX_CHARS: usize = 400;
/// Bounded reconnect policy: 1s, 2s, 4s, 8s, 16s between attempts (attempt 1 first).
const RECONNECT_DELAYS: [Duration; 5] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(16),
];
/// How long `stop()` waits for the worker thread before detaching it.
const STOP_GRACE: Duration = Duration::from_secs(2);

/// `<profile>/airi/discord.json` or `<platform-data>/airi-slint/discord.json`.
/// Mirrors `bridges::discord::discord_config_path` exactly.
fn discord_config_path() -> std::path::PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("discord.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("discord.json")))
        .unwrap_or_else(|| std::path::PathBuf::from("discord.json"))
}

/// The token slice of the config file. Deliberately separate from the REST
/// bridge's `DiscordConfigFile` (that one is private); same file, same schema.
/// `Debug` prints `token: "***"`.
#[derive(Default, Deserialize)]
struct GatewayConfigFile {
    #[serde(default)]
    token: String,
}

impl std::fmt::Debug for GatewayConfigFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GatewayConfigFile")
            .field("token", &"***")
            .finish()
    }
}

/// Read the config file; `None` when missing, `Err` when unreadable. Never
/// logs or echoes the token.
fn load_config() -> Result<Option<GatewayConfigFile>, String> {
    let path = discord_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("{} is not a valid discord.json: {e}", path.display()))
}

/// Cheap pre-flight check used by [`start_worker`] to fail fast with a
/// synchronous error instead of spawning a thread that immediately dies.
fn token_configured() -> bool {
    matches!(load_config(), Ok(Some(config)) if !config.token.trim().is_empty())
}

/// Map a gateway/REST error to a human-readable, token-free message.
/// No `DiscordError` variant ever carries the bot token.
fn gateway_error_message(error: &DiscordError) -> String {
    match error {
        DiscordError::Unauthorized => {
            "Discord rejected the bot token (401 Unauthorized / close 4004) — check the token and try again."
                .to_string()
        }
        DiscordError::RateLimited {
            retry_after,
            global,
        } => format!(
            "Discord rate limit (global={global}) — retry after {:.1}s.",
            retry_after.as_secs_f64()
        ),
        DiscordError::Http { status, message } => {
            format!("Discord returned HTTP {status}: {message}")
        }
        DiscordError::Transport(err) => format!("could not reach Discord: {err}"),
        DiscordError::Decode(message) => {
            format!("failed to decode Discord's response: {message}")
        }
        DiscordError::GatewayTransport(message) => {
            format!("gateway connection failed: {message}")
        }
        DiscordError::InvalidSession { resumable } => {
            format!("Discord invalidated the gateway session (resumable={resumable})")
        }
    }
}

/// One received `MESSAGE_CREATE`, shaped for the page's inbox list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayEventEntry {
    /// The message id (snowflake).
    pub id: String,
    /// The channel the message was sent in (snowflake).
    pub channel_id: String,
    /// The author's username.
    pub author_name: String,
    /// `true` when the author is a bot.
    pub author_bot: bool,
    /// The message content, truncated to [`CONTENT_MAX_CHARS`] chars (empty
    /// unless the privileged `MESSAGE_CONTENT` intent is enabled).
    pub content: String,
    /// ISO-8601 timestamp as sent by Discord (opaque string).
    pub timestamp: String,
    /// When this process received the event, ms since the Unix epoch.
    pub received_ms: u64,
}

impl GatewayEventEntry {
    /// Capture one decoded `MESSAGE_CREATE` event for the inbox queue.
    fn capture(
        id: String,
        channel_id: String,
        author: &airi_discord::MessageAuthor,
        content: &str,
        timestamp: String,
    ) -> Self {
        let received_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let truncated = truncate_chars(content, CONTENT_MAX_CHARS);
        Self {
            id,
            channel_id,
            author_name: author.username.clone(),
            author_bot: author.bot,
            content: truncated,
            timestamp,
            received_ms,
        }
    }
}

/// Shared state between the UI thread and the worker thread. Never holds the
/// token (the worker moves it into the `GatewayClient`, which redacts it in
/// its own `Debug`).
struct GatewayShared {
    /// `true` while the worker thread is alive.
    running: bool,
    /// `"stopped"` | `"running"` | `"listening as <username>"` | `"error: …"`.
    status: String,
    /// Received events, oldest → newest, capped at [`MAX_EVENTS`].
    events: VecDeque<GatewayEventEntry>,
    last_error: Option<String>,
    /// Stop flag observed by the worker at every loop boundary / sleep slice.
    stop: bool,
    /// Worker handle, held so `stop()` can join within [`STOP_GRACE`].
    thread: Option<std::thread::JoinHandle<()>>,
}

impl GatewayShared {
    fn new() -> Self {
        Self {
            running: false,
            status: "stopped".to_string(),
            events: VecDeque::new(),
            last_error: None,
            stop: false,
            thread: None,
        }
    }
}

/// Process-lifetime shared state, created on first use.
static GATEWAY_STATE: LazyLock<Arc<Mutex<GatewayShared>>> =
    LazyLock::new(|| Arc::new(Mutex::new(GatewayShared::new())));

/// Lock the shared state, poison-tolerant (a panicking worker must not wedge
/// the UI; the mutex guard is recovered and the state is whatever it was).
fn lock_shared() -> std::sync::MutexGuard<'static, GatewayShared> {
    GATEWAY_STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn set_status_locked(shared: &mut GatewayShared, status: &str) {
    shared.status = status.to_string();
    if status.starts_with("error:") {
        shared.last_error = Some(status.trim_start_matches("error:").trim().to_string());
    }
}

fn set_error_locked(shared: &mut GatewayShared, message: &str) {
    shared.status = format!("error: {message}");
    shared.last_error = Some(message.to_string());
}

fn stop_requested() -> bool {
    lock_shared().stop
}

/// Push one event into the capped queue. Oldest entries are dropped.
fn push_event(shared: &Arc<Mutex<GatewayShared>>, event: GatewayEventEntry) {
    let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
    if guard.stop {
        // Stop was requested between the read and now — drop the event.
        return;
    }
    guard.events.push_back(event);
    while guard.events.len() > MAX_EVENTS {
        guard.events.pop_front();
    }
}

/// Sleep in 100 ms slices so a `stop()` request is observed within ~100 ms
/// instead of after the full backoff delay. Returns `false` when stop was
/// requested (caller should bail out of the reconnect sequence).
fn sleep_interruptible(total: Duration, shared: &Arc<Mutex<GatewayShared>>) -> bool {
    let start = Instant::now();
    while start.elapsed() < total {
        let stop = shared
            .lock()
            .map(|g| g.stop)
            .unwrap_or_else(|e| e.into_inner().stop);
        if stop {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100).min(total.saturating_sub(start.elapsed())));
    }
    !shared
        .lock()
        .map(|g| g.stop)
        .unwrap_or_else(|e| e.into_inner().stop)
}

/// Outcome of the bounded reconnect sequence.
enum ReconnectOutcome {
    /// Connection re-established (or freshly identified); the event loop may continue.
    Resumed,
    /// 5 attempts exhausted; status is already `error: …` and `stop` was set.
    GaveUp,
    /// `stop()` was requested mid-backoff.
    Stopped,
}

/// Bounded, caller-driven reconnect: up to 5 attempts with 1/2/4/8/16 s
/// backoff. Per attempt, [`next_attempt`] picks RESUME (socket + HELLO + op 6)
/// when a session id is known and not yet invalidated, or a fresh
/// `GatewayClient::connect` (op 2 IDENTIFY — `reconnect()` alone would leave
/// the server waiting for an IDENTIFY that never comes). A RESUME rejected with
/// `InvalidSession` marks the session dead, so every later attempt in this
/// sequence identifies afresh: `GatewayClient` exposes no way to clear its
/// stored session id, so a half-used RESUME client would otherwise still carry
/// the dead session into a later `client.resume()`. `Unauthorized`
/// (close 4004) is fatal and never retried.
///
/// Which handshake one reconnect attempt uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReconnectAttempt {
    /// Re-open the socket + HELLO, then op 6 RESUME the stored session.
    Resume,
    /// Open a fresh socket + HELLO + op 2 IDENTIFY via
    /// [`GatewayClient::connect`], replacing the caller's client.
    Identify,
}

/// Pick the handshake for one attempt: RESUME only while a session id is
/// known and has not been invalidated. Once a RESUME is rejected
/// (`InvalidSession`), every later attempt identifies afresh — the stored
/// session is dead, and `GatewayClient` keeps it until the client is replaced
/// by a `connect()`ed one.
fn next_attempt(session_id: Option<&str>, resume_broken: bool) -> ReconnectAttempt {
    if session_id.is_some() && !resume_broken {
        ReconnectAttempt::Resume
    } else {
        ReconnectAttempt::Identify
    }
}

/// The bounded reconnect sequence described above.
fn reconnect_with_backoff(
    client: &mut GatewayClient,
    shared: &Arc<Mutex<GatewayShared>>,
    url: &str,
    token: &str,
    listening: &Option<String>,
    reason: String,
) -> ReconnectOutcome {
    let mut last_reason = reason;
    let mut resume_broken = false;
    for (attempt_index, delay) in RECONNECT_DELAYS.iter().enumerate() {
        let attempt = attempt_index + 1;
        {
            let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
            set_status_locked(
                &mut guard,
                &format!(
                    "error: {last_reason} — reconnecting in {}s (attempt {attempt}/5)",
                    delay.as_secs()
                ),
            );
        }
        if !sleep_interruptible(*delay, shared) {
            return ReconnectOutcome::Stopped;
        }
        let attempt_result = match next_attempt(client.session_id(), resume_broken) {
            ReconnectAttempt::Resume => client.reconnect().and_then(|()| client.resume()),
            ReconnectAttempt::Identify => {
                GatewayClient::connect(url, token, DEFAULT_INTENTS).map(|fresh| {
                    *client = fresh;
                })
            }
        };
        match attempt_result {
            Ok(()) => {
                let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
                if guard.stop {
                    return ReconnectOutcome::Stopped;
                }
                let line = listening.clone().unwrap_or_else(|| "running".to_string());
                set_status_locked(&mut guard, &line);
                guard.last_error = None;
                return ReconnectOutcome::Resumed;
            }
            Err(DiscordError::Unauthorized) => {
                let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
                set_error_locked(
                    &mut guard,
                    &gateway_error_message(&DiscordError::Unauthorized),
                );
                guard.stop = true;
                return ReconnectOutcome::GaveUp;
            }
            Err(DiscordError::InvalidSession { .. }) => {
                // RESUME was rejected — the session is gone. Fall back to a
                // fresh IDENTIFY for the remaining attempts.
                resume_broken = true;
                last_reason =
                    gateway_error_message(&DiscordError::InvalidSession { resumable: false });
            }
            Err(other) => {
                last_reason = gateway_error_message(&other);
            }
        }
    }
    let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
    set_error_locked(
        &mut guard,
        &format!("gateway connection lost after 5 reconnect attempts ({last_reason})"),
    );
    guard.stop = true;
    ReconnectOutcome::GaveUp
}

/// The worker entry point. Every exit path funnels through the epilogue,
/// which flips `running` to `false` so `stop()`'s grace poll and the page's
/// 1 s timer always observe the worker's death — even when the run failed
/// before the event loop was reached.
fn gateway_run(shared: Arc<Mutex<GatewayShared>>) {
    let gave_up = run_gateway(&shared);
    // Epilogue. Keep an `error:` status when the run gave up; otherwise
    // report `stopped`. Never touch events here — `stop()` owns the clear
    // (events are personal data; dropped on Stop).
    let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
    guard.running = false;
    if gave_up || guard.status.starts_with("error:") {
        return;
    }
    guard.status = "stopped".to_string();
    if guard.stop {
        guard.last_error = None;
    }
}

/// The actual run. Returns `true` when the run ended in an error/give-up
/// state (the caller keeps the `error: …` status), `false` on a clean stop.
fn run_gateway(shared: &Arc<Mutex<GatewayShared>>) -> bool {
    // 1. Resolve the token from the same place the REST bridge keeps it.
    let config = match load_config() {
        Ok(Some(config)) if !config.token.trim().is_empty() => config,
        Ok(Some(_)) => {
            let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
            set_error_locked(&mut guard, "no bot token configured — save a token first");
            return true;
        }
        Ok(None) => {
            let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
            set_error_locked(&mut guard, "no bot token configured — save a token first");
            return true;
        }
        Err(message) => {
            let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
            set_error_locked(&mut guard, &message);
            return true;
        }
    };

    // 2. Ask Discord where to connect (GET /gateway/bot). Blocking reqwest is
    // fine here — this is the background thread, never the UI thread.
    let url = match DiscordRestClient::new(config.token.as_str())
        .and_then(|mut client| client.get_gateway_url())
    {
        Ok(info) => info.url,
        Err(error) => {
            let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
            set_error_locked(&mut guard, &gateway_error_message(&error));
            return true;
        }
    };

    // 3. HELLO → IDENTIFY handshake. DEFAULT_INTENTS (GUILD_MESSAGES |
    // DIRECT_MESSAGES | MESSAGE_CONTENT). MESSAGE_CONTENT is privileged — see
    // the module docs and the phase note.
    let mut client = match GatewayClient::connect(&url, config.token.as_str(), DEFAULT_INTENTS) {
        Ok(client) => client,
        Err(error) => {
            let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
            set_error_locked(&mut guard, &gateway_error_message(&error));
            // Fatal for this run; the human presses Start again if they want.
            return true;
        }
    };

    let mut listening: Option<String> = None;
    let mut gave_up = false;

    // 4. Event loop until stop. Heartbeats are driven inside `next_event`
    // (the crate has no thread of its own).
    loop {
        if stop_requested() {
            break;
        }
        match client.next_event() {
            Ok(GatewayEvent::Ready { user, .. }) => {
                let line = format!("listening as {}", user.username);
                listening = Some(line.clone());
                let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
                if !guard.stop {
                    set_status_locked(&mut guard, &line);
                    guard.last_error = None;
                }
            }
            Ok(GatewayEvent::MessageCreate {
                id,
                channel_id,
                author,
                content,
                timestamp,
                ..
            }) => {
                push_event(
                    shared,
                    GatewayEventEntry::capture(id, channel_id, &author, &content, timestamp),
                );
            }
            Ok(GatewayEvent::Resumed) => {
                let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
                if !guard.stop {
                    let line = listening.clone().unwrap_or_else(|| "running".to_string());
                    set_status_locked(&mut guard, &line);
                    guard.last_error = None;
                }
            }
            Ok(GatewayEvent::HeartbeatAck) => {
                // Liveness signal; not surfaced to the UI.
            }
            Ok(GatewayEvent::Closed { code }) => {
                // Server closed the socket — treat as a transport failure and
                // enter the same bounded backoff. 4004 never reaches here
                // (mapped to `Unauthorized` inside the crate).
                match reconnect_with_backoff(
                    &mut client,
                    shared,
                    &url,
                    config.token.as_str(),
                    &listening,
                    format!(
                        "gateway closed (code {})",
                        code.map(|c| c.to_string())
                            .unwrap_or_else(|| "none".to_string())
                    ),
                ) {
                    ReconnectOutcome::Resumed => continue,
                    ReconnectOutcome::Stopped => break,
                    ReconnectOutcome::GaveUp => {
                        gave_up = true;
                        break;
                    }
                }
            }
            Err(error) => {
                // Unauthorized is fatal — no retry.
                if matches!(error, DiscordError::Unauthorized) {
                    let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
                    set_error_locked(&mut guard, &gateway_error_message(&error));
                    guard.stop = true;
                    gave_up = true;
                    break;
                }
                match reconnect_with_backoff(
                    &mut client,
                    shared,
                    &url,
                    config.token.as_str(),
                    &listening,
                    gateway_error_message(&error),
                ) {
                    ReconnectOutcome::Resumed => continue,
                    ReconnectOutcome::Stopped => break,
                    ReconnectOutcome::GaveUp => {
                        gave_up = true;
                        break;
                    }
                }
            }
        }
    }

    gave_up
}

/// Truncate to `max` scalar values (never mid-codepoint). Content is personal
/// data: the inbox keeps at most this much of it.
fn truncate_chars(input: &str, max: usize) -> String {
    input.chars().take(max).collect()
}

/// Discord gateway receive view-model. One process-wide instance is fine; the
/// worker thread is process-lifetime and keyed to the shared state, not to a
/// UI instance.
pub struct DiscordGatewayState {
    /// `true` while the gateway worker thread is alive.
    pub running: bool,
    /// Human status line: `"stopped"` | `"running"` | `"listening as <name>"`
    /// | `"error: …"`.
    pub status_line: String,
    /// Received events, newest first, capped at [`MAX_EVENTS`].
    pub events: Vec<GatewayEventEntry>,
    /// Last error message (`""` when none).
    pub error: String,
}

impl Default for DiscordGatewayState {
    /// Reads the shared state once at construction so the fields are correct
    /// before the page touches the bridge.
    fn default() -> Self {
        let shared = lock_shared();
        Self {
            running: shared.running,
            status_line: shared.status.clone(),
            events: newest_first(&shared),
            error: shared.last_error.clone().unwrap_or_default(),
        }
    }
}

static STATE: Mutex<DiscordGatewayState> = Mutex::new(DiscordGatewayState {
    running: false,
    status_line: String::new(),
    events: Vec::new(),
    error: String::new(),
});

/// Lock the process-wide gateway state for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut DiscordGatewayState) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

/// The queue newest-first, as the page renders it.
fn newest_first(shared: &GatewayShared) -> Vec<GatewayEventEntry> {
    shared.events.iter().rev().cloned().collect()
}

impl DiscordGatewayState {
    /// Copy the shared state into the state fields.
    fn sync_from_shared(&mut self) {
        let (running, status, events, error) = {
            let shared = lock_shared();
            (
                shared.running,
                shared.status.clone(),
                newest_first(&shared),
                shared.last_error.clone().unwrap_or_default(),
            )
        };
        self.running = running;
        self.status_line = status;
        self.events = events;
        self.error = error;
    }

    /// Synchronous pre-flight failure: writes the error into the shared
    /// state, syncs the state fields and returns `false`. Used when no worker
    /// thread exists (already running / no token), so the page sees the
    /// failure immediately.
    fn fail_fast(&mut self, message: &str) -> bool {
        {
            let mut shared = lock_shared();
            shared.status = format!("error: {message}");
            shared.last_error = Some(message.to_string());
        }
        self.sync_from_shared();
        false
    }

    /// Start the gateway worker thread. Returns `true` when a thread was
    /// spawned. Returns `false` (and sets `error`) when no bot token is
    /// configured or the worker is already running — [`Self::start`] is the
    /// ONLY way the gateway connects; nothing here auto-connects.
    pub fn start(&mut self) -> bool {
        match start_worker() {
            Ok(()) => {
                self.sync_from_shared();
                true
            }
            Err(reason) => self.fail_fast(&reason),
        }
    }

    /// Request the worker to stop and wait up to 2 s for it. If the
    /// worker is blocked in a socket read (up to one heartbeat interval,
    /// typically ~41 s), this does NOT block the UI thread: the stop flag
    /// is set, the events queue is cleared, and `true` is returned; the
    /// worker exits at the next read boundary or when the socket errors
    /// and the page observes `running == false` on a later poll. Returns
    /// `true` even in the detached case.
    pub fn stop(&mut self) -> bool {
        let handle = {
            let mut shared = lock_shared();
            shared.stop = true;
            // Personal data: drop queued events immediately on Stop.
            shared.events.clear();
            shared.thread.take()
        };
        // Grace period: poll for the worker to finish (it sets running=false
        // at exit). We cannot join with a timeout in std, so poll the flag and
        // only join when it flips; otherwise detach — the worker observes the
        // stop flag at the next read boundary / backoff sleep slice.
        let deadline = Instant::now() + STOP_GRACE;
        let mut finished = false;
        while Instant::now() < deadline {
            if !lock_shared().running {
                finished = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if finished {
            if let Some(handle) = handle {
                // Should return immediately (worker already exited).
                let _ = handle.join();
            }
        }
        // If the worker is still alive it is blocked in a socket read; it will
        // observe `stop` at the next boundary. Its final state flip (running =
        // false, status unchanged or "stopped") is picked up by the page's
        // next poll/refresh.
        self.sync_from_shared();
        true
    }

    /// Re-sync the state fields from the shared state. The page calls this on
    /// a 1 s `Timer` while `running`.
    pub fn refresh(&mut self) {
        self.sync_from_shared();
    }

    /// Drop every queued event; returns `true`. Token/status untouched.
    pub fn clear_events(&mut self) -> bool {
        {
            let mut shared = lock_shared();
            shared.events.clear();
        }
        self.sync_from_shared();
        true
    }
}

/// Shared pre-flight + spawn used by both [`DiscordGatewayState::start`] and
/// [`start_from_main`] (`--discord-gateway` autostart). Returns `Err(reason)`
/// on refusal or failure; the caller decides how to report it.
pub(crate) fn start_worker() -> Result<(), String> {
    {
        let shared = lock_shared();
        if shared.running {
            return Err("gateway is already running".to_string());
        }
    }
    if !token_configured() {
        return Err("no bot token configured — save a token first".to_string());
    }
    let thread_state = {
        let mut shared = lock_shared();
        shared.stop = false;
        shared.running = true;
        shared.status = "running".to_string();
        shared.last_error = None;
        Arc::clone(&GATEWAY_STATE)
    };
    let spawn = std::thread::Builder::new()
        .name("discord-gateway".to_string())
        .spawn(move || gateway_run(thread_state));
    match spawn {
        Ok(handle) => {
            let mut shared = lock_shared();
            shared.thread = Some(handle);
            Ok(())
        }
        Err(error) => {
            // Could not spawn — roll the shared state back to a clean error.
            let mut shared = lock_shared();
            shared.running = false;
            set_error_locked(
                &mut shared,
                &format!("failed to spawn gateway thread: {error}"),
            );
            Err(format!("failed to spawn gateway thread: {error}"))
        }
    }
}

/// Free entry point for the `--discord-gateway` CLI flag (called from
/// `main`). Follows the same rails as the Start button: refuses (and only
/// logs) when no token is configured; never spawns "because it's convenient".
/// The gateway events surface through the page's 1 s poll exactly as if the
/// human had pressed Start.
pub(crate) fn start_from_main() -> bool {
    start_worker().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_to_char_boundary_not_bytes() {
        // 400 chars of a multibyte string must survive without panicking.
        let input: String = "héllo ".repeat(100);
        let truncated = truncate_chars(&input, CONTENT_MAX_CHARS);
        assert_eq!(truncated.chars().count(), CONTENT_MAX_CHARS);
    }

    #[test]
    fn events_are_newest_first() {
        let shared = GatewayShared::new();
        let mut shared = shared;
        shared.events.push_back(entry("1"));
        shared.events.push_back(entry("2"));
        let listed = newest_first(&shared);
        assert_eq!(listed[0].id, "2");
        assert_eq!(listed[1].id, "1");
        // camelCase on the wire: the page reads `authorName`, `channelId`.
        let value = serde_json::to_value(&listed).unwrap();
        assert_eq!(value[0]["id"], "2");
        assert!(value[0].get("authorName").is_some());
    }

    #[test]
    fn events_queue_caps_at_max() {
        let shared = Arc::new(Mutex::new(GatewayShared::new()));
        for i in 0..(MAX_EVENTS + 25) {
            push_event(&shared, entry(&i.to_string()));
        }
        let guard = shared.lock().unwrap();
        assert_eq!(guard.events.len(), MAX_EVENTS);
        // Oldest were dropped.
        assert_eq!(guard.events.front().unwrap().id, "25");
    }

    #[test]
    fn entry_shape_is_camel_case_and_truncates_content() {
        let author = airi_discord::MessageAuthor {
            id: "42".to_string(),
            username: "vi".to_string(),
            bot: true,
        };
        let entry = GatewayEventEntry::capture(
            "id-1".to_string(),
            "chan-1".to_string(),
            &author,
            &"a".repeat(CONTENT_MAX_CHARS + 50),
            "2026-11-13T00:00:00+00:00".to_string(),
        );
        assert_eq!(entry.content.chars().count(), CONTENT_MAX_CHARS);
        assert_eq!(entry.author_name, "vi");
        assert!(entry.author_bot);
        // No token-ish field, and no raw author object: only the page-facing
        // scalars cross the boundary.
        let value = serde_json::to_value(&entry).unwrap();
        assert_eq!(value["authorName"], "vi");
        assert_eq!(value["channelId"], "chan-1");
        assert!(value.get("author").is_none());
    }

    #[test]
    fn reconnect_attempt_resumes_while_session_is_live() {
        assert_eq!(
            next_attempt(Some("sess-1"), false),
            ReconnectAttempt::Resume
        );
    }

    #[test]
    fn reconnect_attempt_identifies_after_resume_rejected() {
        // The session id survives on the client even after op 9, so
        // `resume_broken` is what forces a fresh IDENTIFY.
        assert_eq!(
            next_attempt(Some("sess-dead"), true),
            ReconnectAttempt::Identify
        );
    }

    #[test]
    fn reconnect_attempt_identifies_without_session() {
        assert_eq!(next_attempt(None, false), ReconnectAttempt::Identify);
    }

    /// One queue entry with only the id varied; the rest is fixed.
    fn entry(id: &str) -> GatewayEventEntry {
        GatewayEventEntry {
            id: id.to_string(),
            channel_id: "chan-1".to_string(),
            author_name: "vi".to_string(),
            author_bot: false,
            content: "hello".to_string(),
            timestamp: "2026-11-13T00:00:00+00:00".to_string(),
            received_ms: 1,
        }
    }
}