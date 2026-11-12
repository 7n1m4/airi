// SPDX-License-Identifier: GPL-3.0-or-later
//! Minimal typed view over a Spine `.json` skeleton.
//!
//! Only the fields AIRI consumes are modeled; everything else is tolerated
//! and ignored. `.skel` binaries are NOT parsed here — they are read by the
//! spine-cpp runtime at load time. JSON is what the parser tests and the
//! smoke asset rely on.

use serde::Deserialize;
use std::collections::BTreeMap;

/// Top-level `skeleton` block.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SkeletonInfo {
    /// Editor version that exported the file, e.g. `"4.2.18"`.
    pub spine: Option<String>,
    /// Content hash (editor-assigned).
    pub hash: Option<String>,
    /// Bounds in skeleton units.
    pub x: Option<f32>,
    /// Bounds y.
    pub y: Option<f32>,
    /// Bounds width.
    pub width: Option<f32>,
    /// Bounds height.
    pub height: Option<f32>,
    /// Authoring frame rate.
    pub fps: Option<f32>,
    /// Relative path the editor wrote textures to.
    pub images: Option<String>,
    /// Relative path the editor wrote audio to.
    pub audio: Option<String>,
}

/// One entry of the `bones` array.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BoneInfo {
    /// Bone name.
    pub name: String,
    /// Parent bone name, `None` for the root.
    pub parent: Option<String>,
}

/// One entry of the `slots` array.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SlotInfo {
    /// Slot name.
    pub name: String,
    /// Bone the slot is attached to.
    pub bone: Option<String>,
    /// Default attachment name, if any.
    pub attachment: Option<String>,
}

/// A skin entry (Spine 4.x: `{name, attachments}` objects in an array).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SkinInfo {
    /// Skin name.
    pub name: String,
}

/// Summary of an animation: its name and a best-effort duration.
#[derive(Debug, Clone, PartialEq)]
pub struct AnimationInfo {
    /// Animation name.
    pub name: String,
    /// Duration in seconds, computed as the greatest `time` value found
    /// anywhere under the animation object. `None` when the animation object
    /// carries no timed keys (e.g. empty animation).
    pub duration: Option<f64>,
}

/// What AIRI needs out of a JSON skeleton without walking the full timeline
/// graph.
#[derive(Debug, Clone, Default)]
pub struct SkeletonSummary {
    /// Top-level `skeleton` block.
    pub info: SkeletonInfo,
    /// Bone names in file order.
    pub bone_names: Vec<String>,
    /// Slot names in file order.
    pub slot_names: Vec<String>,
    /// Skin names in file order.
    pub skin_names: Vec<String>,
    /// Event names declared in the skeleton.
    pub event_names: Vec<String>,
    /// Animations with best-effort durations (JSON object key order, or
    /// sorted order when the `preserve_order` serde feature is off).
    pub animations: Vec<AnimationInfo>,
}

#[derive(Deserialize, Default)]
struct RawSkeleton {
    #[serde(default)]
    skeleton: SkeletonInfo,
    #[serde(default)]
    bones: Vec<RawBone>,
    #[serde(default)]
    slots: Vec<RawSlot>,
    #[serde(default)]
    skins: serde_json::Value,
    #[serde(default)]
    events: serde_json::Value,
    #[serde(default)]
    animations: serde_json::Value,
}

#[derive(Deserialize, Default)]
struct RawBone {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize, Default)]
struct RawSlot {
    #[serde(default)]
    name: String,
}

/// Parse a JSON skeleton into a summary.
pub fn parse_skeleton_json(json: &str) -> anyhow::Result<SkeletonSummary> {
    let raw: RawSkeleton = serde_json::from_str(json)?;

    let bone_names: Vec<String> = raw.bones.into_iter().map(|b| b.name).collect();
    let slot_names: Vec<String> = raw.slots.into_iter().map(|s| s.name).collect();
    let skin_names = parse_skin_names(&raw.skins);
    let event_names = parse_map_keys(&raw.events);

    let animations = parse_animations(&raw.animations);

    Ok(SkeletonSummary {
        info: raw.skeleton,
        bone_names,
        slot_names,
        skin_names,
        event_names,
        animations,
    })
}

