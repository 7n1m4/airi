// SPDX-License-Identifier: GPL-3.0-or-later

//! Data vault (P9 wave ④): export/import of local user data as a plain,
//! human-readable ZIP archive, plus the chat-history "session media scrub".
//!
//! The Qt app stores user data as:
//!
//! - **chats** — `sessions` / `messages` (SQLite),
//! - **memory** — `summaries` / `journal_entries` / `memory_embeddings` (SQLite),
//! - **providers** — `providers` (SQLite; **contains API keys**, see manifest),
//! - **characters** — CCv2/CCv3 card files under `<profile>/cards` (not SQLite),
//! - **backgrounds** — not implemented in this build (the Vue background gallery
//!   has no Qt counterpart yet), reported as an empty domain.
//!
//! The archive format is a *stored* (uncompressed) ZIP with human-readable
//! JSON documents, matching the Vue app's "selective, human-readable ZIP
//! archives" promise. No Compression is used because the consumers here are
//! in-process: the format stays byte-simple and debuggable by hand.
//!
//! Restore semantics ([`commit_archive`]) are deliberately narrow: sessions,
//! messages, summaries and journal entries are inserted with
//! `INSERT OR IGNORE` (existing rows win). Cards and provider credentials are
//! **not** applied by commit in this build; the report lists them under
//! `not_applied` so callers can surface that honestly.
//!
//! Scrubbing ([`scrub_session_media`]) scans `messages` for inline
//! `data:image/*;base64,…` payloads (and the raw tool-payload variant the Vue
//! app targets — both look like base64 image data URLs to this scanner),
//! writes each decoded image to `<backgrounds>/scrubbed/<fnv-hash>.<ext>`,
//! and replaces the payload in the message with a compact
//! `![image](airi-asset://<fnv-hash>.<ext>)` pointer. A pre-scrub backup
//! archive is written to `<backgrounds>/scrub-backups/` when requested
//! (default `true` for UI-driven flows) and is **not** skipped by any UI that
//! asks for a backup; `create_backup = false` exists for the explicit
//! "scrub without backup" path.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};

use airi_store::{
    MessageRepo, ScrubRunRepo, StoredJournalEntry, StoredScrubRun, StoredSession, StoredSummary,
};

// ============================================================================
// Stored ZIP writer/reader (uncompressed; PKZIP APPNOTE 4.5 subset)
// ============================================================================

fn crc32(data: &[u8]) -> u32 {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, slot) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    (c >> 1) ^ 0xEDB8_8320
                } else {
                    c >> 1
                };
            }
            *slot = c;
        }
        t
    });
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc = table[((crc ^ u32::from(b)) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

/// Write a stored (uncompressed) ZIP archive containing `files`.
///
/// `files` is `(name, contents)` in insertion order. Names must use `/`
/// separators and must not be absolute or contain `..` (rejected).
pub fn zip_stored(files: &[(&str, &[u8])]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        if name.is_empty() || name.starts_with('/') || name.split('/').any(|seg| seg == "..") {
            bail!("zip entry name rejected: {name:?}");
        }
        let offset = u32::try_from(out.len()).context("archive exceeds 4 GiB")?;
        let crc = crc32(data);
        let size = u32::try_from(data.len()).context("zip entry exceeds 4 GiB")?;
        let name_bytes = name.as_bytes();
        let name_len = u16::try_from(name_bytes.len()).context("zip entry name too long")?;

        let (dos_time, dos_date) = dos_time_date();
        out.write_all(b"PK\x03\x04")?;
        out.write_all(&20u16.to_le_bytes())?; // version needed
        out.write_all(&0u16.to_le_bytes())?; // flags
        out.write_all(&0u16.to_le_bytes())?; // stored
        out.write_all(&dos_time.to_le_bytes())?;
        out.write_all(&dos_date.to_le_bytes())?;
        out.write_all(&crc.to_le_bytes())?;
        out.write_all(&size.to_le_bytes())?; // compressed size
        out.write_all(&size.to_le_bytes())?; // uncompressed size
        out.write_all(&name_len.to_le_bytes())?;
        out.write_all(&0u16.to_le_bytes())?; // extra len
        out.write_all(name_bytes)?;
        out.write_all(data)?;

        central.write_all(b"PK\x01\x02")?;
        central.write_all(&20u16.to_le_bytes())?; // version made by
        central.write_all(&20u16.to_le_bytes())?; // version needed
        central.write_all(&0u16.to_le_bytes())?; // flags
        central.write_all(&0u16.to_le_bytes())?; // method: stored
        central.write_all(&dos_time.to_le_bytes())?;
        central.write_all(&dos_date.to_le_bytes())?;
        central.write_all(&crc.to_le_bytes())?;
        central.write_all(&size.to_le_bytes())?;
        central.write_all(&size.to_le_bytes())?;
        central.write_all(&name_len.to_le_bytes())?;
        central.write_all(&0u16.to_le_bytes())?; // extra len
        central.write_all(&0u16.to_le_bytes())?; // comment len
        central.write_all(&0u16.to_le_bytes())?; // disk number
        central.write_all(&0u16.to_le_bytes())?; // internal attrs
        central.write_all(&0u32.to_le_bytes())?; // external attrs
        central.write_all(&offset.to_le_bytes())?;
        central.write_all(name_bytes)?;
    }

    let central_offset = u32::try_from(out.len()).context("archive exceeds 4 GiB")?;
    out.write_all(&central)?;
    let central_len = u32::try_from(central.len()).context("central directory too large")?;
    let entry_count = u16::try_from(files.len()).context("too many zip entries")?;

    out.write_all(b"PK\x05\x06")?;
    out.write_all(&0u16.to_le_bytes())?; // disk number
    out.write_all(&0u16.to_le_bytes())?; // central dir start disk
    out.write_all(&entry_count.to_le_bytes())?;
    out.write_all(&entry_count.to_le_bytes())?;
    out.write_all(&central_len.to_le_bytes())?;
    out.write_all(&central_offset.to_le_bytes())?;
    out.write_all(&0u16.to_le_bytes())?; // comment len
    Ok(out)
}

fn dos_time_date() -> (u16, u16) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Convert UTC epoch seconds to a DOS date/time pair.
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    let dos_time = ((second / 2) | (minute << 5) | (hour << 11)) as u16;
    let dos_date = ((d as u64) | ((m as u64) << 5) | ((y as u64 - 1980) << 9)) as u16;
    (dos_time, dos_date)
}

