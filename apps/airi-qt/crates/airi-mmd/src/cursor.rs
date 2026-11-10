// SPDX-License-Identifier: GPL-3.0-or-later

//! Bounds-checking little-endian cursor over an untrusted byte slice.

use crate::error::MmdError;

/// Internal cursor that bounds-checks every read.
///
/// `section` names the area currently being decoded and is reported in
/// [`MmdError::Truncated`] so failures point at the offending section.
pub(crate) struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
    section: &'static str,
}

impl<'a> Cursor<'a> {
    /// Create a cursor at the start of `buf`.
    pub(crate) fn new(buf: &'a [u8]) -> Self {
        Self {
            buf,
            pos: 0,
            section: "header",
        }
    }

    /// Set the section name reported in errors.
    pub(crate) fn set_section(&mut self, section: &'static str) {
        self.section = section;
    }

    /// Number of bytes not yet consumed.
    pub(crate) fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }

    /// Read exactly 4 bytes (the magic).
    pub(crate) fn take_magic(&mut self) -> Result<[u8; 4], MmdError> {
        Ok(self.take(4)?.try_into().expect("4 bytes"))
    }

    /// Skip `n` bytes, failing with a typed error when out of input.
    pub(crate) fn skip(&mut self, n: usize) -> Result<(), MmdError> {
        self.take(n)?;
        Ok(())
    }

    /// Take the next `n` bytes.
    fn take(&mut self, n: usize) -> Result<&'a [u8], MmdError> {
        if self.buf.len() - self.pos < n {
            return Err(MmdError::Truncated { at: self.section });
        }
        let out = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }

    /// Read a single `u8`.
    pub(crate) fn u8(&mut self) -> Result<u8, MmdError> {
        Ok(self.take(1)?[0])
    }

    /// Read a single `u16` (little-endian).
    pub(crate) fn u16(&mut self) -> Result<u16, MmdError> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("2 bytes"),
        ))
    }

    /// Read a single `i16` (little-endian).
    pub(crate) fn i16(&mut self) -> Result<i16, MmdError> {
        Ok(i16::from_le_bytes(
            self.take(2)?.try_into().expect("2 bytes"),
        ))
    }

    /// Read a single `u32` (little-endian).
    pub(crate) fn u32(&mut self) -> Result<u32, MmdError> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("4 bytes"),
        ))
    }

    /// Read a single `i32` (little-endian).
    pub(crate) fn i32(&mut self) -> Result<i32, MmdError> {
        Ok(i32::from_le_bytes(
            self.take(4)?.try_into().expect("4 bytes"),
        ))
    }

    /// Read a single `f32` (little-endian).
    pub(crate) fn f32(&mut self) -> Result<f32, MmdError> {
        Ok(f32::from_le_bytes(
            self.take(4)?.try_into().expect("4 bytes"),
        ))
    }

    /// Read `n` consecutive `f32`s into an array.
    pub(crate) fn f32_array<const N: usize>(&mut self) -> Result<[f32; N], MmdError> {
        let mut out = [0.0; N];
        for slot in &mut out {
            *slot = self.f32()?;
        }
        Ok(out)
    }

    /// Read a signed PMX index of the given byte `size` (1, 2 or 4).
    ///
    /// Returns the raw value sign-extended to `i32`; `-1` (all ones) means
    /// "no reference" everywhere PMX uses this idiom.
    pub(crate) fn index_signed(&mut self, size: u8) -> Result<i32, MmdError> {
        match size {
            1 => Ok(self.u8()? as i8 as i32),
            2 => Ok(self.i16()? as i32),
            4 => Ok(self.i32()?),
            _ => Err(MmdError::InvalidData("index size must be 1, 2 or 4")),
        }
    }

    /// Read an unsigned PMX index of the given byte `size` (1, 2 or 4).
    ///
    /// Used for face indices, which PMX stores unsigned.
    pub(crate) fn index_unsigned(&mut self, size: u8) -> Result<u32, MmdError> {
        match size {
            1 => Ok(self.u8()? as u32),
            2 => Ok(self.u16()? as u32),
            4 => Ok(self.u32()?),
            _ => Err(MmdError::InvalidData("index size must be 1, 2 or 4")),
        }
    }

    /// Read a length-prefixed string (`i32` byte length + bytes) and decode it
    /// with `encoding`.
    ///
    /// Invalid byte sequences are replaced with U+FFFD (lossy) so a single
    /// bad byte in a texture path cannot sink the whole model.
    pub(crate) fn string(
        &mut self,
        encoding: crate::model::PmxEncoding,
    ) -> Result<String, MmdError> {
        let len = self.i32()?;
        if len < 0 {
            return Err(MmdError::InvalidData("negative string byte length"));
        }
        let len = len as usize;
        if len > self.remaining() {
            return Err(MmdError::Truncated { at: self.section });
        }
        let raw = self.take(len)?;
        Ok(decode_string(raw, encoding))
    }
}

/// Decode a PMX string payload.
fn decode_string(raw: &[u8], encoding: crate::model::PmxEncoding) -> String {
    match encoding {
        crate::model::PmxEncoding::Utf8 => String::from_utf8_lossy(raw).into_owned(),
        crate::model::PmxEncoding::Utf16Le => {
            let (chunks, remainder) = raw.as_chunks::<2>();
            let mut units =
                std::char::decode_utf16(chunks.iter().map(|c| u16::from_le_bytes([c[0], c[1]])))
                    .map(|r| r.unwrap_or('\u{FFFD}'))
                    .collect::<String>();
            if !remainder.is_empty() {
                units.push('\u{FFFD}');
            }
            units
        }
    }
}
