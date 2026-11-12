// SPDX-License-Identifier: GPL-3.0-or-later
//! Card library + card editor bridge (`CardController`) for the QML settings pages.
//!
//! Cards live as `<profile>/cards/*.png|*.json` (CCv2/CCv3) exactly like the
//! chat lane's cards — this bridge scans the same directories, exposes the
//! library as JSON, and implements the editor's save path (PNG payload
//! rewrite via `airi_core::cards::save_card_file`, unknown card keys and avatar
//! pixels preserved).
//!
//! JSON boundaries are used for record lists (same pattern as the providers
//! bridge); the save payload is the typed-ish editor envelope documented on
//! [`qobject::CardController::save_card`].

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use std::path::PathBuf;
use std::pin::Pin;

use airi_core::cards::{save_card_file, CharacterCard};
use airi_core::settings::{CardsSettings, SettingsStore};
use serde_json::json;

use crate::bridges;
use crate::bridges::chat;
use crate::bridges::qstring_to_string;

fn settings_store() -> Option<SettingsStore> {
    bridges::settings_store().cloned()
}

/// Locate a card file in the scanned card dirs by its file-stem id.
fn locate_card(id: &str) -> Option<PathBuf> {
    for dir in chat::card_dirs() {
        for ext in ["png", "json"] {
            let candidate = dir.join(format!("{id}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// True when `a` and `b` refer to the same file. Used to refuse copying a
/// card onto itself (the copy would truncate the source first). Falls back
/// to an absolute lexical comparison when `b` does not exist yet.
fn same_file(a: &std::path::Path, b: &std::path::Path) -> bool {
    if let (Ok(a), Ok(b)) = (a.canonicalize(), b.canonicalize()) {
        return a == b;
    }
    fn absolute(p: &std::path::Path) -> PathBuf {
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(p))
                .unwrap_or_else(|_| p.to_path_buf())
        }
    }
    absolute(a) == absolute(b)
}

fn card_to_editor_json(card: &CharacterCard, path: &std::path::Path) -> serde_json::Value {
    let data = &card.data;
    json!({
        "path": path.to_string_lossy(),
        "kind": if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) { "png" } else { "json" },
        "spec": card.spec.to_string(),
        "specVersion": card.spec_version.clone(),
        "name": data.name,
        "description": data.description,
        "personality": data.personality,
        "scenario": data.scenario,
        "firstMes": data.first_mes,
        "alternateGreetings": data.alternate_greetings,
        "mesExample": data.mes_example,
        "systemPrompt": data.system_prompt,
        "postHistoryInstructions": data.post_history_instructions,
        "creator": data.creator,
        "creatorNotes": data.creator_notes,
        "characterVersion": data.character_version,
        "tags": data.tags,
    })
}

/// Resolve the cards import directory, creating it if needed.
fn gui_import_dir() -> Option<PathBuf> {
    chat::card_gui_import_dir().inspect(|dir| {
        let _ = std::fs::create_dir_all(dir);
    })
}

fn fresh_v3_card() -> CharacterCard {
    let text = r#"{"spec":"chara_card_v3","spec_version":"3.0","data":{"name":"New Card"}}"#;
    airi_core::cards::parse_card_json(text.as_bytes()).expect("the minimal card fixture must parse")
}

fn apply_editor_fields(card: &mut CharacterCard, fields: &serde_json::Value) -> Result<(), String> {
    let obj = fields
        .as_object()
        .ok_or_else(|| "fields payload must be a JSON object".to_string())?;
    let str_field =
        |key: &str| -> Option<String> { obj.get(key).and_then(|v| v.as_str()).map(str::to_string) };
    let list_field = |key: &str| -> Vec<String> {
        obj.get(key)
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };

    if let Some(v) = str_field("name") {
        if v.trim().is_empty() {
            return Err("name must not be empty".into());
        }
        card.data.name = v;
    }
    if let Some(v) = str_field("description") {
        card.data.description = v;
    }
    if let Some(v) = str_field("personality") {
        card.data.personality = v;
    }
    if let Some(v) = str_field("scenario") {
        card.data.scenario = v;
    }
    if let Some(v) = str_field("firstMes") {
        card.data.first_mes = v;
    }
    if let Some(v) = str_field("mesExample") {
        card.data.mes_example = v;
    }
    if let Some(v) = str_field("systemPrompt") {
        card.data.system_prompt = v;
    }
    if let Some(v) = str_field("postHistoryInstructions") {
        card.data.post_history_instructions = v;
    }
    if let Some(v) = str_field("creator") {
        card.data.creator = v;
    }
    if let Some(v) = str_field("creatorNotes") {
        card.data.creator_notes = v;
    }
    if let Some(v) = str_field("characterVersion") {
        card.data.character_version = v;
    }
    if obj.contains_key("alternateGreetings") {
        card.data.alternate_greetings = list_field("alternateGreetings");
    }
    if obj.contains_key("tags") {
        card.data.tags = list_field("tags");
    }
    Ok(())
}

fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = true;
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let mut slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        slug = "card".to_string();
    }
    slug
}