/// Howard Hinnant's civil_from_days algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub(crate) struct ZipEntry {
    pub(crate) name: String,
    pub(crate) data: Vec<u8>,
}

/// Read a stored ZIP archive produced by [`zip_stored`] (and compatible
/// stored archives). Rejects anything compressed or with `..` names.
pub(crate) fn zip_read(bytes: &[u8]) -> Result<Vec<ZipEntry>> {
    // Locate the end-of-central-directory record by scanning from the tail.
    let eocd_pos = find_eocd(bytes).context("not a ZIP archive (no end-of-central-directory)")?;
    let eocd = &bytes[eocd_pos..];
    if eocd.len() < 22 {
        bail!("truncated end-of-central-directory");
    }
    let count = u16::from_le_bytes(eocd[10..12].try_into().unwrap()) as usize;
    let cd_size = u32::from_le_bytes(eocd[12..16].try_into().unwrap()) as usize;
    let cd_offset = u32::from_le_bytes(eocd[16..20].try_into().unwrap()) as usize;
    // `cd_offset`/`cd_size` come straight from the untrusted EOCD, so use checked
    // arithmetic: a hand-edited archive can make the sum wrap and slip past the
    // `bytes.len()` check below.
    let cd_end = cd_offset
        .checked_add(cd_size)
        .context("central-directory offset overflow")?;
    if cd_end > bytes.len() {
        bail!("central directory extends past end of archive");
    }

    let mut entries = Vec::new();
    let mut pos = cd_offset;
    for _ in 0..count {
        // Every slice below is derived from attacker-controlled offsets/lengths;
        // each is bounds-checked before use so a truncated or hand-edited archive
        // returns an error instead of panicking across the cxx-qt boundary.
        let entry_end = pos
            .checked_add(46)
            .context("central-directory entry offset overflow")?;
        if entry_end > bytes.len() {
            bail!("truncated central-directory entry at offset {pos}");
        }
        if bytes[pos..pos + 4] != b"PK\x01\x02"[..] {
            bail!("bad central-directory signature at offset {pos}");
        }
        let method = u16::from_le_bytes(bytes[pos + 10..pos + 12].try_into().unwrap());
        let crc = u32::from_le_bytes(bytes[pos + 16..pos + 20].try_into().unwrap());
        let size = u32::from_le_bytes(bytes[pos + 24..pos + 28].try_into().unwrap()) as usize;
        let name_len = u16::from_le_bytes(bytes[pos + 28..pos + 30].try_into().unwrap()) as usize;
        let extra_len = u16::from_le_bytes(bytes[pos + 30..pos + 32].try_into().unwrap()) as usize;
        let comment_len =
            u16::from_le_bytes(bytes[pos + 32..pos + 34].try_into().unwrap()) as usize;
        let local_offset =
            u32::from_le_bytes(bytes[pos + 42..pos + 46].try_into().unwrap()) as usize;
        // `pos + 46` is already known in range from `entry_end`, so only the
        // name length can push the slice out of bounds.
        let name_end = entry_end
            .checked_add(name_len)
            .context("central-directory entry name length overflow")?;
        if name_end > bytes.len() {
            bail!("truncated central-directory entry name at offset {pos}");
        }
        let name = std::str::from_utf8(&bytes[pos + 46..name_end])
            .context("zip entry name is not UTF-8")?
            .to_string();

        if method != 0 {
            bail!(
                "unsupported compression method {method} for entry {name:?} (stored archives only)"
            );
        }
        if name.split('/').any(|seg| seg == "..") {
            bail!("zip entry name rejected: {name:?}");
        }

        // Read the local header to find the data range.
        let local_end = local_offset
            .checked_add(30)
            .context("local-file-header offset overflow")?;
        if local_end > bytes.len() {
            bail!("truncated local file header for entry {name:?} at offset {local_offset}");
        }
        if bytes[local_offset..local_offset + 4] != b"PK\x03\x04"[..] {
            bail!("bad local-file-header signature for entry {name:?}");
        }
        let local_name_len = u16::from_le_bytes(
            bytes[local_offset + 26..local_offset + 28]
                .try_into()
                .unwrap(),
        ) as usize;
        let local_extra_len = u16::from_le_bytes(
            bytes[local_offset + 28..local_offset + 30]
                .try_into()
                .unwrap(),
        ) as usize;
        let data_start = local_end
            .checked_add(local_name_len)
            .and_then(|p| p.checked_add(local_extra_len))
            .context("local-file-header data offset overflow")?;
        let data_end = data_start
            .checked_add(size)
            .context("zip entry size overflow")?;
        if data_end > bytes.len() {
            bail!("entry {name:?} extends past end of archive");
        }
        if crc32(&bytes[data_start..data_end]) != crc {
            bail!("entry {name:?} has a bad CRC-32");
        }
        entries.push(ZipEntry {
            name,
            data: bytes[data_start..data_end].to_vec(),
        });
        // `entry_end` already advanced past the fixed 46-byte record; the record
        // is only bounds-checked against `bytes.len()`, not `cd_end`, because a
        // valid archive's EOCD may under-report the directory size.
        pos = entry_end
            .checked_add(name_len)
            .and_then(|p| p.checked_add(extra_len))
            .and_then(|p| p.checked_add(comment_len))
            .context("central-directory entry length overflow")?;
    }
    Ok(entries)
}

fn find_eocd(bytes: &[u8]) -> Option<usize> {
    let min = bytes.len().saturating_sub(22 + 65_535);
    (min..=bytes.len().saturating_sub(22))
        .rev()
        .find(|&i| bytes[i..i + 4] == b"PK\x05\x06"[..])
}

// ============================================================================
// Vault API
// ============================================================================

/// Which data domains a vault operation covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VaultSelection {
    /// Character cards (card files on disk).
    pub characters: bool,
    /// Chat sessions + messages (SQLite).
    pub chats: bool,
    /// Memory: summaries, journal entries, embeddings index (SQLite).
    pub memory: bool,
    /// AI provider configuration, **including credentials** (SQLite).
    pub providers: bool,
    /// Background gallery (not implemented in this build).
    pub backgrounds: bool,
}

