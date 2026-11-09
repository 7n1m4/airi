// SPDX-License-Identifier: GPL-3.0-or-later

//! Gaze controller: mouse telemetry → head/eye rotation.
//!
//! Mirrors the Unity tactile handler: maps screen-space mouse coordinates
//! (normalized by `monitorWidth`/`monitorHeight`) to a clamped head yaw/pitch
//! (±30°) plus eye offsets. v1 is saccade-free (smooth target).

/// Gaze state.
#[derive(Debug, Default)]
pub struct GazeController {
    /// Target yaw (degrees, + = right).
    target_yaw: f32,
    /// Target pitch (degrees, + = down).
    target_pitch: f32,
    /// Smoothed yaw.
    yaw: f32,
    /// Smoothed pitch.
    pitch: f32,
}

impl GazeController {
    /// Start looking forward.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a `stage:control:mouse` payload.
    pub fn set_mouse(&mut self, x: f32, y: f32, monitor_w: f32, monitor_h: f32) {
        // Normalize to [-1, 1] around the monitor center.
        let nx = (x / monitor_w.max(1.0) - 0.5) * 2.0;
        let ny = (y / monitor_h.max(1.0) - 0.5) * 2.0;
        self.target_yaw = (nx * 30.0).clamp(-30.0, 30.0);
        self.target_pitch = (ny * 30.0).clamp(-30.0, 30.0);
    }

    /// Advance by `dt` seconds; returns (yaw, pitch) in degrees.
    pub fn tick(&mut self, dt: f32) -> (f32, f32) {
        // Critically-damped-ish smoothing (8 Hz bandwidth).
        let k = 1.0 - (-dt * 8.0).exp();
        self.yaw += (self.target_yaw - self.yaw) * k;
        self.pitch += (self.target_pitch - self.pitch) * k;
        (self.yaw, self.pitch)
    }

    /// Eye offsets (normalized [-1,1] from smoothed yaw/pitch).
    pub fn eye_offsets(&self) -> (f32, f32) {
        (self.yaw / 30.0, self.pitch / 30.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn center_is_forward() {
        let mut g = GazeController::new();
        g.set_mouse(960.0, 540.0, 1920.0, 1080.0);
        let (y, p) = g.tick(1.0);
        assert!(y.abs() < 1e-3 && p.abs() < 1e-3);
    }

    #[test]
    fn corners_clamp() {
        let mut g = GazeController::new();
        g.set_mouse(0.0, 0.0, 1920.0, 1080.0);
        let (y, p) = g.tick(1.0);
        assert!(y.abs() <= 30.0 && p.abs() <= 30.0);
        assert!(y < -25.0 && p < -25.0);
    }
}
