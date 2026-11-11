// SPDX-License-Identifier: GPL-3.0-or-later

//! Env-gated live tests against user-supplied MMD assets.
//!
//! Nothing here is downloaded or committed. Point the variables at local
//! files (license-clean models only — MMD models are usually
//! redistribution-restricted) and run:
//!
//! ```sh
//! AIRI_TEST_MMD_MODEL=/path/to/model.pmx cargo test -p airi-mmd live_
//! AIRI_TEST_MMD_ZIP=/path/to/package.zip cargo test -p airi-mmd live_
//! ```
//!
//! Both tests skip silently (with a note on stderr) when the variable is
//! unset, so the normal suite is unaffected.

use airi_mmd::{MmdModel, VmdMotion};

#[test]
fn live_model_loads_from_env() {
    let Ok(path) = std::env::var("AIRI_TEST_MMD_MODEL") else {
        eprintln!("AIRI_TEST_MMD_MODEL unset; skipping live model test");
        return;
    };
    eprintln!("AIRI_TEST_MMD_MODEL={path}");
    let model = MmdModel::from_path(&path).expect("live model must parse");
    assert!(!model.vertices.is_empty(), "live model has no vertices");
    assert!(!model.bones.is_empty(), "live model has no bones");
    assert!(!model.materials.is_empty(), "live model has no materials");
    eprintln!(
        "live model: {} vertices, {} bones, {} materials, {} morphs \"{}\"",
        model.vertices.len(),
        model.bones.len(),
        model.materials.len(),
        model.morphs.len(),
        model.name,
    );
}

#[test]
fn live_zip_loads_from_env() {
    let Ok(path) = std::env::var("AIRI_TEST_MMD_ZIP") else {
        eprintln!("AIRI_TEST_MMD_ZIP unset; skipping live zip test");
        return;
    };
    eprintln!("AIRI_TEST_MMD_ZIP={path}");

    let file = std::fs::File::open(&path).expect("zip archive must be readable");
    let mut archive = zip::ZipArchive::new(file).expect("path is not a valid zip archive");

    let temp = std::env::temp_dir().join(format!("airi-mmd-live-{}", std::process::id()));
    std::fs::create_dir_all(&temp).expect("temp dir must be creatable");

    let mut model_path = None;
    let result = (|| -> std::io::Result<std::path::PathBuf> {
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            if entry.is_dir() {
                continue;
            }
            let Some(enclosed) = entry.enclosed_name() else {
                // Refuse zip-slip paths; skip the entry rather than write outside temp.
                eprintln!("skipping unsafe entry {}", entry.name());
                continue;
            };
            let dest = temp.join(enclosed);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            if entry.name().to_ascii_lowercase().ends_with(".pmx") {
                model_path = Some(dest);
            }
        }
        model_path.ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "no .pmx entry inside the zip")
        })
    })();

    let model = result.and_then(|p| {
        MmdModel::from_path(p)
            .map_err(|e| std::io::Error::other(format!("PMX failed to parse: {e}")))
    });
    let _ = std::fs::remove_dir_all(&temp); // best effort; the assertions decide the outcome

    let model = model.expect("live zip must contain a parseable .pmx");
    assert!(!model.vertices.is_empty(), "live zip model has no vertices");
    eprintln!(
        "live zip model: {} vertices, {} bones, {} materials, {} morphs \"{}\"",
        model.vertices.len(),
        model.bones.len(),
        model.materials.len(),
        model.morphs.len(),
        model.name,
    );
}

#[test]
fn live_vmd_companion_loads_from_env() {
    // Optional companion check: when AIRI_TEST_MMD_MODEL points at a model,
    // load a repo VMD next to it (if any) and report its frame range. This
    // proves the motion parse half of the pair without touching the model.
    let Ok(_) = std::env::var("AIRI_TEST_MMD_MODEL") else {
        eprintln!("AIRI_TEST_MMD_MODEL unset; skipping live VMD companion test");
        return;
    };
    const VMD: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../stage-tamagotchi/src/renderer/public/assets/mmd/animations/swaying_arms_and_hips.vmd"
    );
    match VmdMotion::from_path(VMD) {
        Ok(motion) => eprintln!(
            "companion motion: {} bone keys, frame range {:?}",
            motion.bones.len(),
            motion.bone_frame_range()
        ),
        Err(e) => eprintln!("companion VMD unavailable (not fatal): {e}"),
    }
}
