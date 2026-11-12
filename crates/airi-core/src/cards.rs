// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Character card schema (CC v2 / CC v3) with AIRI extensions, plus PNG import.
//!
//! Ports the shapes from the repository's card packages:
//!
//! - `packages/ccc/src/define/card.ts`, `packages/ccc/src/export/types/*` —
//!   CC v2 (`spec: "chara_card_v2"`) and v3 (`spec: "chara_card_v3"`) data.
//!   Both share one flat [`CardData`] object (as the TS `DataV1 & DataV2 &
//!   DataV3` intersection does), serialized snake_case.
//! - `packages/stage-ui/src/types/card.schema.ts` — the AIRI extension
//!   (`extensions.airi.*`), typed as far as reasonable and kept under
//!   [`Extensions::airi`].
//! - `packages/stage-ui/src/stores/modules/airi-card.ts` — usage semantics
//!   for `extensions.airi` (see [`AiriExtension`]).
//! - `packages/stage-ui/src/types/card.schema.ts` (`AiriCardSchema`) — the
//!   AIRI card editor document shape, see [`AiriCard`].
//!
//! Serialization policy: structured, typed structs at every modelled level;
//! `BTreeMap<String, serde_json::Value>` only at explicit extension
//! boundaries (JSON merge carries unknown vendor keys without dropping them
//! on round-trip). No `serde_json::Value` appears in the top-level public
//! service APIs of this crate.
//!
//! PNG cards embed the base64 JSON payload as a `tEXt`/`iTXt`/`zTXt` chunk
//! with keyword `ccv3` (v3 card) or `chara` (legacy v2 card). Use
//! [`extract_card_from_png`] to import `.png` card files.

use std::collections::BTreeMap;

use anyhow::{bail, Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};

/// Top-level card spec marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CardSpec {
    /// `chara_card_v2` (also used for legacy flat v1 documents).
    #[serde(rename = "chara_card_v2")]
    V2,
    /// `chara_card_v3`.
    #[serde(rename = "chara_card_v3")]
    V3,
}

impl CardSpec {
    /// Wire value of the spec marker.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::V2 => "chara_card_v2",
            Self::V3 => "chara_card_v3",
        }
    }
}

impl std::fmt::Display for CardSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ============================================================================
// CC v2/v3 data object (DataV1 & DataV2 & DataV3)
// ============================================================================

/// Shared card data object serialized inside the `data` envelope.
///
/// The CC spec's field set is the flattened union of DataV1, DataV2 and
/// DataV3; every field beyond `name` is optional or defaulted so that real
/// world cards (which frequently omit most v2/v3 fields) parse cleanly.
/// Unknown keys are preserved through [`CardData::extra`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardData {
    // --- DataV1 ---
    /// Card description (usually the character definition / backstory).
    #[serde(default)]
    pub description: String,
    /// Opening message (`{{char}}`'s first line).
    #[serde(default)]
    pub first_mes: String,
    /// Example dialogue in the `<START>` format.
    #[serde(default)]
    pub mes_example: String,
    /// Card name (required).
    pub name: String,
    /// Personality summary.
    #[serde(default)]
    pub personality: String,
    /// Scenario / setting.
    #[serde(default)]
    pub scenario: String,
    // --- DataV2 ---
    /// Additional opening messages selectable by the user.
    #[serde(default)]
    pub alternate_greetings: Vec<String>,
    /// Embedded lorebook.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub character_book: Option<CharacterBook>,
    /// Author-supplied character version string.
    #[serde(default)]
    pub character_version: String,
    /// Creator name.
    #[serde(default)]
    pub creator: String,
    /// Creator notes shown in card pickers.
    #[serde(default)]
    pub creator_notes: String,
    /// Extensions blob; AIRI stores `extensions.airi` here.
    #[serde(default)]
    pub extensions: Extensions,
    /// Instructions appended after the chat history.
    #[serde(default)]
    pub post_history_instructions: String,
    /// System prompt override.
    #[serde(default)]
    pub system_prompt: String,
    /// Tag list.
    #[serde(default)]
    pub tags: Vec<String>,
    // --- DataV3 ---
    /// Embedded/referenced assets (sprites, Live2D/VRM models, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<Assets>,
    /// Creation timestamp (unix ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_date: Option<f64>,
    /// Localized creator notes keyed by BCP-47 tag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator_notes_multilingual: Option<BTreeMap<String, String>>,
    /// Greetings only selectable in group chats.
    #[serde(default)]
    pub group_only_greetings: Vec<String>,
    /// Last modification timestamp (unix ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modification_date: Option<f64>,
    /// Character nickname.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    /// Source of the character (e.g. original work URL).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Vec<String>>,
    /// Unknown vendor keys preserved verbatim (e.g. `x_airi_probe`).
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

// ============================================================================
// Character book
// ============================================================================

/// Lorebook extension map (free-form, per the CC spec).
pub type CharacterBookExtensions = BTreeMap<String, serde_json::Value>;
/// Lorebook entry extension map (free-form, per the CC spec).
pub type CharacterBookEntryExtensions = BTreeMap<String, serde_json::Value>;

/// Where a lorebook entry is inserted relative to the character definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CharacterBookEntryPosition {
    /// Inserted after the character definition.
    #[serde(rename = "after_char")]
    AfterChar,
    /// Inserted before the character definition.
    #[serde(rename = "before_char")]
    BeforeChar,
}

/// A character book (lorebook) embedded in the card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CharacterBook {
    /// Free-form description of the book.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Entries, in authoring order.
    #[serde(default)]
    pub entries: Vec<CharacterBookEntry>,
    /// Book-level extensions.
    #[serde(default)]
    pub extensions: CharacterBookExtensions,
    /// Book display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Whether entries can re-trigger scanning after being inserted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recursive_scanning: Option<bool>,
    /// Depth of recent messages scanned for keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_depth: Option<f64>,
    /// Token budget for the whole book.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<f64>,
}

/// One lorebook entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CharacterBookEntry {
    /// Case-insensitive matching when false (default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub case_sensitive: Option<bool>,
    /// Author comment; unused by prompt engineering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Always inserted (within budget) regardless of keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constant: Option<bool>,
    /// Content to insert into the prompt.
    pub content: String,
    /// Whether the entry is active.
    #[serde(default)]
    pub enabled: bool,
    /// Entry-level extensions.
    #[serde(default)]
    pub extensions: CharacterBookEntryExtensions,
    /// Authoring id (ignored by SillyTavern prompt engineering).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<f64>,
    /// Insertion order; lower values are inserted higher.
    #[serde(default)]
    pub insertion_order: f64,
    /// Primary trigger keys.
    #[serde(default)]
    pub keys: Vec<String>,
    /// Author-facing entry name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Insert position relative to the character definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<CharacterBookEntryPosition>,
    /// Lower priority values are discarded first at the budget limit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<f64>,
    /// Secondary keys for `selective` matching.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_keys: Option<Vec<String>>,
    /// Require one primary and one secondary key to trigger.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selective: Option<bool>,
}

// ============================================================================
// Extensions (CC `extensions` object + AIRI `airi` sub-object)
// ============================================================================

/// SillyTavern-style depth prompt nested in `extensions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsDepthPrompt {
    /// Depth at which the prompt is injected (default 4).
    #[serde(default = "default_depth_prompt_depth")]
    pub depth: f64,
    /// Prompt text.
    #[serde(default)]
    pub prompt: String,
    /// Role to inject as; `"system"` by convention.
    #[serde(default = "default_system_role")]
    pub role: String,
}

fn default_depth_prompt_depth() -> f64 {
    4.0
}

fn default_system_role() -> String {
    "system".to_string()
}

impl Default for ExtensionsDepthPrompt {
    fn default() -> Self {
        Self {
            depth: default_depth_prompt_depth(),
            prompt: String::new(),
            role: default_system_role(),
        }
    }
}

/// Card-level `extensions` object.
///
/// Carries the known SillyTavern fields (`depth_prompt`, `fav`,
/// `talkativeness`, `world`), the typed AIRI sub-object
/// ([`Extensions::airi`]), and preserves unknown vendor keys.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Extensions {
    /// Depth prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_prompt: Option<ExtensionsDepthPrompt>,
    /// Favorite flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fav: Option<bool>,
    /// Talkativeness 0.0–1.0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub talkativeness: Option<f64>,
    /// World/setting name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world: Option<String>,
    /// AIRI extension data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub airi: Option<AiriExtension>,
    /// Unknown vendor keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// CC v3 asset descriptor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    /// File extension (without dot).
    pub ext: String,
    /// Asset name.
    pub name: String,
    /// Asset kind (e.g. `icon`, `background`, `live2d`, `vrm`).
    #[serde(rename = "type")]
    pub asset_type: String,
    /// URI (https://, embeded://, ccdefault:, file:...).
    pub uri: String,
}

/// CC v3 asset list.
pub type Assets = Vec<Asset>;

// ============================================================================
// Public card type
// ============================================================================

/// A parsed character card (spec-normalized).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CharacterCard {
    /// Card spec marker.
    pub spec: CardSpec,
    /// Spec version string (`"2.0"` / `"3.0"`); `None` for legacy flat v1 documents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec_version: Option<String>,
    /// Card data (flattened DataV1 & DataV2 & DataV3).
    pub data: CardData,
}

impl CharacterCard {
    /// Card name.
    pub fn name(&self) -> &str {
        &self.data.name
    }

    /// Alias (alternate names/nickname), when set.
    pub fn nickname(&self) -> Option<&str> {
        self.data.nickname.as_deref()
    }

    /// Primary greeting (`first_mes`), when non-empty.
    pub fn primary_greeting(&self) -> Option<&str> {
        let first = self.data.first_mes.trim();
        (!first.is_empty()).then_some(first)
    }

    /// All alternate greetings.
    pub fn alternate_greetings(&self) -> &[String] {
        &self.data.alternate_greetings
    }

    /// The AIRI extension sub-object (`extensions.airi`), when present.
    pub fn airi_extension(&self) -> Option<&AiriExtension> {
        self.data.extensions.airi.as_ref()
    }
}

/// Wire envelope of a spec-wrapped card (`{ spec, spec_version?, data }`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedCard {
    /// Spec marker.
    pub spec: CardSpec,
    /// Spec version (e.g. `"2.0"`, `"3.0"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec_version: Option<String>,
    /// Card data.
    pub data: CardData,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawCard {
    Wrapped(WrappedCard),
    Flat(CardData),
}

