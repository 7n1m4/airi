// SPDX-License-Identifier: GPL-3.0-or-later
//! Provider settings bridge (`ProviderSettingsController`) exposed to Slint.
//!
//! Drives the settings/providers page: one generic page rendered from the
//! static [`airi_llm::PROVIDER_DEFS`] registry — the 44 provider rows are data,
//! not bespoke UI. The detail form is built from each provider's
//! `CredentialSchema` fields, so adding a provider to the registry needs zero
//! UI changes.
//!
//! Boundary contract:
//! - `provider_rows()` returns the provider rows as plain [`ProviderEntry`]
//!   values (registry row + stored persistence state merged). Field records are
//!   flattened into typed plain objects; secrets cross as-is and the form
//!   renders them in password echo fields.
//! - `provider_config_json()` returns a flat JSON *object* string
//!   (`{"api_key": ..., "base_url": ..., "model": ..., ...extras}`), `{}` when
//!   unconfigured. The `enabled` flag is deliberately **not** part of the
//!   payload: `save_provider_config` round-trips this exact shape, and an extra
//!   key would leak into `extra_json`. Enabled state comes from the rows.
//! - `save_provider_config()` accepts the same flat object shape. Well-known
//!   keys (`api_key`, `base_url`, `model`) are mapped onto the typed config; any
//!   remaining keys (`account_id`, `region`, `aws_secret_access_key`, ...) are
//!   kept as provider-specific extras. Empty strings clear a field.
//! - The async pair ([`ProviderSettingsControllerState::test_connection`] /
//!   [`ProviderSettingsControllerState::list_models`]) spawn on the shared Tokio
//!   handle registered from `main` and return immediately. Results are pushed
//!   onto the controller's `mpsc` and **must** be drained on the UI thread via
//!   [`ProviderSettingsControllerState::drain_events`] (a Slint timer calls it),
//!   which updates the `testing` / `last_test_status` / `models_loading` /
//!   `models` / `models_error` fields. Async tasks never touch the UI thread.
//! - The connection test exercises the **stored** configuration (call
//!   `save_provider_config` first — the page does exactly that inside its Test
//!   handler).
//!
//! Persistence goes through `airi_store::ProviderRepo` (id, kind, config JSON,
//! enabled, updated_at). Saving a config for a *new* provider enables it (the
//! user just supplied credentials — implicit intent to use); existing records
//! keep their current `enabled` flag.

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use airi_llm::{build_client, ProviderConfig, ProviderRegistry};
use airi_store::{ProviderKind as StoreProviderKind, StoredProvider};
use serde::Serialize;

/// Hard cap for the connection test / model-list round trip. `build_client`
/// HTTP clients have no total timeout by design (streams are unbounded), so a
/// dead endpoint would otherwise hang the `testing` state forever.
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);

/// One credential field of a provider row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFieldEntry {
    /// Config key the field maps to.
    pub key: &'static str,
    /// Human-readable label.
    pub label: &'static str,
    /// Whether the value is a secret (rendered as a password field).
    pub secret: bool,
    /// Whether a value is required before the provider works.
    pub required: bool,
    /// Example value shown by the empty input.
    pub placeholder: Option<&'static str>,
}

/// One provider row: the registry definition merged with stored state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEntry {
    /// Registry id used in configs/stores.
    pub id: &'static str,
    /// Human-readable label.
    pub label: &'static str,
    /// Kebab-case wire kind (`open-ai-compatible`, `anthropic`, `google-gemini`,
    /// `aws-bedrock`, `local-server`). The UI maps it to a localized badge label.
    pub kind: &'static str,
    /// Whether the provider can serve chat today.
    pub chat_capable: bool,
    /// Persisted enabled flag.
    pub enabled: bool,
    /// Whether credentials are stored.
    pub configured: bool,
    /// Default base URL, when the registry pins one.
    pub default_base_url: Option<&'static str>,
    /// Registry note about missing capability, when any.
    pub compat_note: Option<&'static str>,
    /// Credential schema fields rendered by the detail form.
    pub fields: Vec<ProviderFieldEntry>,
}