/// Spine 4.x writes `skins` as `[{ name, attachments, ... }]`; older exports
/// wrote a `{ name: { attachments } }` map. Both are accepted.
fn parse_skin_names(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get("name")?.as_str().map(str::to_string))
            .collect(),
        serde_json::Value::Object(map) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn parse_map_keys(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::Object(map) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn parse_animations(value: &serde_json::Value) -> Vec<AnimationInfo> {
    let mut animations = Vec::new();
    if let serde_json::Value::Object(map) = value {
        for (name, body) in map {
            animations.push(AnimationInfo {
                name: name.clone(),
                duration: max_time(body),
            });
        }
    }
    animations
}

/// Recursively find the greatest numeric value under any `time` key.
/// Spine timelines carry single numeric `time` values per frame; arrays of
/// numbers are handled too for robustness.
fn max_time(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Object(map) => map.iter().fold(None, |acc, (key, child)| {
            let candidate = if key == "time" {
                time_values(child).into_iter().reduce(f64::max)
            } else {
                None
            };
            let nested = max_time(child);
            [acc, candidate, nested]
                .into_iter()
                .flatten()
                .reduce(f64::max)
        }),
        serde_json::Value::Array(items) => items.iter().fold(None, |acc, child| {
            [acc, max_time(child)]
                .into_iter()
                .flatten()
                .reduce(f64::max)
        }),
        _ => None,
    }
}

/// `time` values in spine animation JSON are single numbers (per keyframe)
/// or, defensively, arrays of numbers.
fn time_values(value: &serde_json::Value) -> Vec<f64> {
    match value {
        serde_json::Value::Number(n) => n.as_f64().into_iter().collect(),
        serde_json::Value::Array(items) => items.iter().filter_map(|i| i.as_f64()).collect(),
        _ => Vec::new(),
    }
}

/// Convenience: collect `(name, duration)` for the animations, with `None`
/// durations rendered as `0.0` (matches the Vue `duration: 0` virtual-motion
/// convention).
pub fn animation_name_durations(summary: &SkeletonSummary) -> BTreeMap<String, f64> {
    summary
        .animations
        .iter()
        .map(|a| (a.name.clone(), a.duration.unwrap_or(0.0)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "skeleton": {
            "hash": "abc123",
            "spine": "4.2.18",
            "x": -100.5,
            "y": -50.25,
            "width": 201,
            "height": 400.5,
            "fps": 30,
            "images": "./images/",
            "audio": "./audio/"
        },
        "bones": [
            { "name": "root" },
            { "name": "hips", "parent": "root" },
            { "name": "head", "parent": "hips" }
        ],
        "slots": [
            { "name": "body", "bone": "hips", "attachment": "body-attachment" },
            { "name": "face", "bone": "head" }
        ],
        "skins": [
            { "name": "default" },
            { "name": "party" }
        ],
        "events": {
            "footstep": {},
            "blink": {}
        },
        "animations": {
            "idle": {
                "bones": {
                    "head": {
                        "rotate": [
                            { "time": 0, "angle": 0 },
                            { "time": 2.5, "angle": 5 }
                        ]
                    }
                }
            },
            "walk": {
                "bones": {
                    "hips": {
                        "translate": [
                            { "time": 0, "x": 0, "y": 0 },
                            { "time": 1.0, "x": 10, "y": 0 }
                        ]
                    }
                }
            },
            "empty": {}
        }
    }"#;

    #[test]
    fn parses_info_and_lists() {
        let summary = parse_skeleton_json(SAMPLE).expect("parse skeleton");
        assert_eq!(summary.info.spine.as_deref(), Some("4.2.18"));
        assert_eq!(summary.info.fps, Some(30.0));
        assert!((summary.info.width.unwrap() - 201.0).abs() < 1e-6);
        assert_eq!(summary.bone_names, vec!["root", "hips", "head"]);
        assert_eq!(summary.slot_names, vec!["body", "face"]);
        assert_eq!(summary.skin_names, vec!["default", "party"]);
        // serde_json object keys iterate in sorted order
        assert_eq!(summary.event_names, vec!["blink", "footstep"]);
    }

    #[test]
    fn animation_durations_best_effort() {
        let summary = parse_skeleton_json(SAMPLE).expect("parse skeleton");
        let durations = animation_name_durations(&summary);
        assert_eq!(durations.get("idle"), Some(&2.5));
        assert_eq!(durations.get("walk"), Some(&1.0));
        assert_eq!(durations.get("empty"), Some(&0.0));
    }

    #[test]
    fn legacy_object_skins_accepted() {
        let json =
            r#"{"skeleton": {}, "skins": {"default": {"attachments": {}}, "expressive": {}}}"#;
        let summary = parse_skeleton_json(json).expect("parse");
        assert_eq!(summary.skin_names, vec!["default", "expressive"]);
    }

    #[test]
    fn tolerates_missing_sections() {
        let summary = parse_skeleton_json(r#"{"skeleton": {"spine": "4.1.0"}}"#).expect("parse");
        assert_eq!(summary.bone_names.len(), 0);
        assert_eq!(summary.animations.len(), 0);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_skeleton_json("nope").is_err());
    }
}