impl VaultSelection {
    /// Everything, or only the given ids (`characters|chats|memory|providers|backgrounds`).
    pub fn parse(ids: &[&str]) -> Self {
        Self {
            characters: ids.contains(&"characters"),
            chats: ids.contains(&"chats"),
            memory: ids.contains(&"memory"),
            providers: ids.contains(&"providers"),
            backgrounds: ids.contains(&"backgrounds"),
        }
    }

    /// All domains enabled.
    pub fn all() -> Self {
        Self::parse(&["characters", "chats", "memory", "providers", "backgrounds"])
    }
}

/// Per-domain statistics for the Data page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomainStats {
    /// Domain id (`characters` / `chats` / `memory` / `providers` / `backgrounds`).
    pub id: String,
    /// Logical entry count (sessions for chats, files for characters, …).
    pub count: u64,
    /// Estimated bytes on disk / in SQLite.
    pub bytes: u64,
}

/// Vault statistics snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultStats {
    /// Per-domain rows.
    pub domains: Vec<DomainStats>,
    /// Sum of domain bytes.
    pub total_bytes: u64,
    /// Sum of domain counts.
    pub total_count: u64,
}

fn message_and_session_bytes(db: &airi_store::Database) -> Result<(u64, u64, u64)> {
    db.with_connection(|conn| {
        let (sessions, sess_bytes): (u64, u64) = conn.query_row(
            "select count(*), coalesce(sum(length(metadata) + length(title)), 0) from sessions",
            [],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )?;
        let (messages, msg_bytes): (u64, u64) = conn.query_row(
            "select count(*), coalesce(sum(length(content) + length(metadata)), 0) from messages",
            [],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )?;
        Ok((sessions, messages, sess_bytes + msg_bytes))
    })
}

fn memory_domain_bytes(db: &airi_store::Database) -> Result<(u64, u64)> {
    db.with_connection(|conn| {
        let (a, ab): (u64, u64) = conn.query_row(
            "select count(*), coalesce(sum(length(content) + length(source_session_ids)), 0) from summaries",
            [],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )?;
        let (b, bb): (u64, u64) = conn.query_row(
            "select count(*), coalesce(sum(length(content) + coalesce(length(embedding), 0)), 0) from journal_entries",
            [],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )?;
        let (c, cb): (u64, u64) = conn.query_row(
            "select count(*), coalesce(sum(length(content) + length(vector)), 0) from memory_embeddings",
            [],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )?;
        Ok((a + b + c, ab + bb + cb))
    })
}

fn provider_domain_bytes(db: &airi_store::Database) -> Result<(u64, u64)> {
    db.with_connection(|conn| {
        let (count, bytes): (u64, u64) = conn.query_row(
            "select count(*), coalesce(sum(length(config)), 0) from providers",
            [],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )?;
        Ok((count, bytes))
    })
}

fn card_domain_bytes(card_dirs: &[PathBuf]) -> (u64, u64) {
    let mut count = 0u64;
    let mut bytes = 0u64;
    for dir in card_dirs {
        count_card_files(dir, &mut count, &mut bytes);
    }
    (count, bytes)
}

fn count_card_files(dir: &Path, count: &mut u64, bytes: &mut u64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            count_card_files(&path, count, bytes);
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if !matches!(ext.to_ascii_lowercase().as_str(), "png" | "json") {
            continue;
        }
        if let Ok(meta) = std::fs::metadata(&path) {
            *count += 1;
            *bytes += meta.len();
        }
    }
}

/// Compute per-domain stats for the vault. `card_dirs` are scanned for card
/// files (characters domain); pass an empty slice to skip that scan.
pub fn stats(db: &airi_store::Database, card_dirs: &[PathBuf]) -> Result<VaultStats> {
    let (sessions, _messages, chat_bytes) = message_and_session_bytes(db)?;
    let (memory_count, memory_bytes) = memory_domain_bytes(db)?;
    let (provider_count, provider_bytes) = provider_domain_bytes(db)?;
    let (card_count, card_bytes) = card_domain_bytes(card_dirs);

    let domains = vec![
        DomainStats {
            id: "chats".into(),
            count: sessions,
            bytes: chat_bytes,
        },
        DomainStats {
            id: "memory".into(),
            count: memory_count,
            bytes: memory_bytes,
        },
        DomainStats {
            id: "providers".into(),
            count: provider_count,
            bytes: provider_bytes,
        },
        DomainStats {
            id: "characters".into(),
            count: card_count,
            bytes: card_bytes,
        },
        DomainStats {
            id: "backgrounds".into(),
            count: 0,
            bytes: 0,
        },
    ];
    let total_bytes = domains.iter().map(|d| d.bytes).sum();
    let total_count = domains.iter().map(|d| d.count).sum();
    Ok(VaultStats {
        domains,
        total_bytes,
        total_count,
    })
}

#[derive(Serialize)]
struct Manifest {
    format: &'static str,
    version: u8,
    created_at: i64,
    includes_secrets: bool,
    domains: Vec<String>,
    counts: serde_json::Map<String, serde_json::Value>,
    notes: Vec<String>,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn card_documents(card_dirs: &[PathBuf]) -> Result<Vec<(PathBuf, serde_json::Value, Vec<u8>)>> {
    let mut out = Vec::new();
    for dir in card_dirs {
        collect_cards_in(dir, &mut out)?;
    }
    Ok(out)
}

fn collect_cards_in(
    dir: &Path,
    out: &mut Vec<(PathBuf, serde_json::Value, Vec<u8>)>,
) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_cards_in(&path, out)?;
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if !matches!(ext.as_deref(), Some("png") | Some("json")) {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let card = if ext.as_deref() == Some("png") {
            crate::cards::extract_card_from_png(&bytes)
        } else {
            crate::cards::parse_card_json(&bytes)
        };
        let Ok(card) = card else { continue };
        // Store the raw file alongside the parsed card so a restore can choose
        // either representation.
        out.push((
            path,
            serde_json::json!({"name": card.name(), "spec": card.spec.to_string()}),
            bytes,
        ));
    }
    Ok(())
}

