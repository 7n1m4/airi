// SPDX-License-Identifier: GPL-3.0-or-later
//! Build script for the airi-qt binary: mirrors the QML module into OUT_DIR so
//! cxx-qt can register module-relative paths (`qml/…`) instead of `../..`.

use cxx_qt_build::{CxxQtBuilder, QmlFile, QmlModule};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    // crates/airi-qt -> qml (source of truth for QML sources)
    let source_qml = manifest_dir
        .join("../../qml")
        .canonicalize()
        .expect("resolve source qml dir");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let build_root = out_dir.join("qml_build");
    let target_qml = build_root.join("qml");

    if target_qml.exists() {
        fs::remove_dir_all(&target_qml).expect("clean mirrored qml dir");
    }
    copy_dir_recursive(&source_qml, &target_qml).expect("mirror qml sources");

    // cxx-qt canonicalizes module-relative paths against the current directory.
    env::set_current_dir(&build_root).expect("chdir into mirrored qml root");

    emit_rerun_if_changed(&source_qml);

    // Every file containing a #[cxx_qt::bridge] module must be listed here
    // (mod.rs has none — the crate graph handles it).
    let files = [
        manifest_dir.join("src/bridges/cards.rs"),
        manifest_dir.join("src/bridges/data.rs"),
        manifest_dir.join("src/bridges/mcp.rs"),
        manifest_dir.join("src/bridges/sync.rs"),
        manifest_dir.join("src/bridges/discord.rs"),
        manifest_dir.join("src/bridges/discord_gateway.rs"),
        manifest_dir.join("src/bridges/capture.rs"),
        manifest_dir.join("src/bridges/acp.rs"),
        manifest_dir.join("src/bridges/shell.rs"),
        manifest_dir.join("src/bridges/stage.rs"),
        manifest_dir.join("src/bridges/mmd.rs"),
        manifest_dir.join("src/bridges/settings_stage.rs"),
        manifest_dir.join("src/bridges/settings_sections.rs"),
        manifest_dir.join("src/bridges/settings_general.rs"),
        manifest_dir.join("src/bridges/settings_chat.rs"),
        manifest_dir.join("src/bridges/i18n.rs"),
        manifest_dir.join("src/bridges/theme.rs"),
        manifest_dir.join("src/bridges/windows.rs"),
        manifest_dir.join("src/bridges/providers.rs"),
        manifest_dir.join("src/bridges/chat.rs"),
        manifest_dir.join("src/bridges/spine.rs"),
        manifest_dir.join("src/bridges/desktop.rs"),
        manifest_dir.join("src/bridges/daemon.rs"),
        manifest_dir.join("src/bridges/update.rs"),
        manifest_dir.join("src/bridges/memory.rs"),
        manifest_dir.join("src/bridges/speech.rs"),
        manifest_dir.join("src/bridges/hearing.rs"),
        manifest_dir.join("src/bridges/gateway_pump.rs"),
    ];
    let cpp_files = [
        manifest_dir.join("src/cpp/airi_qt_bridge.cpp"),
        manifest_dir.join("src/cpp/airi_qt_bridge.h"),
        manifest_dir.join("src/cpp/spine_item.cpp"),
        manifest_dir.join("src/cpp/spine_item.h"),
        manifest_dir.join("src/cpp/capture_item.cpp"),
        manifest_dir.join("src/cpp/capture_item.h"),
    ];

    let mut module =
        QmlModule::new("com.airi.airiqt").qml_file(QmlFile::from("qml/Theme.qml").singleton(true));
    module = module.qml_file(QmlFile::from("qml/I18n.qml").singleton(true));
    module = module.qml_file(QmlFile::from("qml/WindowManager.qml").singleton(true));
    module = module.qml_file("qml/Main.qml");
    module = module.qml_file("qml/spine/SpineStage.qml");
    module = module.qml_file("qml/CaptionOverlay.qml");
    module = module.qml_file("qml/Caption.qml");
    module = module.qml_file("qml/VrmMtoonMaterial.qml");
    module = module.qml_file("qml/ThemeSettingsPage.qml");
    module = module.qml_file("qml/StageScene.qml");
    module = module.qml_file("qml/stage/StageWindow.qml");
    for component in [
        "AButton",
        "ATextField",
        "ATextArea",
        "ASwitch",
        "ASelect",
        "ASlider",
        "ACard",
        "AModal",
        "ATooltip",
        "AListItem",
        "AToggleGroup",
        "AInputNumber",
        "ABadge",
        "AProgress",
        "ASeparator",
        "AEmptyState",
    ] {
        module = module.qml_file(format!("qml/components/{component}.qml").as_str());
    }
    for window in [
        "MainShell",
        "Splash",
        "ChatWindow",
        "SettingsWindow",
        "AboutWindow",
    ] {
        module = module.qml_file(format!("qml/shell/{window}.qml").as_str());
    }
    for provider_page in ["ProvidersPage", "ProviderRow", "ProviderDetail"] {
        module =
            module.qml_file(format!("qml/pages/settings/providers/{provider_page}.qml").as_str());
    }
    module = module.qml_file("qml/pages/settings/stage/StageSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/spine/SpineSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/mmd/MmdSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/live2d/Live2dSettingsPage.qml");
    for chat_file in [
        "SessionListPanel",
        "TranscriptList",
        "MessageItem",
        "Composer",
        "CardPicker",
    ] {
        module = module.qml_file(format!("qml/chat/{chat_file}.qml").as_str());
    }
    for system_page in [
        "GeneralSettingsPage",
        "ChatSettingsPage",
        "AudioDeviceSettingsPage",
        "UserProfileSettingsPage",
    ] {
        module = module.qml_file(format!("qml/pages/settings/system/{system_page}.qml").as_str());
    }
    module = module.qml_file("qml/pages/cards/CardLibraryPage.qml");
    module = module.qml_file("qml/pages/cards/CardEditorPage.qml");
    module = module.qml_file("qml/pages/models/ExploreModelsPage.qml");
    module = module.qml_file("qml/pages/settings/data/DataSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/data/DataExportDialog.qml");
    module = module.qml_file("qml/pages/settings/data/DataImportDialog.qml");
    module = module.qml_file("qml/pages/settings/data/ScrubHistoryDialog.qml");
    module = module.qml_file("qml/pages/onboarding/OnboardingV3Page.qml");
    for notice_page in ["NoticePage", "FadeOnHoverNoticePage"] {
        module = module.qml_file(format!("qml/pages/notice/{notice_page}.qml").as_str());
    }
    module = module.qml_file("qml/pages/widgets/WidgetsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/mcp/McpSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/discord/DiscordSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml");
    module = module.qml_file("qml/pages/devtools/plugin-host/PluginHostPage.qml");
    module = module.qml_file("qml/pages/devtools/screen-capture/ScreenCapturePage.qml");
    module = module.qml_file("qml/pages/settings/modules/acp/AcpAgentsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/ModulesSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/memory/MemorySettingsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/speech/SpeechSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/hearing/HearingSettingsPage.qml");
    module = module.qml_file("qml/pages/settings/modules/awareness/AwarenessSettingsPage.qml");
    module = module.qml_file("qml/pages/cards/CardExportDialog.qml");

    CxxQtBuilder::new_qml_module(module)
        .qt_module("Gui")
        .qt_module("Qml")
        .qt_module("Quick")
        .qt_module("Quick3D")
        .qt_module("QuickControls2")
        .qt_module("Network")
        .qrc_resources(["qml/pages/models/exploreData.js"])
        .files(files.iter().map(|p| p.to_str().expect("utf8 path")))
        .cpp_files(cpp_files.iter().map(|p| p.to_str().expect("utf8 path")))
        .build();
}

fn emit_rerun_if_changed(root: &Path) {
    for entry in fs::read_dir(root).expect("read qml dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            emit_rerun_if_changed(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}