/// Parse raw JSON bytes into a normalized [`CharacterCard`].
///
/// Accepts the spec-wrapped form (`{ spec, spec_version?, data }`) and, for
/// resilience, the legacy flat v1 form (DataV1/v2/v3 fields at the top
/// level), which is treated as [`CardSpec::V2`] with no `spec_version`.
pub fn parse_card_json(bytes: &[u8]) -> Result<CharacterCard> {
    let raw: RawCard =
        serde_json::from_slice(bytes).context("failed to parse character card JSON")?;
    Ok(match raw {
        RawCard::Wrapped(wrapped) => CharacterCard {
            spec: wrapped.spec,
            spec_version: wrapped.spec_version,
            data: wrapped.data,
        },
        RawCard::Flat(data) => CharacterCard {
            spec: CardSpec::V2,
            spec_version: None,
            data,
        },
    })
}

// ============================================================================
// AIRI extension (`extensions.airi.*`)
// ============================================================================

/// Consciousness processor used by AIRI cognition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriCognitionProcessor {
    /// No cognitive enhancement.
    None,
    /// Local nanoid-0 distilled model.
    #[serde(rename = "local_nan0")]
    LocalNan0,
    /// Universe RAG (retrieval-augmented generation over the lore index).
    #[serde(rename = "universe_rag")]
    UniverseRag,
}

/// Preset affect baseline for cognition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriAffectPreset {
    /// Irritable, guarded.
    Gremlin,
    /// Warm, attentive companion.
    Companion,
    /// Cool analyst.
    Analyst,
    /// Sentry — watchful, protective.
    Sentry,
}

/// Reranker provider for retrieval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiriRerankerProvider {
    /// Laya local reranker.
    LayaLocal,
    /// Typesafe AI reranker.
    TypesafeAi,
    /// OpenRouter AI reranker.
    OpenrouterAi,
    /// Opencode Go reranker.
    OpencodeGo,
}

/// Affect baseline tuning for AIRI cognition.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriCognitionAffect {
    /// Affect preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<AiriAffectPreset>,
    /// Baseline suspicion of user intent (0.0–1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_suspicion: Option<f64>,
    /// Baseline attachment (0.0–1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_attachment: Option<f64>,
    /// Baseline pride (0.0–1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_pride: Option<f64>,
    /// Suspicion sensitivity multiplier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspicion_sensitivity: Option<f64>,
    /// Irritation half-life in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub irritation_half_life_minutes: Option<f64>,
    /// Daily forgiveness rate (0.0–1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_forgiveness_rate: Option<f64>,
    /// Grievance accumulation threshold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grievance_threshold: Option<f64>,
    /// Silence threshold for passive-aggressive drift.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub silence_threshold: Option<f64>,
    /// Enable periodic metabolic rest cycles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metabolic_rest_enabled: Option<bool>,
    /// Track grievances over time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grievance_tracking_enabled: Option<bool>,
    /// Override the anchor the companion persona attaches to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub companion_anchor_override: Option<String>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// One per-tier trigger override.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiriCognitionTriggerOverride {
    /// Whether the override enables (`true`) or disables (`false`) the tier.
    pub enabled: bool,
}

/// Cognition trigger switches.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriCognitionTriggers {
    /// Enable tier-1 local reflexes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier1_local_reflex_enabled: Option<bool>,
    /// Enable tier-2 Jev challenger.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier2_jev_challenger_enabled: Option<bool>,
    /// Per-tier overrides keyed by tier id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overrides: Option<BTreeMap<String, AiriCognitionTriggerOverride>>,
}

/// Universe-RAG search engine configuration.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriCognitionSearchEngine {
    /// Enable Universe RAG retrieval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub universe_rag_enabled: Option<bool>,
    /// Enable reranking of retrieved documents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reranker_enabled: Option<bool>,
    /// Reranker backend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reranker_provider: Option<AiriRerankerProvider>,
    /// Escalate to a system-2 reasoning model when uncertain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system2_escalation_enabled: Option<bool>,
    /// Reasoning model used for system-2 escalation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_model: Option<String>,
    /// Maximum number of evidence documents kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_limit: Option<f64>,
    /// Minimum relevance score for an evidence document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relevance_threshold: Option<f64>,
    /// Resolve anaphora ("it", "that") against conversation context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anaphora_enabled: Option<bool>,
    /// Weight recent timeline facts higher.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_priority_enabled: Option<bool>,
}

/// AIRI cognition block (`extensions.airi.cognition`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriCognition {
    /// Whether cognition is enabled for this card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Cognitive processor kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processor: Option<AiriCognitionProcessor>,
    /// Provider id for the processor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Model id for the processor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Affect baseline tuning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affect: Option<AiriCognitionAffect>,
    /// Trigger switches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triggers: Option<AiriCognitionTriggers>,
    /// Search engine configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_engine: Option<AiriCognitionSearchEngine>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Consciousness module assignment (`extensions.airi.modules.consciousness`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriConsciousnessModule {
    /// Provider id (e.g. `openai-compatible`).
    pub provider: String,
    /// Model id.
    pub model: String,
    /// Free-form per-module configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module_configs: Option<BTreeMap<String, serde_json::Value>>,
}

/// Speech module assignment (`extensions.airi.modules.speech`).
///
/// Wire keys are snake_case (`voice_id`) per the TS schema.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriSpeechModule {
    /// Provider id (e.g. `speech-noop`).
    pub provider: String,
    /// Model id.
    pub model: String,
    /// Voice id within the provider.
    pub voice_id: String,
    /// Pitch adjustment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pitch: Option<f64>,
    /// Rate adjustment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate: Option<f64>,
    /// Emit SSML instead of plain text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssml: Option<bool>,
    /// BCP-47 language tag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// Where a display model comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriModelSource {
    /// Uploaded/user-provided file.
    File,
    /// Remote URL.
    Url,
}

/// VRM display model reference.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiriVrmModelRef {
    /// Source kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<AiriModelSource>,
    /// File name/path when `source = file`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// URL when `source = url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Live2D display model reference with visual state.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriLive2dModelRef {
    /// Source kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<AiriModelSource>,
    /// File name/path when `source = file`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// URL when `source = url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Active expression weights keyed by expression id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_expressions: Option<BTreeMap<String, f64>>,
    /// Model parameter overrides keyed by parameter id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_parameters: Option<BTreeMap<String, f64>>,
}

/// AIRI module assignments (`extensions.airi.modules`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriModules {
    /// Consciousness (LLM) module.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consciousness: Option<AiriConsciousnessModule>,
    /// Cognition sub-tree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cognition: Option<AiriCognition>,
    /// Speech (TTS) module.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speech: Option<AiriSpeechModule>,
    /// Active display model id (e.g. VRM/Live2D catalog id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_model_id: Option<String>,
    /// VRM model reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vrm: Option<AiriVrmModelRef>,
    /// Live2D model reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live2d: Option<AiriLive2dModelRef>,
    /// Preferred background id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_background_id: Option<String>,
    /// Preferred background display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_background_name: Option<String>,
    /// Preferred background inlined as a data URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_background_data_url: Option<String>,
}

/// Heartbeat proactivity configuration.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriHeartbeatContextOptions {
    /// Include recent chat history in the heartbeat prompt.
    pub window_history: bool,
    /// Include system load metrics.
    pub system_load: bool,
    /// Include usage metrics.
    pub usage_metrics: bool,
}

/// Heartbeat schedule window.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriHeartbeatSchedule {
    /// Window start, e.g. `"09:00"`.
    pub start: String,
    /// Window end, e.g. `"23:00"`.
    pub end: String,
}

/// Heartbeat proactivity configuration (`extensions.airi.heartbeats`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriHeartbeat {
    /// Whether heartbeats are enabled.
    pub enabled: bool,
    /// Interval between heartbeats in minutes.
    pub interval_minutes: f64,
    /// Prompt used to decide whether to message the user.
    pub prompt: String,
    /// Inject heartbeat results into the system prompt.
    pub inject_into_prompt: bool,
    /// Use the heartbeat decision as a local gate for other proactivity.
    pub use_as_local_gate: bool,
    /// Optional context toggles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_options: Option<AiriHeartbeatContextOptions>,
    /// Active schedule window.
    pub schedule: AiriHeartbeatSchedule,
    /// Pause heartbeats while the user is AFK.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_when_afk: Option<bool>,
    /// AFK threshold in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub afk_threshold_minutes: Option<f64>,
}

/// Dream journaling threshold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriJournalingThreshold {
    /// Only highly salient memories are journaled.
    Minimal,
    /// Balanced threshold (default).
    #[default]
    Balanced,
    /// Most turns are journaled.
    Lush,
}

/// Dream-state memory processing configuration (`extensions.airi.dreamState`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriDreamState {
    /// Whether dream consolidation runs.
    pub enabled: bool,
    /// Require AFK to run dreaming regardless of schedule.
    pub strict_afk_gating: bool,
    /// Journaling threshold for memory promotion.
    pub journaling_threshold: AiriJournalingThreshold,
    /// Maximum dream sessions per day.
    pub max_sessions_per_day: f64,
    /// Timeout for one dream session in minutes.
    pub session_timeout_minutes: f64,
    /// AFK threshold in minutes.
    pub afk_threshold_minutes: f64,
    /// Minimum conversation turns before dreaming runs.
    pub min_conversation_turns: f64,
    /// Last processed timestamp (unix ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_processed_at: Option<f64>,
    /// Local date of the last run (`YYYY-MM-DD`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_run_date: Option<String>,
    /// Number of runs on `daily_run_date`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_run_count: Option<f64>,
    /// Inject dream context into subsequent prompts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inject_dream_context: Option<bool>,
    /// Prompt used when a dream intrudes into the conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dream_intrusion_prompt: Option<String>,
    /// Pending dream chips queued for surfacing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_dream_chips: Option<Vec<String>>,
    /// Timestamp of the pending dream.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_dream_timestamp: Option<f64>,
    /// Mood of the pending dream.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_dream_mood: Option<String>,
    /// Recency-weighted salience threshold for journal promotion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journal_worthy_threshold: Option<f64>,
}

