// SPDX-License-Identifier: GPL-3.0-or-later

//! Stub client for providers that are not chat-ready yet.
//!
//! Used for registry rows whose wire is not (or not yet) implemented:
//! AWS Bedrock (SigV4), on-device engines (Laya, OpenJev), and the TypeSafe
//! System-1 decision engine. `build_client` succeeds so the UI can render the
//! row with its declared credential schema; `models()` and `stream()` return
//! [`LlmError::UnsupportedProvider`] describing exactly what is missing.
//! Nothing here fakes a wire protocol.

use async_trait::async_trait;

use crate::registry::ProviderDef;
use crate::types::{ChatRequest, ModelInfo};
use crate::{ChatProvider, ChatStream, LlmError};

/// Placeholder provider that always reports itself unsupported.
pub struct UnsupportedChatClient {
    id: String,
    reason: String,
}

impl UnsupportedChatClient {
    /// Create the stub from a registry row; the reason comes from `compat.note`.
    pub fn new(def: &ProviderDef) -> Self {
        Self {
            id: def.id.to_owned(),
            reason: def
                .compat
                .note
                .map(str::to_owned)
                .unwrap_or_else(|| "no chat client wired yet".to_owned()),
        }
    }
}

#[async_trait]
impl ChatProvider for UnsupportedChatClient {
    fn id(&self) -> &str {
        &self.id
    }

    async fn models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        Err(LlmError::UnsupportedProvider(format!(
            "{}: {}",
            self.id, self.reason
        )))
    }

    async fn stream(&self, _req: ChatRequest) -> Result<ChatStream, LlmError> {
        Err(LlmError::UnsupportedProvider(format!(
            "{}: {}",
            self.id, self.reason
        )))
    }
}
