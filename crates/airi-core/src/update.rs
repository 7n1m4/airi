// SPDX-License-Identifier: GPL-3.0-or-later
//! Check-only updater against GitHub Releases.
//!
//! Stage gate (P8): **check + notify only** — there is deliberately no
//! download or self-replacement path here. `self_update` was evaluated and
//! rejected for this lane: it is built around replacing an installed binary
//! in place, which is explicitly out of scope until post-parity. Instead the
//! `airi-slint` bridge calls [`check_for_update`] on demand and surfaces the
//! result in the About window.
//!
//! The network path is a single unauthenticated `GET` to the GitHub REST API
//! (`/repos/anlmalabs/airi/releases/latest`). No credentials are sent and no
//! user data leaves the machine beyond the request itself. Tests point
//! [`fetch_latest_release`] at a local mock server; the real endpoint is
//! never exercised in tests.

use serde::Deserialize;
use std::time::Duration;

/// GitHub REST endpoint for the latest published release.
///
/// Note: `/releases/latest` excludes drafts and prereleases.
pub const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/anlmalabs/airi/releases/latest";

/// Timeout applied to the release check request.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/// User-Agent header (GitHub rejects requests without one).
const USER_AGENT: &str = concat!("airi-slint/", env!("CARGO_PKG_VERSION"), " update-check");

/// Subset of the GitHub release payload this app cares about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseInfo {
    /// Semver version of the release, normalized (no leading `v`).
    pub version: String,
    /// `html_url` of the release page (human-facing download/release notes).
    pub url: String,
    /// Release body (markdown notes), when present.
    pub notes: Option<String>,
    /// Whether GitHub marked the release as a prerelease.
    pub prerelease: bool,
}

/// Outcome of comparing the running build against the latest release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStatus {
    /// Installed version is equal to or newer than the latest release.
    UpToDate,
    /// A newer release exists.
    UpdateAvailable {
        /// Semver version of the newer release (no leading `v`).
        version: String,
        /// Release page URL to open for release notes / downloads.
        url: String,
    },
}

/// Errors produced by the update check.
#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    /// The HTTP request failed (network, TLS, timeout, non-2xx status).
    #[error("release check request failed: {0}")]
    Http(#[from] reqwest::Error),
    /// The response body did not match the expected release payload.
    #[error("unexpected release payload: {0}")]
    Payload(String),
    /// A version string (ours or the release tag's) could not be parsed.
    #[error("invalid version {0:?}: {1}")]
    Version(String, #[source] semver::Error),
}

/// Raw wire shape of the GitHub release object (only the fields used here).
#[derive(Deserialize)]
struct ReleasePayload {
    tag_name: String,
    html_url: Option<String>,
    body: Option<String>,
    #[serde(default)]
    prerelease: bool,
}

/// Normalize a git tag into a bare semver string (strips a leading `v`/`V`
/// and surrounding whitespace).
fn normalize_version(tag: &str) -> &str {
    tag.trim().trim_start_matches(['v', 'V'])
}

/// Parse a GitHub release JSON body into [`ReleaseInfo`].
///
/// Extracted from the network path so tests can exercise payload parsing
/// without a server at all.
///
/// # Errors
///
/// Returns [`UpdateError::Payload`] when the body is not the expected JSON
/// shape or carries an unparsable/empty `tag_name`.
pub fn parse_release_body(body: &str) -> Result<ReleaseInfo, UpdateError> {
    let payload: ReleasePayload =
        serde_json::from_str(body).map_err(|e| UpdateError::Payload(e.to_string()))?;
    let version = normalize_version(&payload.tag_name).to_string();
    if version.is_empty() {
        return Err(UpdateError::Payload("empty tag_name".to_string()));
    }
    // Validate eagerly so callers never compare garbage.
    semver::Version::parse(&version)
        .map_err(|e| UpdateError::Version(payload.tag_name.clone(), e))?;
    Ok(ReleaseInfo {
        version,
        url: payload
            .html_url
            .unwrap_or_else(|| "https://github.com/anlmalabs/airi/releases".to_string()),
        notes: payload.body,
        prerelease: payload.prerelease,
    })
}

/// Compare `current_version` against `release`.
///
/// # Errors
///
/// Returns [`UpdateError::Version`] when `current_version` is not a valid
/// semver string. (Release versions were validated in [`parse_release_body`].)
pub fn evaluate_update(
    current_version: &str,
    release: &ReleaseInfo,
) -> Result<UpdateStatus, UpdateError> {
    let current = semver::Version::parse(normalize_version(current_version))
        .map_err(|e| UpdateError::Version(current_version.to_string(), e))?;
    let latest = semver::Version::parse(&release.version)
        .map_err(|e| UpdateError::Version(release.version.clone(), e))?;
    if latest > current {
        Ok(UpdateStatus::UpdateAvailable {
            version: release.version.clone(),
            url: release.url.clone(),
        })
    } else {
        Ok(UpdateStatus::UpToDate)
    }
}

/// Fetch and parse the release at `url`.
///
/// `url` is a parameter (rather than the constant) so tests can point the
/// client at a local mock server.
///
/// # Errors
///
/// Returns [`UpdateError::Http`] on transport errors, non-2xx statuses, or
/// bodies above a sane size cap, and [`UpdateError::Payload`] when the body
/// is not a release payload.
pub async fn fetch_latest_release(url: &str) -> Result<ReleaseInfo, UpdateError> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()?;
    let body = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    parse_release_body(&body)
}