/// Build the export archive for `selection`.
pub fn collect_archive(
    db: &airi_store::Database,
    card_dirs: &[PathBuf],
    selection: VaultSelection,
) -> Result<Vec<u8>> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut counts = serde_json::Map::new();

    if selection.chats {
        let sessions = airi_store::SessionRepo::new(db.clone()).list()?;
        let messages = airi_store::MessageRepo::new(db.clone()).list_all()?;
        counts.insert("sessions".into(), sessions.len().into());
        counts.insert("messages".into(), messages.len().into());
        files.push((
            "chats/sessions.json".into(),
            serde_json::to_vec_pretty(&sessions)?,
        ));
        files.push((
            "chats/messages.json".into(),
            serde_json::to_vec_pretty(&messages)?,
        ));
    }

    if selection.memory {
        let summaries: Vec<StoredSummary> = db.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "select id, day, content, source_session_ids, token_estimate, created_at
                 from summaries order by created_at asc",
            )?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(StoredSummary {
                        id: r.get(0)?,
                        day: r.get(1)?,
                        content: r.get(2)?,
                        source_session_ids: serde_json::from_str(&r.get::<_, String>(3)?)
                            .unwrap_or_default(),
                        token_estimate: r.get(4)?,
                        created_at: r.get(5)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok::<Vec<StoredSummary>, anyhow::Error>(rows)
        })?;
        let journals: Vec<StoredJournalEntry> = db.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "select id, kind, content, embedding, created_at, updated_at
                 from journal_entries order by created_at asc",
            )?;
            let rows = stmt
                .query_map([], |r| {
                    let embedding: Option<String> = r.get(3)?;
                    Ok(StoredJournalEntry {
                        id: r.get(0)?,
                        kind: r.get(1)?,
                        content: r.get(2)?,
                        embedding: embedding.and_then(|e| serde_json::from_str(&e).ok()),
                        created_at: r.get(4)?,
                        updated_at: r.get(5)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok::<Vec<StoredJournalEntry>, anyhow::Error>(rows)
        })?;
        let embeddings: Vec<serde_json::Value> = db.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "select id, kind, content, vector, created_at from memory_embeddings order by created_at asc",
            )?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "kind": r.get::<_, String>(1)?,
                        "content": r.get::<_, String>(2)?,
                        "vector": serde_json::from_str::<Vec<f32>>(&r.get::<_, String>(3)?).unwrap_or_default(),
                        "created_at": r.get::<_, i64>(4)?,
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok::<Vec<serde_json::Value>, anyhow::Error>(rows)
        })?;
        counts.insert("summaries".into(), summaries.len().into());
        counts.insert("journal_entries".into(), journals.len().into());
        counts.insert("memory_embeddings".into(), embeddings.len().into());
        files.push((
            "memory/summaries.json".into(),
            serde_json::to_vec_pretty(&summaries)?,
        ));
        files.push((
            "memory/journal_entries.json".into(),
            serde_json::to_vec_pretty(&journals)?,
        ));
        files.push((
            "memory/memory_embeddings.json".into(),
            serde_json::to_vec_pretty(&embeddings)?,
        ));
    }

    if selection.providers {
        let providers = airi_store::ProviderRepo::new(db.clone()).list()?;
        counts.insert("providers".into(), providers.len().into());
        files.push((
            "providers/providers.json".into(),
            serde_json::to_vec_pretty(&providers)?,
        ));
    }

    if selection.characters {
        let docs = card_documents(card_dirs)?;
        counts.insert("characters".into(), docs.len().into());
        for (path, _, bytes) in &docs {
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "card.bin".into());
            files.push((format!("characters/cards/{file_name}"), bytes.clone()));
        }
        let names: Vec<_> = docs
            .iter()
            .map(|(_, meta, _)| {
                meta.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        files.push((
            "characters/manifest.json".into(),
            serde_json::to_vec_pretty(&names)?,
        ));
    }

    if selection.backgrounds {
        // Not implemented in this build; recorded as present-but-empty so the
        // archive advertises the domain honestly.
        files.push((
            "backgrounds/.unsupported".into(),
            b"backgrounds are not implemented in this build\n".to_vec(),
        ));
    }

    let mut domain_ids: Vec<String> = Vec::new();
    if selection.chats {
        domain_ids.push("chats".into());
    }
    if selection.memory {
        domain_ids.push("memory".into());
    }
    if selection.providers {
        domain_ids.push("providers".into());
    }
    if selection.characters {
        domain_ids.push("characters".into());
    }
    if selection.backgrounds {
        domain_ids.push("backgrounds".into());
    }

    let manifest = Manifest {
        format: "airi-vault",
        version: 1,
        created_at: now_millis(),
        includes_secrets: selection.providers,
        domains: domain_ids,
        counts,
        notes: vec![
            "airi-vault stored-ZIP archive; chats/memory restore with existing-row-wins semantics.".into(),
            "providers/providers.json contains API credentials when the providers domain is selected.".into(),
        ],
    };
    files.push((
        "manifest.json".into(),
        serde_json::to_vec_pretty(&manifest)?,
    ));

    let files_ref: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    zip_stored(&files_ref)
}

/// What a vault archive contains, without writing anything.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InspectionReport {
    /// Format marker (`airi-vault`).
    pub format: String,
    /// Format version.
    pub version: u8,
    /// Archive creation time (ms), when the manifest carries it.
    pub created_at: Option<i64>,
    /// Whether the archive includes provider credentials.
    pub includes_secrets: bool,
    /// Per-domain entry counts: `[{ "id": "chats", "entries": n, "bytes": n }]`.
    pub domains: Vec<serde_json::Value>,
    /// Session count inside the archive.
    pub session_count: u64,
    /// Message count inside the archive.
    pub message_count: u64,
    /// Companion (card) names found in the archive.
    pub companion_names: Vec<String>,
}