/// cxx-qt bridge definitions for the card library/editor bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Card library + editor view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, cards_json, cxx_name = "cardsJson")]
        #[qproperty(QString, active_card_id, cxx_name = "activeCardId")]
        #[qproperty(QString, error)]
        type CardController = super::CardControllerRust;
    }

    extern "RustQt" {
        /// Emitted after the library is rescanned (import/delete/save).
        #[qsignal]
        #[cxx_name = "cardsChanged"]
        fn cards_changed(self: Pin<&mut CardController>);

        /// Rescan the cards directories; updates `cardsJson` and
        /// `activeCardId`. JSON entries are
        /// `{"id","name","path","kind","greeting"}`.
        #[qinvokable]
        #[cxx_name = "refresh"]
        fn refresh(self: Pin<&mut CardController>);

        /// Import a `.png`/`.json` card into the GUI import dir.
        #[qinvokable]
        #[cxx_name = "importCard"]
        fn import_card(self: Pin<&mut CardController>, path: QString);

        /// Delete the card with file-stem `id`. No-op when missing.
        #[qinvokable]
        #[cxx_name = "deleteCard"]
        fn delete_card(self: Pin<&mut CardController>, id: QString);

        /// Activate the card with file-stem `id` for the next chat.
        #[qinvokable]
        #[cxx_name = "setActiveCard"]
        fn set_active_card(self: Pin<&mut CardController>, id: QString);

        /// Full editor view of the card with file-stem `id` as JSON.
        /// Empty string on error (`error` carries the message).
        #[qinvokable]
        #[cxx_name = "loadCard"]
        fn load_card(self: &CardController, id: QString) -> QString;

        /// Save the editor state. `fields_json` is
        /// `{"path": string|null, "spec": "chara_card_v2"|"chara_card_v3",
        ///   "name": string, "description", "personality", "scenario",
        ///   "firstMes", "mesExample", "alternateGreetings": [string],
        ///   "systemPrompt", "postHistoryInstructions", "creator",
        ///   "creatorNotes", "characterVersion", "tags": [string]}`.
        ///
        /// `path: null` creates a new `.json` card in the GUI import dir.
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "saveCard"]
        fn save_card(self: Pin<&mut CardController>, fields_json: QString) -> bool;

        /// Byte-copy the card file with file-stem `id` to `destination`.
        /// PNG cards are copied verbatim (embedded PNG `tEXt` chunks
        /// included); JSON cards are copied as-is. `destination` is the
        /// full file path confirmed by a Save dialog — existing files are
        /// overwritten (the Save dialog already confirmed with the user).
        /// The library is not rescanned; cards are unchanged by an export.
        /// Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "exportCardToFile"]
        fn export_card_to_file(
            self: Pin<&mut CardController>,
            id: QString,
            destination: QString,
        ) -> bool;
    }
}

/// Rust storage for `CardController`.
pub struct CardControllerRust {
    cards_json: QString,
    active_card_id: QString,
    error: QString,
}

impl Default for CardControllerRust {
    fn default() -> Self {
        Self {
            cards_json: QString::from("[]"),
            active_card_id: QString::from(""),
            error: QString::from(""),
        }
    }
}

