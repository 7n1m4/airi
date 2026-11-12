// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! AIRI core domain services, state, events, and character-card handling.
//!
//! P1 delivers:
//!
//! - [`settings`]: typed settings sections persisted as one JSON blob per
//!   section through `airi-store`'s `SettingsRepo`, with change broadcasts.
//!   Section keys reuse the Electron app's `settings/<group>` namespace.
//! - [`chat`]: [`ChatService`](chat::ChatService), a streaming chat pipeline
//!   that persists user/assistant messages and emits typed
//!   [`ChatEvent`](chat::ChatEvent)s on a broadcast channel. Transport goes
//!   through `airi-llm` providers (registered clients or `build_client`).
//! - [`cards`]: character card schema types (CC v2 / v3, AIRI `airi`
//!   extension) and `.png` card import via tEXt/iTXt/zTXt chunk extraction.
//! - [`AppCore`]: aggregate state wiring the store, the provider registry,
//!   and the event bus together.
//!
//! Cross-thread notification uses Tokio broadcast channels; UI bindings pump
//! these into UI signals on the UI thread (P2). One-way flow only:
//! core → broadcast → the UI.
//!
//! Not yet implemented (later phases): tool calling and the `WaitingOnTool`
//! round trip, incremental assistant-message persistence while streaming
//! (`airi-store`'s `MessageRepo` has no update path yet), provider secret
//! management, and 1:1 migration of the Electron localStorage flat keys into
//! section blobs (desktop-only port; no migration).
//! - [`memory`]: memory services. Lane ① (`memory::short_term`, `memory::journal`):
//!   short-term daily summaries via a `ChatProvider`-backed summarizer and the
//!   append-only text journal (tables `summaries` / `journal_entries`, migration v2).
//!   Lane ② (`memory::retrieval`, `memory::embedding`): embeddings over
//!   OpenAI-compatible `/embeddings`, the hybrid semantic + lexical retrieval
//!   index (migration v3), 5W query hooks, and the chat-context prompt-block
//!   builder.
//! - [`sessions`]: session export helpers (JSONL). Search lives on
//!   `airi_store::SessionRepo`; auto-titling of default-titled sessions runs
//!   best-effort in `chat` after the assistant's first reply completes.
//! - [`update`]: check-only updater against GitHub Releases (P8 stage:
//!   check + notify; no self-replacement).
//! - [`single_instance`]: named-lock-file single-instance guard.
//! - [`crashlog`]: panic hook that records crash metadata under
//!   `<data>/logs/` before chaining to the default hook.

pub mod cards;
pub mod chat;
pub mod crashlog;
pub mod memory;
pub mod sessions;
pub mod settings;
pub mod single_instance;
pub mod update;
pub mod vault;

pub use chat::{ChatService, ChatStatus};
pub use settings::SettingsStore;

use airi_llm::ChatRequest;
use airi_store::{MessageRepo, SessionRepo, StoredMessage, StoredSession};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::broadcast;

/// Lightweight core events emitted across the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum CoreEvent {
    /// Session was created.
    SessionCreated {
        /// session id
        id: String,
    },
    /// Message was appended.
    MessageAppended {
        /// session id
        session_id: String,
        /// message id
        id: String,
    },
    /// Provider registry was updated.
    ProvidersChanged,
    /// Settings changed.
    SettingsChanged {
        /// setting key
        key: String,
    },
}
/// Application state aggregator.
///
/// Holds the store repositories, the shared provider table (LLM clients by
/// id), the core broadcast bus, and a ready-to-use [`ChatService`](chat::ChatService)
/// wired to the same store and provider table.
#[derive(Clone)]
pub struct AppCore {
    db: airi_store::Database,
    sessions: SessionRepo,
    messages: MessageRepo,
    bus: broadcast::Sender<CoreEvent>,
    /// LLM providers by id.
    pub providers: Arc<Mutex<std::collections::HashMap<String, Arc<dyn airi_llm::ChatProvider>>>>,
    /// Streaming chat service sharing the store and provider table.
    pub chat: chat::ChatService,
}

impl AppCore {
    /// Build core state from store handles.
    pub fn new(store: airi_store::Database) -> Self {
        let (bus, _) = broadcast::channel(64);
        let providers = Arc::new(Mutex::new(std::collections::HashMap::new()));
        Self {
            db: store.clone(),
            sessions: SessionRepo::new(store.clone()),
            messages: MessageRepo::new(store.clone()),
            bus,
            providers: providers.clone(),
            chat: chat::ChatService::with_shared_providers(store, providers),
        }
    }

    /// Subscribe to core events.
    pub fn subscribe(&self) -> broadcast::Receiver<CoreEvent> {
        self.bus.subscribe()
    }

    /// Build a settings store bound to the core's event bus.
    pub fn settings(&self) -> settings::SettingsStore {
        settings::SettingsStore::new(self.db.clone(), self.bus.clone())
    }

    /// Create a session and emit event.
    pub fn create_session(&self, title: &str) -> Result<StoredSession> {
        let id = new_id();
        let s = self.sessions.create(&id, title)?;
        let _ = self
            .bus
            .send(CoreEvent::SessionCreated { id: s.id.clone() });
        Ok(s)
    }

    /// Append a message to a session and emit event.
    pub fn append_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<StoredMessage> {
        let id = new_id();
        let m = StoredMessage {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now_ms(),
            metadata: serde_json::json!({}),
        };
        self.messages.insert(&m)?;
        let _ = self.bus.send(CoreEvent::MessageAppended {
            session_id: session_id.to_string(),
            id: m.id.clone(),
        });
        Ok(m)
    }

    /// Start a streaming chat completion using a registered provider.
    pub async fn stream_chat(
        &self,
        provider_id: &str,
        req: ChatRequest,
    ) -> Result<airi_llm::ChatStream> {
        let provider = self
            .providers
            .lock()
            .expect("providers mutex poisoned")
            .get(provider_id)
            .cloned()
            .with_context(|| format!("provider not registered: {provider_id}"))?;
        let request = req;
        let stream = provider.stream(request).await?;
        Ok(stream)
    }
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(crate) fn new_id() -> String {
    // time+random-ish without adding uuid dep yet
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}{:x}", n, std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn create_session_and_append_message() {
        let dir = tempdir().unwrap();
        let db = airi_store::Database::open(&dir.path().join("test.sqlite")).unwrap();
        let core = AppCore::new(db);
        let session = core.create_session("Demo").unwrap();
        let msg = core.append_message(&session.id, "user", "hello").unwrap();
        assert_eq!(msg.content, "hello");
    }

    #[test]
    fn appcore_chat_shares_provider_table() {
        let dir = tempdir().unwrap();
        let db = airi_store::Database::open(&dir.path().join("test.sqlite")).unwrap();
        let core = AppCore::new(db);
        // The chat service must observe providers registered on the AppCore table.
        assert!(Arc::ptr_eq(&core.chat.providers, &core.providers));
    }
}