/// Inspect a vault archive produced by [`collect_archive`]. Reads only.
pub fn inspect_archive(bytes: &[u8]) -> Result<InspectionReport> {
    let entries = zip_read(bytes)?;
    let by_name = |needle: &str| entries.iter().find(|e| e.name == needle);

    let manifest_bytes = by_name("manifest.json").context("archive has no manifest.json")?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest_bytes.data).context("manifest.json is not valid JSON")?;
    let format = manifest
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if format != "airi-vault" {
        bail!("not an airi-vault archive (manifest format is {format:?})");
    }
    let version = manifest
        .get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u8;
    let created_at = manifest.get("created_at").and_then(|v| v.as_i64());
    let includes_secrets = manifest
        .get("includes_secrets")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut domains = Vec::new();
    let mut session_count = 0u64;
    let mut message_count = 0u64;
    if let Some(s) = by_name("chats/sessions.json") {
        let sessions: serde_json::Value = serde_json::from_slice(&s.data)?;
        session_count = sessions.as_array().map_or(0, Vec::len) as u64;
        domains.push(
            serde_json::json!({"id": "chats", "sessions": session_count, "bytes": s.data.len()}),
        );
    }
    if let Some(m) = by_name("chats/messages.json") {
        let messages: serde_json::Value = serde_json::from_slice(&m.data)?;
        message_count = messages.as_array().map_or(0, Vec::len) as u64;
        if let Some(chats) = domains
            .iter_mut()
            .find(|d| d.get("id").and_then(|v| v.as_str()) == Some("chats"))
        {
            chats["messages"] = message_count.into();
            chats["bytes"] = (chats["bytes"].as_u64().unwrap_or(0) + m.data.len() as u64).into();
        }
    }
    for name in [
        "summaries.json",
        "journal_entries.json",
        "memory_embeddings.json",
    ] {
        if let Some(m) = by_name(&format!("memory/{name}")) {
            let values: serde_json::Value = serde_json::from_slice(&m.data)?;
            let entries_n = values.as_array().map_or(0, Vec::len) as u64;
            domains.push(serde_json::json!({"id": format!("memory/{name}"), "entries": entries_n, "bytes": m.data.len()}));
        }
    }
    if let Some(p) = by_name("providers/providers.json") {
        let providers: serde_json::Value = serde_json::from_slice(&p.data)?;
        let n = providers.as_array().map_or(0, Vec::len) as u64;
        domains.push(serde_json::json!({"id": "providers", "entries": n, "bytes": p.data.len()}));
    }
    let card_entries = entries
        .iter()
        .filter(|e| e.name.starts_with("characters/cards/"))
        .count() as u64;
    if card_entries > 0 {
        let bytes: u64 = entries
            .iter()
            .filter(|e| e.name.starts_with("characters/cards/"))
            .map(|e| e.data.len() as u64)
            .sum();
        domains
            .push(serde_json::json!({"id": "characters", "entries": card_entries, "bytes": bytes}));
    }

    let companion_names = by_name("characters/manifest.json")
        .and_then(|m| serde_json::from_slice::<Vec<String>>(&m.data).ok())
        .unwrap_or_default();

    Ok(InspectionReport {
        format,
        version,
        created_at,
        includes_secrets,
        domains,
        session_count,
        message_count,
        companion_names,
    })
}

/// Outcome of applying an archive to the local store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitReport {
    /// Sessions inserted.
    pub sessions_inserted: u64,
    /// Sessions skipped because the id already exists.
    pub sessions_skipped: u64,
    /// Messages inserted.
    pub messages_inserted: u64,
    /// Messages skipped because the id already exists.
    pub messages_skipped: u64,
    /// Summaries inserted.
    pub summaries_inserted: u64,
    /// Journal entries inserted.
    pub journal_entries_inserted: u64,
    /// Domains that were applied (`chats`, `memory`).
    pub applied: Vec<String>,
    /// Domains present in the archive but intentionally not applied by this build.
    pub not_applied: Vec<String>,
}

/// Apply a vault archive to the local store.
///
/// Existing rows win (`INSERT OR IGNORE`); nothing is ever deleted or
/// overwritten. Only `chats` and `memory` are applied; `providers` and
/// `characters` are reported in `not_applied`.
pub fn commit_archive(db: &airi_store::Database, bytes: &[u8]) -> Result<CommitReport> {
    let entries = zip_read(bytes)?;
    let by_name = |needle: &str| entries.iter().find(|e| e.name == needle);

    // Validate the manifest before writing anything.
    let manifest_bytes = by_name("manifest.json").context("archive has no manifest.json")?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest_bytes.data).context("manifest.json is not valid JSON")?;
    if manifest.get("format").and_then(|v| v.as_str()) != Some("airi-vault") {
        bail!("not an airi-vault archive");
    }

    let domain_names = |n: &str| entries.iter().any(|e| e.name.starts_with(n));

    let mut report = CommitReport {
        sessions_inserted: 0,
        sessions_skipped: 0,
        messages_inserted: 0,
        messages_skipped: 0,
        summaries_inserted: 0,
        journal_entries_inserted: 0,
        applied: Vec::new(),
        not_applied: Vec::new(),
    };

    if domain_names("chats/") {
        let sessions: Vec<StoredSession> = by_name("chats/sessions.json")
            .map(|e| serde_json::from_slice(&e.data))
            .transpose()?
            .unwrap_or_default();
        let messages: Vec<airi_store::StoredMessage> = by_name("chats/messages.json")
            .map(|e| serde_json::from_slice(&e.data))
            .transpose()?
            .unwrap_or_default();

        db.with_connection(|conn| {
            let tx = conn.unchecked_transaction()?;
            for s in &sessions {
                let inserted = tx.execute(
                    "insert or ignore into sessions (id, title, created_at, updated_at, metadata)
                     values (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        s.id,
                        s.title,
                        s.created_at,
                        s.updated_at,
                        serde_json::to_string(&s.metadata)?,
                    ],
                )?;
                if inserted > 0 {
                    report.sessions_inserted += 1;
                } else {
                    report.sessions_skipped += 1;
                }
            }
            for m in &messages {
                let inserted = tx.execute(
                    "insert or ignore into messages (id, session_id, role, content, created_at, metadata)
                     values (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        m.id,
                        m.session_id,
                        m.role,
                        m.content,
                        m.created_at,
                        serde_json::to_string(&m.metadata)?,
                    ],
                )?;
                if inserted > 0 {
                    report.messages_inserted += 1;
                } else {
                    report.messages_skipped += 1;
                }
            }
            tx.commit()?;
            Ok::<(), anyhow::Error>(())
        })?;
        report.applied.push("chats".into());
    }

    if domain_names("memory/") {
        db.with_connection(|conn| {
            let tx = conn.unchecked_transaction()?;
            if let Some(e) = by_name("memory/summaries.json") {
                let summaries: Vec<StoredSummary> = serde_json::from_slice(&e.data)?;
                for s in &summaries {
                    let inserted = tx.execute(
                        "insert or ignore into summaries (id, day, content, source_session_ids, token_estimate, created_at)
                         values (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            s.id,
                            s.day,
                            s.content,
                            serde_json::to_string(&s.source_session_ids)?,
                            s.token_estimate,
                            s.created_at,
                        ],
                    )?;
                    report.summaries_inserted += inserted as u64;
                }
            }
            if let Some(e) = by_name("memory/journal_entries.json") {
                let journals: Vec<StoredJournalEntry> = serde_json::from_slice(&e.data)?;
                for j in &journals {
                    let inserted = tx.execute(
                        "insert or ignore into journal_entries (id, kind, content, embedding, created_at, updated_at)
                         values (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            j.id,
                            j.kind,
                            j.content,
                            j.embedding.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
                            j.created_at,
                            j.updated_at,
                        ],
                    )?;
                    report.journal_entries_inserted += inserted as u64;
                }
            }
            tx.commit()?;
            Ok::<(), anyhow::Error>(())
        })?;
        report.applied.push("memory".into());
    }

    for domain in ["providers/", "characters/"] {
        if domain_names(domain) {
            report
                .not_applied
                .push(domain.trim_end_matches('/').to_string());
        }
    }

    Ok(report)
}