/// Pending entry for the text journal.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriPendingJournalMoment {
    /// The entry text to write.
    pub entry_text: String,
    /// Timestamp (unix ms) of the moment.
    pub timestamp: f64,
}

/// Short-term memory (daily summary) configuration (`extensions.airi.shortTermMemory`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriShortTermMemory {
    /// Whether STMM runs.
    pub enabled: bool,
    /// Number of days in the rolling window.
    pub window_size: f64,
    /// Token budget per day.
    pub token_budget_per_day: f64,
}

/// Lifetime memory (eternal thread) configuration (`extensions.airi.lifetimeMemory`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriLifetimeMemory {
    /// Whether lifetime memory is enabled.
    pub enabled: bool,
    /// Token budget for eternal artifacts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<f64>,
}

/// Screen-watching delivery mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiriScreenWatchingDeliveryMode {
    /// Deliver to both TTS and the chat bubble.
    #[serde(rename = "both")]
    Both,
    /// Chat bubble only.
    #[serde(rename = "bubble_only")]
    BubbleOnly,
    /// TTS only.
    #[serde(rename = "tts_only")]
    TtsOnly,
    /// Do not deliver.
    #[serde(rename = "off")]
    Off,
}

/// What the screen watcher captures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriScreenWatchingSourceType {
    /// All displays.
    Displays,
    /// Per-application windows.
    Applications,
    /// Automatically focused window.
    AutoFocused,
}

/// Screen-watching workload profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiriScreenWatchingWorkload {
    /// Attention guard (local, cheap).
    #[serde(rename = "attention-guard")]
    AttentionGuard,
    /// Screen interpretation via a vision model.
    #[serde(rename = "screen:interpret")]
    ScreenInterpret,
    /// Screen OCR.
    #[serde(rename = "screen:ocr")]
    ScreenOcr,
}

/// Vision tier used for VLM observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriScreenWatchingVlmTier {
    /// Lightweight local model.
    Lightweight,
    /// Moondream local model.
    Moondream,
    /// External vision provider.
    External,
}

/// Screen observation configuration (`extensions.airi.screenWatching`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriScreenWatching {
    /// Whether screen watching is enabled.
    pub enabled: bool,
    /// Delivery mode for observations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_mode: Option<AiriScreenWatchingDeliveryMode>,
    /// Capture source kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_type: Option<AiriScreenWatchingSourceType>,
    /// Source identifier (display id or application name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// Capture interval in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_interval_ms: Option<f64>,
    /// Downscale percentage for captured frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downscale_percent: Option<f64>,
    /// Workload profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workload: Option<AiriScreenWatchingWorkload>,
    /// Publish observations into ambient context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publish_to_context: Option<bool>,
    /// Interest tags used for gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interest_tags: Option<Vec<String>>,
    /// Defer observations while speaking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defer_while_speaking: Option<bool>,
    /// Maximum observations per hour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_per_hour: Option<f64>,
    /// Hysteresis (minutes) before repeating a similar observation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hysteresis_minutes: Option<f64>,
    /// Enable VLM-based interpretation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_vlm: Option<bool>,
    /// VLM tier to use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vlm_tier: Option<AiriScreenWatchingVlmTier>,
    /// Respect the user's schedule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub respect_schedule: Option<bool>,
    /// Pause while the user is AFK.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_when_afk: Option<bool>,
    /// AFK threshold in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub afk_threshold_minutes: Option<f64>,
}

/// Text journal configuration (`extensions.airi.textJournal`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriTextJournal {
    /// Instruction shown to the model for journal widget usage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widget_instruction: Option<String>,
    /// Inject journal context into prompts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inject_journal_context: Option<bool>,
    /// Prompt used when a journal moment intrudes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journal_intrusion_prompt: Option<String>,
    /// Pending journal moment queued for review.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_journal_moment: Option<AiriPendingJournalMoment>,
}

/// Sandbox configuration (`extensions.airi.sandbox`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriSandbox {
    /// Whether the sandbox is enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Instruction shown to the model for sandbox widget usage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widget_instruction: Option<String>,
}

/// Tool-call reflection configuration (`extensions.airi.toolCallReflection`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriToolCallReflection {
    /// Whether reflection runs after each tool call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Prompt template for the reflection turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_template: Option<String>,
}

/// Universe RAG retrieval settings (`extensions.airi.universeRag`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriUniverseRag {
    /// Whether Universe RAG is enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Minimum retrieval score.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_score: Option<f64>,
    /// Maximum candidates kept after scoring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_candidates: Option<f64>,
    /// Boost retrieval by document recency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporal_boost: Option<bool>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// One observed recent topic (`extensions.airi.recentTopics[]`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiriRecentTopic {
    /// Topic label.
    pub topic: String,
    /// Weight of the topic in retrieval.
    pub weight: f64,
}

/// First-hop processor override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriFirstHopProcessor {
    /// Default provider.
    Default,
    /// Local nan0 distilled model.
    #[serde(rename = "nan0")]
    Nan0,
    /// Universe RAG.
    #[serde(rename = "universe_rag")]
    UniverseRag,
}

/// Known generation options (`extensions.airi.generation.known`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriGenerationKnown {
    /// Maximum tokens to generate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<f64>,
    /// Sampling temperature.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    /// Nucleus sampling parameter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    /// Fall back to reasoning models when stuck.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_fallback: Option<bool>,
    /// Maximum tool steps per turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tool_steps: Option<f64>,
    /// Preserve tool call history across turns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserve_tool_history: Option<bool>,
}

/// Context compaction strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriCompactionStrategy {
    /// Keep everything (default).
    None,
    /// Prune oldest turns.
    Prune,
    /// Winnow low-value turns.
    Winnow,
    /// Distill old context into a summary.
    Distill,
}

/// Compaction configuration (`extensions.airi.generation.compaction`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriGenerationCompaction {
    /// Compaction strategy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strategy: Option<AiriCompactionStrategy>,
    /// Minimum number of turns to keep verbatim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_keep_turns: Option<f64>,
}

/// Provenance of an imported generation preset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriImportedPresetMeta {
    /// Source application/file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Original keys before normalization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_keys: Option<Vec<String>>,
    /// Import timestamp (ISO-8601).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_at: Option<String>,
}

/// Generation configuration (`extensions.airi.generation`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriGeneration {
    /// Whether the generation block overrides defaults.
    pub enabled: bool,
    /// Provider id override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Model id override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Well-known generation options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known: Option<AiriGenerationKnown>,
    /// Provider-specific advanced options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advanced: Option<BTreeMap<String, serde_json::Value>>,
    /// Context compaction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction: Option<AiriGenerationCompaction>,
    /// Provenance when the preset was imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_preset_meta: Option<AiriImportedPresetMeta>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Pacing profile preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriPacingProfile {
    /// Fast, low-latency.
    Snappy,
    /// Balanced default.
    Balanced,
    /// Deep chain-of-thought.
    DeepCot,
    /// User-customized values.
    Custom,
}

/// Thinking-filler category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriThinkingFillerCategory {
    /// Generic filler.
    #[default]
    Generic,
    /// Analytical musing.
    Analytical,
    /// Memory-related filler.
    Memory,
    /// Emotional filler.
    Emotional,
    /// Uncertainty filler.
    Uncertain,
}

/// One thinking filler (`extensions.airi.acting.pacing.fillers[]`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriThinkingFiller {
    /// Filler text to speak.
    pub text: String,
    /// Filler category.
    pub category: AiriThinkingFillerCategory,
    /// Whether the filler is enabled.
    pub enabled: bool,
}

/// Visual typing cadence for the chat widget.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriVisualTyping {
    /// Whether visual typing is enabled.
    pub enabled: bool,
    /// Minimum interval between keystrokes in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_interval_ms: Option<f64>,
    /// Maximum interval between keystrokes in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_interval_ms: Option<f64>,
    /// Experimental draft-and-retype behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experimental_draft_retype: Option<bool>,
}

/// Conversational pacing engine configuration (`extensions.airi.acting.pacing`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriPacing {
    /// Whether pacing is enabled.
    pub enabled: bool,
    /// Minimum arm delay in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arm_min_ms: Option<f64>,
    /// Maximum arm delay in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arm_max_ms: Option<f64>,
    /// Maximum filler duration in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_filler_duration_ms: Option<f64>,
    /// Reasoning window in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_window_ms: Option<f64>,
    /// Category threshold weight.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_threshold: Option<f64>,
    /// Fast-path multiplier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_fast: Option<f64>,
    /// Maximum fillers per turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_fillers_per_turn: Option<f64>,
    /// Pacing loop interval in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pacing_interval_ms: Option<f64>,
    /// Filler set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fillers: Option<Vec<AiriThinkingFiller>>,
    /// Enable dynamic conversational asides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dynamic_asides_enabled: Option<bool>,
    /// Enable the semantic extractor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_extractor_enabled: Option<bool>,
    /// Delay before dynamic asides in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dynamic_after_ms: Option<f64>,
    /// TTL for candidate asides in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_ttl_ms: Option<f64>,
    /// Synthesis budget for fillers in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_filler_synthesis_budget_ms: Option<f64>,
    /// Total synthesis budget in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_synthesis_budget_ms: Option<f64>,
    /// Pacing profile preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pacing_profile: Option<AiriPacingProfile>,
    /// Experimental organic pivots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experimental_organic_pivots: Option<bool>,
    /// Visual typing cadence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_typing: Option<AiriVisualTyping>,
}

/// Cadence (bubble splitting / inter-bubble pause) configuration.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriCadence {
    /// Split a long reply into multiple bubbles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multi_bubble_enabled: Option<bool>,
    /// Split threshold as a fraction (0.1–1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_threshold: Option<f64>,
    /// Pause between bubbles in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inter_bubble_pause_ms: Option<f64>,
    /// Typing cadence per character in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typing_cadence_ms_per_char: Option<f64>,
    /// Maximum bubbles per turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bubbles_per_turn: Option<f64>,
    /// Enable dynamic pacing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dynamic_pacing_enabled: Option<bool>,
    /// Rapid-burst cadence in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rapid_burst_ms: Option<f64>,
    /// Conversational beat cadence in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversational_beat_ms: Option<f64>,
    /// Thoughtful pause cadence in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thoughtful_pause_ms: Option<f64>,
    /// Maximum delay ceiling in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_delay_ceiling_ms: Option<f64>,
}

