// SPDX-License-Identifier: GPL-3.0-or-later
//! Round-trip persistence tests for the four settings bridges.
//!
//! Each section is saved through its bridge method, re-read straight from the
//! store, and compared. The store is a temp SQLite file — never the real
//! profile — and each test uses its own file because the bridges share one
//! process-wide store handle (tests that touch it serialize on
//! [`STORE_LOCK`]).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use airi_core::settings::{
    AudioDeviceSettings, CaptionsSettings, ChatSendMode, ChatSettings, ChatSuggestMode,
    GeneralSettings, Live2dSettings, MmdSettings, PositioningSettings, SpineSettings,
    StageModelSettings, StageWindowSettings, UserProfileSettings,
};
use airi_store::Database;

use crate::bridges::{settings_chat, settings_general, settings_sections, settings_stage};

/// Serializes tests that re-register the process-wide settings store.
static STORE_LOCK: Mutex<()> = Mutex::new(());

/// Per-process temp root, unique to this test binary's pid and start time, so
/// repeated runs never share a directory with a previous run.
fn temp_root(tag: &str) -> PathBuf {
    static ROOTS: Mutex<Option<std::collections::HashMap<String, PathBuf>>> = Mutex::new(None);
    let mut guard = ROOTS.lock().unwrap_or_else(|e| e.into_inner());
    let roots = guard.get_or_insert_with(std::collections::HashMap::new);
    roots
        .entry(tag.to_string())
        .or_insert_with(|| {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "airi-settings-bridge-test-{tag}-{}-{nanos}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("create temp root");
            dir
        })
        .clone()
}

/// Build a unique temp path for `name` under the per-process root, keeping any
/// extension at the end so `Path::extension()` sees it (the import validators
/// check it).
fn temp_path(tag: &str, name: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let file_name = match (Path::new(name).file_stem(), Path::new(name).extension()) {
        (Some(stem), Some(ext)) => {
            format!("{}-{n}.{}", stem.to_string_lossy(), ext.to_string_lossy())
        }
        _ => format!("{name}-{n}"),
    };
    temp_root(tag).join(file_name)
}

/// Point the process-wide settings store at a temp database and return its
/// path. The store is a `OnceLock`, so only the first call's database is ever
/// used; every section is therefore cleared here so each test starts from
/// defaults regardless of what an earlier test persisted.
fn register_temp_store(tag: &str) -> PathBuf {
    let path = temp_path(tag, "sqlite");
    let db = Database::open(&path).expect("open temp db");
    let store = airi_core::settings::SettingsStore::new(db, tokio::sync::broadcast::channel(16).0);
    // Clearing before the first registration is harmless (the db is empty),
    // and after it makes the shared store start each test at defaults.
    for key in store.list_keys(None).expect("list keys") {
        let _ = store.delete(&key);
    }
    crate::bridges::set_settings_store(store);
    path
}

/// Read a section straight from the store the bridges use.
fn stored<T: airi_core::settings::SettingsSection>() -> T {
    crate::bridges::settings_store()
        .expect("store registered")
        .load_section::<T>()
        .expect("load section")
}

