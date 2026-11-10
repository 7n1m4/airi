// SPDX-License-Identifier: GPL-3.0-or-later
//! Provider settings bridge (`ProviderSettingsController`) exposed to QML.
//!
//! Drives `qml/pages/settings/providers/ProvidersPage.qml`: one generic page
//! rendered from the static [`airi_llm::PROVIDER_DEFS`] registry — the 44
//! provider rows are data, not bespoke QML. The detail form is built from each
//! provider's `CredentialSchema` fields, so adding a provider to the registry
//! needs zero QML changes.
//!
//! Boundary contract (keeps the no-`serde_json::Value` rule honest):
//! - `listProviders()` returns a one-shot JSON *array* string. JSON is used at
//!   this boundary because cxx-qt 0.10 cannot express a Rust-subclassed
//!   `QAbstractListModel` (see `docs/bridge-pattern.md`) and the list is consumed
//!   wholesale on page load/refresh anyway. Field records are flattened into
//!   typed plain objects; secrets cross as-is and QML renders them in password
//!   echo fields.
//! - `loadConfig()` returns a flat JSON *object* string (`{"api_key": ...,
//!   "base_url": ..., "model": ..., ...extras}`), `{}` when unconfigured. The
//!   `enabled` flag is deliberately **not** part of the payload: `saveConfig`
//!   round-trips this exact shape, and an extra key would leak into
//!   `extra_json`. Enabled state comes from `listProviders()`.
//! - `saveConfig()` accepts the same flat object shape. Well-known keys
//!   (`api_key`, `base_url`, `model`) are mapped onto the typed config; any
//!   remaining keys (`account_id`, `region`, `aws_secret_access_key`, ...) are
//!   kept as provider-specific extras. Empty strings clear a field.
//! - `testConnection()` / `listModels()` are async: they spawn on the shared
//!   Tokio handle registered from `main` and return immediately. Results are
//!   pushed onto a per-instance `mpsc` and **must** be drained on the Qt thread
//!   via `drainEvents()` (a QML `Timer` calls it), which updates the `testing` /
//!   `lastTestStatus` / `modelsLoading` / `models` / `modelsError` properties
//!   and emits `testFinished` / `modelsLoaded`. Async tasks never touch the
//!   Qt thread.
//! - `testConnection()` tests the **stored** configuration (call `saveConfig`
//!   first — the QML page does exactly that inside its Test handler).
//!
//! Persistence goes through `airi_store::ProviderRepo` (id, kind, config JSON,
//! enabled, updated_at). Saving a config for a *new* provider enables it (the
//! user just supplied credentials — implicit intent to use); existing records
//! keep their current `enabled` flag.

use cxx_qt_lib::{QString, QStringList};
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use airi_llm::{build_client, ProviderConfig, ProviderRegistry};
use airi_store::{ProviderKind as StoreProviderKind, StoredProvider};
use serde::Serialize;

use crate::bridges::qstring_to_string;

/// Hard cap for the connection test / model-list round trip. `build_client`
/// HTTP clients have no total timeout by design (streams are unbounded), so a
/// dead endpoint would otherwise hang the `testing` state forever.
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);