fn render_cards_json() -> QString {
    let entries: Vec<serde_json::Value> = chat::scan_cards()
        .into_iter()
        .map(|entry| {
            let kind = if entry.avatar.to_ascii_lowercase().ends_with(".png") {
                "png"
            } else {
                "json"
            };
            json!({
                "id": entry.id,
                "name": entry.name,
                "path": entry.avatar,
                "kind": kind,
                "greeting": entry.greeting.unwrap_or_default(),
            })
        })
        .collect();
    QString::from(
        serde_json::to_string(&entries)
            .unwrap_or_else(|_| "[]".to_string())
            .as_str(),
    )
}

fn active_card_id() -> String {
    settings_store()
        .and_then(|store| store.load_section::<CardsSettings>().ok())
        .map(|s| s.active_card_id)
        .unwrap_or_default()
}

impl qobject::CardController {
    fn set_error_msg(mut self: std::pin::Pin<&mut Self>, message: String) {
        let s = QString::from(message.as_str());
        self.as_mut().rust_mut().error = s.clone();
        self.as_mut().set_error(s);
    }

    fn clear_error(mut self: std::pin::Pin<&mut Self>) {
        let s = QString::from("");
        self.as_mut().rust_mut().error = s.clone();
        self.as_mut().set_error(s);
    }

    fn refresh_impl(mut self: std::pin::Pin<&mut Self>) {
        let entries_json = render_cards_json();
        let active = active_card_id();
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.cards_json = entries_json.clone();
            rust_mut.active_card_id = QString::from(active.as_str());
        }
        self.as_mut().set_cards_json(entries_json);
        self.as_mut()
            .set_active_card_id(QString::from(active.as_str()));
        qobject::CardController::cards_changed(self.as_mut());
    }

    /// Re-scan the library. Emits `cardsChanged`.
    pub fn refresh(mut self: Pin<&mut Self>) {
        self.as_mut().clear_error();
        self.refresh_impl();
    }

    /// Import a `.png`/`.json` card file into the GUI import dir.
    pub fn import_card(mut self: Pin<&mut Self>, path: QString) {
        self.as_mut().clear_error();
        let path = qstring_to_string(&path);
        let Some(dir) = gui_import_dir() else {
            self.set_error_msg("could not resolve a card import directory".into());
            return;
        };
        match chat::import_card_file(std::path::Path::new(&path), &dir) {
            Ok(_) => self.refresh_impl(),
            Err(err) => self.set_error_msg(format!("import failed: {err}")),
        }
    }

    /// Delete the card with file-stem `id`.
    pub fn delete_card(mut self: Pin<&mut Self>, id: QString) {
        self.as_mut().clear_error();
        let id = qstring_to_string(&id);
        let Some(path) = locate_card(&id) else {
            qobject::CardController::cards_changed(self.as_mut());
            return;
        };
        if let Err(err) = std::fs::remove_file(&path) {
            self.set_error_msg(format!("delete failed: {err}"));
            return;
        }
        // Forget it as the active card if it was selected.
        if let Some(store) = settings_store() {
            if let Ok(section) = store.load_section::<CardsSettings>() {
                if section.active_card_id == id {
                    let _ = store.save_section(&CardsSettings {
                        active_card_id: String::new(),
                    });
                }
            }
        }
        self.refresh_impl();
    }

    /// Activate the card with file-stem `id`.
    pub fn set_active_card(mut self: Pin<&mut Self>, id: QString) {
        self.as_mut().clear_error();
        let id = qstring_to_string(&id);
        if !id.is_empty() && locate_card(&id).is_none() {
            self.set_error_msg(format!("card not found: {id}"));
            return;
        }
        if let Some(store) = settings_store() {
            if store
                .save_section(&CardsSettings { active_card_id: id })
                .is_err()
            {
                self.set_error_msg("failed to persist the active card".into());
                return;
            }
        }
        self.refresh_impl();
    }

    /// Load the editor view of the card with file-stem `id`.
    pub fn load_card(&self, id: QString) -> QString {
        let id = qstring_to_string(&id);
        let Some(path) = locate_card(&id) else {
            return QString::from("");
        };
        let Ok(bytes) = std::fs::read(&path) else {
            return QString::from("");
        };
        let parsed = if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            airi_core::cards::extract_card_from_png(&bytes)
        } else {
            airi_core::cards::parse_card_json(&bytes)
        };
        match parsed {
            Ok(card) => QString::from(card_to_editor_json(&card, &path).to_string().as_str()),
            Err(_) => QString::from(""),
        }
    }

    /// Export the card with file-stem `id` by byte-copying its file to
    /// `destination`. `destination` is the full file path confirmed by a
    /// Save dialog; an existing destination is overwritten (the Save
    /// dialog already confirmed that with the user). No parent directories
    /// are created. PNG cards keep their embedded `tEXt` chunks — nothing
    /// is re-serialized. The error property carries a human message on
    /// failure. Cards are unchanged, so no rescan is emitted.
    pub fn export_card_to_file(
        mut self: Pin<&mut Self>,
        id: QString,
        destination: QString,
    ) -> bool {
        self.as_mut().clear_error();
        let id = qstring_to_string(&id);
        let destination = qstring_to_string(&destination);
        if destination.trim().is_empty() {
            self.set_error_msg("no destination file was chosen".into());
            return false;
        }
        let Some(source) = locate_card(&id) else {
            self.set_error_msg(format!("card not found: {id}"));
            return false;
        };
        let destination = PathBuf::from(destination.as_str());
        if destination.is_dir() {
            self.set_error_msg("the destination is a directory, not a file".into());
            return false;
        }
        if same_file(&source, &destination) {
            self.set_error_msg("the destination is the card's own file".into());
            return false;
        }
        // std::fs::copy truncates/creates the destination as given. It does
        // not create missing parent directories.
        match std::fs::copy(&source, &destination) {
            Ok(_) => true,
            Err(err) => {
                self.set_error_msg(format!("failed to export the card: {err}"));
                false
            }
        }
    }

    /// Save the editor state (see the QML-facing signature in the bridge block).
    pub fn save_card(mut self: Pin<&mut Self>, fields_json: QString) -> bool {
        self.as_mut().clear_error();
        let fields = qstring_to_string(&fields_json);
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&fields) else {
            self.set_error_msg("fields payload is not valid JSON".into());
            return false;
        };

        match build_card_for_save(&value) {
            Ok((card, Some(path))) => {
                if let Err(err) = save_card_file(std::path::Path::new(&path), &card) {
                    self.set_error_msg(format!("failed to save the card: {err}"));
                    return false;
                }
            }
            Ok((card, None)) => {
                if let Err(err) = create_new_json_card(&card) {
                    self.set_error_msg(err);
                    return false;
                }
            }
            Err(message) => {
                self.set_error_msg(message);
                return false;
            }
        }

        self.refresh_impl();
        true
    }
}