/// One emotion/motion entry in a cue allowlist.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriCueAllowlistEntry {
    /// Raw model-emitted key.
    pub raw_key: String,
    /// Human-readable label.
    pub label: String,
}

/// Allowed emotion/motion cues for a card.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriCueAllowlist {
    /// Schema version (always `1`).
    pub version: u8,
    /// Allowed emotions keyed by raw key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emotions: Option<BTreeMap<String, AiriCueAllowlistEntry>>,
    /// Allowed motions keyed by raw key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motions: Option<BTreeMap<String, AiriCueAllowlistEntry>>,
}

/// Acting persona/expression configuration (`extensions.airi.acting`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AiriActing {
    /// Prompt template for the model expression cue pass.
    pub model_expression_prompt: String,
    /// Prompt template for the speech expression cue pass.
    pub speech_expression_prompt: String,
    /// Prompt template for speech mannerisms.
    pub speech_mannerism_prompt: String,
    /// Idle animation ids to cycle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle_animations: Option<Vec<String>>,
    /// Conversational pacing engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pacing: Option<AiriPacing>,
    /// Bubble cadence configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence: Option<AiriCadence>,
    /// Allowlisted cues the card may emit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cue_allowlist: Option<AiriCueAllowlist>,
    /// Enable automatic cue emission.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_cues_enabled: Option<bool>,
    /// Enable automatic expression cues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_cue_expressions: Option<bool>,
    /// Enable automatic motion cues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_cue_motions: Option<bool>,
    /// Compiled whitelist (resolved at load time).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled_whitelist: Option<AiriCueAllowlist>,
    /// Prompt for sticker directives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sticker_directives_prompt: Option<String>,
    /// Active sticker ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_sticker_ids: Option<Vec<String>>,
    /// Enable sticker widgets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sticker_widgets_enabled: Option<bool>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// One custom sticker (`extensions.airi.stickers{}` value).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriCustomSticker {
    /// Stable sticker id.
    pub id: String,
    /// Display label.
    pub label: String,
    /// Author description.
    pub description: String,
    /// Emotion tags this sticker may accompany.
    pub emotions: Vec<String>,
    /// Creation timestamp (unix ms).
    pub created_at: f64,
    /// Inlined image payload as a data URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Outfit type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriOutfitType {
    /// Base outfit (full body replacement).
    Base,
    /// Overlay layered on top of the base outfit.
    Overlay,
}

/// One outfit entry (`extensions.airi.outfits[]`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriOutfit {
    /// Stable outfit id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Icon (Iconify reference).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Tag used for grouping in pickers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Mesh name patterns this outfit affects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meshes: Option<Vec<String>>,
    /// Outfit type (wire key: `type`).
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub outfit_type: Option<AiriOutfitType>,
    /// Expression weights applied while wearing this outfit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expressions: Option<BTreeMap<String, f64>>,
    /// Enabled by default for new installs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_enabled: Option<bool>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Autonomous artistry model selection mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiriArtistryAutonomousModelMode {
    /// Inherit the consciousness model.
    Inherit,
    /// Use a dedicated model.
    Custom,
}

/// Pending artistry moment queued for generation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiriPendingArtistryMoment {
    /// Prompt to render.
    pub prompt: String,
    /// Timestamp (unix ms) when the moment was queued.
    pub timestamp: f64,
}

/// Artistry (image generation) configuration (`extensions.airi.artistry`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriArtistry {
    /// Provider id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Model id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Prefix prepended to every prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_prefix: Option<String>,
    /// Instruction shown to the model for artistry widget usage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widget_instruction: Option<String>,
    /// Provider-specific options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<BTreeMap<String, serde_json::Value>>,
    /// Enable autonomous image generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_enabled: Option<bool>,
    /// Autonomous generation threshold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_threshold: Option<f64>,
    /// Turns of history considered by the autonomous trigger.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_history_depth: Option<f64>,
    /// Model selection mode for autonomous generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_model_mode: Option<AiriArtistryAutonomousModelMode>,
    /// Provider id for autonomous generation (custom mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_provider: Option<String>,
    /// Model id for autonomous generation (custom mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_model: Option<String>,
    /// Enable the autonomous monitor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_monitor_enabled: Option<bool>,
    /// Publish autonomous generations to Discord.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autonomous_monitor_discord_enabled: Option<bool>,
    /// Inject artistry context into prompts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inject_artistry_context: Option<bool>,
    /// Prompt used when an artistry moment intrudes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artistry_intrusion_prompt: Option<String>,
    /// Pending artistry moment queued for generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_artistry_moment: Option<AiriPendingArtistryMoment>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// One subordinate agent (`extensions.airi.agents{}` value).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriAgent {
    /// System prompt for the agent.
    pub prompt: String,
    /// Whether the agent is enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Image journal (selfie) configuration (`extensions.airi.imageJournal`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriImageJournal {
    /// Enable selfie capture in the image journal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selfie: Option<bool>,
}

/// Artistry options embedded in a visual asset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriVisualAssetArtistry {
    /// Provider id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Model id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Provider-specific options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<BTreeMap<String, serde_json::Value>>,
}

/// Manifestation (model-swap) embedded in a visual asset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriVisualAssetManifestation {
    /// Model id to swap to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Mood id to apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
}

/// One visual asset (`extensions.airi.visual_assets{}` value).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AiriVisualAsset {
    /// Description of the asset.
    pub description: String,
    /// Generation prompt for artistry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Whether this is the base (default) asset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_base: Option<bool>,
    /// Text color to use when this asset is active.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    /// Embedded artistry configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artistry: Option<AiriVisualAssetArtistry>,
    /// Embedded manifestation configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifestation: Option<AiriVisualAssetManifestation>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Eternal-record (lifetime artifact) seeds.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriEternalRecord {
    /// Relational milestone names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relational_milestones: Option<Vec<String>>,
    /// Lore bits for the eternal thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lore_bits: Option<Vec<String>>,
}

/// Counters tracked for proactive behavior.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AiriProactivityMetrics {
    /// TTS messages sent.
    #[serde(default)]
    pub tts_count: f64,
    /// STT events processed.
    #[serde(default)]
    pub stt_count: f64,
    /// Chat turns observed.
    #[serde(default)]
    pub chat_count: f64,
    /// Total turns recorded.
    #[serde(default)]
    pub total_turns: f64,
}

/// Active display/mood state persisted with the card.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiriActiveState {
    /// Active display model id.
    #[serde(
        default,
        rename = "displayModelId",
        skip_serializing_if = "Option::is_none"
    )]
    pub display_model_id: Option<String>,
    /// Active background id.
    #[serde(
        default,
        rename = "activeBackgroundId",
        skip_serializing_if = "Option::is_none"
    )]
    pub active_background_id: Option<String>,
    /// Active expression weights keyed by expression id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_expressions: Option<BTreeMap<String, f64>>,
}

/// RWKV model configuration (`extensions.airi.rwkv`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriRwkv {
    /// State cartridge id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_cartridge_id: Option<String>,
    /// State cartridge URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_cartridge_url: Option<String>,
    /// RWKV archetype.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archetype: Option<String>,
    /// Base model name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_model: Option<String>,
    /// Quantization label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    /// Recommended temperature.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_temperature: Option<f64>,
    /// Recommended top-p.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_top_p: Option<f64>,
    /// Whether the zero-prompt behavior was verified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zero_prompt_verified: Option<bool>,
    /// Conditioning turns for the cartridge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditioning_turns: Option<Vec<String>>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// AIRI extension root (`extensions.airi`).
///
/// Wire keys are mixed camelCase/snake_case to match the TS schema exactly
/// (`visual_assets`, `active_concepts`, ... are snake_case keys). Unknown
/// keys are preserved through `extra`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiriExtension {
    /// Module assignments (consciousness, speech, display model).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modules: Option<AiriModules>,
    /// Cognition sub-tree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cognition: Option<AiriCognition>,
    /// Heartbeat proactivity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heartbeats: Option<AiriHeartbeat>,
    /// Dream-state memory.
    #[serde(
        default,
        rename = "dreamState",
        skip_serializing_if = "Option::is_none"
    )]
    pub dream_state: Option<AiriDreamState>,
    /// Short-term memory.
    #[serde(
        default,
        rename = "shortTermMemory",
        skip_serializing_if = "Option::is_none"
    )]
    pub short_term_memory: Option<AiriShortTermMemory>,
    /// Lifetime memory.
    #[serde(
        default,
        rename = "lifetimeMemory",
        skip_serializing_if = "Option::is_none"
    )]
    pub lifetime_memory: Option<AiriLifetimeMemory>,
    /// Screen watching.
    #[serde(
        default,
        rename = "screenWatching",
        skip_serializing_if = "Option::is_none"
    )]
    pub screen_watching: Option<AiriScreenWatching>,
    /// Text journal.
    #[serde(
        default,
        rename = "textJournal",
        skip_serializing_if = "Option::is_none"
    )]
    pub text_journal: Option<AiriTextJournal>,
    /// Sandbox execution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<AiriSandbox>,
    /// Tool-call reflection.
    #[serde(
        default,
        rename = "toolCallReflection",
        skip_serializing_if = "Option::is_none"
    )]
    pub tool_call_reflection: Option<AiriToolCallReflection>,
    /// Enable grounding (retrieval grounding of replies).
    #[serde(
        default,
        rename = "groundingEnabled",
        skip_serializing_if = "Option::is_none"
    )]
    pub grounding_enabled: Option<bool>,
    /// Ground replies in memory retrieval.
    #[serde(
        default,
        rename = "groundingMemoryEnabled",
        skip_serializing_if = "Option::is_none"
    )]
    pub grounding_memory_enabled: Option<bool>,
    /// Ground replies in topic retrieval.
    #[serde(
        default,
        rename = "groundingTopicsEnabled",
        skip_serializing_if = "Option::is_none"
    )]
    pub grounding_topics_enabled: Option<bool>,
    /// Ground replies in the director scratchpad.
    #[serde(
        default,
        rename = "groundingDirectorScratchpadEnabled",
        skip_serializing_if = "Option::is_none"
    )]
    pub grounding_director_scratchpad_enabled: Option<bool>,
    /// Enable the salience gate.
    #[serde(
        default,
        rename = "salienceGateEnabled",
        skip_serializing_if = "Option::is_none"
    )]
    pub salience_gate_enabled: Option<bool>,
    /// First-hop processor override.
    #[serde(
        default,
        rename = "firstHopProcessor",
        skip_serializing_if = "Option::is_none"
    )]
    pub first_hop_processor: Option<AiriFirstHopProcessor>,
    /// Universe RAG retrieval settings.
    #[serde(
        default,
        rename = "universeRag",
        skip_serializing_if = "Option::is_none"
    )]
    pub universe_rag: Option<AiriUniverseRag>,
    /// Observed recent topics.
    #[serde(
        default,
        rename = "recentTopics",
        skip_serializing_if = "Option::is_none"
    )]
    pub recent_topics: Option<Vec<AiriRecentTopic>>,
    /// Generation overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<AiriGeneration>,
    /// Acting persona/cues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acting: Option<AiriActing>,
    /// Custom stickers keyed by sticker id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stickers: Option<BTreeMap<String, AiriCustomSticker>>,
    /// Outfits, in display order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outfits: Option<Vec<AiriOutfit>>,
    /// Artistry (image generation) configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artistry: Option<AiriArtistry>,
    /// Subordinate agents keyed by agent id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<BTreeMap<String, AiriAgent>>,
    /// Image journal (selfies).
    #[serde(
        default,
        rename = "imageJournal",
        skip_serializing_if = "Option::is_none"
    )]
    pub image_journal: Option<AiriImageJournal>,
    /// Visual assets keyed by asset id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_assets: Option<BTreeMap<String, AiriVisualAsset>>,
    /// Text color to use for this card's UI.
    #[serde(default, rename = "textColor", skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    /// Currently active concept tags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_concepts: Option<Vec<String>>,
    /// Eternal-record seeds (lifetime artifacts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eternal_record: Option<AiriEternalRecord>,
    /// Proactivity counters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proactivity_metrics: Option<AiriProactivityMetrics>,
    /// Persisted active display/mood state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_state: Option<AiriActiveState>,
    /// Voice profiles (free-form records, one per saved voice).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_profiles: Option<Vec<BTreeMap<String, serde_json::Value>>>,
    /// RWKV model state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rwkv: Option<AiriRwkv>,
    /// Unknown keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