/// Async results pushed from the Tokio thread onto the UI thread.
enum ProviderEvent {
    /// Connection-test outcome: the diagnostic text is logged where it is
    /// produced; the event carries only what the UI reads.
    TestFinished {
        /// Provider id the test ran for.
        id: String,
        /// Whether the provider answered successfully.
        ok: bool,
    },
    /// Model-list outcome: `models` is empty on error.
    ModelsLoaded {
        /// Provider id the fetch ran for.
        id: String,
        /// Model ids offered by the provider.
        models: Vec<String>,
        /// Diagnostic detail (not localized); `None` on success.
        error: Option<String>,
    },
}

/// Provider settings view-model state. One process-wide instance.
pub struct ProviderSettingsControllerState {
    /// True while a connection test is in flight.
    pub testing: bool,
    /// Provider id the last test ran for.
    pub last_test_id: String,
    /// `success` / `failed` / `unsupported` for the last test.
    pub last_test_status: String,
    /// True while a model-list fetch is in flight.
    pub models_loading: bool,
    /// Model ids from the last fetch; empty on error.
    pub models: Vec<String>,
    /// Diagnostic detail of the last failed model-list fetch.
    pub models_error: String,
    /// Sender half of the async result channel, cloned into each spawned task.
    events_tx: mpsc::Sender<ProviderEvent>,
    /// Receiver half of the async result channel; drained on the UI thread.
    events_rx: Mutex<mpsc::Receiver<ProviderEvent>>,
}

/// Process-wide controller. The initializer owns the channel pair so the
/// receiver can stay behind the state's mutex: the sender is cloned into every
/// spawned Tokio task, the receiver is only ever drained on the UI thread.
static STATE: LazyLock<Mutex<ProviderSettingsControllerState>> = LazyLock::new(|| {
    let (events_tx, events_rx) = mpsc::channel();
    Mutex::new(ProviderSettingsControllerState {
        testing: false,
        last_test_id: String::new(),
        last_test_status: String::new(),
        models_loading: false,
        models: Vec::new(),
        models_error: String::new(),
        events_tx,
        events_rx: Mutex::new(events_rx),
    })
});

/// Lock the process-wide controller for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut ProviderSettingsControllerState) -> R) -> R {
    match STATE.lock() {
        Ok(mut guard) => f(&mut guard),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

/// Kebab-case kind tag matching `airi-store`'s persistence format and the UI badge keys.
fn kind_str(kind: airi_llm::ProviderKind) -> &'static str {
    match kind {
        airi_llm::ProviderKind::OpenAiCompatible => "open-ai-compatible",
        airi_llm::ProviderKind::Anthropic => "anthropic",
        airi_llm::ProviderKind::GoogleGemini => "google-gemini",
        airi_llm::ProviderKind::AwsBedrock => "aws-bedrock",
        airi_llm::ProviderKind::LocalServer => "local-server",
    }
}

/// Map the registry kind onto the store's persistence kind.
fn store_kind(kind: airi_llm::ProviderKind) -> StoreProviderKind {
    match kind {
        airi_llm::ProviderKind::OpenAiCompatible => StoreProviderKind::OpenAiCompatible,
        airi_llm::ProviderKind::Anthropic => StoreProviderKind::Anthropic,
        airi_llm::ProviderKind::GoogleGemini => StoreProviderKind::GoogleGemini,
        airi_llm::ProviderKind::AwsBedrock => StoreProviderKind::AwsBedrock,
        airi_llm::ProviderKind::LocalServer => StoreProviderKind::LocalServer,
    }
}

/// `Some(trimmed)` for non-empty strings, `None` otherwise (empty clears the field).
fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Load and deserialize the stored typed config for `id`; `None` when missing or corrupt.
fn stored_config(id: &str) -> Option<ProviderConfig> {
    let stored = crate::bridges::provider_repo()?.get(id).ok().flatten()?;
    serde_json::from_value(stored.config).ok()
}