/// Apply the editor fields onto the existing card at `path` (or a fresh V3 card
/// when `path` is `null`). Returns the card and the (optional) destination.
fn build_card_for_save(
    value: &serde_json::Value,
) -> Result<(CharacterCard, Option<String>), String> {
    let path = value
        .get("path")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut card = match &path {
        Some(path) => {
            let bytes = std::fs::read(path).map_err(|e| format!("failed to read {path}: {e}"))?;
            if path.to_ascii_lowercase().ends_with(".png") {
                airi_core::cards::extract_card_from_png(&bytes)
                    .map_err(|e| format!("failed to parse PNG card at {path}: {e}"))?
            } else {
                airi_core::cards::parse_card_json(&bytes)
                    .map_err(|e| format!("failed to parse JSON card at {path}: {e}"))?
            }
        }
        None => fresh_v3_card(),
    };
    apply_editor_fields(&mut card, value)?;
    Ok((card, path))
}

fn create_new_json_card(card: &CharacterCard) -> Result<(), String> {
    let Some(dir) = gui_import_dir() else {
        return Err("could not resolve a card import directory".into());
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let slug = slugify(&card.data.name);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = dir.join(format!("{slug}-{nanos:x}.json"));
    save_card_file(&path, card).map_err(|e| format!("failed to write new card: {e}"))?;
    Ok(())
}
