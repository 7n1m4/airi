// SPDX-License-Identifier: GPL-3.0-or-later

//! Lip-sync driver: speech `rms` → `aa` vowel morph weight.
//!
//! Mirrors the Unity sidecar's lip-sync smoothing: fast attack, exponential
//! decay (~120 ms), clamped [0,1]. The `aa` weight is fed into the expression
//! engine as an unmanaged preset (see [`super::expression`]).

/// Lip-sync state.
#[derive(Debug, Default)]
pub struct LipSync {
    /// Current smoothed weight.
    weight: f32,
    /// Latest incoming rms.
    rms: f32,
}

impl LipSync {
    /// Start with zero weight.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a new rms sample (from `stage:vrm:lip-sync`).
    pub fn set_rms(&mut self, rms: f32) {
        self.rms = rms.clamp(0.0, 1.0);
    }

    /// Advance by `dt` seconds → current `aa` weight.
    pub fn tick(&mut self, dt: f32) -> f32 {
        // Attack: snap up quickly toward rms; decay: exponential ~120 ms.
        if self.rms > self.weight {
            self.weight = self.rms;
        } else {
            self.weight = (self.weight - dt / 0.120).max(self.rms);
        }
        self.weight.clamp(0.0, 1.0)
    }

    /// Current weight (no tick).
    pub fn weight(&self) -> f32 {
        self.weight
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_decays_to_zero() {
        let mut l = LipSync::new();
        l.set_rms(1.0);
        l.tick(0.016);
        assert!(l.weight() > 0.9);
        l.set_rms(0.0);
        for _ in 0..60 {
            l.tick(0.016);
        }
        assert!(l.weight() < 0.05);
    }

    #[test]
    fn attack_is_fast() {
        let mut l = LipSync::new();
        l.set_rms(0.8);
        l.tick(0.016);
        assert!(l.weight() > 0.7);
    }
}
