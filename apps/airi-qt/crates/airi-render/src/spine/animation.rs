// SPDX-License-Identifier: GPL-3.0-or-later
//! Animation-track conventions and name resolution for spine models.
//!
//! Direct port of the semantics in
//! `packages/stage-ui-spine/src/composables/spine/animation-manager.ts`
//! and `constants/emotions.ts`: track 0 is the persistent looping idle,
//! track 1 layers one-shot
//! emotion animations over it; names are resolved case-insensitively with
//! substring fallbacks; a generic `idle` request falls back to any
//! `idle`/`stand` animation, then to the first available animation.

/// Track reserved for the persistent idle/state loop.
pub const IDLE_TRACK: usize = 0;
/// Track reserved for one-shot emotion animations layered over the idle.
pub const EMOTION_TRACK: usize = 1;
/// Default mix duration in seconds (Vue `defaultMixDuration` / `defaultMix`).
pub const DEFAULT_MIX_SECONDS: f32 = 0.2;

/// Resolve a preferred animation name against the available names.
///
/// Order (mirrors `useSpineAnimationManager().resolveAnimation`):
/// 1. exact match, 2. case-insensitive exact, 3. name contains preferred,
/// 4. preferred contains name.
pub fn resolve_animation(available: &[String], preferred: &str) -> Option<String> {
    if available.is_empty() {
        return None;
    }
    if let Some(exact) = available.iter().find(|name| *name == preferred) {
        return Some(exact.clone());
    }
    let lower = preferred.to_lowercase();
    if let Some(ci) = available.iter().find(|name| name.to_lowercase() == lower) {
        return Some(ci.clone());
    }
    if let Some(contains) = available
        .iter()
        .find(|name| name.to_lowercase().contains(&lower))
    {
        return Some(contains.clone());
    }
    if let Some(reverse) = available
        .iter()
        .find(|name| lower.contains(&name.to_lowercase()))
    {
        return Some(reverse.clone());
    }
    None
}

/// Pick the animation to play for an idle request: the resolved name when it
/// is a reasonable idle match, otherwise the best available idle/stand, then
/// the first animation (matches `setIdle` fallback).
pub fn resolve_idle(available: &[String], preferred: &str) -> Option<String> {
    if available.is_empty() {
        return None;
    }
    let requested = preferred.to_lowercase();
    let resolved = resolve_animation(available, preferred);
    let generic_idle = requested == "idle";
    let resolved_non_idle = resolved
        .as_deref()
        .map(|name| {
            let lower = name.to_lowercase();
            !lower.contains("idle") && !lower.contains("stand")
        })
        .unwrap_or(true);

    if resolved.is_none() || generic_idle || resolved_non_idle {
        let best = available
            .iter()
            .find(|name| name.to_lowercase().contains("idle"))
            .or_else(|| {
                available
                    .iter()
                    .find(|name| name.to_lowercase().contains("stand"))
            })
            .or_else(|| available.first());
        return best.cloned();
    }
    resolved
}

/// Find the first `hit_*` animation (used by the poke gesture).
pub fn find_hit_animation(available: &[String]) -> Option<String> {
    available
        .iter()
        .find(|name| name.to_lowercase().starts_with("hit_"))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> Vec<String> {
        vec![
            "idle".to_string(),
            "walk".to_string(),
            "hit_body".to_string(),
            "celebrate".to_string(),
        ]
    }

    #[test]
    fn resolve_exact_ci_and_substring() {
        let available = names();
        assert_eq!(
            resolve_animation(&available, "idle").as_deref(),
            Some("idle")
        );
        assert_eq!(
            resolve_animation(&available, "IDLE").as_deref(),
            Some("idle")
        );
        assert_eq!(
            resolve_animation(&available, "walk").as_deref(),
            Some("walk")
        );
        assert_eq!(
            resolve_animation(&available, "alk").as_deref(),
            Some("walk")
        );
        assert_eq!(
            resolve_animation(&available, "xwalkx").as_deref(),
            Some("walk")
        );
        assert_eq!(resolve_animation(&available, "nope").as_deref(), None);
    }

    #[test]
    fn idle_fallback_prefers_idle_then_stand_then_first() {
        let available = names();
        assert_eq!(
            resolve_idle(&available, "celebrate").as_deref(),
            Some("idle")
        );
        assert_eq!(resolve_idle(&available, "idle").as_deref(), Some("idle"));

        let stand_only = vec!["stand".to_string(), "walk".to_string()];
        assert_eq!(
            resolve_idle(&stand_only, "celebrate").as_deref(),
            Some("stand")
        );

        let single = vec!["jump".to_string()];
        assert_eq!(resolve_idle(&single, "celebrate").as_deref(), Some("jump"));
    }

    #[test]
    fn hit_animation_found() {
        assert_eq!(find_hit_animation(&names()).as_deref(), Some("hit_body"));
        assert_eq!(find_hit_animation(&["idle".to_string()]).as_deref(), None);
    }
}
