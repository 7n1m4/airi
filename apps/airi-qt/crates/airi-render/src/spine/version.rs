// SPDX-License-Identifier: GPL-3.0-or-later
//! Detection of the Spine editor version a skeleton was exported with.
//!
//! Mirrors `packages/stage-ui-spine/src/utils/spine-version.ts`: JSON
//! skeletons expose `skeleton.spine`; binary `.skel` files carry an
//! 8-byte hash followed by a varint-prefixed version string (4.0+) — or a
//! varint-prefixed hash followed by the version for 3.8-and-below files.
//!
//! The returned bucket is `major.minor` (e.g. `"4.2"`), matching the npm
//! runtime aliases the Vue package routes between.

/// Detect the runtime bucket (`4.0` / `4.1` / `4.2`) from JSON skeleton text.
pub fn detect_version_json(json: &str) -> Option<String> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;
    let version = root.get("skeleton")?.get("spine")?.as_str()?;
    parse_version_bucket(version)
}

/// Detect the runtime bucket from a binary `.skel` skeleton.
pub fn detect_version_binary(data: &[u8]) -> Option<String> {
    // 1. Spine 4.0+ layout: 8 non-varint hash bytes, then varint-prefixed
    //    version string (varint value = utf8 length + 1).
    if data.len() > 8 {
        if let Some(version) = read_varint_prefixed_string(data, 8) {
            if let Some(bucket) = parse_version_bucket(&version) {
                return Some(bucket);
            }
        }
    }

    // 2. Spine 3.8 and below: varint-prefixed hash string, then the
    //    varint-prefixed version string.
    if let Some(hash) = read_varint_string(data, 0) {
        let offset = hash.1;
        if let Some(version) = read_varint_prefixed_string(data, offset) {
            if let Some(bucket) = parse_version_bucket(&version) {
                return Some(bucket);
            }
        }
    }

    // 3. Robust fallback: first `\d+\.\d+\.\d+` in the first 200 bytes.
    let header = String::from_utf8_lossy(&data[..data.len().min(200)]);
    find_version_token(&header)
}

/// Parse `major.minor` out of a version token like `4.2.18`.
pub fn parse_version_bucket(version: &str) -> Option<String> {
    let mut parts = version.trim().split('.');
    let major = parts.next()?;
    let minor = parts.next()?;
    if !major.chars().all(|c| c.is_ascii_digit()) || !minor.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("{major}.{minor}"))
}

fn find_version_token(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_digit() {
            let start = index;
            while index < bytes.len() && (bytes[index].is_ascii_digit() || bytes[index] == b'.') {
                index += 1;
            }
            let token = &text[start..index];
            if let Some(bucket) = parse_version_bucket(token) {
                return Some(bucket);
            }
        } else {
            index += 1;
        }
    }
    None
}

/// Reads a Spine varint (7 bits per byte, high bit = continuation).
fn read_varint(data: &[u8], offset: usize) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift: u32 = 0;
    let mut bytes_read = 0usize;
    while offset + bytes_read < data.len() {
        let byte = data[offset + bytes_read];
        bytes_read += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, bytes_read));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

/// `(value − 1)`-length-prefixed UTF-8 string; varint written as `len + 1`.
fn read_varint_prefixed_string(data: &[u8], offset: usize) -> Option<String> {
    let (len_plus_one, bytes_read) = read_varint(data, offset)?;
    if len_plus_one <= 1 {
        return None;
    }
    let len = (len_plus_one - 1) as usize;
    let start = offset + bytes_read;
    let end = start.checked_add(len)?;
    if end > data.len() {
        return None;
    }
    let text = std::str::from_utf8(&data[start..end]).ok()?;
    if !is_version_like(text) {
        return None;
    }
    Some(text.to_string())
}

/// Varint-prefixed string where the varint is the raw length + 1; returns
/// the consumed offset as well.
fn read_varint_string(data: &[u8], offset: usize) -> Option<(String, usize)> {
    let (len_plus_one, bytes_read) = read_varint(data, offset)?;
    let len = (len_plus_one.checked_sub(1)?) as usize;
    let start = offset + bytes_read;
    let end = start.checked_add(len)?;
    if end > data.len() {
        return None;
    }
    let text = String::from_utf8(data[start..end].to_vec()).ok()?;
    Some((text, end))
}

fn is_version_like(text: &str) -> bool {
    parse_version_bucket(text).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_version_detected() {
        let json = r#"{"skeleton": {"spine": "4.2.18", "hash": "abc"}}"#;
        assert_eq!(detect_version_json(json).as_deref(), Some("4.2"));
        assert_eq!(
            detect_version_json(r#"{"skeleton": {"spine": "4.1.56"}}"#).as_deref(),
            Some("4.1")
        );
        assert_eq!(
            detect_version_json(r#"{"skeleton": {"spine": "4.0.64"}}"#).as_deref(),
            Some("4.0")
        );
        assert_eq!(detect_version_json("not json"), None);
        assert_eq!(detect_version_json(r#"{"skeleton": {}}"#), None);
    }

    #[test]
    fn binary_40_layout_detected() {
        // 8-byte hash + varint(len+1) + "4.2.18"
        let mut data = b"HASH1234".to_vec();
        let version = b"4.2.18";
        data.push((version.len() as u8 + 1) & 0x7f);
        data.extend_from_slice(version);
        assert_eq!(detect_version_binary(&data).as_deref(), Some("4.2"));
    }

    #[test]
    fn binary_38_layout_detected() {
        let hash = b"abcdef";
        let version = b"3.8.99";
        let mut data = Vec::new();
        data.push((hash.len() as u8 + 1) & 0x7f);
        data.extend_from_slice(hash);
        data.push((version.len() as u8 + 1) & 0x7f);
        data.extend_from_slice(version);
        assert_eq!(detect_version_binary(&data).as_deref(), Some("3.8"));
    }

    #[test]
    fn garbage_returns_none() {
        assert_eq!(detect_version_binary(b""), None);
        assert_eq!(detect_version_binary(b"\x00\x01\x02\x03"), None);
    }

    #[test]
    fn bucket_parsing_strict() {
        assert_eq!(parse_version_bucket("4.2.18").as_deref(), Some("4.2"));
        assert_eq!(parse_version_bucket("4.1").as_deref(), Some("4.1"));
        assert_eq!(parse_version_bucket("x.y.z"), None);
        assert_eq!(parse_version_bucket(""), None);
    }
}