/// What one scrub pass did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScrubReport {
    /// Inline images found (and extracted).
    pub images_found: u64,
    /// Total decoded bytes written to the backgrounds store.
    pub bytes_extracted: u64,
    /// Sessions that contained at least one extracted image.
    pub sessions_scanned: u64,
    /// Path of the pre-scrub backup archive, when one was requested and written.
    pub backup_path: Option<String>,
}

/// FNV-1a 64-bit hash, used for content-addressed scrub asset names.
fn fnv1a(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in data {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    hash
}

fn base64_image_spans(content: &str) -> Vec<(usize, usize, String)> {
    // Returns (start, end, extension) for each `data:image/<ext>;base64,<payload>` span.
    let needle = "data:image/";
    let mut spans = Vec::new();
    let mut cursor = 0;
    while let Some(rel) = content[cursor..].find(needle) {
        let start = cursor + rel;
        let after_prefix = start + needle.len();
        let Some(semi) = content[after_prefix..].find(';') else {
            break;
        };
        let ext = content[after_prefix..after_prefix + semi].to_ascii_lowercase();
        let base64_marker = ";base64,";
        let Some(marker_rel) = content[after_prefix + semi..].find(base64_marker) else {
            break;
        };
        let payload_start = after_prefix + semi + marker_rel + base64_marker.len();
        let mut payload_end = payload_start;
        while payload_end < content.len() {
            let b = content.as_bytes()[payload_end];
            if b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=' {
                payload_end += 1;
            } else {
                break;
            }
        }
        if payload_end - payload_start > 64 {
            // Ignore degenerate tiny matches.
            spans.push((start, payload_end, ext));
        }
        cursor = payload_end;
    }
    spans
}

/// Scan `messages` for inline base64 images, extract them into
/// `<backgrounds_dir>/scrubbed/<hash>.<ext>`, and re-point those message
/// contents at the extracted asset. When `create_backup` is true a full
/// pre-scrub archive is written under `<backgrounds_dir>/scrub-backups/`
/// first.
pub fn scrub_session_media(
    db: &airi_store::Database,
    backgrounds_dir: &Path,
    card_dirs: &[PathBuf],
    create_backup: bool,
) -> Result<ScrubReport> {
    let backup_path = if create_backup {
        let archive = collect_archive(
            db,
            card_dirs,
            VaultSelection {
                characters: false,
                ..VaultSelection::all()
            },
        )?;
        let backup_dir = backgrounds_dir.join("scrub-backups");
        std::fs::create_dir_all(&backup_dir)
            .with_context(|| format!("failed to create {}", backup_dir.display()))?;
        let path = backup_dir.join(format!("pre-scrub-{}.zip", now_millis()));
        std::fs::write(&path, &archive)
            .with_context(|| format!("failed to write {}", path.display()))?;
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    };

    let messages: Vec<airi_store::StoredMessage> = MessageRepo::new(db.clone()).list_all()?;
    let scrub_dir = backgrounds_dir.join("scrubbed");
    std::fs::create_dir_all(&scrub_dir)
        .with_context(|| format!("failed to create {}", scrub_dir.display()))?;

    let mut images_found = 0u64;
    let mut bytes_extracted = 0u64;
    let mut sessions = BTreeSet::new();

    for msg in &messages {
        let spans = base64_image_spans(&msg.content);
        if spans.is_empty() {
            continue;
        }
        let mut new_content = msg.content.clone();
        // Replace from the end so earlier offsets stay valid.
        for (start, end, ext) in spans.into_iter().rev() {
            let Some(payload_range) = payload_range_of(&msg.content, start, end) else {
                continue;
            };
            let payload = &msg.content[payload_range.0..payload_range.1];
            let decoded = match base64::engine::general_purpose::STANDARD.decode(payload.trim()) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let hash = fnv1a(&decoded);
            let safe_ext: String = ext
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(8)
                .collect();
            let ext = if safe_ext.is_empty() {
                "bin".to_string()
            } else {
                safe_ext
            };
            let file_name = format!("{hash:016x}.{ext}");
            std::fs::write(scrub_dir.join(&file_name), &decoded)
                .with_context(|| format!("failed to write scrubbed asset {file_name}"))?;
            let pointer = format!("![image](airi-asset://{file_name})");
            new_content.replace_range(start..end, &pointer);
            images_found += 1;
            bytes_extracted += decoded.len() as u64;
            sessions.insert(msg.session_id.clone());
        }
        if new_content != msg.content {
            db.with_connection(|conn| {
                conn.execute(
                    "update messages set content = ?2 where id = ?1",
                    rusqlite::params![msg.id, new_content],
                )?;
                Ok::<(), anyhow::Error>(())
            })?;
        }
    }

    let report = ScrubReport {
        images_found,
        bytes_extracted,
        sessions_scanned: sessions.len() as u64,
        backup_path,
    };
    ScrubRunRepo::new(db.clone()).insert(&StoredScrubRun {
        id: format!("scrub-{}", now_millis()),
        started_at: now_millis(),
        sessions_scanned: report.sessions_scanned,
        images_extracted: report.images_found,
        bytes_extracted: report.bytes_extracted,
        backup_path: report.backup_path.clone(),
    })?;
    Ok(report)
}

