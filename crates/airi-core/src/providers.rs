// SPDX-License-Identifier: GPL-3.0-or-later
//! Provider resolution from the environment and the providers table.
//!
//! Shared by the chat pipeline (through the slint bridge today, the daemon
//! later) so every surface picks the same provider when it must answer
//! "which provider would a send go through".

use airi_llm::ProviderConfig;
use airi_store::StoredProvider;

/// Environment variable naming the provider id to use.
pub const ENV_PROVIDER: &str = "AIRI_SLINT_PROVIDER";
/// Environment variable for the API key of the env-selected provider.
pub const ENV_API_KEY: &str = "AIRI_SLINT_API_KEY";
/// Environment variable for the base URL of the env-selected provider.
pub const ENV_BASE_URL: &str = "AIRI_SLINT_BASE_URL";
/// Environment variable for the model of the env-selected provider.
pub const ENV_MODEL: &str = "AIRI_SLINT_MODEL";

/// The provider a send would go through.
#[derive(Debug, Clone)]
pub struct ProviderResolution {
    /// Provider id (e.g. `openai`).
    pub id: String,
    /// Provider config (api key, base URL, model, extra options).
    pub config: ProviderConfig,
    /// Model, mirroring `config.model` for label display.
    pub model: String,
}

impl ProviderResolution {
    /// `id` when no model is configured, else `id · model`.
    pub fn label(&self) -> String {
        if self.model.trim().is_empty() {
            self.id.clone()
        } else {
            format!("{} · {}", self.id, self.model.trim())
        }
    }
}

/// Resolve the provider: env override first, then the first enabled row in
/// the providers table. `rows` are the caller's own listing (fetched from
/// `ProviderRepo` or injected in tests); the env is passed as an
/// `std::env::var`-shaped function so tests never touch the process env.
///
/// Returns `None` when nothing is configured — callers decide what "nothing
/// configured" means for them (the slint bridge falls back to a default
/// `openai` id; the memory wiring shows "not configured").
pub fn resolve_provider(
    env: impl Fn(&str) -> Option<String>,
    rows: &[StoredProvider],
) -> Option<ProviderResolution> {
    if let Some(id) = env(ENV_PROVIDER) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            let config = ProviderConfig {
                api_key: env(ENV_API_KEY),
                base_url: env(ENV_BASE_URL),
                model: env(ENV_MODEL),
                extra_json: Default::default(),
            };
            let model = config.model.clone().unwrap_or_default();
            return Some(ProviderResolution { id, config, model });
        }
    }
    let provider = rows.iter().find(|p| p.enabled)?;
    let config: ProviderConfig = serde_json::from_value(provider.config.clone()).unwrap_or_default();
    let model = config.model.clone().unwrap_or_default();
    Some(ProviderResolution {
        id: provider.id.clone(),
        config,
        model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use airi_store::StoredProvider;

    fn row(id: &str, enabled: bool, config: serde_json::Value) -> StoredProvider {
        StoredProvider {
            id: id.to_string(),
            kind: airi_store::ProviderKind::OpenAiCompatible,
            config,
            enabled,
            updated_at: 0,
        }
    }

    fn empty_env(_: &str) -> Option<String> {
        None
    }

    fn env_fn(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| v.to_string())
    }

    #[test]
    fn env_override_wins_over_stored_rows() {
        let env = env_fn(&[
            (ENV_PROVIDER, "anthropic"),
            (ENV_API_KEY, "sk-test"),
            (ENV_MODEL, "claude-x"),
        ]);
        let rows = [row("openai", true, serde_json::json!({ "model": "stored-model" }))];
        let r = resolve_provider(env, &rows).unwrap();
        assert_eq!(r.id, "anthropic");
        assert_eq!(r.config.api_key.as_deref(), Some("sk-test"));
        assert_eq!(r.model, "claude-x");
    }

    #[test]
    fn blank_env_id_falls_through_to_stored() {
        let env = env_fn(&[(ENV_PROVIDER, "   ")]);
        let rows = [row("openai", true, serde_json::json!({ "model": "stored-model" }))];
        let r = resolve_provider(env, &rows).unwrap();
        assert_eq!(r.id, "openai");
        assert_eq!(r.model, "stored-model");
    }

    #[test]
    fn first_enabled_row_wins_and_disabled_rows_are_skipped() {
        let rows = [
            row("disabled-one", false, serde_json::json!({ "model": "x" })),
            row("enabled-one", true, serde_json::json!({ "model": "y" })),
            row("enabled-two", true, serde_json::json!({ "model": "z" })),
        ];
        let r = resolve_provider(empty_env, &rows).unwrap();
        assert_eq!(r.id, "enabled-one");
        assert_eq!(r.model, "y");
    }

    #[test]
    fn malformed_stored_config_defaults_to_empty_config() {
        let rows = [row("openai", true, serde_json::json!("not an object"))];
        let r = resolve_provider(empty_env, &rows).unwrap();
        assert_eq!(r.id, "openai");
        assert!(r.config.api_key.is_none());
        assert_eq!(r.model, "");
    }

    #[test]
    fn nothing_configured_resolves_to_none() {
        assert!(resolve_provider(empty_env, &[]).is_none());
    }

    #[test]
    fn label_shows_model_when_present_else_id() {
        let rows = [row("openai", true, serde_json::json!({ "model": "gpt-4o" }))];
        assert_eq!(resolve_provider(empty_env, &rows).unwrap().label(), "openai · gpt-4o");
        let rows = [row("openai", true, serde_json::json!({}))];
        assert_eq!(resolve_provider(empty_env, &rows).unwrap().label(), "openai");
    }
}
