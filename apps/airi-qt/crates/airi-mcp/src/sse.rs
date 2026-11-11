// SPDX-License-Identifier: GPL-3.0-or-later

//! Incremental Server-Sent Events (`text/event-stream`) frame parsing for
//! the MCP streamable-HTTP transport.
//!
//! Implements the subset of the WHATWG SSE wire format that matters for
//! MCP: `field: value` lines, multi-line `data:` accumulation (joined with
//! `\n` per the SSE spec), `:`-prefixed comment/keep-alive lines (ignored),
//! `\n` and `\r\n` line endings and lines split across chunks (buffered
//! until a line terminator arrives). A frame is dispatched on the blank
//! line that terminates it; frames with an empty `data` buffer are
//! discarded, matching the spec.
//!
//! What is intentionally **not** implemented (see the phase note for the
//! full list): the `retry:` field is parsed but not honored (no reconnect
//! logic), `event:`/`id:` values are surfaced on the [`SseFrame`] but
//! nothing in this crate re-dispatches on them (MCP embeds its routing in
//! the JSON payload, exactly like the `airi-llm` SSE reader), and the
//! parser never panics — invalid UTF-8 is replaced lossily and malformed
//! frames are reported to the caller, not thrown.

/// A single dispatched SSE frame (a block terminated by a blank line).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SseFrame {
    /// Value of the `event:` line, when present. Not used for routing in
    /// this crate; surfaced for diagnostics.
    pub(crate) event: Option<String>,
    /// Value of the `id:` line, when present. Not used for routing in this
    /// crate; surfaced for diagnostics.
    pub(crate) id: Option<String>,
    /// The `data:` payload. When several `data:` lines appear in one frame
    /// they are joined with `\n`, per the SSE spec.
    pub(crate) data: String,
}

/// Incremental SSE parser. Feed it arbitrary byte chunks; it returns every
/// complete frame it contained.
#[derive(Default)]
pub(crate) struct SseParser {
    /// Bytes of the current unterminated line.
    pending_line: Vec<u8>,
    /// Accumulated `data:` payload of the frame currently being assembled.
    data_buf: String,
    /// `event:` value of the frame currently being assembled, if any.
    event_buf: Option<String>,
    /// `id:` value of the frame currently being assembled, if any.
    id_buf: Option<String>,
}