// ============================================================================
// AIRI card editor document (`AiriCardSchema`)
// ============================================================================

/// AIRI-specific part of the editor document's `extensions` object.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiriCardExtensions {
    /// AIRI extension data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub airi: Option<AiriExtension>,
    /// Non-AIRI extension keys preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// AIRI card editor document (the shape the card editor loads/saves).
///
/// CamelCase wire format; converted to/from the CC v3 wire format by the
/// card export pipeline. `greetings[0]` is exported as `first_mes` and
/// `greetings[1..]` as `alternate_greetings`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiriCard {
    /// Card name (required).
    pub name: String,
    /// Nickname.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    /// Short tagline shown in pickers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    /// Author-supplied version string (required).
    pub version: String,
    /// Description / character definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Creator notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Personality summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    /// Scenario / setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario: Option<String>,
    /// System prompt override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// Instructions appended after the chat history.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_history_instructions: Option<String>,
    /// Greetings; `greetings[0]` is the opening message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub greetings: Option<Vec<String>>,
    /// Example dialogue as an array of turns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_example: Option<Vec<Vec<String>>>,
    /// Extension object (AIRI data lives under `airi`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<AiriCardExtensions>,
}

impl AiriCard {
    /// The AIRI extension sub-object, when present.
    pub fn airi_extension(&self) -> Option<&AiriExtension> {
        self.extensions.as_ref().and_then(|ext| ext.airi.as_ref())
    }
}

// ============================================================================
// PNG card import
// ============================================================================

/// tEXt/iTXt/zTXt keyword embedding a CC v3 card (base64 JSON).
pub const CCV3_KEYWORD: &str = "ccv3";
/// tEXt/iTXt/zTXt keyword embedding a legacy CC v2 card (base64 JSON).
pub const CHARA_KEYWORD: &str = "chara";

/// Extract a character card embedded in a `.png` file.
///
/// Scans the PNG's `tEXt`, `iTXt`, and `zTXt` chunks for a case-insensitive
/// `ccv3` or `chara` keyword (`ccv3` wins when both are present). The chunk
/// payload is base64-decoded (standard, no-pad, or URL-safe alphabet); if it
/// is not valid base64 it is parsed as raw UTF-8 JSON, which covers cards
/// embedded by writers that do not encode.
///
/// Note: the underlying PNG decoder reads metadata up to the first `IDAT`;
/// card keywords embedded after `IDAT` are not visible to this parser.
pub fn extract_card_from_png(bytes: &[u8]) -> Result<CharacterCard> {
    let decoder = png::Decoder::new(bytes);
    let reader = decoder.read_info().context("failed to decode PNG header")?;
    let info = reader.info();

    let mut found: Vec<(String, String, bool)> = Vec::new(); // (keyword, text, is_ccv3)
    let mut keywords: Vec<String> = Vec::new();
    for chunk in &info.uncompressed_latin1_text {
        keywords.push(chunk.keyword.clone());
        if let Some(is_ccv3) = match_card_keyword(&chunk.keyword) {
            found.push((chunk.keyword.clone(), chunk.text.clone(), is_ccv3));
        }
    }
    for chunk in &info.compressed_latin1_text {
        keywords.push(chunk.keyword.clone());
        if let Some(is_ccv3) = match_card_keyword(&chunk.keyword) {
            if let Ok(text) = chunk.get_text() {
                found.push((chunk.keyword.clone(), text, is_ccv3));
            }
        }
    }
    for chunk in &info.utf8_text {
        keywords.push(chunk.keyword.clone());
        if let Some(is_ccv3) = match_card_keyword(&chunk.keyword) {
            match chunk.get_text() {
                Ok(text) => found.push((chunk.keyword.clone(), text, is_ccv3)),
                Err(err) => {
                    bail!("failed to decode iTXt chunk {:?}: {err}", chunk.keyword)
                }
            }
        }
    }

    if found.is_empty() {
        bail!(
            "PNG contains no character card chunk (expected tEXt/iTXt keyword `ccv3` or `chara`; found keywords: [{}])",
            keywords.join(", ")
        );
    }

    // Prefer ccv3 over chara when both are embedded.
    found.sort_by_key(|(_, _, is_ccv3)| std::cmp::Reverse(*is_ccv3));
    let (keyword, payload, _) = found.remove(0);
    decode_card_payload(payload.trim()).with_context(|| {
        format!("failed to decode card payload from PNG chunk keyword {keyword:?}")
    })
}

/// Case-insensitive match of the card keywords; returns `Some(is_ccv3)`.
fn match_card_keyword(keyword: &str) -> Option<bool> {
    let lower = keyword.trim().to_ascii_lowercase();
    match lower.as_str() {
        "ccv3" => Some(true),
        "chara" => Some(false),
        _ => None,
    }
}

/// Base64-decode a card payload, falling back to raw UTF-8 JSON.
fn decode_card_payload(payload: &str) -> Result<CharacterCard> {
    use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};

    let decoded = STANDARD
        .decode(payload)
        .or_else(|_| STANDARD_NO_PAD.decode(payload))
        .or_else(|_| URL_SAFE.decode(payload))
        .or_else(|_| URL_SAFE_NO_PAD.decode(payload));
    match decoded {
        Ok(json) => parse_card_json(&json),
        Err(_) => parse_card_json(payload.as_bytes()),
    }
}

// ============================================================================
// Saving cards back (PNG tEXt rewrite / JSON serialize)
// ============================================================================

/// Write `bytes` to `path` atomically (temp file in the same directory + rename),
/// so a crash mid-save never leaves a half-written card file.
fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow::anyhow!("card path has no file name: {}", path.display()))?;
    let tmp = dir.join(format!(".{file_name}.tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes).with_context(|| format!("failed to write {}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .with_context(|| format!("failed to rename {} into place", path.display()))
}

/// Envelope JSON used both for embedding (PNG `tEXt` chunk) and for `.json` files.
///
/// Uses the same shape `parse_card_json` accepts: the spec-wrapped form.
pub fn card_to_json_bytes(card: &CharacterCard) -> Result<Vec<u8>> {
    let wrapped = WrappedCard {
        spec: card.spec,
        spec_version: card.spec_version.clone(),
        data: card.data.clone(),
    };
    Ok(serde_json::to_vec_pretty(&wrapped)?)
}

/// Rewrite an existing PNG card with a new card payload.
///
/// The CC spec keys `chara` (legacy v2) / `ccv3` (v3) are replaced with the
/// spec-appropriate keyword; every other chunk (IHDR, IDAT, …) is copied
/// verbatim, so the avatar pixels survive a re-save untouched. A iTXt/zTXt
/// variant with the same keyword is dropped too.
///
/// # Errors
/// Fails when the input is not a well-formed PNG, contains a chunk with a bad
/// CRC, or has trailing garbage after `IEND`.
pub fn write_card_png(png_bytes: &[u8], card: &CharacterCard) -> Result<Vec<u8>> {
    const SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if png_bytes.len() < 8 || png_bytes[..8] != SIG[..] {
        bail!("not a PNG file (bad signature)");
    }

    let chunks = walk_png_chunks(png_bytes)?;
    // Drop card-payload chunks; everything else goes verbatim.
    let mut kept: Vec<&[u8]> = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        if is_card_payload_chunk(chunk, png_bytes) {
            continue;
        }
        kept.push(&png_bytes[chunk.start..chunk.start + chunk.raw_len]);
    }

    let payload = base64::engine::general_purpose::STANDARD.encode(card_to_json_bytes(card)?);
    let keyword = if card.spec == CardSpec::V3 {
        "ccv3"
    } else {
        "chara"
    };
    let mut text_data = Vec::with_capacity(keyword.len() + 1 + payload.len());
    text_data.extend_from_slice(keyword.as_bytes());
    text_data.push(0);
    text_data.extend_from_slice(payload.as_bytes());
    let new_chunk = encode_png_chunk(*b"tEXt", &text_data);

    let mut out = Vec::with_capacity(png_bytes.len() + new_chunk.len());
    out.extend_from_slice(SIG);
    let mut inserted = false;
    for chunk_bytes in kept {
        // PNG text metadata must precede image data for readers that stop
        // parsing chunks at the first IDAT (the `png` crate's `read_info`).
        if !inserted && chunk_bytes.len() >= 8 && &chunk_bytes[4..8] == b"IDAT" {
            out.extend_from_slice(&new_chunk);
            inserted = true;
        }
        out.extend_from_slice(chunk_bytes);
    }
    // Degenerate case: no IDAT (malformed but passed the CRC walk) — append
    // before IEND anyway so the payload is recoverable.
    if !inserted {
        out.extend_from_slice(&new_chunk);
    }
    Ok(out)
}