/// Build the registry + persistence-merged provider rows (the payload of
/// [`provider_rows`]). Free function so unit tests can exercise the merge
/// without a controller instance.
fn provider_records() -> Vec<ProviderEntry> {
    let stored = crate::bridges::provider_repo()
        .and_then(|repo| repo.list().ok())
        .unwrap_or_default();
    let by_id: HashMap<&str, &StoredProvider> = stored.iter().map(|p| (p.id.as_str(), p)).collect();

    ProviderRegistry::new()
        .all()
        .iter()
        .map(|def| {
            let stored = by_id.get(def.id);
            let configured = stored
                .map(|s| s.config.as_object().map(|o| !o.is_empty()).unwrap_or(true))
                .unwrap_or(false);
            ProviderEntry {
                id: def.id,
                label: def.label,
                kind: kind_str(def.kind),
                chat_capable: def.compat.chat,
                enabled: stored.map(|s| s.enabled).unwrap_or(false),
                configured,
                default_base_url: def.base_url,
                compat_note: def.compat.note,
                fields: def
                    .credential
                    .fields
                    .iter()
                    .map(|f| ProviderFieldEntry {
                        key: f.key,
                        label: f.label,
                        secret: f.secret,
                        required: f.required,
                        placeholder: f.placeholder,
                    })
                    .collect(),
            }
        })
        .collect()
}

/// Save flat credential JSON for `id` into `repo`; see module docs for the shape.
/// Free function so unit tests can drive it against a temporary database.
fn save_config_to_repo(repo: &airi_store::ProviderRepo, id: &str, config_json: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(config_json) else {
        eprintln!("[airi-slint] providers: saveConfig: config JSON for '{id}' is not an object");
        return false;
    };
    let Some(obj) = value.as_object() else {
        eprintln!("[airi-slint] providers: saveConfig: config JSON for '{id}' is not an object");
        return false;
    };
    let Some(def) = ProviderRegistry::new().get(id) else {
        eprintln!("[airi-slint] providers: saveConfig: unknown provider id '{id}'");
        return false;
    };

    let mut api_key = None;
    let mut base_url = None;
    let mut model = None;
    let mut extras = serde_json::Map::new();
    for (key, value) in obj {
        match key.as_str() {
            // Reserved record-level keys are not part of the credential payload.
            "id" | "kind" | "enabled" | "updated_at" | "config" => {}
            "api_key" => api_key = value.as_str().and_then(non_empty),
            "base_url" => base_url = value.as_str().and_then(non_empty),
            "model" => model = value.as_str().and_then(non_empty),
            _ => {
                extras.insert(key.clone(), value.clone());
            }
        }
    }
    let config = ProviderConfig {
        api_key,
        base_url,
        model,
        extra_json: extras,
    };
    let Ok(config_value) = serde_json::to_value(&config) else {
        return false;
    };
    let enabled = repo
        .get(id)
        .ok()
        .flatten()
        .map(|p| p.enabled)
        .unwrap_or(true);
    let provider = StoredProvider {
        id: id.to_owned(),
        kind: store_kind(def.kind),
        config: config_value,
        enabled,
        updated_at: 0,
    };
    match repo.upsert(&provider) {
        Ok(()) => true,
        Err(err) => {
            eprintln!("[airi-slint] providers: saveConfig: {err:#}");
            false
        }
    }
}

/// Load the stored flat credential JSON for `id` from `repo`; `{}` when unset.
fn load_config_from_repo(repo: &airi_store::ProviderRepo, id: &str) -> String {
    let Some(stored) = repo.get(id).ok().flatten() else {
        return "{}".to_owned();
    };
    match serde_json::from_value::<ProviderConfig>(stored.config.clone()) {
        Ok(config) => {
            let mut map = serde_json::Map::new();
            if let Some(v) = config.api_key {
                map.insert("api_key".into(), v.into());
            }
            if let Some(v) = config.base_url {
                map.insert("base_url".into(), v.into());
            }
            if let Some(v) = config.model {
                map.insert("model".into(), v.into());
            }
            for (key, value) in config.extra_json {
                map.insert(key, value);
            }
            serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_owned())
        }
        // Tolerate a raw object blob written by older tooling.
        Err(_) => stored.config.to_string(),
    }
}