impl SseParser {
    /// Creates a parser in its initial state.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Feeds a chunk; returns every complete frame it contained.
    ///
    /// Incomplete trailing lines are buffered for the next call. A frame is
    /// emitted only when a blank line terminates it (or at [`Self::finish`],
    /// which flushes a trailing unterminated line and an unterminated final
    /// frame).
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Vec<SseFrame> {
        let mut frames = Vec::new();
        self.pending_line.extend_from_slice(chunk);
        while let Some(pos) = self.pending_line.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.pending_line.drain(..=pos).collect();
            line.pop(); // the '\n' itself
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(frame) = self.parse_line(&line) {
                frames.push(frame);
            }
        }
        frames
    }

    /// Flushes any trailing unterminated line and dispatches a pending
    /// unterminated frame at end-of-stream.
    ///
    /// This is deliberately lenient: strict SSE would require the final
    /// blank line, but real-world MCP servers occasionally end the body
    /// right after the last `data:` line.
    pub(crate) fn finish(&mut self) -> Vec<SseFrame> {
        let mut frames = Vec::new();
        if !self.pending_line.is_empty() {
            let line = std::mem::take(&mut self.pending_line);
            if let Some(frame) = self.parse_line(&line) {
                frames.push(frame);
            }
        }
        if let Some(frame) = self.dispatch_frame() {
            frames.push(frame);
        }
        frames
    }

    fn parse_line(&mut self, line: &[u8]) -> Option<SseFrame> {
        // Lines are expected to be valid UTF-8; invalid bytes are replaced
        // rather than aborting the stream, mirroring `String::from_utf8_lossy`
        // semantics (and `airi-llm`'s SSE reader).
        let line = String::from_utf8_lossy(line);
        let line = line.as_ref();

        if line.is_empty() {
            // Blank line: terminate the current frame.
            return self.dispatch_frame();
        }
        if line.starts_with(':') {
            // Comment / keep-alive line. Ignored by design.
            return None;
        }

        // `field: value` — one leading space after the colon is stripped;
        // a line without a colon is a field name with an empty value.
        let (field, value) = match line.split_once(':') {
            Some((field, rest)) => (field, rest.strip_prefix(' ').unwrap_or(rest)),
            None => (line, ""),
        };

        match field {
            "data" => {
                if !self.data_buf.is_empty() {
                    self.data_buf.push('\n');
                }
                self.data_buf.push_str(value);
                None
            }
            "event" => {
                self.event_buf = Some(value.to_string());
                None
            }
            "id" => {
                // Per the SSE spec, an id containing U+0000 is ignored;
                // MCP never sends one, but honor the rule cheaply.
                if !value.contains('\0') {
                    self.id_buf = Some(value.to_string());
                }
                None
            }
            "retry" => {
                // Parsed and deliberately not honored: this crate performs
                // no automatic reconnection. Documented in the phase note.
                tracing::trace!(target: "airi-mcp", retry = %value, "ignoring SSE retry field");
                None
            }
            _ => None, // unknown extension field: ignore per SSE spec
        }
    }

    fn dispatch_frame(&mut self) -> Option<SseFrame> {
        let event = self.event_buf.take();
        let id = self.id_buf.take();
        let data = std::mem::take(&mut self.data_buf);
        if data.is_empty() {
            // Spec: an empty data buffer means no event is dispatched; the
            // event-type buffer is reset. `id` is intentionally retained.
            return None;
        }
        Some(SseFrame { event, id, data })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_all(chunks: &[&[u8]]) -> Vec<SseFrame> {
        let mut parser = SseParser::new();
        let mut frames = Vec::new();
        for chunk in chunks {
            frames.extend(parser.feed(chunk));
        }
        frames.extend(parser.finish());
        frames
    }

    #[test]
    fn single_data_frame_dispatches_on_blank_line() {
        let frames = parse_all(&[b"data: {\"a\":1}\n\n"]);
        assert_eq!(
            frames,
            vec![SseFrame {
                event: None,
                id: None,
                data: "{\"a\":1}".into(),
            }]
        );
    }

    #[test]
    fn multiline_data_is_joined_with_newlines() {
        let frames = parse_all(&[b"data: {\"jsonrpc\":\ndata: \"2.0\"}\n\n"]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "{\"jsonrpc\":\n\"2.0\"}");
        // The joined payload is still valid JSON (newlines are legal in JSON).
        let _: serde_json::Value = serde_json::from_str(&frames[0].data).unwrap();
    }

    #[test]
    fn comment_keep_alive_lines_are_ignored() {
        let frames = parse_all(&[b": keep-alive\n\n: another\ndata: x\n\n"]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "x");
    }

    #[test]
    fn event_and_id_fields_are_surfaced_but_not_routing() {
        let frames = parse_all(&[b"event: message\nid: 42\ndata: y\n\n"]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].event.as_deref(), Some("message"));
        assert_eq!(frames[0].id.as_deref(), Some("42"));
    }

    #[test]
    fn crlf_and_split_chunks_are_handled() {
        let frames = parse_all(&[b"data: {\"a\"", b":1}\r", b"\n\r\n"]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "{\"a\":1}");
    }

    #[test]
    fn frame_without_trailing_blank_line_is_flushed_at_eof() {
        let frames = parse_all(&[b"data: tail"]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "tail");
    }

    #[test]
    fn frame_with_only_comments_and_blank_lines_dispatches_nothing() {
        let frames = parse_all(&[b": ping\n\n\n"]);
        assert!(frames.is_empty());
    }

    #[test]
    fn data_line_without_space_after_colon_is_accepted() {
        let frames = parse_all(&[b"data:nospace\n\n"]);
        assert_eq!(frames[0].data, "nospace");
    }

    #[test]
    fn retry_field_does_not_create_a_frame() {
        let frames = parse_all(&[b"retry: 5000\ndata: z\n\n"]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "z");
    }
}
