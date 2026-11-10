// SPDX-License-Identifier: GPL-3.0-or-later

//! stage protocol (WebSocket JSONL) client.
//!
//! Mirrors the contract implemented by the AIRI main process server in
//! `apps/stage-tamagotchi/src/main/services/airi/stage-mate/index.ts` and the
//! Unity definitions in
//! `apps/stage-mate/unity-src/Assets/StageMate/Core/StageMateProtocol.cs`.

pub mod socket;

use serde::{Deserialize, Serialize};

/// Envelope: `{ "type": string, "data": object }`. Some Unity messages send
/// `payload` instead of `data`; we accept both on inbound messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireMessage {
    /// Message type literal, e.g. `stage:vrm:load`.
    pub r#type: String,
    /// Payload object (or null).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Alternate payload key used by some Unity messages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

impl WireMessage {
    /// Effective payload, preferring `data` (production server key).
    pub fn effective_data(&self) -> Option<&serde_json::Value> {
        self.data.as_ref().or(self.payload.as_ref())
    }

    /// Build an outbound message.
    pub fn new(r#type: &str, data: serde_json::Value) -> Self {
        Self {
            r#type: r#type.to_string(),
            data: Some(data),
            payload: None,
        }
    }
}

/// Inbound: `stage:state:sync` data block.
#[derive(Debug, Clone, Deserialize)]
pub struct StateSync {
    /// Window bounds snapshot.
    #[serde(default)]
    pub window: WindowBounds,
    /// Active model (present when the stage has one).
    #[serde(default)]
    pub model: Option<ModelRef>,
    /// Model placement.
    #[serde(default)]
    pub positioning: Option<Positioning>,
    /// Viewport mode block.
    #[serde(default)]
    pub viewport: Option<ViewportBlock>,
    /// Stage visibility block.
    #[serde(default)]
    pub stage: Option<StageBlock>,
}

/// Window bounds as sent in `stage:state:sync` / `stage:window:bounds`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct WindowBounds {
    /// X position.
    pub x: i32,
    /// Y position.
    pub y: i32,
    /// Width.
    pub width: i32,
    /// Height.
    pub height: i32,
    /// Whether the desktop window should stay on top.
    #[serde(default)]
    pub always_on_top: bool,
}

/// Active model reference.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelRef {
    /// Model identifier.
    #[serde(default)]
    pub model_id: String,
    /// Filesystem path of the `.vrm` binary.
    #[serde(default)]
    pub model_path: String,
}

/// Model placement (screen-space positioning from the AIRI stage).
#[derive(Debug, Clone, Deserialize)]
pub struct Positioning {
    /// X (screen space / normalized per StageMate semantics).
    pub x: f32,
    /// Y.
    pub y: f32,
    /// Scale.
    #[serde(default)]
    pub scale: Option<f32>,
}

/// Viewport block.
#[derive(Debug, Clone, Deserialize)]
pub struct ViewportBlock {
    /// Current viewport mode string.
    #[serde(default)]
    pub mode: String,
}

/// Stage visibility block.
#[derive(Debug, Clone, Deserialize)]
pub struct StageBlock {
    /// Whether the stage is enabled/visible.
    #[serde(default)]
    pub enabled: bool,
}