#[test]
fn general_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("general");

    // An empty store loads the section defaults into the mirror.
    settings_general::with_state(|state| state.load());
    settings_general::with_state(|state| {
        assert!(state.language.is_empty());
        assert!(state.disable_transitions);
        assert!(state.use_page_specific_transitions);
        assert!(!state.remote_sync_enabled);
        assert!(!state.websocket_secure_enabled);
        assert!(!state.autostart);
    });

    settings_general::with_state(|state| {
        assert!(state.save(" ja ", false, true, true, true, true));
        assert_eq!(state.language, "ja");
    });
    settings_general::with_state(|state| state.reload_from_store());
    settings_general::with_state(|state| {
        assert_eq!(state.language, "ja");
        assert!(!state.disable_transitions);
        assert!(state.use_page_specific_transitions);
        assert!(state.remote_sync_enabled);
        assert!(state.websocket_secure_enabled);
        assert!(state.autostart);
    });

    let section: GeneralSettings = stored();
    assert_eq!(section.language, "ja");
    assert!(!section.disable_transitions);
    assert!(section.autostart);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn chat_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("chat");

    settings_chat::with_state(|state| {
        assert!(state.save("ctrl-enter", "disabled", 1_234.6, true, true));
        assert_eq!(state.send_mode, "ctrl-enter");
        assert_eq!(state.suggest_mode, "disabled");
        assert_eq!(state.stream_idle_timeout_ms, 1_235.0);
    });
    settings_chat::with_state(|state| state.reload_from_store());
    settings_chat::with_state(|state| {
        assert_eq!(state.send_mode, "ctrl-enter");
        assert_eq!(state.suggest_mode, "disabled");
        assert_eq!(state.stream_idle_timeout_ms, 1_235.0);
        assert!(state.show_director_notes);
        assert!(state.combine_system_messages);
    });

    let section: ChatSettings = stored();
    assert_eq!(section.send_mode, ChatSendMode::CtrlEnter);
    assert_eq!(section.suggest_mode, ChatSuggestMode::Disabled);
    assert_eq!(section.stream_idle_timeout_ms, 1_235);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn chat_rejects_unknown_wire_modes_and_clamps_timeouts() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("chat-reject");

    settings_chat::with_state(|state| {
        assert!(!state.save("nope", "enter", 0.0, true, false));
        assert!(!state.save("enter", "nope", 0.0, true, false));
    });
    // Rejected saves persist nothing: the section keeps its defaults.
    let section: ChatSettings = stored();
    assert_eq!(section.send_mode, ChatSendMode::Enter);
    assert!(section.send_mode != ChatSendMode::CtrlEnter);

    // Non-finite / negative timeouts fall back to the default.
    settings_chat::with_state(|state| {
        assert!(state.save("enter", "enter", f64::NAN, true, false));
        assert_eq!(state.stream_idle_timeout_ms, 600_000.0);
    });
    settings_chat::with_state(|state| {
        assert!(state.save("enter", "enter", -1.0, false, true));
        assert_eq!(state.stream_idle_timeout_ms, 600_000.0);
    });
    let section: ChatSettings = stored();
    assert_eq!(section.stream_idle_timeout_ms, 600_000);
    assert!(!section.show_director_notes);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn spine_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("spine");

    settings_sections::with_spine_state(|state| {
        assert!(state.save(120, 1.5, 0.3, 2.0, false, -10.0, 20.0, 3.0));
    });
    settings_sections::with_spine_state(|state| state.reload_from_store());
    settings_sections::with_spine_state(|state| {
        assert_eq!(state.max_fps, 120);
        assert_eq!(state.render_scale, 1.5);
        assert_eq!(state.mix_duration, 0.3);
        assert_eq!(state.animation_speed, 2.0);
        assert!(!state.idle_animation_enabled);
        assert_eq!(state.scale_pos_x, -10.0);
        assert_eq!(state.scale_pos_y, 20.0);
        assert_eq!(state.scale_pos_scale, 3.0);
    });

    let section: SpineSettings = stored();
    assert_eq!(section.max_fps, 120);
    assert_eq!(section.scale_pos.y, 20.0);
    assert!(!section.idle_animation_enabled);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn spine_clamps_invalid_input() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("spine-clamp");

    settings_sections::with_spine_state(|state| {
        assert!(state.save(-1, 0.0, f64::NAN, -5.0, true, f64::NAN, 1.0, 0.0));
        assert_eq!(state.max_fps, 0);
        assert_eq!(state.render_scale, 1.0);
        assert_eq!(state.mix_duration, 0.2);
        assert_eq!(state.animation_speed, 1.0);
        assert_eq!(state.scale_pos_x, 0.0);
        assert_eq!(state.scale_pos_scale, 1.0);
    });

    let section: SpineSettings = stored();
    assert_eq!(section.max_fps, 0);
    assert_eq!(section.render_scale, 1.0);
    assert_eq!(section.mix_duration, 0.2);
    assert_eq!(section.animation_speed, 1.0);
    assert_eq!(section.scale_pos.x, 0.0);
    assert_eq!(section.scale_pos.scale, 1.0);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn mmd_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("mmd");

    settings_sections::with_mmd_state(|state| assert!(state.save(false, 2.25)));
    settings_sections::with_mmd_state(|state| state.reload_from_store());
    settings_sections::with_mmd_state(|state| {
        assert!(!state.mmd_idle_animation_enabled);
        assert_eq!(state.mmd_render_scale, 2.25);
    });

    let section: MmdSettings = stored();
    assert_eq!(section.mmd_render_scale, 2.25);
    assert!(!section.mmd_idle_animation_enabled);

    // Non-positive render scale falls back to 1.0.
    settings_sections::with_mmd_state(|state| assert!(state.save(true, 0.0)));
    let section: MmdSettings = stored();
    assert_eq!(section.mmd_render_scale, 1.0);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn live2d_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("live2d");

    settings_sections::with_live2d_state(|state| {
        assert!(state.save(true, 0.75, false, false, true, false, 90));
    });
    settings_sections::with_live2d_state(|state| state.reload_from_store());
    settings_sections::with_live2d_state(|state| {
        assert!(state.live2d_disable_focus);
        assert_eq!(state.live2d_follow_speed, 0.75);
        assert!(!state.live2d_idle_animation_enabled);
        assert!(!state.live2d_auto_blink_enabled);
        assert!(state.live2d_force_auto_blink_enabled);
        assert!(!state.live2d_shadow_enabled);
        assert_eq!(state.live2d_max_fps, 90);
    });

    let section: Live2dSettings = stored();
    assert_eq!(section.live2d_max_fps, 90);
    assert_eq!(section.live2d_follow_speed, 0.75);

    // Follow speed is clamped to 0..=1 and a negative fps floor-clamps to 0.
    settings_sections::with_live2d_state(|state| {
        assert!(state.save(false, 5.0, true, true, false, true, -3));
    });
    let section: Live2dSettings = stored();
    assert_eq!(section.live2d_follow_speed, 1.0);
    assert_eq!(section.live2d_max_fps, 0);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn positioning_placements_round_trip() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("positioning");

    settings_sections::with_positioning_state(|state| {
        assert!(state.save_scale("model-a", 1.0, 2.0, 1.5));
        assert_eq!(state.count, 1);
    });
    settings_sections::with_positioning_state(|state| {
        assert_eq!(
            state.scale_for("model-a"),
            r#"{"scale":1.5,"x":1.0,"y":2.0}"#
        );
    });
    // Unknown ids report the default placement without persisting anything.
    settings_sections::with_positioning_state(|state| {
        assert_eq!(
            state.scale_for("missing"),
            r#"{"scale":1.0,"x":0.0,"y":0.0}"#
        );
    });
    // Empty ids are refused.
    settings_sections::with_positioning_state(|state| {
        assert!(!state.save_scale(" ", 0.0, 0.0, 1.0));
    });

    settings_sections::with_positioning_state(|state| state.reload_from_store());
    settings_sections::with_positioning_state(|state| assert_eq!(state.count, 1));

    let section: PositioningSettings = stored();
    assert_eq!(section.models.len(), 1);
    assert_eq!(section.models["model-a"].x, 1.0);

    settings_sections::with_positioning_state(|state| assert!(state.reset_all()));
    settings_sections::with_positioning_state(|state| assert_eq!(state.count, 0));
    assert!(stored::<PositioningSettings>().models.is_empty());

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn audio_device_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("audio-device");

    settings_sections::with_audio_device_state(|state| {
        assert!(state.save(" mic-1 ", " speakers-2 ", true));
        assert_eq!(state.selected_input_device, " mic-1 ");
        assert_eq!(state.selected_output_device, " speakers-2 ");
        assert!(state.input_enabled);
    });
    settings_sections::with_audio_device_state(|state| state.reload_from_store());
    settings_sections::with_audio_device_state(|state| {
        assert_eq!(state.selected_input_device, " mic-1 ");
        assert!(state.input_enabled);
    });

    let section: AudioDeviceSettings = stored();
    assert_eq!(section.selected_input_device, " mic-1 ");
    assert!(section.input_enabled);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn user_profile_section_round_trips() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("user-profile");

    settings_sections::with_user_profile_state(|state| {
        assert!(state.save("Vi", "creator", "be nice", "voice-7"));
    });
    settings_sections::with_user_profile_state(|state| state.reload_from_store());
    settings_sections::with_user_profile_state(|state| {
        assert_eq!(state.name, "Vi");
        assert_eq!(state.description, "creator");
        assert_eq!(state.prompt, "be nice");
        assert_eq!(state.voice_profile_id, "voice-7");
    });

    let section: UserProfileSettings = stored();
    assert_eq!(section.name, "Vi");
    assert_eq!(section.voice_profile_id, "voice-7");

    // An empty save clears the fields instead of falling back to defaults.
    settings_sections::with_user_profile_state(|state| {
        assert!(state.save("", "", "", ""));
    });
    let section: UserProfileSettings = stored();
    assert!(section.name.is_empty());
    assert!(section.description.is_empty());

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn stage_model_and_captions_round_trip() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("stage");

    settings_stage::with_state(|state| {
        assert!(state.save_model(" /models/hero.vrm "));
        assert_eq!(state.model_id, "/models/hero.vrm");
        assert!(state.save_captions(false, 900.0, -5.0, " TOP "));
    });
    settings_stage::with_state(|state| state.load_all());
    settings_stage::with_state(|state| {
        assert_eq!(state.model_id, "/models/hero.vrm");
        assert!(!state.captions_enabled);
        assert_eq!(state.captions_font_size, 400.0);
        assert_eq!(state.captions_opacity, 0.0);
        assert_eq!(state.captions_docking, "top");
    });

    let model: StageModelSettings = stored();
    let captions: CaptionsSettings = stored();
    assert_eq!(model.model_id, "/models/hero.vrm");
    assert_eq!(captions.docking, "top");
    assert!(!captions.enabled);

    // Unknown docking values are refused and nothing is persisted.
    settings_stage::with_state(|state| {
        assert!(!state.save_captions(true, 100.0, 70.0, "side"));
    });
    let captions: CaptionsSettings = stored();
    assert_eq!(captions.docking, "top");

    // Empty id clears the model selection.
    settings_stage::with_state(|state| assert!(state.save_model("")));
    assert!(stored::<StageModelSettings>().model_id.is_empty());

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn stage_window_bounds_round_trip() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("stage-window");

    let json = r#"{"x": 100000, "y": -5, "width": 10, "height": 800, "visible": false}"#;
    settings_stage::with_state(|state| assert!(state.save_bounds(json)));
    settings_stage::with_state(|state| assert!(!state.stage_visible));

    let section: StageWindowSettings = stored();
    assert_eq!(section.x, Some(10_000.0));
    assert_eq!(section.y, Some(-5.0));
    assert_eq!(section.width, 200.0);
    assert_eq!(section.height, 800.0);
    assert!(!section.visible);

    // `loadBounds` reads the persisted section back as JSON.
    let round_tripped = settings_stage::with_state(|state| state.load_bounds());
    let parsed: serde_json::Value = serde_json::from_str(&round_tripped).expect("valid json");
    assert_eq!(parsed["x"], 10_000.0);
    assert_eq!(parsed["width"], 200.0);
    assert_eq!(parsed["visible"], false);

    // Missing `visible` defaults to true; bad JSON is rejected.
    settings_stage::with_state(|state| {
        assert!(state.save_bounds(r#"{"width":300,"height":400}"#));
        assert!(!state.save_bounds("not json"));
        assert!(!state.save_bounds(r#"{"x":1,"y":2}"#));
    });
    let section: StageWindowSettings = stored();
    assert_eq!(section.x, None);
    assert_eq!(section.y, None);
    assert!(section.visible);
    assert_eq!(section.width, 300.0);

    settings_stage::with_state(|state| assert!(state.reset_bounds()));
    assert_eq!(stored::<StageWindowSettings>().x, None);
    // reset_bounds keeps size and visibility.
    assert_eq!(stored::<StageWindowSettings>().height, 400.0);

    settings_stage::with_state(|state| assert!(state.save_window_visible(false)));
    let section: StageWindowSettings = stored();
    assert!(!section.visible);
    assert_eq!(section.width, 300.0);

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn control_strip_button_flags_round_trip() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let db = register_temp_store("control-strip");

    // Unknown ids default to enabled.
    settings_stage::with_state(|state| assert!(state.strip_button_enabled("caption")));
    // Unknown ids are refused on save.
    settings_stage::with_state(|state| {
        assert!(!state.save_strip_button_enabled("chat", false));
    });
    settings_stage::with_state(|state| {
        assert!(state.save_strip_button_enabled("stage", false));
    });
    settings_stage::with_state(|state| {
        assert!(!state.strip_button_enabled("stage"));
        assert!(state.strip_button_enabled("caption"));
    });
    // Whitespace around the id is trimmed before lookup and persistence.
    settings_stage::with_state(|state| {
        assert!(!state.strip_button_enabled(" stage "));
    });

    drop(_guard);
    let _ = std::fs::remove_file(db);
}

#[test]
fn model_discovery_and_import_round_trip() {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _db = register_temp_store("models");

    let profile = temp_path("models", "profile");
    let models_dir = profile.join("models");
    std::fs::create_dir_all(&models_dir).expect("create models dir");
    crate::bridges::set_profile_dir(profile.clone());

    let src = temp_path("models", "source.vrm");
    std::fs::write(&src, b"vrm").expect("write source");
    let uppercase = temp_path("models", "other.VRM");
    std::fs::write(&uppercase, b"vrm").expect("write uppercase source");
    let not_a_model = temp_path("models", "notes.txt");
    std::fs::write(&not_a_model, b"x").expect("write text");

    // A non-`.vrm` source is refused with an empty result.
    settings_stage::with_state(|state| {
        assert!(state.import_model(not_a_model.to_str().unwrap()).is_empty());
    });

    let imported = settings_stage::with_state(|state| state.import_model(src.to_str().unwrap()));
    let imported_path = PathBuf::from(&imported);
    assert!(imported_path.is_file());
    assert_eq!(imported_path.parent(), Some(models_dir.as_path()));

    // Importing the same file twice dedupes the name instead of overwriting.
    let again = settings_stage::with_state(|state| state.import_model(src.to_str().unwrap()));
    assert_ne!(again, imported);
    let names = settings_stage::with_state(|state| state.list_models());
    // Dedupe keeps the `.vrm` extension but inserts `-<hex nanos>` before it,
    // so the pair shares the source's own (suffixed) stem.
    let src_name = src.file_name().unwrap().to_string_lossy().into_owned();
    let stem = src_name.strip_suffix(".vrm").unwrap();
    let deduped = names
        .iter()
        .filter(|n| n.starts_with(stem) && n.ends_with(".vrm"))
        .count();
    assert_eq!(deduped, 2, "expected the deduped pair, got {names:?} (src {src_name})");
    assert_eq!(names.iter().filter(|n| **n == src_name).count(), 1);
    assert!(!names.iter().any(|n| n.ends_with(".txt")));

    // Uppercase `.VRM` files are discovered too.
    std::fs::copy(&uppercase, models_dir.join("other.VRM")).expect("copy uppercase vrm");
    let names = settings_stage::with_state(|state| state.list_models());
    assert!(names.contains(&"other.VRM".to_string()));

    // Resolution rejects path components and unknown names.
    settings_stage::with_state(|state| {
        assert_eq!(state.resolve_model_path(&src_name), imported);
        assert!(state.resolve_model_path(&format!("../{src_name}")).is_empty());
        assert!(state.resolve_model_path("").is_empty());
        assert!(state.resolve_model_path("nope.vrm").is_empty());
        assert_eq!(
            state.resolve_model_path("other.VRM"),
            models_dir.join("other.VRM").to_string_lossy()
        );
    });

    for path in [
        src,
        uppercase,
        not_a_model,
        imported_path,
        PathBuf::from(&again),
    ] {
        let _ = std::fs::remove_file(path);
    }
    let _ = std::fs::remove_dir_all(&profile);
}