/// Save a card to `path`, dispatching on extension: `.png` cards get their
/// embedded payload re-written, everything else is serialized as pretty JSON.
///
/// # Errors
/// See [`write_card_png`]. Also fails when the extension is `.png` but the
/// existing file is not a well-formed PNG.
pub fn save_card_file(path: &std::path::Path, card: &CharacterCard) -> Result<()> {
    let is_png = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("png"));
    if is_png {
        let old = std::fs::read(path).context("failed to read the existing PNG card")?;
        let new_bytes = write_card_png(&old, card)?;
        return atomic_write(path, &new_bytes);
    }
    let bytes = card_to_json_bytes(card)?;
    atomic_write(path, &bytes)
}

struct PngChunk {
    start: usize,
    raw_len: usize,
    keyword_stride: Option<usize>,
}

fn walk_png_chunks(bytes: &[u8]) -> Result<Vec<PngChunk>> {
    let mut chunks = Vec::new();
    let mut pos = 8usize;
    loop {
        if bytes.len() < pos + 12 {
            bail!("truncated PNG (need ≥12 more bytes at offset {pos})");
        }
        let len = u32::from_be_bytes(bytes[pos..pos + 4].try_into().unwrap()) as usize;
        let type_bytes: [u8; 4] = bytes[pos + 4..pos + 8].try_into().unwrap();
        let data_start = pos + 8;
        let data_end = data_start
            .checked_add(len)
            .ok_or_else(|| anyhow::anyhow!("PNG chunk length overflow at offset {pos}"))?;
        let crc_end = data_end
            .checked_add(4)
            .ok_or_else(|| anyhow::anyhow!("PNG CRC offset overflow at offset {pos}"))?;
        if crc_end > bytes.len() {
            bail!("truncated PNG chunk at offset {pos} (chunk extends past end of file)");
        }
        let stored_crc = u32::from_be_bytes(bytes[data_end..crc_end].try_into().unwrap());
        let computed_crc = png_crc32(&bytes[pos + 4..data_end]);
        if stored_crc != computed_crc {
            bail!("PNG chunk at offset {pos} has a bad CRC (stored {stored_crc:#010x}, computed {computed_crc:#010x})");
        }
        let type_str = std::str::from_utf8(&type_bytes).context("PNG chunk type is not ASCII")?;
        let stride = if matches!(type_str, "tEXt" | "iTXt" | "zTXt") {
            bytes[data_start..data_end].iter().position(|b| *b == 0)
        } else {
            None
        };
        chunks.push(PngChunk {
            start: pos,
            raw_len: crc_end - pos,
            keyword_stride: stride,
        });
        pos = crc_end;
        if &type_bytes == b"IEND" {
            break;
        }
    }
    if pos != bytes.len() {
        bail!(
            "trailing garbage after PNG IEND ({} extra bytes)",
            bytes.len() - pos
        );
    }
    Ok(chunks)
}

fn is_card_payload_chunk(chunk: &PngChunk, bytes: &[u8]) -> bool {
    let Some(stride) = chunk.keyword_stride else {
        return false;
    };
    let data_start = chunk.start + 8;
    let keyword_raw = &bytes[data_start..data_start + stride];
    let keyword = String::from_utf8_lossy(keyword_raw).to_ascii_lowercase();
    if !(&bytes[chunk.start + 4..chunk.start + 8] == b"tEXt"
        || &bytes[chunk.start + 4..chunk.start + 8] == b"iTXt"
        || &bytes[chunk.start + 4..chunk.start + 8] == b"zTXt")
    {
        return false;
    }
    keyword == "chara" || keyword == "ccv3"
}

