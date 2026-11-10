// SPDX-License-Identifier: GPL-3.0-or-later

//! Expression engine.
//!
//! Mirrors the semantics of
//! `packages/stage-ui-three/src/composables/vrm/expression.ts`
//! (`useVRMEmote`):
//! - ease-in-out-cubic interpolation over `durationMs` (default 500),
//! - previously-managed expressions fade out additively on emotion switch,
//! - unmanaged morphs (blink, lip-sync) are NEVER zeroed,
//! - applied weight = value × clamped intensity.

use std::collections::{HashMap, HashSet};

/// Expression (emotion) definitions: name → (preset → weight) map.
pub type EmotionMap = HashMap<String, HashMap<String, f32>>;

/// One in-flight transition.
#[derive(Debug)]
struct Transition {
    /// Start weights (per preset).
    from: HashMap<String, f32>,
    /// Target weights.
    to: HashMap<String, f32>,
    /// Elapsed seconds.
    elapsed: f32,
    /// Total duration seconds.
    duration: f32,
}

/// Expression engine state.
#[derive(Debug, Default)]
pub struct ExpressionEngine {
    /// Emotion definitions (preset-style presets registered from the document).
    emotions: EmotionMap,
    /// Currently active emotion name (if any).
    current: Option<String>,
    /// Presets managed by the current emotion.
    managed: HashSet<String>,
    /// Presets managed by the previous emotion (fading out).
    fading: HashSet<String>,
    /// Transition in flight.
    transition: Option<Transition>,
    /// Current per-preset weights (result of the last `tick`).
    weights: HashMap<String, f32>,
    /// Intensity multiplier [0,1].
    intensity: f32,
}

impl ExpressionEngine {
    /// Create an engine with the given emotion definitions.
    pub fn new(emotions: EmotionMap) -> Self {
        Self {
            emotions,
            current: None,
            managed: HashSet::new(),
            fading: HashSet::new(),
            transition: None,
            weights: HashMap::new(),
            intensity: 1.0,
        }
    }

    /// Trigger an emotion by name with an intensity and optional duration.
    ///
    /// Mirrors `setEmotion(name, intensity, durationMs)` in the reference:
    /// ease-in-out-cubic interpolation from current weights to targets.
    pub fn set_emotion(&mut self, name: &str, intensity: f32, duration_ms: Option<u32>) {
        let intensity = intensity.clamp(0.0, 1.0);
        let Some(def) = self.emotions.get(name) else {
            // Unknown emotion (e.g. AIRI sends "neutral" presets not in the
            // VRM) → clear managed presets instead of erroring.
            self.clear_managed();
            self.current = Some(name.to_string());
            return;
        };
        let target: HashMap<String, f32> = def
            .iter()
            .map(|(p, w)| (p.clone(), (w * intensity).clamp(0.0, 1.0)))
            .collect();
        self.begin_transition(target, duration_ms.unwrap_or(500), intensity);
        self.current = Some(name.to_string());
        self.intensity = intensity;
    }

    /// Clear the managed expression (fade previously managed to zero).
    pub fn clear_managed(&mut self) {
        self.begin_transition(HashMap::new(), 500, 0.0);
        self.current = None;
        self.intensity = 0.0;
    }

    /// Begin a transition from current weights to `to`.
    fn begin_transition(&mut self, to: HashMap<String, f32>, duration_ms: u32, _intensity: f32) {
        // Only managed presets (current + previous) participate in the
        // transition; external presets (blink/lipsync) are excluded so the
        // TS-reference invariant "never zero unmanaged morphs" holds.
        let mut relevant: HashSet<String> = self.managed.clone();
        relevant.extend(self.fading.iter().cloned());
        relevant.extend(to.keys().cloned());
        let from: HashMap<String, f32> = self
            .weights
            .iter()
            .filter(|(p, _)| relevant.contains(*p))
            .map(|(p, w)| (p.clone(), *w))
            .collect();
        self.fading = self.managed.clone();
        self.managed = to.keys().cloned().collect();
        self.transition = Some(Transition {
            from,
            to,
            elapsed: 0.0,
            duration: (duration_ms as f32 / 1000.0).max(0.001),
        });
    }

