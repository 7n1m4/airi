// SPDX-License-Identifier: GPL-3.0-or-later

//! Hand-rolled UUIDv4 generation.
//!
//! The workspace has no `uuid` crate (and this lane may not add
//! dependencies), so version 4 UUIDs are built here. Entropy source, in
//! order of preference:
//!
//! 1. `/dev/urandom` on Unix — cryptographically secure, preferred.
//! 2. Non-Unix fallback (xorshift64* seeded from `SystemTime` nanos XOR
//!    pid) — **not cryptographically secure**. Used only when
//!    `/dev/urandom` is unavailable (e.g. some sandboxed/embedded targets).
//!    If you are on such a target and care about token unguessability,
//!    supply the token yourself instead of relying on the generated one.

#[cfg(unix)]
use std::io::Read;

/// Generate a random version 4 UUID in canonical hyphenated form.
pub fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    if !fill_from_urandom(&mut bytes) {
        fill_fallback(&mut bytes);
    }

    // Version 4 (random), variant 1 (RFC 4122).
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let b = bytes;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15],
    )
}

/// Fill `buf` from `/dev/urandom`. Returns `false` if unavailable.
#[cfg(unix)]
fn fill_from_urandom(buf: &mut [u8; 16]) -> bool {
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(buf))
        .is_ok()
}

/// Non-Unix fallback: no `/dev/urandom` to draw from.
#[cfg(not(unix))]
fn fill_from_urandom(_buf: &mut [u8; 16]) -> bool {
    false
}

/// Last-resort weak fill. See module docs for the caveat.
fn fill_fallback(buf: &mut [u8; 16]) {
    // NOTICE: explicitly not cryptographic. Only reached when /dev/urandom is
    // unreadable; the authToken is still unique per process start but must
    // not be assumed unguessable on such targets.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15);
    let mut state = nanos ^ ((std::process::id() as u64) << 32) ^ 0xA5A5_5A5A_3C3C_C3C3;
    if state == 0 {
        state = 0x9E37_79B9_7F4A_7C15;
    }

    for chunk in buf.chunks_mut(8) {
        // xorshift64*
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let value = state.wrapping_mul(0x2545_F491_4F6C_DD1D);
        for (i, byte) in chunk.iter_mut().enumerate() {
            *byte = (value >> (i * 8)) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_v4_shape() {
        let id = uuid_v4();
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.len(), 5);
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(id.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        // Version nibble must be 4 and variant nibble must be 8/9/a/b.
        assert!(parts[2].starts_with('4'));
        assert!(matches!(
            parts[3].chars().next().unwrap(),
            '8' | '9' | 'a' | 'b'
        ));
    }

    #[test]
    fn uuid_v4_unique() {
        let a = uuid_v4();
        let b = uuid_v4();
        assert_ne!(a, b);
    }
}