fn payload_range_of(content: &str, span_start: usize, span_end: usize) -> Option<(usize, usize)> {
    let base64_marker = ";base64,";
    let marker = content[span_start..span_end].find(base64_marker)?;
    Some((span_start + marker + base64_marker.len(), span_end))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use airi_store::{MessageRepo, SessionRepo};

    fn image_payload_bytes() -> Vec<u8> {
        // A deterministic pseudo-image body, long enough to pass the 64-byte floor.
        (0..200u32).map(|i| ((i * 37 + 11) % 251) as u8).collect()
    }

    fn image_data_url() -> String {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(image_payload_bytes())
        )
    }

    fn fresh_db(dir: &tempfile::TempDir) -> airi_store::Database {
        airi_store::Database::open(&dir.path().join("test.sqlite")).expect("open test db")
    }

    fn seed_chat(db: &airi_store::Database, with_image: bool) -> airi_store::StoredSession {
        let session = SessionRepo::new(db.clone())
            .create("s1", "vault test")
            .expect("create session");
        let content = if with_image {
            format!("here is an image: {} ...and some text", image_data_url())
        } else {
            "plain message".to_string()
        };
        MessageRepo::new(db.clone())
            .insert(&airi_store::StoredMessage {
                id: "m1".into(),
                session_id: session.id.clone(),
                role: "user".into(),
                content,
                created_at: 1000,
                metadata: serde_json::json!({}),
            })
            .expect("insert message");
        session
    }

    fn write_card_json(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(format!("{name}.json"));
        std::fs::write(
            &path,
            serde_json::json!({
                "spec": "chara_card_v3",
                "spec_version": "3.0",
                "data": { "name": name },
            })
            .to_string(),
        )
        .expect("write card");
        path
    }

    #[test]
    fn crc32_matches_png_spec_vector() {
        // CRC-32 of ASCII "123456789" is 0xCBF43926 (same vector the PNG writer uses).
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn zip_roundtrip_preserves_entries() {
        let entries = [
            ("a.txt", b"hello".as_slice()),
            ("dir/b.json", br#"{"k":"v"}"#.as_slice()),
            ("empty", b"".as_slice()),
        ];
        let archive = zip_stored(&entries).expect("write zip");
        let read_back = zip_read(&archive).expect("read zip");
        assert_eq!(read_back.len(), 3);
        assert_eq!(read_back[0].name, "a.txt");
        assert_eq!(read_back[0].data, b"hello");
        assert_eq!(read_back[1].name, "dir/b.json");
        assert_eq!(read_back[2].data, b"");
    }

    #[test]
    fn stats_reports_domains() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = fresh_db(&dir);
        seed_chat(&db, false);
        write_card_json(dir.path(), "TestMascot");

        let stats = stats(&db, &[dir.path().to_path_buf()]).expect("stats");
        let by_id = |id: &str| stats.domains.iter().find(|d| d.id == id).unwrap().clone();
        assert_eq!(by_id("chats").count, 1); // sessions count
        assert!(by_id("memory").count == 0);
        assert_eq!(by_id("characters").count, 1);
        assert_eq!(by_id("providers").count, 0);
        assert_eq!(by_id("backgrounds").count, 0);
    }

    #[test]
    fn collect_and_inspect_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = fresh_db(&dir);
        seed_chat(&db, false);
        write_card_json(dir.path(), "Mascot");

        let archive = collect_archive(&db, &[dir.path().to_path_buf()], VaultSelection::all())
            .expect("collect");
        let report = inspect_archive(&archive).expect("inspect");
        assert_eq!(report.format, "airi-vault");
        assert_eq!(report.version, 1);
        assert_eq!(report.session_count, 1);
        assert_eq!(report.message_count, 1);
        assert_eq!(report.companion_names, vec!["Mascot".to_string()]);
    }

    #[test]
    fn commit_inserts_then_skips_existing() {
        let dir_a = tempfile::tempdir().expect("tempdir a");
        let dir_b = tempfile::tempdir().expect("tempdir b");
        let db_a = fresh_db(&dir_a);
        seed_chat(&db_a, false);
        let archive = collect_archive(
            &db_a,
            &[],
            VaultSelection {
                characters: false,
                providers: false,
                ..VaultSelection::all()
            },
        )
        .expect("collect");

        let db_b = fresh_db(&dir_b);
        let first = commit_archive(&db_b, &archive).expect("first commit");
        assert_eq!(first.sessions_inserted, 1);
        assert_eq!(first.messages_inserted, 1);
        assert!(first.applied.contains(&"chats".to_string()));
        assert!(first.applied.contains(&"memory".to_string()));

        let second = commit_archive(&db_b, &archive).expect("second commit");
        assert_eq!(second.sessions_inserted, 0);
        assert_eq!(second.sessions_skipped, 1);
        assert_eq!(second.messages_inserted, 0);
        assert_eq!(second.messages_skipped, 1);
    }

    #[test]
    fn scrub_extracts_inline_image_and_records_run() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = fresh_db(&dir);
        seed_chat(&db, true);

        let bg = dir.path().join("backgrounds");
        let report = scrub_session_media(&db, &bg, &[], true).expect("scrub");
        assert_eq!(report.images_found, 1);
        assert!(report.bytes_extracted > 100);
        assert_eq!(report.sessions_scanned, 1);
        assert!(report.backup_path.is_some());

        // The message now carries a pointer, not the payload.
        let messages = MessageRepo::new(db.clone())
            .list_all()
            .expect("list messages");
        assert!(messages[0].content.contains("airi-asset://"));
        assert!(!messages[0].content.contains("base64"));

        // The backup archive is a valid vault archive.
        let backup_bytes =
            std::fs::read(report.backup_path.as_ref().unwrap()).expect("read backup");
        let inspection = inspect_archive(&backup_bytes).expect("backup inspects");
        assert_eq!(inspection.session_count, 1);

        // The scrub run was recorded.
        let runs = airi_store::ScrubRunRepo::new(db.clone())
            .list_recent(10)
            .expect("runs");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].images_extracted, 1);

        // A second pass finds nothing.
        let report2 = scrub_session_media(&db, &bg, &[], false).expect("second scrub");
        assert_eq!(report2.images_found, 0);
        assert_eq!(report2.backup_path, None);
    }

    #[test]
    fn inspect_rejects_non_vault_zip() {
        let archive = zip_stored(&[("random.txt", b"nope".as_slice())]).expect("zip");
        assert!(inspect_archive(&archive).is_err());
    }

    /// A central-directory entry whose name length runs past the end of the
    /// buffer must error, not panic. Only the `name_end` check can reject it:
    /// the fixed 46-byte record is intact, and the archive is long enough that
    /// the entry's declared end still fits inside `bytes`.
    #[test]
    fn zip_read_rejects_oversized_entry_name_len() {
        let archive = zip_stored(&[("a.txt", b"hello".as_slice())]).expect("zip");
        let cd_offset = archive.len() - 46 - 5 - 22;
        let mut tampered = archive[..cd_offset].to_vec();
        tampered.extend_from_slice(b"PK\x01\x02");
        tampered.extend_from_slice(&20u16.to_le_bytes()); // version made by
        tampered.extend_from_slice(&20u16.to_le_bytes()); // version needed
        tampered.extend_from_slice(&0u16.to_le_bytes()); // flags
        tampered.extend_from_slice(&0u16.to_le_bytes()); // method: stored
        tampered.extend_from_slice(&0u16.to_le_bytes()); // dos time
        tampered.extend_from_slice(&0u16.to_le_bytes()); // dos date
        tampered.extend_from_slice(&0u32.to_le_bytes()); // crc
        tampered.extend_from_slice(&0u32.to_le_bytes()); // compressed size
        tampered.extend_from_slice(&0u32.to_le_bytes()); // uncompressed size
        tampered.extend_from_slice(&0x1000u16.to_le_bytes()); // name len: past EOF
        tampered.extend_from_slice(&0u16.to_le_bytes()); // extra len
        tampered.extend_from_slice(&0u16.to_le_bytes()); // comment len
        tampered.extend_from_slice(&0u16.to_le_bytes()); // disk number
        tampered.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        tampered.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        tampered.extend_from_slice(&0u32.to_le_bytes()); // local header offset

        let cd_size = (tampered.len() - cd_offset + 46) as u32;
        tampered.extend_from_slice(b"PK\x05\x06");
        tampered.extend_from_slice(&0u16.to_le_bytes());
        tampered.extend_from_slice(&0u16.to_le_bytes());
        tampered.extend_from_slice(&1u16.to_le_bytes());
        tampered.extend_from_slice(&1u16.to_le_bytes());
        tampered.extend_from_slice(&cd_size.to_le_bytes());
        tampered.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        tampered.extend_from_slice(&0u16.to_le_bytes());

        assert!(zip_read(&tampered).is_err());
    }

    /// A central directory whose fixed 46-byte entry record is cut in half must
    /// be a typed error, not a slice-out-of-range panic.
    #[test]
    fn zip_read_rejects_truncated_central_directory() {
        let archive = zip_stored(&[("a.txt", b"hello".as_slice())]).expect("zip");
        // `find_eocd` only scans backwards, so keep the forged EOCD last: declare
        // a central directory that starts inside the original one and ends past
        // EOF, with a count that needs more bytes than remain.
        let cd_offset = archive.len() - 22 - 10;
        let mut truncated = archive[..archive.len() - 22].to_vec();
        truncated.extend_from_slice(b"PK\x05\x06");
        truncated.extend_from_slice(&0u16.to_le_bytes()); // disk number
        truncated.extend_from_slice(&0u16.to_le_bytes()); // central dir start disk
        truncated.extend_from_slice(&1u16.to_le_bytes()); // entries on this disk
        truncated.extend_from_slice(&1u16.to_le_bytes()); // total entries
        truncated.extend_from_slice(&10u32.to_le_bytes()); // central dir size
        truncated.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // central dir offset
        truncated.extend_from_slice(&0u16.to_le_bytes()); // comment len

        assert!(zip_read(&truncated).is_err());
    }

    /// An entry whose local-header offset points past the end of the buffer must
    /// error, not panic.
    #[test]
    fn zip_read_rejects_out_of_range_local_header_offset() {
        let archive = zip_stored(&[("a.txt", b"hello".as_slice())]).expect("zip");
        // The single central-directory entry's local-header offset lives at +42.
        let cd_offset = archive.len() - 22 - 46;
        let mut tampered = archive.clone();
        tampered[cd_offset + 42..cd_offset + 46].copy_from_slice(&u32::MAX.to_le_bytes());

        assert!(zip_read(&tampered).is_err());
    }

    /// A central directory whose declared size runs past the end of the buffer
    /// must error, not panic. The trailing padding keeps the forged EOCD last so
    /// `find_eocd` cannot fall back to an earlier record.
    #[test]
    fn zip_read_rejects_oversized_central_directory_size() {
        let archive = zip_stored(&[("a.txt", b"hello".as_slice())]).expect("zip");
        let cd_offset = archive.len() - 46 - 5 - 22;
        let mut tampered = archive[..cd_offset].to_vec();
        tampered.extend_from_slice(&[0u8; 64]);
        tampered.extend_from_slice(b"PK\x05\x06");
        tampered.extend_from_slice(&0u16.to_le_bytes());
        tampered.extend_from_slice(&0u16.to_le_bytes());
        tampered.extend_from_slice(&1u16.to_le_bytes());
        tampered.extend_from_slice(&1u16.to_le_bytes());
        tampered.extend_from_slice(&4096u32.to_le_bytes()); // central dir size
        tampered.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // central dir offset
        tampered.extend_from_slice(&0u16.to_le_bytes());

        assert!(zip_read(&tampered).is_err());
    }

    /// An archive whose declared `cd_offset + cd_size` wraps `usize` must error
    /// via `checked_add`, not slip past the range check.
    #[test]
    fn zip_read_rejects_wrapping_central_directory_offset() {
        let archive = zip_stored(&[("a.txt", b"hello".as_slice())]).expect("zip");
        let cd_offset = archive.len() - 46 - 5 - 22;
        let mut tampered = archive[..cd_offset].to_vec();
        tampered.extend_from_slice(&[0u8; 64]);
        tampered.extend_from_slice(b"PK\x05\x06");
        tampered.extend_from_slice(&0u16.to_le_bytes());
        tampered.extend_from_slice(&0u16.to_le_bytes());
        tampered.extend_from_slice(&1u16.to_le_bytes());
        tampered.extend_from_slice(&1u16.to_le_bytes());
        tampered.extend_from_slice(&u32::MAX.to_le_bytes()); // cd size
        tampered.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // cd offset
        tampered.extend_from_slice(&0u16.to_le_bytes());

        assert!(zip_read(&tampered).is_err());
    }
}