/// Flip the persisted enabled flag for `id` in `repo`.
fn save_enabled_to_repo(repo: &airi_store::ProviderRepo, id: &str, enabled: bool) -> bool {
    match repo.get(id) {
        Ok(Some(mut stored)) => {
            stored.enabled = enabled;
            stored.updated_at = 0;
            repo.upsert(&stored).is_ok()
        }
        Ok(None) => {
            let Some(def) = ProviderRegistry::new().get(id) else {
                eprintln!("[airi-slint] providers: saveEnabled: unknown provider id '{id}'");
                return false;
            };
            repo.upsert(&StoredProvider {
                id: id.to_owned(),
                kind: store_kind(def.kind),
                config: serde_json::json!({}),
                enabled,
                updated_at: 0,
            })
            .is_ok()
        }
        Err(err) => {
            eprintln!("[airi-slint] providers: saveEnabled: {err:#}");
            false
        }
    }
}

/// Delete the stored record for `id` from `repo`.
fn delete_config_from_repo(repo: &airi_store::ProviderRepo, id: &str) -> bool {
    match repo.delete(id) {
        Ok(_) => true,
        Err(err) => {
            eprintln!("[airi-slint] providers: deleteConfig: {err:#}");
            false
        }
    }
}

/// Fetch the model list for `def` using `config` with a hard timeout. Shared by
/// the connection test (count only) and the model-list fetch (ids).
async fn fetch_models(
    def: airi_llm::ProviderDef,
    config: ProviderConfig,
) -> Result<Vec<String>, String> {
    let client = build_client(&def, config).map_err(|e| e.to_string())?;
    match tokio::time::timeout(MODELS_TIMEOUT, client.models()).await {
        Ok(Ok(models)) => Ok(models.into_iter().map(|m| m.id).collect()),
        Ok(Err(err)) => Err(err.to_string()),
        Err(_) => Err("request timed out".to_owned()),
    }
}

/// Registry rows, merged with stored persistence state.
pub fn provider_rows() -> Vec<ProviderEntry> {
    provider_records()
}

/// Flat JSON object with the stored credential fields for `id`; `{}` when unset.
pub fn provider_config_json(id: &str) -> String {
    let Some(repo) = crate::bridges::provider_repo() else {
        return "{}".to_owned();
    };
    load_config_from_repo(repo, id)
}

/// Upsert credentials for `id` from a flat JSON object; see module docs.
pub fn save_provider_config(id: &str, config_json: &str) -> bool {
    let Some(repo) = crate::bridges::provider_repo() else {
        eprintln!("[airi-slint] providers: saveConfig: store unavailable");
        return false;
    };
    save_config_to_repo(repo, id, config_json)
}

/// Flip the persisted enabled flag for `id`.
pub fn save_provider_enabled(id: &str, enabled: bool) -> bool {
    let Some(repo) = crate::bridges::provider_repo() else {
        eprintln!("[airi-slint] providers: saveEnabled: store unavailable");
        return false;
    };
    save_enabled_to_repo(repo, id, enabled)
}

/// Delete the stored configuration (credentials + enabled flag) for `id`.
pub fn delete_provider_config(id: &str) -> bool {
    let Some(repo) = crate::bridges::provider_repo() else {
        eprintln!("[airi-slint] providers: deleteConfig: store unavailable");
        return false;
    };
    delete_config_from_repo(repo, id)
}

impl ProviderSettingsControllerState {
    /// Spawn the async connection test; see module docs.
    ///
    /// `last_test_status` becomes `"success"` / `"failed"` (or `"unsupported"`
    /// when the row cannot serve chat) once [`Self::drain_events`] sees the
    /// result; the provider's diagnostic detail is logged, not surfaced as a
    /// status token.
    pub fn test_connection(&mut self, id: &str) {
        let Some(def) = ProviderRegistry::new().get(id) else {
            self.last_test_id = id.to_owned();
            self.last_test_status = "unsupported".to_owned();
            eprintln!("[airi-slint] providers: testConnection: unknown provider '{id}'");
            return;
        };
        if !def.compat.chat {
            let note = def.compat.note.unwrap_or("provider is not wired yet");
            self.last_test_id = id.to_owned();
            self.last_test_status = "unsupported".to_owned();
            eprintln!("[airi-slint] providers: testConnection: {id}: {note}");
            return;
        }

        let config = stored_config(id).unwrap_or_default();
        self.testing = true;
        let tx = self.events_tx.clone();
        let Some(handle) = crate::bridges::runtime_handle() else {
            self.testing = false;
            self.last_test_id = id.to_owned();
            self.last_test_status = "failed".to_owned();
            eprintln!("[airi-slint] providers: testConnection: tokio runtime unavailable");
            return;
        };
        let def = *def;
        handle.spawn(async move {
            // The diagnostic text is logged here rather than carried on the
            // event: no consumer reads it.
            match fetch_models(def, config).await {
                Ok(models) => {
                    eprintln!("[airi-slint] providers: {} models", models.len());
                    let _ = tx.send(ProviderEvent::TestFinished {
                        id: def.id.to_owned(),
                        ok: true,
                    });
                }
                Err(error) => {
                    eprintln!("[airi-slint] providers: test failed: {error}");
                    let _ = tx.send(ProviderEvent::TestFinished {
                        id: def.id.to_owned(),
                        ok: false,
                    });
                }
            }
        });
    }

