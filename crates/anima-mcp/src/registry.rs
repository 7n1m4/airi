// SPDX-License-Identifier: GPL-3.0-or-later

//! MCP registry discovery against the official MCP Registry.
//!
//! Defaults to `https://registry.modelcontextprotocol.io/v0.1/servers`,
//! the unauthenticated official registry endpoint. This is documented
//! in-repo (`docs/research-open-apis-and-mcp-servers.md`) as the
//! recommended directory listing API, and the AIRI settings UI
//! (`packages/stage-pages/.../mcp.vue`) queries the same URL with
//! `version=latest`. The response envelope used by the UI is
//! `{ "servers": [ { "server": { … }, … } ] }`, i.e. each listed entry
//! wraps the actual server record in a `server` key (bare server objects
//! are also tolerated). **The exact registry response schema is taken
//! from those in-repo consumers, not from a spec copy shipped in this
//! repository, so the query/response mapping below is best-effort and
//! marked unverified** — see the phase note.
//!
//! [`list_registry_servers`] performs a single blocking `GET` with
//! `version=latest`, `limit=<limit>` and (when `query` is non-empty)
//! `search=<query>`. It is never called against the network by the test
//! suite — `base_url` is always a parameter and tests use a mock server.

use serde_json::Value;

use crate::error::McpError;

/// Base URL of the official MCP Registry's server-list endpoint.
///
/// Verified only against in-repo consumers (see the module docs); not
/// verified against a live registry from this crate's test suite.
pub const DEFAULT_REGISTRY_BASE_URL: &str = "https://registry.modelcontextprotocol.io/v0.1/servers";

const REGISTRY_CONTENT_TYPE: &str = "application/json";

/// One server entry as advertised by an MCP registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryEntry {
    /// Canonical registry name, e.g. `io.github.acme/widgets-mcp`.
    pub name: String,
    /// Human-readable description; empty when the registry omits it.
    pub description: String,
    /// Best-effort URL for the server: `websiteUrl` when present, else the
    /// repository URL, else the first advertised remote's URL, else empty.
    pub url: String,
    /// Advertised version string, when the registry lists one.
    pub version: Option<String>,
}

/// Lists servers from an MCP registry.
///
/// * `base_url` — the registry's server-list endpoint. Pass
///   [`DEFAULT_REGISTRY_BASE_URL`] for the official registry.
/// * `query` — optional substring search passed as `search=…`; empty or
///   whitespace-only values omit the parameter.
/// * `limit` — page size passed as `limit=…`; `0` is sent verbatim (the
///   server decides how to handle it).
///
/// Entries whose `server` record lacks a string `name` are skipped. A
/// response whose `servers` member is missing or not an array is a
/// [`McpError::Protocol`]; an empty (or entirely absent) `servers` array
/// yields an empty `Vec`.
///
/// Authentication is out of scope: the official endpoint is
/// unauthenticated. Registries requiring credentials can be reached by
/// pointing `base_url` at an authenticating proxy; this client does not
/// send an `Authorization` header.
pub fn list_registry_servers(
    base_url: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<RegistryEntry>, McpError> {
    let mut url = reqwest::Url::parse(base_url)
        .map_err(|e| McpError::Transport(format!("invalid registry base URL `{base_url}`: {e}")))?;

    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("version", "latest");
        pairs.append_pair("limit", &limit.to_string());
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            pairs.append_pair("search", trimmed);
        }
    }

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(crate::types::DEFAULT_REQUEST_TIMEOUT)
        .timeout(crate::types::DEFAULT_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| McpError::Transport(format!("failed to build HTTP client: {e}")))?;

    let response = client
        .get(url)
        .header("Accept", REGISTRY_CONTENT_TYPE)
        .send()
        .map_err(|e| {
            if e.is_timeout() {
                McpError::Timeout {
                    method: "registry/list".to_string(),
                    timeout: crate::types::DEFAULT_REQUEST_TIMEOUT,
                }
            } else {
                McpError::Transport(format!("registry request to `{base_url}` failed: {e}"))
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(McpError::HttpStatus {
            status: status.as_u16(),
            body,
        });
    }

    let body = response
        .text()
        .map_err(|e| McpError::Transport(format!("failed to read registry response body: {e}")))?;

    let parsed: Value = serde_json::from_str(body.trim())
        .map_err(|e| McpError::Protocol(format!("registry response is not valid JSON: {e}")))?;

    let servers = parsed
        .get("servers")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            McpError::Protocol("registry response is missing a `servers` array".to_string())
        })?;

    Ok(servers.iter().filter_map(parse_entry).collect())
}

/// Parses one `servers[]` item. Tolerates both the `{ "server": { … } }`
/// wrapper used by the official registry (and by the AIRI settings UI) and
/// a bare server object.
fn parse_entry(item: &Value) -> Option<RegistryEntry> {
    let record = item.get("server").unwrap_or(item);

    let name = record.get("name").and_then(Value::as_str)?.to_string();
    let description = record
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let url = record
        .get("websiteUrl")
        .or_else(|| record.get("website_url"))
        .and_then(Value::as_str)
        .or_else(|| {
            record
                .get("repository")
                .and_then(|repo| repo.get("url"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            record
                .get("remotes")
                .and_then(Value::as_array)
                .and_then(|remotes| remotes.first())
                .and_then(|remote| remote.get("url"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_string();

    let version = record
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string);

    Some(RegistryEntry {
        name,
        description,
        url,
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_entry_reads_wrapped_server_records() {
        let item = json!({
            "server": {
                "name": "io.github.acme/widgets-mcp",
                "description": "Widgets for everything",
                "websiteUrl": "https://widgets.example.com",
                "version": "1.2.3",
                "repository": {"url": "https://github.com/acme/widgets-mcp"},
                "remotes": [{"type": "streamable-http", "url": "https://mcp.widgets.example.com"}]
            },
            "_meta": {"published": true}
        });
        let entry = parse_entry(&item).unwrap();
        assert_eq!(entry.name, "io.github.acme/widgets-mcp");
        assert_eq!(entry.description, "Widgets for everything");
        assert_eq!(entry.url, "https://widgets.example.com");
        assert_eq!(entry.version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn parse_entry_falls_back_to_repository_then_remotes() {
        let repo_only = json!({
            "server": {
                "name": "a",
                "repository": {"url": "https://github.com/a/b"},
                "remotes": [{"type": "streamable-http", "url": "https://mcp.a.example.com"}]
            }
        });
        assert_eq!(
            parse_entry(&repo_only).unwrap().url,
            "https://github.com/a/b"
        );

        let remotes_only = json!({
            "server": {
                "name": "b",
                "remotes": [{"type": "streamable-http", "url": "https://mcp.b.example.com"}]
            }
        });
        assert_eq!(
            parse_entry(&remotes_only).unwrap().url,
            "https://mcp.b.example.com"
        );

        let bare = json!({"name": "c"});
        let entry = parse_entry(&bare).unwrap();
        assert_eq!(entry.url, "");
        assert_eq!(entry.description, "");
        assert_eq!(entry.version, None);
    }

    #[test]
    fn parse_entry_skips_records_without_name() {
        assert!(parse_entry(&json!({"server": {"description": "no name"}})).is_none());
        assert!(parse_entry(&json!(42)).is_none());
    }
}
