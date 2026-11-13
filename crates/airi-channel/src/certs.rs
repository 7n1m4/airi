// SPDX-License-Identifier: GPL-3.0-or-later

//! Local CA + server certificate management for the gateway (mkcert-style,
//! self-contained).
//!
//! The Electron gateway mints a private CA once (`websocket-ca-cert.pem` /
//! `websocket-ca-key.pem`), then issues short-lived server certificates whose
//! SANs cover `localhost`, loopback IPs, the configured hostname, and the
//! host's LAN IPs. External clients (the unified Rust native app, VS Code,
//! Python agents) must trust that CA to connect over `wss://`.
//!
//! This module mirrors that flow in one directory (by default
//! `<data>/airi-slint/server-channel/certs`):
//!
//! | File                  | Purpose                                   |
//! |-----------------------|-------------------------------------------|
//! | `websocket-ca-cert.pem` | CA certificate (distribute to clients)  |
//! | `websocket-ca-key.pem`  | CA private key (never leaves the host)  |
//! | `websocket-cert.pem`    | Server certificate (SAN-covered)        |
//! | `websocket-key.pem`     | Server private key                      |
//! | `cert-domains.json`     | Sidecar: exact SAN list the cert was    |
//! |                       | minted for (staleness detection)          |
//!
//! Private key files are written `0600`. Renewal policy: the server
//! certificate is re-minted on every call whose SAN sidecar differs from the
//! requested domain set; the CA itself is reused indefinitely (mkcert's
//! model). Expiry is calendar-based (365 days for the leaf, 10 years for the
//! CA); re-minting on SAN drift also refreshes the leaf's validity window.
//!
//! ## Why a sidecar instead of parsing the cert
//!
//! x509 SAN parsing would need an extra parser dependency for one string
//! comparison. The sidecar is written by the same code that signs the
//! certificate, so it is honest about the SAN set without trusting
//! third-party X.509 tooling. If the cert files are deleted but the sidecar
//! remains, the mismatch regenerates everything except the CA (or nothing,
//! if the CA is also gone).

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa,
    KeyPair, KeyUsagePurpose,
};

/// CA certificate PEM filename.
pub const CA_CERT_FILE: &str = "websocket-ca-cert.pem";
/// CA private key PEM filename.
pub const CA_KEY_FILE: &str = "websocket-ca-key.pem";
/// Server certificate PEM filename.
pub const CERT_FILE: &str = "websocket-cert.pem";
/// Server private key PEM filename.
pub const KEY_FILE: &str = "websocket-key.pem";
/// Sidecar recording the SAN list the server cert was minted for.
pub const DOMAINS_FILE: &str = "cert-domains.json";

/// How long a freshly minted leaf lives, in days.
const LEAF_VALIDITY_DAYS: i64 = 365;
/// How long a freshly minted CA lives, in days.
const CA_VALIDITY_DAYS: i64 = 3650;

/// Errors from certificate management.
#[derive(Debug)]
pub enum CertsError {
    /// Filesystem failure reading/writing the store.
    Io(io::Error),
    /// rcgen failed to construct or sign a certificate.
    Mint(rcgen::Error),
    /// The sidecar file existed but held unparseable content. Treated as a
    /// stale sidecar (re-mint), not an error — kept for future diagnostics.
    #[allow(dead_code)]
    BadSidecar(String),
}

impl fmt::Display for CertsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "cert store I/O: {e}"),
            Self::Mint(e) => write!(f, "certificate minting: {e}"),
            Self::BadSidecar(s) => write!(f, "cert-domains.json unreadable: {s}"),
        }
    }
}

impl std::error::Error for CertsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::Mint(e) => Some(e),
            Self::BadSidecar(_) => None,
        }
    }
}

impl From<io::Error> for CertsError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<rcgen::Error> for CertsError {
    fn from(e: rcgen::Error) -> Self {
        Self::Mint(e)
    }
}

/// The certificate set the gateway needs at listen time.
#[derive(Debug)]
pub struct CertBundle {
    /// Server certificate PEM (single cert, chain to CA is implicit).
    pub cert_pem: String,
    /// Server private key PEM (PKCS#8).
    pub key_pem: String,
    /// CA certificate PEM — ship this to clients for `wss://` trust.
    pub ca_cert_pem: String,
    /// SAN list the server certificate was minted for.
    pub domains: Vec<String>,
    /// True when the server certificate was minted during this call.
    pub generated: bool,
    /// True when the CA itself was minted during this call.
    pub ca_generated: bool,
}

