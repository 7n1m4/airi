// SPDX-License-Identifier: GPL-3.0-or-later

//! Tiny embeddings client for the OpenAI-compatible `/embeddings` endpoint.
//!
//! Built on the `airi-llm` provider-config path ([`ProviderConfig`]) rather than
//! a new provider registry. Only what memory retrieval needs: POST
//! `{base_url}/embeddings` with `{"model": model, "input": texts}` and parse
//! `data[].embedding` back into `Vec<Vec<f32>>`.
//!
//! Error taxonomy mirrors `airi-llm`: [`EmbeddingError::Transport`] (reqwest /
//! I/O), [`EmbeddingError::Empty`] (provider returned no embedding rows), and
//! [`EmbeddingError::Decode`] (response shape mismatch). An
//! [`EmbeddingError::InvalidConfig`] is added for the missing-base_url case,
//! matching `airi-llm`'s config error.
//!
//! Smoke-style env override: [`EmbeddingClient::from_provider_config`] falls
//! back to the `AIRI_QT_BASE_URL` / `AIRI_QT_API_KEY` env vars (the same ones
//! the `--smoke` override uses) when the config does not set them, so a unit
//! e2e against a mock server is possible in tests. Default tests stay fully
//! mocked; nothing here phones home.

use airi_llm::ProviderConfig;
use async_trait::async_trait;
use thiserror::Error;

/// Default embedding model, used when the caller passes an empty `model`.
pub const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";

/// Errors returned by [`EmbeddingClient::embed`].
#[derive(Debug, Error)]
pub enum EmbeddingError {
    /// I/O or transport failure talking to the provider.
    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),
    /// The provider returned no embedding data.
    #[error("empty embeddings response")]
    Empty,
    /// The response body did not match the expected shape.
    #[error("decode error: {0}")]
    Decode(String),
    /// Invalid client configuration (e.g. missing base URL).
    #[error("invalid config: {0}")]
    InvalidConfig(String),
}

/// Injectable embeddings backend.
///
/// [`EmbeddingClient`] implements this against the network; tests inject a
/// mock instead of standing up HTTP. Keeps the retrieval pipeline testable
/// without touching any live provider.
#[async_trait]
pub trait Embedder: Send + Sync {
    /// Embed a batch of texts. Implementations MUST return one vector per
    /// input text, in order.
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError>;
}

/// Minimal OpenAI-compatible embeddings client.
#[derive(Clone)]
pub struct EmbeddingClient {
    base_url: String,
    api_key: Option<String>,
    model: String,
    http: reqwest::Client,
}

impl EmbeddingClient {
    /// Build a client from a stored/smoke-override provider config.
    ///
    /// `model`: the embedding model to request; an empty string selects
    /// [`DEFAULT_EMBEDDING_MODEL`]. `base_url` comes from `config.base_url`,
    /// falling back to the `AIRI_QT_BASE_URL` env var; `api_key` comes from
    /// `config.api_key`, falling back to `AIRI_QT_API_KEY`. Errors with
    /// [`EmbeddingError::InvalidConfig`] when no base URL is available.
    pub fn from_provider_config(
        config: &ProviderConfig,
        model: &str,
    ) -> Result<Self, EmbeddingError> {
        let base_url = config
            .base_url
            .clone()
            .or_else(|| std::env::var("AIRI_QT_BASE_URL").ok())
            .filter(|u| !u.trim().is_empty())
            .map(|u| u.trim_end_matches('/').to_owned())
            .ok_or_else(|| {
                EmbeddingError::InvalidConfig(
                    "base_url is required (config or AIRI_QT_BASE_URL)".to_owned(),
                )
            })?;
        let api_key = config
            .api_key
            .clone()
            .or_else(|| std::env::var("AIRI_QT_API_KEY").ok())
            .filter(|k| !k.trim().is_empty());
        Ok(Self::new(base_url, api_key, model))
    }

    /// Build a client directly from explicit parts.
    pub fn new(base_url: String, api_key: Option<String>, model: &str) -> Self {
        let model = if model.trim().is_empty() {
            DEFAULT_EMBEDDING_MODEL.to_owned()
        } else {
            model.trim().to_owned()
        };
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client builder must not fail with static config");
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key,
            model,
            http,
        }
    }

    /// The model this client requests.
    pub fn model(&self) -> &str {
        &self.model
    }
}

#[async_trait]
impl Embedder for EmbeddingClient {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut req = self.http.post(format!("{}/embeddings", self.base_url));
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        let resp = req
            .json(&serde_json::json!({ "model": self.model, "input": texts }))
            .send()
            .await
            .map_err(EmbeddingError::Transport)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(EmbeddingError::Decode(format!(
                "embeddings endpoint returned HTTP {status}: {body}"
            )));
        }
        let body: serde_json::Value = resp.json().await.map_err(EmbeddingError::Transport)?;
        parse_embeddings_response(&body, texts.len())
    }
}

