// SPDX-License-Identifier: GPL-3.0-or-later

//! AWS Polly native speech endpoint (SigV4-signed).
//!
//! Port of the Vue registry entry (`aws-polly-tts`):
//! `POST https://polly.{region}.amazonaws.com/v1/speech`
//! body `{Engine, OutputFormat: 'mp3', Text, VoiceId}`, signed with `service=polly`.
//!
//! Credential mapping mirrors the Vue app: `config.api_key` is the **Access Key ID**;
//! the Secret Access Key and region come from `extra.secret_access_key` / `extra.region`.
//!
//! The signature is computed locally with HMAC-SHA256 (no AWS SDK). There is no AWS
//! SigV4 test vector inside this repo, so the implementation is structured to follow
//! the documented algorithm exactly (canonical request → string to sign → derived
//! signing key) and is covered by unit tests for determinism and shape; it has NOT
//! been verified against a live AWS Polly endpoint from this environment.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::client_common::{error_body, one_shot};
use crate::error::SpeechError;
use crate::synth::SpeechSynthesizer;
use crate::types::{AudioStream, SynthesizeOptions};
use crate::wav::encode_hex;

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    // HMAC accepts keys of any length; unwrap is safe by construction.
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts arbitrary key lengths");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    encode_hex(&Sha256::digest(data))
}

fn amz_now() -> (String, String) {
    // SigV4 wants x-amz-date = %Y%m%dT%H%M%SZ and date scope = %Y%m%d.
    // No chrono dependency: compute civil-from-days manually (Howard Hinnant's algorithm).
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let hour = secs_of_day / 3600;
    let min = (secs_of_day % 3600) / 60;
    let sec = secs_of_day % 60;

    // Civil from days algorithm (valid for 1970..9999).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    let amz_date = format!(
        "{year:04}{mo:02}{da:02}T{hour:02}{min:02}{sec:02}Z",
        mo = m,
        da = d,
    );
    let date_stamp = format!("{year:04}{mo:02}{da:02}", mo = m, da = d);
    (amz_date, date_stamp)
}