/// The default SAN list: `localhost`, loopback IPs (v4 + v6), plus the
/// host's LAN IPs when enumerable (best-effort — failures just omit them).
/// `extra` covers the configured gateway hostname and any caller-supplied
/// names; all entries are deduplicated and sorted.
pub fn san_domains(extra: &[String]) -> Vec<String> {
    let mut out: Vec<String> = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "::1".to_string(),
    ];
    if let Ok(ips) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in ips {
            if !ip.is_loopback() {
                out.push(ip.to_string());
            }
        }
    }
    out.extend(extra.iter().cloned());
    out.sort();
    out.dedup();
    out
}

/// True when all four cert files exist (does not validate contents).
pub fn certs_exist(dir: &Path) -> bool {
    [CA_CERT_FILE, CA_KEY_FILE, CERT_FILE, KEY_FILE]
        .iter()
        .all(|f| dir.join(f).is_file())
}

/// Load the CA certificate PEM, if present.
pub fn ca_cert_pem(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(CA_CERT_FILE)).ok()
}

fn sidecar_domains(dir: &Path) -> Option<Vec<String>> {
    let raw = fs::read_to_string(dir.join(DOMAINS_FILE)).ok()?;
    serde_json::from_str::<Vec<String>>(&raw).ok()
}

fn write_private(path: &Path, contents: &str) -> io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(contents.as_bytes())
}

/// Get a usable certificate set for `domains`, minting what is missing or
/// stale. The CA is reused when both CA files exist and parse; otherwise a
/// new CA is minted. The leaf is re-minted whenever the SAN sidecar differs
/// from `domains` (or the cert files are absent).
pub fn get_or_create_certs(dir: &Path, domains: &[String]) -> Result<CertBundle, CertsError> {
    fs::create_dir_all(dir)?;

    let mut domains = domains.to_vec();
    domains.sort();
    domains.dedup();

    let ca_cert_path = dir.join(CA_CERT_FILE);
    let ca_key_path = dir.join(CA_KEY_FILE);
    let cert_path = dir.join(CERT_FILE);
    let key_path = dir.join(KEY_FILE);

    let mut ca_generated = false;

    // --- CA: load or mint ---------------------------------------------------
    let ca = match (
        fs::read_to_string(&ca_cert_path),
        fs::read_to_string(&ca_key_path),
    ) {
        (Ok(ca_pem), Ok(ca_key_pem)) => match KeyPair::from_pem(&ca_key_pem) {
            Ok(key) => Some((ca_pem, key)),
            Err(_) => {
                tracing::warn!("airi-channel: CA key unreadable, reminting CA");
                None
            }
        },
        _ => None,
    };

    let (ca_cert_pem, ca_key) = match ca {
        Some(pair) => pair,
        None => {
            let mut params = ca_params()?;
            params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
            params.key_usages = vec![
                KeyUsagePurpose::KeyCertSign,
                KeyUsagePurpose::CrlSign,
                KeyUsagePurpose::DigitalSignature,
            ];
            set_validity_days(&mut params, CA_VALIDITY_DAYS);

            let key = KeyPair::generate()?;
            let cert = params.self_signed(&key)?;

            write_private(&ca_key_path, &key.serialize_pem())?;
            fs::write(&ca_cert_path, cert.pem())?;
            ca_generated = true;
            (cert.pem(), key)
        }
    };

    // --- Leaf: reuse when SANs match -----------------------------------------
    let stale_domains = sidecar_domains(dir).map(|d| d != domains).unwrap_or(true);
    let cert_files_ok = cert_path.is_file() && key_path.is_file();

    if !stale_domains && cert_files_ok && !ca_generated {
        return Ok(CertBundle {
            cert_pem: fs::read_to_string(&cert_path)?,
            key_pem: fs::read_to_string(&key_path)?,
            ca_cert_pem,
            domains,
            generated: false,
            ca_generated,
        });
    }

    // --- Leaf: mint ----------------------------------------------------------
    let mut leaf = CertificateParams::new(domains.clone())?;
    leaf.is_ca = IsCa::NoCa;
    leaf.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    leaf.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "airi-gateway");
    dn.push(DnType::OrganizationName, "AIRI");
    leaf.distinguished_name = dn;
    set_validity_days(&mut leaf, LEAF_VALIDITY_DAYS);

    let issuer = rcgen::Issuer::new(ca_params()?, ca_key);
    let leaf_key = KeyPair::generate()?;
    let leaf_cert = leaf.signed_by(&leaf_key, &issuer)?;

    write_private(&key_path, &leaf_key.serialize_pem())?;
    fs::write(&cert_path, leaf_cert.pem())?;
    fs::write(
        dir.join(DOMAINS_FILE),
        serde_json::to_string_pretty(&domains).expect("domain list serializes"),
    )?;

    Ok(CertBundle {
        cert_pem: leaf_cert.pem(),
        key_pem: leaf_key.serialize_pem(),
        ca_cert_pem,
        domains,
        generated: true,
        ca_generated,
    })
}

