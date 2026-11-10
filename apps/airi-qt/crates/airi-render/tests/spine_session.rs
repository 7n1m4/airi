// SPDX-License-Identifier: GPL-3.0-or-later
//! End-to-end test of the vendored spine-cpp runtime through the C ABI shell.
//!
//! Builds a synthetic skeleton fully in memory (no disk assets, no GL), loads
//! it, ticks the animation state and inspects the serialized draw commands.

use airi_render::spine::{DrawGroup, SpineSession};

const ATLAS: &str =
    "synthetic.png\nsize:32,32\nformat:RGBA8888\nfilter:Nearest,Nearest\nbody\nbounds:0,0,32,32\n";

const SKELETON_JSON: &str = r#"{
    "skeleton": {
        "hash": "synthetic-p4",
        "spine": "4.2.18",
        "x": -16,
        "y": -16,
        "width": 32,
        "height": 32,
        "fps": 30,
        "images": "./",
        "audio": ""
    },
    "bones": [
        { "name": "root" }
    ],
    "slots": [
        { "name": "body", "bone": "root", "attachment": "body" }
    ],
    "skins": [
        {
            "name": "default",
            "attachments": {
                "body": {
                    "body": { "width": 32, "height": 32, "x": 0, "y": 0 }
                }
            }
        }
    ],
    "animations": {
        "idle": {
            "bones": {
                "root": {
                    "rotate": [
                        { "time": 0, "value": 0 },
                        { "time": 1, "value": 10 },
                        { "time": 2, "value": 0 }
                    ]
                }
            }
        },
        "hit_body": {
            "bones": {
                "root": {
                    "scale": [
                        { "time": 0, "x": 1, "y": 1 },
                        { "time": 0.2, "x": 0.8, "y": 1.2 },
                        { "time": 0.5, "x": 1, "y": 1 }
                    ]
                }
            }
        }
    }
}"#;

#[test]
fn ffi_session_loads_ticks_and_serializes() {
    let session = SpineSession::load(SKELETON_JSON.as_bytes(), false, ATLAS)
        .expect("synthetic skeleton should load");

    assert_eq!(session.version(), "4.2.18");
    let bounds = session.bounds();
    assert_eq!((bounds.width, bounds.height), (32.0, 32.0));

    let animations: Vec<String> = session.animations().into_iter().map(|(n, _)| n).collect();
    assert!(animations.contains(&"idle".to_string()));
    assert!(animations.contains(&"hit_body".to_string()));
    assert_eq!(session.skins(), vec!["default".to_string()]);

    let pages = session.pages();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].image, "synthetic.png");

    assert!(session.set_animation(0, "idle", true));
    assert!(!session.set_animation(0, "does-not-exist", false));

    // Tick 1s at 60fps; the pose must change.
    let before = session.collect_draws();
    for _ in 0..60 {
        session.update(1.0 / 60.0);
    }
    let after = session.collect_draws();

    assert!(
        !before.vertices.is_empty(),
        "expected vertices in first frame"
    );
    assert!(!after.indices.is_empty());
    assert_eq!(after.draws.len(), 1, "one region attachment on track 0");
    let DrawGroup {
        page_index,
        blend_mode,
        alpha,
        vertex_count,
        index_count,
        ..
    } = after.draws[0];
    assert_eq!(page_index, 0);
    assert_eq!(blend_mode, 0);
    assert!(alpha > 0.99);
    assert_eq!(vertex_count, 4);
    assert_eq!(index_count, 6);

    let moved = before
        .vertices
        .iter()
        .zip(after.vertices.iter())
        .any(|(a, b)| (a.x - b.x).abs() > 1e-4 || (a.y - b.y).abs() > 1e-4);
    assert!(
        moved,
        "skeleton should pose differently after 1s of idle animation"
    );
}

#[test]
fn ffi_session_reports_errors_cleanly() {
    // NB: spine-cpp's JSON parser is assert-driven on malformed bytes (in
    // debug builds), so exercise the graceful error path instead: a
    // semantic rejection (editor version mismatch) surfaces as a readable
    // error without tripping the parser assert.
    let wrong_version = r#"{"skeleton": {"spine": "4.1.0"}, "bones": [{"name": "root"}]}"#;
    let err = SpineSession::load(wrong_version.as_bytes(), false, ATLAS);
    let message = err.map(|_| String::new()).unwrap_err().to_string();
    assert!(
        message.contains("spine load failed"),
        "unexpected error: {message}"
    );
    assert!(
        message.contains("does not match"),
        "unexpected error: {message}"
    );
}
