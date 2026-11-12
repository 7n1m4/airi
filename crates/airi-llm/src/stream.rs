// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared byte-stream → [`ChatStream`] pump.

use futures_util::StreamExt as _;

use crate::sse::{SseItem, SseParser};
use crate::types::ChatChunk;
use crate::{ChatStream, LlmError};

/// Map one SSE `data:` payload to an optional chunk.
///
/// `Ok(None)` skips the frame (pings, content-block starts, ...).
/// `Err(..)` is yielded as a single stream item and terminates the stream.
pub(crate) type PayloadMapper = dyn FnMut(&str) -> Result<Option<ChatChunk>, LlmError> + Send;

/// Consume a streaming (`text/event-stream`) response body into a [`ChatStream`].
pub(crate) fn sse_chat_stream(resp: reqwest::Response, mut map: Box<PayloadMapper>) -> ChatStream {
    Box::pin(async_stream::stream! {
        let mut parser = SseParser::new();
        let mut body = resp.bytes_stream();
        'outer: while let Some(chunk) = body.next().await {
            match chunk {
                Ok(bytes) => {
                    for item in parser.feed(&bytes) {
                        match item {
                            SseItem::Done => break 'outer,
                            SseItem::Data(payload) => match map(&payload) {
                                Ok(Some(c)) => yield Ok(c),
                                Ok(None) => {}
                                Err(e) => {
                                    yield Err(e);
                                    return;
                                }
                            },
                        }
                    }
                }
                Err(e) => {
                    yield Err(LlmError::Transport(e));
                    return;
                }
            }
        }
        // Flush a trailing unterminated line, if any.
        for item in parser.finish() {
            if let SseItem::Data(payload) = item {
                match map(&payload) {
                    Ok(Some(c)) => yield Ok(c),
                    Ok(None) => {}
                    Err(e) => yield Err(e),
                }
            }
        }
    })
}