/// Base params for the CA. Only the distinguished name is load-bearing for
/// leaf issuance (issuer DN); validity and key usages live in the minted
/// CA cert itself. Rebuilt identically at issuance time so reloaded CAs
/// produce leaves with the correct issuer field.
fn ca_params() -> Result<CertificateParams, rcgen::Error> {
    let mut params = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "AIRI Local Gateway CA");
    dn.push(DnType::OrganizationName, "AIRI");
    params.distinguished_name = dn;
    Ok(params)
}

fn set_validity_days(params: &mut CertificateParams, days: i64) {
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::minutes(5);
    params.not_after = now + time::Duration::days(days);
}

/// Parse a PEM certificate chain into rustls certificate DER blocks.
/// Accepts the leaf alone (the common case here) as well as a full chain.
pub fn rustls_certs(pem: &str) -> Vec<rustls::pki_types::CertificateDer<'static>> {
    rustls_pemfile::certs(&mut pem.as_bytes())
        .filter_map(Result::ok)
        .collect()
}

/// Parse a PEM private key (PKCS#8 or PKCS#1) into rustls's key type.
pub fn rustls_key(pem: &str) -> Option<rustls::pki_types::PrivateKeyDer<'static>> {
    rustls_pemfile::private_key(&mut pem.as_bytes())
        .ok()
        .flatten()
}

/// Build a rustls `ServerConfig` for the gateway listener.
pub fn server_config(cert_pem: &str, key_pem: &str) -> Result<rustls::ServerConfig, rustls::Error> {
    let certs = rustls_certs(cert_pem);
    let key = rustls_key(key_pem).ok_or(rustls::Error::InvalidCertificate(
        rustls::CertificateError::BadEncoding,
    ))?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    // The WS protocol does not use ALPN; leave it empty rather than
    // advertise h2 which we never speak.
    config.alpn_protocols = Vec::new();
    Ok(config)
}

/// Sanity check used by tests and the daemon's startup path: can we build
/// a TLS configuration from these bytes?
pub fn server_config_available(cert_pem: &str, key_pem: &str) -> bool {
    server_config(cert_pem, key_pem).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn san_domains_include_loopback_and_dedup() {
        let domains = san_domains(&[
            "example.internal".to_string(),
            "localhost".to_string(),
            "192.168.1.20".to_string(),
        ]);
        assert!(domains.contains(&"localhost".to_string()));
        assert!(domains.contains(&"127.0.0.1".to_string()));
        assert!(domains.contains(&"::1".to_string()));
        assert!(domains.contains(&"example.internal".to_string()));
        assert!(domains.contains(&"192.168.1.20".to_string()));
        let mut sorted = domains.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(domains, sorted);
    }

    #[test]
    fn mint_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let domains = vec!["localhost".to_string(), "127.0.0.1".to_string()];

        let first = get_or_create_certs(dir, &domains).unwrap();
        assert!(first.generated);
        assert!(first.ca_generated);
        assert!(certs_exist(dir));
        assert!(first.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(first.key_pem.contains("PRIVATE KEY"));
        assert!(first.ca_cert_pem.contains("BEGIN CERTIFICATE"));

        // Second call, same domains: everything reused.
        let second = get_or_create_certs(dir, &domains).unwrap();
        assert!(!second.generated);
        assert!(!second.ca_generated);
        assert_eq!(first.ca_cert_pem, second.ca_cert_pem);
        assert_eq!(first.cert_pem, second.cert_pem);
    }

    #[test]
    fn san_change_remints_leaf_but_reuses_ca() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        let first =
            get_or_create_certs(dir, &["localhost".to_string(), "127.0.0.1".to_string()]).unwrap();
        let second = get_or_create_certs(
            dir,
            &[
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "::1".to_string(),
            ],
        )
        .unwrap();
        assert!(second.generated);
        assert_eq!(first.ca_cert_pem, second.ca_cert_pem, "CA must be reused");
        assert_ne!(first.cert_pem, second.cert_pem, "leaf must be re-minted");
        assert_eq!(second.domains.len(), 3);
    }

    #[test]
    fn server_config_builds_from_generated_certs() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = get_or_create_certs(tmp.path(), &san_domains(&[])).unwrap();
        assert!(server_config_available(&bundle.cert_pem, &bundle.key_pem));
    }

    #[test]
    fn private_key_files_are_0600() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        get_or_create_certs(dir, &["localhost".to_string()]).unwrap();
        for file in [CA_KEY_FILE, KEY_FILE] {
            let mode = fs::metadata(dir.join(file)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{file} must be owner-only");
        }
    }
}
