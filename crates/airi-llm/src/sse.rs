// SPDX-License-Identifier: GPL-3.0-or-later

//! Incremental Server-Sent Events (`text/event-stream`) line parsing.
//!
//! Providers emit `data: <json>\n\n` frames (OpenAI), or `event: <type>\ndata: <json>\n\n`
//! frames (Anthropic, Gemini `alt=sse`). Only `data:` payloads are surfaced;
//! `event:`/`id:`/`retry:` lines and comments are ignored because every
//! supported provider embeds the frame type in the JSON payload itself.
//! The `data: [DONE]` sentinel is reported as [`SseItem::Done`].

/// One parsed SSE item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SseItem {
    /// Payload of a `data:` line, trimmed.
    Data(String),
    /// The `data: [DONE]` sentinel.
    Done,
}

/// Incremental parser fed with arbitrary byte chunks from the response stream.
///
/// Handles `\n` and `\r\n` line endings and lines split across chunk
/// boundaries (the P0 implementation split per byte-chunk and broke on
/// partial lines).
#[derive(Default)]
pub(crate) struct SseParser {
    /// Bytes of the current unterminated line.
    pending: Vec<u8>,
}

impl SseParser {
    /// Create a new parser.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk of response bytes; returns all complete SSE items it contained.
    ///
    /// Incomplete trailing lines are buffered for the next call.
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Vec<SseItem> {
        let mut items = Vec::new();
        self.pending.extend_from_slice(bytes);
        while let Some(pos) = self.pending.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.pending.drain(..=pos).collect();
            line.pop(); // '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(item) = Self::parse_line(&line) {
                items.push(item);
            }
        }
        items
    }

    /// Flush any trailing unterminated line at end-of-stream.
    pub(crate) fn finish(&mut self) -> Vec<SseItem> {
        let mut out = Vec::new();
        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            if let Some(item) = Self::parse_line(&line) {
                out.push(item);
            }
        }
        out
    }

    fn parse_line(line: &[u8]) -> Option<SseItem> {
        // Lines are expected to be valid UTF-8; invalid bytes are replaced rather than
        // aborting the stream, mirroring `String::from_utf8_lossy` semantics.
        let line = String::from_utf8_lossy(line);
        let line = line.trim_end();
        if line.is_empty() {
            return None; // frame separator
        }
        let Some(rest) = line.strip_prefix("data:") else {
            return None; // event:/id:/retry:/comment lines — ignored
        };
        let payload = rest.trim();
        if payload == "[DONE]" {
            return Some(SseItem::Done);
        }
        if payload.is_empty() {
            return None;
        }
        Some(SseItem::Data(payload.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_lines_and_done() {
        let mut p = SseParser::new();
        let items = p.feed(b"data: {\"a\":1}\n\ndata: [DONE]\n\n");
        assert_eq!(
            items,
            vec![SseItem::Data("{\"a\":1}".into()), SseItem::Done]
        );
        assert!(p.finish().is_empty());
    }

    #[test]
    fn buffers_partial_lines_across_chunks() {
        let mut p = SseParser::new();
        assert_eq!(p.feed(b"data: {\"a\""), vec![]);
        assert_eq!(p.feed(b":1}\r\n"), vec![SseItem::Data("{\"a\":1}".into())]);
    }

    #[test]
    fn ignores_event_and_comment_lines() {
        let mut p = SseParser::new();
        let items = p.feed(b"event: content_block_delta\n: keep-alive\ndata: {\"b\":2}\n\n");
        assert_eq!(items, vec![SseItem::Data("{\"b\":2}".into())]);
    }

    #[test]
    fn finish_flushes_unterminated_line() {
        let mut p = SseParser::new();
        assert_eq!(p.feed(b"data: tail"), vec![]);
        assert_eq!(p.finish(), vec![SseItem::Data("tail".into())]);
    }
}