/// cxx-qt bridge definitions for the providers bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
        include!("cxx-qt-lib/qstringlist.h");
        /// QStringList from cxx-qt-lib (deref-convertible to QList<QString>).
        type QStringList = cxx_qt_lib::QStringList;
    }

    extern "RustQt" {
        /// Provider settings view-model. Persists via `airi_store::ProviderRepo`
        /// and talks to providers via `airi_llm`. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, testing)]
        #[qproperty(QString, last_test_id, cxx_name = "lastTestId")]
        #[qproperty(QString, last_test_status, cxx_name = "lastTestStatus")]
        #[qproperty(bool, models_loading, cxx_name = "modelsLoading")]
        #[qproperty(QStringList, models)]
        #[qproperty(QString, models_error, cxx_name = "modelsError")]
        type ProviderSettingsController = super::ProviderSettingsControllerRust;
    }

    extern "RustQt" {
        /// Emitted when a connection test finishes. `ok == false` carries a
        /// diagnostic `message` (provider error detail, not localized); QML
        /// renders the localized status label itself.
        #[qsignal]
        #[cxx_name = "testFinished"]
        fn test_finished(
            self: Pin<&mut ProviderSettingsController>,
            id: QString,
            ok: bool,
            message: QString,
        );

        /// Emitted when an async model-list fetch finishes (empty list on
        /// error; see `modelsError`).
        #[qsignal]
        #[cxx_name = "modelsLoaded"]
        fn models_loaded(
            self: Pin<&mut ProviderSettingsController>,
            id: QString,
            models: QStringList,
        );
    }

    extern "RustQt" {
        /// One-shot JSON array describing every registry row (45 providers)
        /// merged with stored persistence state. See module docs for why JSON
        /// at this boundary.
        #[qinvokable]
        #[cxx_name = "listProviders"]
        fn list_providers(self: &ProviderSettingsController) -> QString;

        /// Flat JSON object with the stored credential fields for `id`, `{}`
        /// when unconfigured. See module docs.
        #[qinvokable]
        #[cxx_name = "loadConfig"]
        fn load_config(self: &ProviderSettingsController, id: QString) -> QString;

        /// Upsert credentials for `id` from a flat JSON object (shape matches
        /// `loadConfig`). Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveConfig"]
        fn save_config(
            self: &ProviderSettingsController,
            id: QString,
            config_json: QString,
        ) -> bool;

        /// Flip the persisted enabled flag for `id` (creating a minimal record
        /// when none exists yet). Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveEnabled"]
        fn save_enabled(self: &ProviderSettingsController, id: QString, enabled: bool) -> bool;

        /// Delete the stored configuration (credentials + enabled flag) for
        /// `id`. Returns `true` on success (including "nothing to delete").
        #[qinvokable]
        #[cxx_name = "deleteConfig"]
        fn delete_config(self: &ProviderSettingsController, id: QString) -> bool;

        /// Spawn an async connection test against the *stored* configuration
        /// (`GET {base}/models` for this provider kind). Sets `testing` to
        /// `true`; `false` again plus `lastTestStatus` is applied by
        /// `drainEvents()` on the Qt thread.
        #[qinvokable]
        #[cxx_name = "testConnection"]
        fn test_connection(self: Pin<&mut ProviderSettingsController>, id: QString);

        /// Spawn an async model-list fetch for `id` against the *stored*
        /// configuration. Sets `modelsLoading` to `true`; `false` again plus
        /// `models` / `modelsError` is applied by `drainEvents()`.
        #[qinvokable]
        #[cxx_name = "listModels"]
        fn list_models(self: Pin<&mut ProviderSettingsController>, id: QString);

        /// Drain pending async results. Call from a QML `Timer` (50–100 ms);
        /// updates properties and emits `testFinished` / `modelsLoaded`. All
        /// property writes and signal emission happen here — never on the
        /// Tokio thread.
        #[qinvokable]
        #[cxx_name = "drainEvents"]
        fn drain_events(self: Pin<&mut ProviderSettingsController>);
    }
}

/// Async results pushed from the Tokio thread onto the Qt thread.
enum ProviderEvent {
    /// `testConnection` outcome: `message` is a `"N models"` summary on
    /// success or the diagnostic error on failure.
    TestFinished {
        /// Provider id the test ran for.
        id: String,
        /// Whether the provider answered successfully.
        ok: bool,
        /// Diagnostic detail (not localized).
        message: String,
    },
    /// `listModels` outcome: `models` is empty on error.
    ModelsLoaded {
        /// Provider id the fetch ran for.
        id: String,
        /// Model ids offered by the provider.
        models: Vec<String>,
        /// Diagnostic detail (not localized); `None` on success.
        error: Option<String>,
    },
}

/// Rust storage for `ProviderSettingsController`.
pub struct ProviderSettingsControllerRust {
    testing: bool,
    last_test_id: QString,
    last_test_status: QString,
    models_loading: bool,
    models: QStringList,
    models_error: QString,
    events_tx: mpsc::Sender<ProviderEvent>,
    events_rx: Mutex<mpsc::Receiver<ProviderEvent>>,
}

impl Default for ProviderSettingsControllerRust {
    fn default() -> Self {
        let (events_tx, events_rx) = mpsc::channel();
        Self {
            testing: false,
            last_test_id: QString::default(),
            last_test_status: QString::default(),
            models_loading: false,
            models: QStringList::default(),
            models_error: QString::default(),
            events_tx,
            events_rx: Mutex::new(events_rx),
        }
    }
}

/// Per-field record serialized into the `listProviders()` JSON array.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FieldRecord {
    key: &'static str,
    label: &'static str,
    secret: bool,
    required: bool,
    placeholder: Option<&'static str>,
}