fn encode_png_chunk(kind: [u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend_from_slice(&u32::try_from(data.len()).unwrap_or(u32::MAX).to_be_bytes());
    out.extend_from_slice(&kind);
    out.extend_from_slice(data);
    let crc = png_crc32(&out[4..4 + 4 + data.len()]);
    out.extend_from_slice(&crc.to_be_bytes());
    out
}

/// Table-driven CRC-32 (IEEE polynomial, reflected), as required by the PNG spec.
fn png_crc32(bytes: &[u8]) -> u32 {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (i, slot) in table.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    (c >> 1) ^ 0xEDB8_8320
                } else {
                    c >> 1
                };
            }
            *slot = c;
        }
        table
    });
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in bytes {
        crc = table[((crc ^ u32::from(byte)) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

#[cfg(test)]
mod png_write_tests {
    use super::*;

    fn sample_card() -> CharacterCard {
        let json = serde_json::json!({
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Test Character",
                "description": "A test card",
                "personality": "curious",
                "scenario": "test bench",
                "first_mes": "Hello!",
                "mes_example": "<START>"
            }
        });
        let text = json.to_string();
        parse_card_json(text.as_bytes()).expect("fixture card must parse")
    }

    fn tiny_png() -> Vec<u8> {
        // 8x8 opaque red RGBA image encoded with the `png` crate.
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, 8, 8);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("header");
        let mut rows = vec![0u8; 8 * 8 * 4];
        for chunk in rows.as_chunks_mut::<4>().0 {
            chunk.copy_from_slice(&[255, 0, 0, 255]);
        }
        writer.write_image_data(&rows).expect("write image data");
        writer.finish().expect("finish PNG fixture");
        out
    }

    #[test]
    fn crc32_matches_known_vector() {
        // PNG spec example: CRC of "IHDR" + 13 zero-ish bytes is implementation
        // defined; just assert self-consistency against a hand-computed value
        // (CRC-32 of ASCII "123456789" = 0xCBF43926).
        assert_eq!(png_crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn write_card_png_replaces_payload_and_preserves_idat() {
        let card = sample_card();
        let png = tiny_png();
        let with_card = write_card_png(&png, &card).expect("rewrite");
        let extracted = extract_card_from_png(&with_card).expect("extract");
        assert_eq!(extracted.name(), "Test Character");
        assert_eq!(extracted.spec, CardSpec::V3);
        // Image bytes (IDAT) must be byte-identical between the two files.
        fn idat_of(bytes: &[u8]) -> Vec<&[u8]> {
            walk_png_chunks(bytes)
                .unwrap()
                .iter()
                .filter(|c| &bytes[c.start + 4..c.start + 8] == b"IDAT")
                .map(|c| &bytes[c.start..c.start + c.raw_len])
                .collect()
        }
        assert_eq!(idat_of(&with_card), idat_of(&png));
    }

    #[test]
    fn write_card_png_overwrites_existing_chara_chunk() {
        let card = sample_card();
        // Inject a bogus chara chunk first.
        let png = tiny_png();
        let first = write_card_png(&png, &card).expect("first write");
        let mut stale = sample_card();
        stale.data.name = "Stale Name".into();
        let second = write_card_png(&first, &stale).expect("second write");
        let extracted = extract_card_from_png(&second).expect("extract");
        assert_eq!(extracted.name(), "Stale Name");
        let third = write_card_png(&second, &card).expect("third write");
        let extracted = extract_card_from_png(&third).expect("extract");
        assert_eq!(extracted.name(), "Test Character");
    }

    #[test]
    fn save_card_file_json_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let card = sample_card();
        let path = dir.path().join("roundtrip.json");
        save_card_file(&path, &card).expect("save");
        let bytes = std::fs::read(&path).expect("read");
        let parsed = parse_card_json(&bytes).expect("parse");
        assert_eq!(parsed.name(), "Test Character");
    }

    #[test]
    fn save_card_file_png_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("roundtrip.png");
        std::fs::write(&path, tiny_png()).expect("write fixture");
        let card = sample_card();
        save_card_file(&path, &card).expect("save");
        let bytes = std::fs::read(&path).expect("read");
        let parsed = extract_card_from_png(&bytes).expect("extract");
        assert_eq!(parsed.name(), "Test Character");
    }

    #[test]
    fn malformed_png_is_rejected() {
        let err = write_card_png(b"not a png", &sample_card()).unwrap_err();
        assert!(err.to_string().contains("not a PNG"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use base64::engine::general_purpose::STANDARD as B64;

    fn sample_v3_json() -> serde_json::Value {
        serde_json::json!({
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Testris",
                "description": "A test character",
                "personality": "Curious",
                "scenario": "A test scenario",
                "first_mes": "Hello, traveler.",
                "mes_example": "<START>\n{{char}}: hi",
                "alternate_greetings": ["Welcome!", "Oh, it's you."],
                "group_only_greetings": ["Group hello"],
                "character_version": "1.2.3",
                "creator": "test-suite",
                "creator_notes": "notes",
                "system_prompt": "be curious",
                "post_history_instructions": "stay in character",
                "tags": ["test", "fixture"],
                "creation_date": 1_700_000_000_000_i64,
                "modification_date": 1_700_000_100_000_i64,
                "nickname": "Tess",
                "source": ["https://example.com/source"],
                "assets": [
                    { "ext": "png", "name": "icon", "type": "icon", "uri": "ccdefault:" }
                ],
                "extensions": {
                    "talkativeness": 0.7,
                    "depth_prompt": { "depth": 4, "prompt": "remember the test", "role": "system" },
                    "airi": {
                        "modules": {
                            "consciousness": { "provider": "openai-compatible", "model": "gpt-test" },
                            "speech": { "provider": "speech-noop", "model": "tts-test", "voice_id": "voice-1", "pitch": 1.5 },
                            "displayModelId": "vrm-test-model"
                        },
                        "heartbeats": {
                            "enabled": true,
                            "intervalMinutes": 15.0,
                            "prompt": "ping?",
                            "injectIntoPrompt": true,
                            "useAsLocalGate": false,
                            "schedule": { "start": "09:00", "end": "23:00" }
                        },
                        "groundingEnabled": true,
                        "visual_assets": {
                            "base": { "description": "standing", "isBase": true, "textColor": "#fff" }
                        },
                        "proactivity_metrics": { "ttsCount": 3.0, "sttCount": 4.0, "chatCount": 5.0, "totalTurns": 9.0 }
                    }
                }
            }
        })
    }

    fn sample_v2_json() -> serde_json::Value {
        serde_json::json!({
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": {
                "name": "Legacy Lora",
                "description": "A v2 card",
                "personality": "calm",
                "scenario": "a library",
                "first_mes": "Shh.",
                "mes_example": "",
                "alternate_greetings": [],
                "group_only_greetings": [],
                "character_version": "0.1",
                "creator": "someone",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": [],
                "extensions": {}
            }
        })
    }

    fn encode_fixture_v3() -> Vec<u8> {
        serde_json::to_vec(&sample_v3_json()).unwrap()
    }

    #[test]
    fn parses_v3_card_with_airi_extension() {
        let card = parse_card_json(&encode_fixture_v3()).unwrap();
        assert_eq!(card.spec, CardSpec::V3);
        assert_eq!(card.spec_version.as_deref(), Some("3.0"));
        assert_eq!(card.name(), "Testris");
        assert_eq!(card.primary_greeting(), Some("Hello, traveler."));
        assert_eq!(card.alternate_greetings(), &["Welcome!", "Oh, it's you."]);
        assert_eq!(card.data.group_only_greetings, vec!["Group hello"]);
        assert_eq!(card.data.assets.as_ref().unwrap().len(), 1);

        let airi = card.airi_extension().expect("airi extension missing");
        let modules = airi.modules.as_ref().unwrap();
        assert_eq!(modules.consciousness.as_ref().unwrap().model, "gpt-test");
        assert_eq!(modules.speech.as_ref().unwrap().pitch, Some(1.5));
        assert_eq!(modules.display_model_id.as_deref(), Some("vrm-test-model"));
        let heartbeats = airi.heartbeats.as_ref().unwrap();
        assert!(heartbeats.enabled);
        assert_eq!(heartbeats.interval_minutes, 15.0);
        assert!(airi.grounding_enabled.unwrap());
        let visual = airi.visual_assets.as_ref().unwrap().get("base").unwrap();
        assert_eq!(visual.text_color.as_deref(), Some("#fff"));
        assert_eq!(airi.proactivity_metrics.as_ref().unwrap().total_turns, 9.0);

        // Round-trip preserves the airi extension.
        let serialized = serde_json::to_vec(&card).unwrap();
        let reparsed = parse_card_json(&serialized).unwrap();
        assert_eq!(card, reparsed);
    }

    #[test]
    fn parses_v2_card() {
        let card = parse_card_json(&serde_json::to_vec(&sample_v2_json()).unwrap()).unwrap();
        assert_eq!(card.spec, CardSpec::V2);
        assert_eq!(card.name(), "Legacy Lora");
        assert!(card.airi_extension().is_none());
        // Defaults for missing v3-only fields.
        assert!(card.data.assets.is_none());
        assert_eq!(card.data.group_only_greetings, Vec::<String>::new());
    }

    #[test]
    fn parses_legacy_flat_v1_card() {
        let flat = serde_json::json!({
            "name": "Flat Fiona",
            "description": "flat",
            "first_mes": "hey",
            "personality": "",
            "scenario": "",
            "mes_example": ""
        });
        let card = parse_card_json(&serde_json::to_vec(&flat).unwrap()).unwrap();
        assert_eq!(card.spec, CardSpec::V2);
        assert!(card.spec_version.is_none());
        assert_eq!(card.name(), "Flat Fiona");
    }

    #[test]
    fn unknown_keys_survive_round_trip() {
        let mut json = sample_v3_json();
        json["data"]["x_vendor_probe"] = serde_json::json!({"nested": [1, 2, 3]});
        json["data"]["extensions"]["vendor_key"] = serde_json::json!("vendor");
        let card = parse_card_json(&serde_json::to_vec(&json).unwrap()).unwrap();
        assert_eq!(card.data.extra["x_vendor_probe"]["nested"][1], 2);
        assert_eq!(card.data.extensions.extra["vendor_key"], "vendor");
        let reparsed = parse_card_json(&serde_json::to_vec(&card).unwrap()).unwrap();
        assert_eq!(reparsed.data.extra["x_vendor_probe"]["nested"][2], 3);
    }

    #[test]
    fn lorebook_entry_round_trip() {
        let book = CharacterBook {
            description: Some("book".to_string()),
            entries: vec![CharacterBookEntry {
                case_sensitive: None,
                comment: None,
                constant: Some(true),
                content: "tea lore".to_string(),
                enabled: true,
                extensions: BTreeMap::new(),
                id: Some(1.0),
                insertion_order: 10.0,
                keys: vec!["tea".to_string()],
                name: Some("Tea".to_string()),
                position: Some(CharacterBookEntryPosition::BeforeChar),
                priority: Some(100.0),
                secondary_keys: None,
                selective: Some(false),
            }],
            extensions: BTreeMap::new(),
            name: Some("Lore".to_string()),
            recursive_scanning: Some(false),
            scan_depth: Some(4.0),
            token_budget: Some(500.0),
        };
        let json = serde_json::to_string(&book).unwrap();
        let reparsed: CharacterBook = serde_json::from_str(&json).unwrap();
        assert_eq!(reparsed, book);
        assert_eq!(
            reparsed.entries[0].position,
            Some(CharacterBookEntryPosition::BeforeChar)
        );
    }

    #[test]
    fn airi_card_document_round_trip() {
        let doc = AiriCard {
            name: "Editor Card".to_string(),
            version: "1.0".to_string(),
            greetings: Some(vec!["hi".to_string()]),
            message_example: Some(vec![vec![
                "{{user}}: hey".to_string(),
                "{{char}}: hello".to_string(),
            ]]),
            extensions: Some(AiriCardExtensions {
                airi: Some(AiriExtension {
                    grounding_enabled: Some(true),
                    ..AiriExtension::default()
                }),
                extra: BTreeMap::from([("vendor".to_string(), serde_json::json!(1))]),
            }),
            ..AiriCard::default()
        };
        let json = serde_json::to_string(&doc).unwrap();
        let reparsed: AiriCard = serde_json::from_str(&json).unwrap();
        assert_eq!(reparsed, doc);
        assert_eq!(reparsed.extensions.as_ref().unwrap().extra["vendor"], 1);
        assert!(reparsed
            .airi_extension()
            .unwrap()
            .grounding_enabled
            .unwrap());
    }

    // --- PNG fixtures --------------------------------------------------

    fn minimal_png_with_text_chunk(keyword: &str, text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .add_text_chunk(keyword.to_string(), text.to_string())
                .unwrap();
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[0, 0, 0]).unwrap();
        }
        out
    }

    #[test]
    fn png_extracts_ccv3_card() {
        let payload = B64.encode(serde_json::to_vec(&sample_v3_json()).unwrap());
        let png_bytes = minimal_png_with_text_chunk("ccv3", &payload);
        let card = extract_card_from_png(&png_bytes).unwrap();
        assert_eq!(card.spec, CardSpec::V3);
        assert_eq!(card.name(), "Testris");
        assert!(card.airi_extension().is_some());
    }

    #[test]
    fn png_extracts_legacy_chara_v2_card() {
        let payload = B64.encode(serde_json::to_vec(&sample_v2_json()).unwrap());
        let png_bytes = minimal_png_with_text_chunk("chara", &payload);
        let card = extract_card_from_png(&png_bytes).unwrap();
        assert_eq!(card.spec, CardSpec::V2);
        assert_eq!(card.name(), "Legacy Lora");
    }

    #[test]
    fn png_ccv3_keyword_wins_over_chara() {
        let v3 = B64.encode(serde_json::to_vec(&sample_v3_json()).unwrap());
        let v2 = B64.encode(serde_json::to_vec(&sample_v2_json()).unwrap());
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.add_text_chunk("chara".to_string(), v2).unwrap();
            encoder.add_text_chunk("ccv3".to_string(), v3).unwrap();
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[0, 0, 0]).unwrap();
        }
        let card = extract_card_from_png(&out).unwrap();
        assert_eq!(card.spec, CardSpec::V3);
    }

    #[test]
    fn png_keywords_are_case_insensitive() {
        let payload = B64.encode(serde_json::to_vec(&sample_v3_json()).unwrap());
        let png_bytes = minimal_png_with_text_chunk("CCV3", &payload);
        let card = extract_card_from_png(&png_bytes).unwrap();
        assert_eq!(card.name(), "Testris");
    }

    #[test]
    fn png_raw_json_payload_is_accepted() {
        let raw = String::from_utf8(serde_json::to_vec(&sample_v3_json()).unwrap()).unwrap();
        let png_bytes = minimal_png_with_text_chunk("ccv3", &raw);
        let card = extract_card_from_png(&png_bytes).unwrap();
        assert_eq!(card.name(), "Testris");
    }

    #[test]
    fn png_itxt_chunk_is_supported() {
        let payload = B64.encode(serde_json::to_vec(&sample_v3_json()).unwrap());
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.add_itxt_chunk("ccv3".to_string(), payload).unwrap();
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[0, 0, 0]).unwrap();
        }
        let card = extract_card_from_png(&out).unwrap();
        assert_eq!(card.name(), "Testris");
    }

    #[test]
    fn png_without_card_chunk_errors_with_keywords() {
        let png_bytes = minimal_png_with_text_chunk("notacard", "hello");
        let err = extract_card_from_png(&png_bytes).unwrap_err();
        let msg = format!("{err:#}");
        assert!(msg.contains("ccv3"), "unexpected message: {msg}");
        assert!(msg.contains("notacard"), "unexpected message: {msg}");
    }

    #[test]
    fn png_garbage_bytes_error() {
        let err = extract_card_from_png(b"not a png").unwrap_err();
        assert!(format!("{err:#}").contains("PNG"));
    }

    #[test]
    fn invalid_spec_is_rejected() {
        let doc = serde_json::json!({
            "spec": "chara_card_v9",
            "data": { "name": "Nope" }
        });
        assert!(parse_card_json(&serde_json::to_vec(&doc).unwrap()).is_err());
    }
}

#[cfg(test)]
mod wire_format_tests {
    use super::*;