    /// Spawn the async model-list fetch; see module docs.
    pub fn list_models(&mut self, id: &str) {
        let Some(def) = ProviderRegistry::new().get(id) else {
            self.models_loading = false;
            self.models_error = "unknown provider".to_owned();
            return;
        };
        if !def.compat.chat {
            self.models_loading = false;
            self.models_error = "provider is not wired yet".to_owned();
            return;
        }

        let config = stored_config(id).unwrap_or_default();
        self.models_loading = true;
        self.models_error = String::default();
        let tx = self.events_tx.clone();
        let Some(handle) = crate::bridges::runtime_handle() else {
            self.models_loading = false;
            self.models_error = "tokio runtime unavailable".to_owned();
            return;
        };
        let def = *def;
        handle.spawn(async move {
            let event = match fetch_models(def, config).await {
                Ok(models) => ProviderEvent::ModelsLoaded {
                    id: def.id.to_owned(),
                    models,
                    error: None,
                },
                Err(err) => ProviderEvent::ModelsLoaded {
                    id: def.id.to_owned(),
                    models: Vec::new(),
                    error: Some(err),
                },
            };
            let _ = tx.send(event);
        });
    }

    /// Drain pending async results onto the UI thread; see module docs.
    pub fn drain_events(&mut self) {
        let events_rx = match self.events_rx.lock() {
            Ok(rx) => rx,
            Err(poisoned) => poisoned.into_inner(),
        };
        while let Ok(event) = events_rx.try_recv() {
            match event {
                ProviderEvent::TestFinished { id, ok, .. } => {
                    self.testing = false;
                    self.last_test_id = id;
                    self.last_test_status = if ok { "success" } else { "failed" }.to_owned();
                }
                ProviderEvent::ModelsLoaded { id, models, error } => {
                    self.models_loading = false;
                    self.last_test_id = id;
                    self.models = models;
                    self.models_error = error.unwrap_or_default();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! Registry/persistence-boundary tests for the providers bridge. The UI
    //! pump itself is exercised by `--smoke`; here we cover the pure logic:
    //! the `provider_rows()` payload merge, the flat save/load round trip, and
    //! the HTTP probe used by the connection test / model list — against a
    //! loopback mock server, never a live endpoint.
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_db_path() -> std::path::PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "airi-providers-bridge-test-{}-{n}.sqlite",
            std::process::id()
        ))
    }

    fn temp_repo() -> (airi_store::ProviderRepo, std::path::PathBuf) {
        let path = temp_db_path();
        let db = airi_store::Database::open(&path).expect("open temp db");
        (airi_store::ProviderRepo::new(db), path)
    }

    fn cleanup(path: &std::path::Path) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn provider_records_covers_registry() {
        let records = provider_records();
        assert_eq!(records.len(), 45, "expected all 45 registry rows");
        let ids: Vec<&str> = records.iter().map(|r| r.id).collect();
        assert!(
            ids.contains(&"llama-cpp-local"),
            "missing llama-cpp-local row"
        );
        for expected in [
            "openai",
            "ollama",
            "anthropic",
            "google-generative-ai",
            "amazon-bedrock",
            "llama-cpp-local",
        ] {
            assert!(ids.contains(&expected), "missing registry id {expected}");
        }
        // Engines that land in a later phase render disabled.
        let bedrock = records.iter().find(|r| r.id == "amazon-bedrock").unwrap();
        assert!(!bedrock.chat_capable);
        assert_eq!(bedrock.fields.len(), 4);
        // Ollama: keyless, two fields.
        let ollama = records.iter().find(|r| r.id == "ollama").unwrap();
        assert!(ollama.chat_capable);
        assert_eq!(
            ollama.fields.iter().map(|f| f.key).collect::<Vec<_>>(),
            ["base_url", "model"]
        );
        // OpenAI: key + optional base_url + model.
        let openai = records.iter().find(|r| r.id == "openai").unwrap();
        assert_eq!(
            openai.fields.iter().map(|f| f.key).collect::<Vec<_>>(),
            ["api_key", "base_url", "model"]
        );
        assert!(
            openai
                .fields
                .iter()
                .any(|f| f.key == "api_key" && f.secret && f.required),
            "api_key must stay secret + required for openai"
        );
    }

    #[test]
    fn save_load_roundtrip_and_delete() {
        let (repo, path) = temp_repo();
        assert!(save_config_to_repo(
            &repo,
            "openai",
            r#"{"api_key":"sk-test","base_url":"https://example.invalid/v1","model":"gpt-mock","organization":"acme"}"#
        ));
        let loaded: serde_json::Value =
            serde_json::from_str(&load_config_from_repo(&repo, "openai")).unwrap();
        assert_eq!(loaded["api_key"], "sk-test");
        assert_eq!(loaded["model"], "gpt-mock");
        // Provider-specific extras round-trip untouched.
        assert_eq!(loaded["organization"], "acme");
        // Empty string clears a field.
        assert!(save_config_to_repo(
            &repo,
            "openai",
            r#"{"api_key":"","model":"gpt-mock"}"#
        ));
        let loaded: serde_json::Value =
            serde_json::from_str(&load_config_from_repo(&repo, "openai")).unwrap();
        assert!(loaded.get("api_key").is_none());
        assert_eq!(loaded["model"], "gpt-mock");
        // Enabling a never-saved provider creates a minimal record.
        assert!(save_enabled_to_repo(&repo, "ollama", true));
        let stored = repo.get("ollama").unwrap().unwrap();
        assert!(stored.enabled);
        assert_eq!(stored.config, serde_json::json!({}));
        // Toggle persists on an existing record.
        assert!(save_enabled_to_repo(&repo, "ollama", false));
        assert!(!repo.get("ollama").unwrap().unwrap().enabled);
        // Delete removes the record.
        assert!(delete_config_from_repo(&repo, "ollama"));
        assert!(repo.get("ollama").unwrap().is_none());
        drop(repo);
        cleanup(&path);
    }

    /// Spawn a one-shot HTTP responder on a loopback port; returns the base URL
    /// including the `/v1` affix the OpenAI-compatible client expects.
    fn mock_openai_models(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 8192];
                let _ = socket.read(&mut buf);
                let reason = match status {
                    200 => "200 OK",
                    401 => "401 Unauthorized",
                    _ => "500 Internal Server Error",
                };
                let resp = format!(
                    "HTTP/1.1 {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(resp.as_bytes());
            }
        });
        format!("http://{addr}/v1")
    }

    #[tokio::test]
    async fn fetch_models_success_against_mock() {
        let base_url =
            mock_openai_models(200, r#"{"data":[{"id":"mock-alpha"},{"id":"mock-beta"}]}"#);
        let def = ProviderRegistry::new().get("openai").unwrap();
        let config = ProviderConfig {
            api_key: Some("sk-test".into()),
            base_url: Some(base_url),
            model: Some("mock-alpha".into()),
            extra_json: serde_json::Map::new(),
        };
        let models = fetch_models(*def, config).await.expect("mock must answer");
        assert_eq!(models, ["mock-alpha", "mock-beta"]);
    }

    #[tokio::test]
    async fn fetch_models_401_surfaces_provider_error() {
        let base_url = mock_openai_models(401, r#"{"error":{"message":"bad key"}}"#);
        let def = ProviderRegistry::new().get("openai").unwrap();
        let config = ProviderConfig {
            api_key: Some("sk-wrong".into()),
            base_url: Some(base_url),
            model: None,
            extra_json: serde_json::Map::new(),
        };
        let err = fetch_models(*def, config)
            .await
            .expect_err("401 must surface");
        assert!(!err.is_empty());
    }
}