    /// Advance by `dt` seconds; returns the current weight map.
    pub fn tick(&mut self, dt: f32) -> &HashMap<String, f32> {
        if let Some(tr) = &mut self.transition {
            tr.elapsed += dt;
            let t = (tr.elapsed / tr.duration).min(1.0);
            let e = ease_in_out_cubic(t);
            // Write interpolated weights for all presets touched by `from`
            // or `to`; leave everything else untouched (blink/lipsync live
            // outside this engine and are never zeroed here).
            for (p, &to_w) in &tr.to {
                let from_w = tr.from.get(p).copied().unwrap_or(0.0);
                self.weights.insert(p.clone(), from_w + (to_w - from_w) * e);
            }
            for p in tr.from.keys() {
                if !tr.to.contains_key(p) {
                    let from_w = tr.from[p];
                    self.weights.insert(p.clone(), from_w * (1.0 - e));
                }
            }
            if t >= 1.0 {
                self.transition = None;
            }
        }
        &self.weights
    }

    /// Update the intensity multiplier mid-transition (mirrors
    /// `updateIntensity` in the reference).
    pub fn update_intensity(&mut self, intensity: f32) {
        self.intensity = intensity.clamp(0.0, 1.0);
        for (p, w) in &mut self.weights {
            if self.managed.contains(p) {
                *w *= self.intensity;
            }
        }
    }

    /// Current weight for a preset (0.0 if absent).
    pub fn weight(&self, preset: &str) -> f32 {
        self.weights.get(preset).copied().unwrap_or(0.0)
    }

    /// Register computed weights for presets this engine does not manage
    /// (blink, lip-sync) so the caller can merge everything.
    pub fn apply_external(&mut self, preset: &str, weight: f32) {
        if !self.managed.contains(preset) {
            self.weights.insert(preset.to_string(), weight);
        }
    }
}

/// Ease-in-out-cubic (matches the TS reference).
pub fn ease_in_out_cubic(t: f32) -> f32 {
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> ExpressionEngine {
        let mut emotions = EmotionMap::new();
        emotions.insert(
            "happy".into(),
            [("happy".to_string(), 0.8), ("mouth_smile".to_string(), 0.7)]
                .into_iter()
                .collect(),
        );
        emotions.insert(
            "angry".into(),
            [("angry".to_string(), 0.9)].into_iter().collect(),
        );
        ExpressionEngine::new(emotions)
    }

    #[test]
    fn reaches_targets() {
        let mut e = engine();
        e.set_emotion("happy", 1.0, Some(500));
        for _ in 0..60 {
            e.tick(1.0 / 60.0);
        }
        assert!((e.weight("happy") - 0.8).abs() < 1e-3);
        assert!((e.weight("mouth_smile") - 0.7).abs() < 1e-3);
    }

    #[test]
    fn switch_fades_previous_out() {
        let mut e = engine();
        e.set_emotion("happy", 1.0, Some(200));
        for _ in 0..30 {
            e.tick(1.0 / 60.0);
        }
        e.set_emotion("angry", 1.0, Some(200));
        for _ in 0..30 {
            e.tick(1.0 / 60.0);
        }
        assert!(e.weight("happy") < 0.01);
        assert!((e.weight("angry") - 0.9).abs() < 1e-3);
    }

    #[test]
    fn external_presets_untouched_by_switch() {
        let mut e = engine();
        e.apply_external("blink", 1.0);
        e.set_emotion("happy", 1.0, Some(100));
        for _ in 0..20 {
            e.tick(1.0 / 60.0);
        }
        assert!((e.weight("blink") - 1.0).abs() < 1e-6);
    }
}
