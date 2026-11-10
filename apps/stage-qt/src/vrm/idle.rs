// SPDX-License-Identifier: GPL-3.0-or-later

//! Procedural idle motion: breathing, torso sway, autonomous blink,
//! arm A-pose relaxation.
//!
//! VRM binaries ship no animation clips; the Unity sidecar uses motion files
//! for expressive idle, but v1 here is purely procedural (deterministic,
//! `dt`-integrated, no allocations in `tick`).

use std::collections::HashMap;

/// Idle engine state.
#[derive(Debug)]
pub struct IdleController {
    /// Elapsed time (seconds).
    t: f32,
    /// Time until next blink.
    blink_timer: f32,
    /// Current blink weight [0,1] (1 = fully closed).
    blink_weight: f32,
    /// Blink velocity phase.
    blink_phase: BlinkPhase,
    /// Phase accumulator for breathing.
    breath_phase: f32,
    /// Per-bone map (bone name → weight/role).
    #[allow(dead_code)]
    bones: HashMap<String, f32>,
}

/// Blink state-machine phase.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BlinkPhase {
    /// Eyes open, waiting for next blink.
    Open,
    /// Closing (fast).
    Closing,
    /// Closed dwell.
    Closed,
    /// Opening.
    Opening,
}

impl Default for IdleController {
    fn default() -> Self {
        Self {
            t: 0.0,
            blink_timer: 2.5,
            blink_weight: 0.0,
            blink_phase: BlinkPhase::Open,
            breath_phase: 0.0,
            bones: HashMap::new(),
        }
    }
}

impl IdleController {
    /// Advance the simulation by `dt` seconds.
    pub fn tick(&mut self, dt: f32) {
        self.t += dt;
        self.breath_phase += dt * (2.0 * std::f32::consts::PI / 4.0); // ~4 s breath
        self.update_blink(dt);
    }

    /// Blink state machine (random 2–6 s interval, ~150 ms close/open).
    fn update_blink(&mut self, dt: f32) {
        match self.blink_phase {
            BlinkPhase::Open => {
                self.blink_weight = 0.0;
                self.blink_timer -= dt;
                if self.blink_timer <= 0.0 {
                    self.blink_phase = BlinkPhase::Closing;
                }
            }
            BlinkPhase::Closing => {
                self.blink_weight = (self.blink_weight + dt / 0.075).min(1.0);
                if self.blink_weight >= 1.0 {
                    self.blink_phase = BlinkPhase::Closed;
                }
            }
            BlinkPhase::Closed => {
                self.blink_weight = 1.0;
                self.blink_phase = BlinkPhase::Opening;
            }
            BlinkPhase::Opening => {
                self.blink_weight = (self.blink_weight - dt / 0.075).max(0.0);
                if self.blink_weight <= 0.0 {
                    self.blink_phase = BlinkPhase::Open;
                    // Random 2–6 s until the next blink.
                    self.blink_timer = 2.0 + (self.t.fract() * 4.0);
                }
            }
        }
    }

    /// Chest breathing scale factor (subtle, ±2%).
    pub fn breath_scale(&self) -> f32 {
        1.0 + 0.02 * (self.breath_phase / 2.0).sin().abs()
    }

    /// Torso sway yaw in degrees (slow, small).
    pub fn sway_yaw(&self) -> f32 {
        2.0 * (self.breath_phase * 0.5).sin()
    }

    /// Current eyelid weight (drives the `blink` morph preset).
    pub fn blink_weight(&self) -> f32 {
        self.blink_weight
    }

    /// Arm relaxation: static A-pose pull-in factor (0.15 rad).
    pub fn arm_relax(&self) -> f32 {
        0.15
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blink_cycles() {
        let mut idle = IdleController::default();
        let mut saw_closed = false;
        for _ in 0..(60 * 12) {
            idle.tick(1.0 / 60.0);
            if idle.blink_weight() > 0.9 {
                saw_closed = true;
                break;
            }
        }
        assert!(saw_closed, "blink should close at least once in 12 s");
    }

    #[test]
    fn breath_stays_bounded() {
        let mut idle = IdleController::default();
        for _ in 0..(60 * 10) {
            idle.tick(1.0 / 60.0);
            let b = idle.breath_scale();
            assert!((0.97..=1.03).contains(&b));
        }
    }
}
