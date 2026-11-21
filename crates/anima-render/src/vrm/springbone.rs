// SPDX-License-Identifier: GPL-3.0-or-later

//! Verlet-integrated springbone chains (hair/skirt).
//!
//! Semi-implicit Euler (position-Verlet) per the VRM 0.x/1.0 springbone
//! specs: gravity + stiffness + drag, head-sphere collider in v1. Operates in
//! the parent bone's local space so it composes with the skinning tree.

/// One spring joint's pin position (parent-space offset from rest).
#[derive(Debug, Clone, Copy)]
pub struct SpringPoint {
    /// Current position.
    pub pos: [f32; 3],
    /// Previous position (for Verlet velocity).
    pub prev: [f32; 3],
}

/// One spring chain (converted from VRM 0.x `SpringGroup0` or 1.0 `Spring1`).
#[derive(Debug)]
pub struct SpringChain {
    /// Bone names in chain order (root → tip).
    pub bone_names: Vec<String>,
    /// Per-joint simulation points.
    pub points: Vec<SpringPoint>,
    /// Rest segment length reference.
    pub rest_lengths: Vec<f32>,
    /// Stiffness.
    pub stiffness: f32,
    /// Gravity power.
    pub gravity_power: f32,
    /// Gravity direction.
    pub gravity_dir: [f32; 3],
    /// Drag (velocity damping) [0,1].
    pub drag: f32,
}

impl SpringChain {
    /// Create a chain with `points` pinned at the given offsets.
    pub fn new(
        bone_names: Vec<String>,
        rest_offsets: &[[f32; 3]],
        stiffness: f32,
        gravity_power: f32,
        gravity_dir: [f32; 3],
        drag: f32,
    ) -> Self {
        let points = rest_offsets
            .iter()
            .map(|o| SpringPoint { pos: *o, prev: *o })
            .collect::<Vec<_>>();
        let rest_lengths = rest_offsets.windows(2).map(|w| dist(w[0], w[1])).collect();
        Self {
            bone_names,
            points,
            rest_lengths,
            stiffness,
            gravity_power,
            gravity_dir,
            drag,
        }
    }

    /// Advance the chain by `dt` seconds (parent-local space).
    ///
    /// `head_sphere`: `(center, radius)` collider in the same space; `None`
    /// disables collision.
    pub fn tick(&mut self, dt: f32, head_sphere: Option<([f32; 3], f32)>) {
        if self.points.len() < 2 {
            return;
        }
        let dt2 = dt * dt;
        let root_pos = self.points[0].pos;
        for pt in self.points.iter_mut().skip(1) {
            // Verlet: pos += (pos - prev) * (1 - drag) + accel * dt²
            let vel = sub(pt.pos, pt.prev);
            let damped = scale(vel, (1.0 - self.drag).max(0.0));
            let gravity = scale(self.gravity_dir, -9.81 * self.gravity_power);
            let spring = scale(sub(root_pos, pt.pos), self.stiffness * 0.01);
            let accel = add(gravity, spring);
            pt.prev = pt.pos;
            pt.pos = add(add(pt.pos, damped), scale(accel, dt2));
        }
        // Distance constraints (two passes).
        for _ in 0..2 {
            for i in 1..self.points.len() {
                let rest = self.rest_lengths.get(i - 1).copied().unwrap_or(0.05);
                let a = self.points[i - 1].pos;
                let b = self.points[i].pos;
                let d = sub(b, a);
                let l = len(d).max(1e-6);
                let diff = (l - rest) / l;
                // Move only the child (root is pinned).
                self.points[i].pos = sub(b, scale(d, diff));
            }
        }
        // Head-sphere collider: push points out of the sphere surface.
        if let Some((center, radius)) = head_sphere {
            for pt in self.points.iter_mut().skip(1) {
                let d = sub(pt.pos, center);
                let l = len(d);
                if l < radius && l > 1e-6 {
                    pt.pos = add(center, scale(d, radius / l));
                }
            }
        }
    }
}

/// Engine holding all chains of the avatar.
#[derive(Debug, Default)]
pub struct SpringBoneSim {
    /// Active chains.
    pub chains: Vec<SpringChain>,
}

impl SpringBoneSim {
    /// Create an empty sim.
    pub fn new() -> Self {
        Self::default()
    }

    /// Advance all chains by `dt` seconds.
    pub fn tick(&mut self, dt: f32, head_sphere: Option<([f32; 3], f32)>) {
        for c in &mut self.chains {
            c.tick(dt, head_sphere);
        }
    }

    /// Current offsets of chain `i` (for head/tip rendering).
    pub fn chain_offsets(&self, i: usize) -> Option<[[f32; 3]; 4]> {
        let c = self.chains.get(i)?;
        let p = |k: usize| c.points.get(k).map(|pt| pt.pos).unwrap_or([0.0; 3]);
        Some([p(0), p(1), p(2), p(3)])
    }
}

fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn len(a: [f32; 3]) -> f32 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    len(sub(b, a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_does_not_explode() {
        let mut sim = SpringBoneSim::new();
        sim.chains.push(SpringChain::new(
            vec!["h1".into(), "h2".into(), "h3".into()],
            &[[0.0, 0.0, 0.0], [0.0, -0.05, 0.0], [0.0, -0.1, 0.0]],
            0.1,
            1.0,
            [0.0, -1.0, 0.0],
            0.05,
        ));
        for _ in 0..(60 * 5) {
            sim.tick(1.0 / 60.0, Some(([0.0, 0.02, 0.0], 0.06)));
        }
        let tip = sim.chain_offsets(0).unwrap()[2];
        assert!(tip.iter().all(|v| v.is_finite()));
        assert!(tip[1] < 0.0, "tip should hang below the root");
    }
}