fn parse_embeddings_response(
    body: &serde_json::Value,
    expected: usize,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    let data = body
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| EmbeddingError::Decode("response missing `data` array".into()))?;
    if data.is_empty() {
        return Err(EmbeddingError::Empty);
    }
    // OpenAI-compatible APIs return one row per input with an `index` field;
    // sort by it when present so order matches the request even if the
    // provider reorders rows.
    let mut rows: Vec<(u64, Vec<f32>)> = Vec::with_capacity(data.len());
    for (position, row) in data.iter().enumerate() {
        let index = row
            .get("index")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(position as u64);
        let embedding = row
            .get("embedding")
            .and_then(|e| e.as_array())
            .ok_or_else(|| {
                EmbeddingError::Decode(format!("row {position} missing `embedding` array"))
            })?;
        let mut vector = Vec::with_capacity(embedding.len());
        for value in embedding {
            vector.push(value.as_f64().map(|f| f as f32).ok_or_else(|| {
                EmbeddingError::Decode(format!("row {position} has a non-numeric embedding value"))
            })?);
        }
        if vector.is_empty() {
            return Err(EmbeddingError::Decode(format!(
                "row {position} embedding is empty"
            )));
        }
        rows.push((index, vector));
    }
    rows.sort_by_key(|(index, _)| *index);
    if rows.len() != expected {
        return Err(EmbeddingError::Decode(format!(
            "expected {expected} embedding rows, got {}",
            rows.len()
        )));
    }
    let dim = rows[0].1.len();
    if rows.iter().any(|(_, v)| v.len() != dim) {
        return Err(EmbeddingError::Decode(
            "embedding rows have inconsistent dimensions".into(),
        ));
    }
    Ok(rows.into_iter().map(|(_, v)| v).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sorts_by_index() {
        let body = serde_json::json!({
            "data": [
                { "index": 1, "embedding": [0.5, 0.25] },
                { "index": 0, "embedding": [1.0, 0.0] },
            ]
        });
        let vectors = parse_embeddings_response(&body, 2).unwrap();
        assert_eq!(vectors, vec![vec![1.0, 0.0], vec![0.5, 0.25]]);
    }

    #[test]
    fn parse_rejects_missing_data() {
        let body = serde_json::json!({ "unexpected": true });
        assert!(matches!(
            parse_embeddings_response(&body, 1),
            Err(EmbeddingError::Decode(_))
        ));
    }

    #[test]
    fn parse_rejects_empty_data() {
        let body = serde_json::json!({ "data": [] });
        assert!(matches!(
            parse_embeddings_response(&body, 1),
            Err(EmbeddingError::Empty)
        ));
    }

    #[test]
    fn parse_rejects_row_count_mismatch() {
        let body = serde_json::json!({
            "data": [{ "index": 0, "embedding": [1.0, 0.0] }]
        });
        assert!(matches!(
            parse_embeddings_response(&body, 2),
            Err(EmbeddingError::Decode(_))
        ));
    }

    #[test]
    fn parse_rejects_dimension_mismatch() {
        let body = serde_json::json!({
            "data": [
                { "index": 0, "embedding": [1.0] },
                { "index": 1, "embedding": [1.0, 2.0] },
            ]
        });
        assert!(matches!(
            parse_embeddings_response(&body, 2),
            Err(EmbeddingError::Decode(_))
        ));
    }

    #[test]
    fn default_model_selected_when_empty() {
        let client = EmbeddingClient::new("http://127.0.0.1:1".into(), None, "");
        assert_eq!(client.model(), DEFAULT_EMBEDDING_MODEL);
    }

    #[tokio::test]
    async fn embed_posts_expected_wire_shape() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/embeddings")
            .match_header("authorization", "Bearer sk-test")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "model": "text-embedding-3-small",
                "input": ["hello"],
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"data":[{"index":0,"embedding":[0.125,0.25]}]}"#)
            .create_async()
            .await;
        let config = ProviderConfig {
            api_key: Some("sk-test".into()),
            base_url: Some(format!("{}/v1", server.url())),
            model: None,
            extra_json: serde_json::Map::new(),
        };
        let client = EmbeddingClient::from_provider_config(&config, "").unwrap();
        let vectors = client.embed(&["hello".to_string()]).await.unwrap();
        assert_eq!(vectors, vec![vec![0.125, 0.25]]);
        mock.assert_async().await;
    }
}