    /// A realistic `extensions.airi` payload as written by the TS app,
    /// exercising mixed camelCase/snake_case wire keys.
    fn airi_blob() -> serde_json::Value {
        serde_json::json!({
            "modules": {
                "consciousness": { "provider": "anthropic", "model": "claude-sonnet-4-5", "moduleConfigs": { "temperature": 0.7 } },
                "speech": { "provider": "speech-noop", "model": "tts", "voice_id": "nova", "rate": 1.1, "ssml": true },
                "live2d": { "source": "file", "file": "model.model3.json", "activeExpressions": { "smile": 0.8 }, "modelParameters": { "ParamEyeBallX": 1.0 } },
                "displayModelId": "live2d-test"
            },
            "dreamState": {
                "enabled": true,
                "strictAfkGating": false,
                "journalingThreshold": "balanced",
                "maxSessionsPerDay": 2.0,
                "sessionTimeoutMinutes": 30.0,
                "afkThresholdMinutes": 10.0,
                "minConversationTurns": 6.0
            },
            "shortTermMemory": { "enabled": true, "windowSize": 3.0, "tokenBudgetPerDay": 1000.0 },
            "lifetimeMemory": { "enabled": true, "tokenBudget": 800.0 },
            "screenWatching": { "enabled": false, "deliveryMode": "bubble_only", "sourceType": "auto_focused", "workload": "screen:interpret", "vlmTier": "moondream" },
            "toolCallReflection": { "enabled": true, "promptTemplate": "reflect" },
            "salienceGateEnabled": true,
            "firstHopProcessor": "nan0",
            "generation": { "enabled": true, "known": { "maxTokens": 512.0, "reasoningFallback": true, "preserveToolHistory": false }, "compaction": { "strategy": "winnow", "minKeepTurns": 4.0 } },
            "acting": {
                "modelExpressionPrompt": "expr",
                "speechExpressionPrompt": "speech",
                "speechMannerismPrompt": "mannerism",
                "autoCuesEnabled": true,
                "pacing": { "enabled": true, "kFast": 0.5, "maxFillersPerTurn": 2.0, "pacingProfile": "snappy", "visualTyping": { "enabled": true, "minIntervalMs": 10.0 } },
                "cadence": { "multiBubbleEnabled": true, "splitThreshold": 0.6 },
                "cueAllowlist": { "version": 1, "emotions": { "smile": { "rawKey": "joy", "label": "Smile" } } }
            },
            "outfits": [
                { "id": "casual", "name": "Casual", "type": "base", "defaultEnabled": true }
            ],
            "artistry": { "autonomousModelMode": "inherit", "autonomousThreshold": 0.75, "pendingArtistryMoment": { "prompt": "draw", "timestamp": 1_700_000_000_000.0 } },
            "agents": { "helper": { "prompt": "help", "enabled": true } },
            "imageJournal": { "selfie": true },
            "visual_assets": { "base": { "description": "standing", "isBase": true, "textColor": "#fff", "artistry": { "provider": "comfyui", "model": "sdxl" }, "manifestation": { "modelId": "m1", "mood": "calm" } } },
            "textColor": "#ffddaa",
            "active_concepts": ["tea"],
            "eternal_record": { "relational_milestones": ["met at the cafe"], "lore_bits": ["likes tea"] },
            "proactivity_metrics": { "ttsCount": 1.0, "sttCount": 2.0, "chatCount": 3.0, "totalTurns": 4.0 },
            "active_state": { "displayModelId": "live2d-test", "activeBackgroundId": "bg-1", "active_expressions": { "smile": 0.5 } },
            "voice_profiles": [{ "name": "nova" }],
            "rwkv": { "stateCartridgeId": "cart-1", "recommendedTopP": 0.9, "zeroPromptVerified": true, "conditioningTurns": ["a"] }
        })
    }

    fn card_with_airi(airi: serde_json::Value) -> CharacterCard {
        let doc = serde_json::json!({
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Wire Fixture",
                "first_mes": "hi",
                "alternate_greetings": [],
                "group_only_greetings": [],
                "extensions": { "airi": airi }
            }
        });
        parse_card_json(&serde_json::to_vec(&doc).unwrap()).unwrap()
    }

    #[test]
    fn ts_wire_blob_parses_into_typed_structs() {
        let card = card_with_airi(airi_blob());
        let airi = card.airi_extension().unwrap();

        let modules = airi.modules.as_ref().unwrap();
        assert_eq!(
            modules
                .consciousness
                .as_ref()
                .unwrap()
                .module_configs
                .as_ref()
                .unwrap()["temperature"],
            0.7
        );
        assert_eq!(modules.speech.as_ref().unwrap().voice_id, "nova");
        let live2d = modules.live2d.as_ref().unwrap();
        assert_eq!(live2d.active_expressions.as_ref().unwrap()["smile"], 0.8);
        assert_eq!(
            live2d.model_parameters.as_ref().unwrap()["ParamEyeBallX"],
            1.0
        );

        let dream = airi.dream_state.as_ref().unwrap();
        assert_eq!(
            dream.journaling_threshold,
            AiriJournalingThreshold::Balanced
        );
        assert_eq!(dream.max_sessions_per_day, 2.0);

        assert_eq!(
            airi.short_term_memory
                .as_ref()
                .unwrap()
                .token_budget_per_day,
            1000.0
        );
        assert_eq!(
            airi.lifetime_memory.as_ref().unwrap().token_budget,
            Some(800.0)
        );
        let sw = airi.screen_watching.as_ref().unwrap();
        assert_eq!(
            sw.delivery_mode,
            Some(AiriScreenWatchingDeliveryMode::BubbleOnly)
        );
        assert_eq!(
            sw.workload,
            Some(AiriScreenWatchingWorkload::ScreenInterpret)
        );
        assert_eq!(sw.vlm_tier, Some(AiriScreenWatchingVlmTier::Moondream));

        assert_eq!(airi.first_hop_processor, Some(AiriFirstHopProcessor::Nan0));
        let generation = airi.generation.as_ref().unwrap();
        assert_eq!(generation.known.as_ref().unwrap().max_tokens, Some(512.0));
        assert_eq!(
            generation.compaction.as_ref().unwrap().strategy,
            Some(AiriCompactionStrategy::Winnow)
        );

        let acting = airi.acting.as_ref().unwrap();
        assert!(acting.auto_cues_enabled.unwrap());
        let pacing = acting.pacing.as_ref().unwrap();
        assert_eq!(pacing.k_fast, Some(0.5));
        assert_eq!(pacing.pacing_profile, Some(AiriPacingProfile::Snappy));
        assert!(pacing.visual_typing.as_ref().unwrap().enabled);
        assert!(acting
            .cadence
            .as_ref()
            .unwrap()
            .multi_bubble_enabled
            .unwrap());
        let allowlist = acting.cue_allowlist.as_ref().unwrap();
        assert_eq!(allowlist.version, 1);
        assert_eq!(allowlist.emotions.as_ref().unwrap()["smile"].raw_key, "joy");

        let outfit = &airi.outfits.as_ref().unwrap()[0];
        assert_eq!(outfit.outfit_type, Some(AiriOutfitType::Base));
        assert_eq!(outfit.default_enabled, Some(true));

        let artistry = airi.artistry.as_ref().unwrap();
        assert_eq!(
            artistry.autonomous_model_mode,
            Some(AiriArtistryAutonomousModelMode::Inherit)
        );
        assert_eq!(
            artistry.pending_artistry_moment.as_ref().unwrap().prompt,
            "draw"
        );

        assert!(airi.agents.as_ref().unwrap()["helper"].enabled.unwrap());
        assert!(airi.image_journal.as_ref().unwrap().selfie.unwrap());

        let visual = &airi.visual_assets.as_ref().unwrap()["base"];
        assert_eq!(visual.text_color.as_deref(), Some("#fff"));
        assert_eq!(
            visual.artistry.as_ref().unwrap().provider.as_deref(),
            Some("comfyui")
        );
        assert_eq!(
            visual.manifestation.as_ref().unwrap().model_id.as_deref(),
            Some("m1")
        );

        assert_eq!(airi.text_color.as_deref(), Some("#ffddaa"));
        assert_eq!(
            airi.active_concepts.as_ref().unwrap(),
            &vec!["tea".to_string()]
        );
        assert_eq!(
            airi.eternal_record
                .as_ref()
                .unwrap()
                .lore_bits
                .as_ref()
                .unwrap()[0],
            "likes tea"
        );

        let state = airi.active_state.as_ref().unwrap();
        assert_eq!(state.display_model_id.as_deref(), Some("live2d-test"));
        assert_eq!(state.active_expressions.as_ref().unwrap()["smile"], 0.5);

        let rwkv = airi.rwkv.as_ref().unwrap();
        assert_eq!(rwkv.recommended_top_p, Some(0.9));
        assert!(rwkv.zero_prompt_verified.unwrap());

        // Full round trip: parse(serialize(x)) == x
        let serialized = serde_json::to_vec(&card).unwrap();
        let reparsed = parse_card_json(&serialized).unwrap();
        assert_eq!(card, reparsed);
    }

    #[test]
    fn serialized_blob_keeps_ts_wire_keys() {
        let card = card_with_airi(airi_blob());
        let value = serde_json::to_value(&card).unwrap();
        let airi = &value["data"]["extensions"]["airi"];
        assert_eq!(airi["modules"]["displayModelId"], "live2d-test");
        assert_eq!(airi["modules"]["live2d"]["activeExpressions"]["smile"], 0.8);
        assert_eq!(airi["dreamState"]["journalingThreshold"], "balanced");
        assert_eq!(airi["visual_assets"]["base"]["textColor"], "#fff");
        assert_eq!(airi["visual_assets"]["base"]["isBase"], true);
        assert_eq!(
            airi["visual_assets"]["base"]["manifestation"]["modelId"],
            "m1"
        );
        assert_eq!(airi["textColor"], "#ffddaa");
        assert_eq!(airi["active_state"]["displayModelId"], "live2d-test");
        assert_eq!(airi["active_state"]["active_expressions"]["smile"], 0.5);
        assert_eq!(airi["acting"]["modelExpressionPrompt"], "expr");
        assert_eq!(
            airi["acting"]["cueAllowlist"]["emotions"]["smile"]["rawKey"],
            "joy"
        );
        assert_eq!(airi["outfits"][0]["type"], "base");
        assert_eq!(airi["rwkv"]["recommendedTopP"], 0.9);
    }
}