/// Per-provider record serialized into the `listProviders()` JSON array.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderRecord {
    id: &'static str,
    label: &'static str,
    /// Kebab-case wire kind (`open-ai-compatible`, `anthropic`, `google-gemini`,
    /// `aws-bedrock`, `local-server`). QML maps it to a localized badge label.
    kind: &'static str,
    chat_capable: bool,
    enabled: bool,
    configured: bool,
    default_base_url: Option<&'static str>,
    compat_note: Option<&'static str>,
    fields: Vec<FieldRecord>,
}

/// Kebab-case kind tag matching `airi-store`'s persistence format and the QML badge keys.
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

/// Build the registry + persistence-merged provider records (the payload of
/// `listProviders()`). Free function so unit tests can exercise the merge
/// without a QObject instance.
fn provider_records() -> Vec<ProviderRecord> {
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
            ProviderRecord {
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
                    .map(|f| FieldRecord {
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
        eprintln!("[airi-qt] providers: saveConfig: config JSON for '{id}' is not an object");
        return false;
    };
    let Some(obj) = value.as_object() else {
        eprintln!("[airi-qt] providers: saveConfig: config JSON for '{id}' is not an object");
        return false;
    };
    let Some(def) = ProviderRegistry::new().get(id) else {
        eprintln!("[airi-qt] providers: saveConfig: unknown provider id '{id}'");
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
            eprintln!("[airi-qt] providers: saveConfig: {err:#}");
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
                eprintln!("[airi-qt] providers: saveEnabled: unknown provider id '{id}'");
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
            eprintln!("[airi-qt] providers: saveEnabled: {err:#}");
            false
        }
    }
}

/// Delete the stored record for `id` from `repo`.
fn delete_config_from_repo(repo: &airi_store::ProviderRepo, id: &str) -> bool {
    match repo.delete(id) {
        Ok(_) => true,
        Err(err) => {
            eprintln!("[airi-qt] providers: deleteConfig: {err:#}");
            false
        }
    }
}

/// Fetch the model list for `def` using `config` with a hard timeout. Shared by
/// the connection test (count only) and `listModels` (ids).
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

impl qobject::ProviderSettingsController {
    /// One-shot JSON array of provider records (see module docs).
    pub fn list_providers(&self) -> QString {
        QString::from(
            serde_json::to_string(&provider_records()).unwrap_or_else(|_| "[]".to_owned()),
        )
    }

    /// Flat JSON object with the stored credential fields; `{}` when unset.
    pub fn load_config(&self, id: QString) -> QString {
        let id = qstring_to_string(&id);
        let Some(repo) = crate::bridges::provider_repo() else {
            return QString::from("{}");
        };
        QString::from(load_config_from_repo(repo, &id))
    }

    /// Upsert credentials from a flat JSON object; see module docs.
    pub fn save_config(&self, id: QString, config_json: QString) -> bool {
        let id = qstring_to_string(&id);
        let Some(repo) = crate::bridges::provider_repo() else {
            eprintln!("[airi-qt] providers: saveConfig: store unavailable");
            return false;
        };
        save_config_to_repo(repo, &id, &qstring_to_string(&config_json))
    }

    /// Flip the persisted enabled flag for `id`.
    pub fn save_enabled(&self, id: QString, enabled: bool) -> bool {
        let id = qstring_to_string(&id);
        let Some(repo) = crate::bridges::provider_repo() else {
            eprintln!("[airi-qt] providers: saveEnabled: store unavailable");
            return false;
        };
        save_enabled_to_repo(repo, &id, enabled)
    }

    /// Remove the stored configuration for `id`.
    pub fn delete_config(&self, id: QString) -> bool {
        let id = qstring_to_string(&id);
        let Some(repo) = crate::bridges::provider_repo() else {
            eprintln!("[airi-qt] providers: deleteConfig: store unavailable");
            return false;
        };
        delete_config_from_repo(repo, &id)
    }

    /// Spawn the async connection test; see module docs.
    pub fn test_connection(mut self: Pin<&mut Self>, id: QString) {
        let id_s = qstring_to_string(&id);
        let Some(def) = ProviderRegistry::new().get(&id_s) else {
            self.as_mut().set_last_test_id(id.clone());
            self.as_mut()
                .set_last_test_status(QString::from("unsupported"));
            qobject::ProviderSettingsController::test_finished(
                self.as_mut(),
                id,
                false,
                QString::from("unknown provider"),
            );
            return;
        };
        if !def.compat.chat {
            let note = def.compat.note.unwrap_or("provider is not wired yet");
            self.as_mut().set_last_test_id(id.clone());
            self.as_mut()
                .set_last_test_status(QString::from("unsupported"));
            qobject::ProviderSettingsController::test_finished(
                self.as_mut(),
                id,
                false,
                QString::from(note),
            );
            return;
        }

        let config = stored_config(&id_s).unwrap_or_default();
        self.as_mut().set_testing(true);
        let tx = self.events_tx.clone();
        let Some(handle) = crate::bridges::runtime_handle() else {
            self.as_mut().set_testing(false);
            self.as_mut().set_last_test_id(id.clone());
            self.as_mut().set_last_test_status(QString::from("failed"));
            qobject::ProviderSettingsController::test_finished(
                self.as_mut(),
                id,
                false,
                QString::from("tokio runtime unavailable"),
            );
            return;
        };
        let def = *def;
        handle.spawn(async move {
            let event = match fetch_models(def, config).await {
                Ok(models) => ProviderEvent::TestFinished {
                    id: def.id.to_owned(),
                    ok: true,
                    message: format!("{} models", models.len()),
                },
                Err(err) => ProviderEvent::TestFinished {
                    id: def.id.to_owned(),
                    ok: false,
                    message: err,
                },
            };
            let _ = tx.send(event);
        });
    }

    /// Spawn the async model-list fetch; see module docs.
    pub fn list_models(mut self: Pin<&mut Self>, id: QString) {
        let id_s = qstring_to_string(&id);
        let Some(def) = ProviderRegistry::new().get(&id_s) else {
            self.as_mut().set_models_loading(false);
            self.as_mut()
                .set_models_error(QString::from("unknown provider"));
            qobject::ProviderSettingsController::models_loaded(
                self.as_mut(),
                id,
                QStringList::default(),
            );
            return;
        };
        if !def.compat.chat {
            self.as_mut().set_models_loading(false);
            self.as_mut()
                .set_models_error(QString::from("provider is not wired yet"));
            qobject::ProviderSettingsController::models_loaded(
                self.as_mut(),
                id,
                QStringList::default(),
            );
            return;
        }

        let config = stored_config(&id_s).unwrap_or_default();
        self.as_mut().set_models_loading(true);
        self.as_mut().set_models_error(QString::default());
        let tx = self.events_tx.clone();
        let Some(handle) = crate::bridges::runtime_handle() else {
            self.as_mut().set_models_loading(false);
            self.as_mut()
                .set_models_error(QString::from("tokio runtime unavailable"));
            qobject::ProviderSettingsController::models_loaded(
                self.as_mut(),
                id,
                QStringList::default(),
            );
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

    /// Drain pending async results onto the Qt thread; see module docs.
    pub fn drain_events(mut self: Pin<&mut Self>) {
        let mut pending = Vec::new();
        if let Ok(rx) = self.events_rx.lock() {
            while let Ok(event) = rx.try_recv() {
                pending.push(event);
            }
        }
        for event in pending {
            match event {
                ProviderEvent::TestFinished { id, ok, message } => {
                    self.as_mut().set_testing(false);
                    self.as_mut().set_last_test_id(QString::from(id.clone()));
                    self.as_mut().set_last_test_status(QString::from(if ok {
                        "success"
                    } else {
                        "failed"
                    }));
                    qobject::ProviderSettingsController::test_finished(
                        self.as_mut(),
                        QString::from(id),
                        ok,
                        QString::from(message),
                    );
                }
                ProviderEvent::ModelsLoaded { id, models, error } => {
                    self.as_mut().set_models_loading(false);
                    self.as_mut()
                        .set_models_error(QString::from(error.unwrap_or_else(|| "".to_owned())));
                    let list: QStringList = models.iter().map(QString::from).collect();
                    self.as_mut().set_models(list.clone());
                    qobject::ProviderSettingsController::models_loaded(
                        self.as_mut(),
                        QString::from(id),
                        list,
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! Registry/persistence-boundary tests for the providers bridge. The Qt
    //! pump itself is exercised by `--smoke`; here we cover the pure logic:
    //! the `listProviders()` payload merge, the flat save/load round trip, and
    //! the HTTP probe used by `testConnection` / `listModels` — against a
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