/// Fetch the latest published release of `anlmalabs/airi` and compare it
/// against `current_version`.
///
/// # Errors
///
/// Propagates [`UpdateError`] from the fetch or the comparison.
pub async fn check_for_update(current_version: &str) -> Result<UpdateStatus, UpdateError> {
    let release = fetch_latest_release(LATEST_RELEASE_URL).await?;
    evaluate_update(current_version, &release)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn release_body(tag: &str, url: &str) -> String {
        json!({
            "tag_name": tag,
            "html_url": url,
            "body": "notes",
            "prerelease": false,
        })
        .to_string()
    }

    #[test]
    fn parse_release_strips_leading_v() {
        let info = parse_release_body(&release_body("v0.2.0", "https://example/rel")).unwrap();
        assert_eq!(info.version, "0.2.0");
        assert_eq!(info.url, "https://example/rel");
        assert_eq!(info.notes.as_deref(), Some("notes"));
        assert!(!info.prerelease);
    }

    #[test]
    fn parse_release_rejects_malformed_body() {
        assert!(matches!(
            parse_release_body("not json"),
            Err(UpdateError::Payload(_))
        ));
        assert!(matches!(
            parse_release_body(&json!({"tag_name": ""}).to_string()),
            Err(UpdateError::Payload(_))
        ));
        assert!(matches!(
            parse_release_body(&json!({"tag_name": "banana"}).to_string()),
            Err(UpdateError::Version(..))
        ));
    }

    #[test]
    fn evaluate_detects_update_available() {
        let info = parse_release_body(&release_body("v0.2.0", "https://example/rel")).unwrap();
        let status = evaluate_update("0.1.0", &info).unwrap();
        assert_eq!(
            status,
            UpdateStatus::UpdateAvailable {
                version: "0.2.0".to_string(),
                url: "https://example/rel".to_string(),
            }
        );
    }

    #[test]
    fn evaluate_reports_up_to_date_for_same_or_newer_local() {
        let info = parse_release_body(&release_body("v0.2.0", "https://example/rel")).unwrap();
        assert_eq!(
            evaluate_update("0.2.0", &info).unwrap(),
            UpdateStatus::UpToDate
        );
        assert_eq!(
            evaluate_update("0.3.0", &info).unwrap(),
            UpdateStatus::UpToDate
        );
        assert_eq!(
            evaluate_update("v0.2.0", &info).unwrap(),
            UpdateStatus::UpToDate
        );
    }

    #[test]
    fn evaluate_rejects_bad_current_version() {
        let info = parse_release_body(&release_body("v0.2.0", "https://example/rel")).unwrap();
        assert!(matches!(
            evaluate_update("not-a-version", &info),
            Err(UpdateError::Version(..))
        ));
    }

    #[tokio::test]
    async fn fetch_latest_release_against_mock_server() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/repos/anlmalabs/airi/releases/latest")
            .match_header(
                "accept",
                Matcher::Exact("application/vnd.github+json".to_string()),
            )
            .match_header(
                "user-agent",
                Matcher::Regex("airi-slint/.*update-check".to_string()),
            )
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(release_body("v0.2.0", "https://example/release/0.2.0"))
            .create_async()
            .await;

        let url = format!("{}/repos/anlmalabs/airi/releases/latest", server.url());
        let info = fetch_latest_release(&url).await.unwrap();
        assert_eq!(info.version, "0.2.0");
        assert_eq!(info.url, "https://example/release/0.2.0");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn fetch_latest_release_surfaces_http_errors() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/repos/anlmalabs/airi/releases/latest")
            .with_status(403)
            .with_body("rate limited")
            .create_async()
            .await;

        let url = format!("{}/repos/anlmalabs/airi/releases/latest", server.url());
        assert!(matches!(
            fetch_latest_release(&url).await,
            Err(UpdateError::Http(_))
        ));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn end_to_end_status_against_mock_server() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/latest")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(release_body("v9.9.9", "https://example/release/9.9.9"))
            .create_async()
            .await;

        let release = fetch_latest_release(&format!("{}/latest", server.url()))
            .await
            .unwrap();
        let status = evaluate_update("0.1.0", &release).unwrap();
        assert!(matches!(
            status,
            UpdateStatus::UpdateAvailable { ref version, .. } if version == "9.9.9"
        ));
    }
}