fn uri_encode_path(path: &str) -> String {
    // RFC 3986: keep unreserved + '/'; encode everything else.
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(char::from(byte));
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Client for AWS Polly's `v1/speech` endpoint.
pub struct PollyClient {
    pub(crate) id: String,
    pub(crate) region: String,
    pub(crate) access_key_id: String,
    pub(crate) secret_access_key: String,
    pub(crate) model: String,
    pub(crate) voice: String,
}

struct SignedRequest {
    url: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl PollyClient {
    fn sign(&self, body: &str, amz_date: &str, date_stamp: &str) -> SignedRequest {
        let host = format!("polly.{}.amazonaws.com", self.region);
        let path = "/v1/speech";
        let canonical_uri = uri_encode_path(path);
        let canonical_query = "";
        let payload_hash = sha256_hex(body.as_bytes());
        let content_type = "application/json";

        // SigV4 requires signed headers sorted by lowercase name: content-type, host,
        // x-amz-content-sha256, x-amz-date.
        let canonical_headers = format!(
            "content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
        );
        let signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date";

        let canonical_request = format!(
            "POST\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
        );

        let scope = format!("{date_stamp}/{}/polly/aws4_request", self.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            sha256_hex(canonical_request.as_bytes())
        );

        let k_date = hmac_sha256(
            format!("AWS4{}", self.secret_access_key).as_bytes(),
            date_stamp.as_bytes(),
        );
        let k_region = hmac_sha256(&k_date, self.region.as_bytes());
        let k_service = hmac_sha256(&k_region, b"polly");
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        let signature = encode_hex(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));

        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
            self.access_key_id
        );

        SignedRequest {
            url: format!("https://{host}{path}"),
            headers: vec![
                ("Content-Type".into(), content_type.to_string()),
                ("X-Amz-Date".into(), amz_date.to_string()),
                ("X-Amz-Content-Sha256".into(), payload_hash),
                ("Authorization".into(), authorization),
            ],
            body: body.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl SpeechSynthesizer for PollyClient {
    fn id(&self) -> &str {
        &self.id
    }

    async fn synthesize(
        &self,
        text: &str,
        voice: &str,
        options: &SynthesizeOptions,
    ) -> Result<AudioStream, SpeechError> {
        if text.trim().is_empty() {
            return Err(SpeechError::InvalidConfig(
                "cannot synthesize empty text".into(),
            ));
        }
        if self.access_key_id.trim().is_empty() {
            return Err(SpeechError::InvalidConfig(
                "aws-polly-tts requires config.api_key (the AWS Access Key ID)".into(),
            ));
        }
        let engine = options
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.model.clone());
        let voice_id = if voice.trim().is_empty() {
            if self.voice.trim().is_empty() {
                "Ivy"
            } else {
                self.voice.trim()
            }
        } else {
            voice.trim()
        };

        let body = serde_json::json!({
            "Engine": engine,
            "OutputFormat": "mp3",
            "Text": text,
            "VoiceId": voice_id,
        })
        .to_string();

        let (amz_date, date_stamp) = amz_now();
        let signed = self.sign(&body, &amz_date, &date_stamp);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let mut request = client.post(&signed.url).body(signed.body);
        for (name, value) in &signed.headers {
            request = request.header(name.as_str(), value.as_str());
        }

        let resp = request.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = error_body(resp).await;
            return Err(SpeechError::Provider(format!(
                "{} answered {} for v1/speech: {body}",
                self.id,
                status.as_u16()
            )));
        }
        let bytes = resp.bytes().await.map_err(SpeechError::from)?;
        Ok(one_shot(bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amz_now_uses_sigv4_formats() {
        let (amz, date) = amz_now();
        assert_eq!(amz.len(), 16);
        assert_eq!(date.len(), 8);
        assert!(amz.ends_with('Z'));
        assert!(amz.starts_with(&date));
    }

    #[test]
    fn sign_is_deterministic_and_well_formed() {
        let client = PollyClient {
            id: "aws-polly-tts".into(),
            region: "eu-central-1".into(),
            access_key_id: "AKIAEXAMPLE".into(),
            secret_access_key: "secret".into(),
            model: "neural".into(),
            voice: "Ivy".into(),
        };
        let a = client.sign("{}", "20260101T000000Z", "20260101");
        let b = client.sign("{}", "20260101T000000Z", "20260101");
        assert_eq!(a.url, "https://polly.eu-central-1.amazonaws.com/v1/speech");
        let auth = |s: &SignedRequest| {
            s.headers
                .iter()
                .find(|(n, _)| n == "Authorization")
                .map(|(_, v)| v.clone())
                .expect("authorization header present")
        };
        assert_eq!(auth(&a), auth(&b));
        let authorization = auth(&a);
        assert!(authorization.starts_with(
            "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260101/eu-central-1/polly/aws4_request"
        ));
        assert!(authorization
            .contains("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"));
        assert!(authorization.contains("Signature="));
        let signature = authorization.rsplit("Signature=").next().unwrap();
        assert_eq!(signature.len(), 64);
        assert!(signature.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn sign_depends_on_secret() {
        let mut client = PollyClient {
            id: "aws-polly-tts".into(),
            region: "us-east-1".into(),
            access_key_id: "AKIA".into(),
            secret_access_key: "secret-a".into(),
            model: "neural".into(),
            voice: "Ivy".into(),
        };
        let a = client.sign("{}", "20260101T000000Z", "20260101");
        client.secret_access_key = "secret-b".into();
        let b = client.sign("{}", "20260101T000000Z", "20260101");
        let auth = |s: &SignedRequest| {
            s.headers
                .iter()
                .find(|(n, _)| n == "Authorization")
                .map(|(_, v)| v.clone())
        };
        assert_ne!(auth(&a), auth(&b));
    }

    #[test]
    fn path_encoding_keeps_slashes() {
        assert_eq!(uri_encode_path("/v1/speech"), "/v1/speech");
        assert_eq!(uri_encode_path("/v1/weird path"), "/v1/weird%20path");
    }
}
