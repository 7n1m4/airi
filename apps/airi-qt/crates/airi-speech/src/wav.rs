// SPDX-License-Identifier: GPL-3.0-or-later

//! Minimal 44-byte WAV (RIFF/PCM s16le) writer used by providers that return raw PCM
//! (Gemini native and OpenRouter audio both emit 24 kHz mono s16 PCM). Port of the
//! `toWavFromPCM16` helper in `@proj-airi/audio/encoding`.

/// Wrap raw little-endian PCM16 bytes in a WAV header.
#[must_use]
pub fn wav_from_pcm16(pcm: &[u8], sample_rate: u32, channels: u16) -> Vec<u8> {
    let data_len = u32::try_from(pcm.len()).unwrap_or(u32::MAX);
    let byte_rate = sample_rate * u32::from(channels) * 2;
    let block_align = channels * 2;

    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// Decode a base64 string to bytes (used by Gemini/MiMo/Player2/OpenRouter payloads).
///
/// Returns `None` on invalid input.
#[must_use]
pub fn decode_base64(input: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input.as_bytes())
        .ok()
}

/// Decode a hex string to bytes (used by MiniMax SSE audio chunks). Odd/invalid input yields `None`.
#[must_use]
pub fn decode_hex(input: &str) -> Option<Vec<u8>> {
    let clean = input.trim();
    if !clean.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(clean.len() / 2);
    let bytes = clean.as_bytes();
    for pair in bytes.as_chunks::<2>().0 {
        let hi = hex_val(pair[0])?;
        let lo = hex_val(pair[1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Lowercase hex encode (cache keys, signatures).
#[must_use]
pub fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from(HEX[(b >> 4) as usize]));
        out.push(char::from(HEX[(b & 0x0f) as usize]));
    }
    out
}
