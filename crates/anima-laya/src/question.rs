// SPDX-License-Identifier: GPL-3.0-or-later

//! Laya decision questions: preparation and answer decoding.
//!
//! This is a straight port of `packages/stage-ui/src/workers/laya/prep.ts`
//! (Laya family) semantics, so the native runtime answers identically to
//! the web worker it replaces:
//!
//! - temperature bucketing by question type and option count
//! - `<<`-free span-marker prompt assembly (`CLS head SEP (MASK option)* SEP state SEP`)
//! - softmax + normalized-entropy confidence
//! - per-type answer decoding (choice argmax / score expectation / noul `p[1]`)
//!
//! Option lists for `Choice` keep insertion order (JS object key order), which
//! is what the checkpoint was trained/decoding against.

use serde::{Deserialize, Serialize};

use crate::error::LayaError;

/// Question discriminator, mapped to the `qtype` tensor the graph consumes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Qtype {
    /// Plain classification over arbitrary option sets.
    Choice,
    /// Ordered Likert-style levels.
    Score,
    /// Boolean (true/false) statement evaluation.
    Noul,
}

impl Qtype {
    /// The `qtype` tensor id the graph expects (`choice: 0, score: 1, noul: 2`).
    pub fn id(self) -> i64 {
        match self {
            Qtype::Choice => 0,
            Qtype::Score => 1,
            Qtype::Noul => 2,
        }
    }

    /// Lowercase wire name, used in prompt head and temperatures.
    pub fn name(self) -> &'static str {
        match self {
            Qtype::Choice => "choice",
            Qtype::Score => "score",
            Qtype::Noul => "noul",
        }
    }
}

/// A normalized decision question, mirroring the web worker's `toInternal` output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LayaQuestion {
    /// Choose one option id.
    Choice {
        /// Question instructions / prompt text.
        instructions: String,
        /// Ordered `(id, description)` option list. `description: None` renders bare.
        criteria: Vec<(String, Option<String>)>,
    },
    /// Rate on `0..levels.len()-1`.
    Score {
        /// Question instructions / prompt text.
        instructions: String,
        /// Ordered level descriptions.
        levels: Vec<String>,
    },
    /// Evaluate a proposition.
    Noul {
        /// The proposition (and only) the model sees.
        instructions: String,
    },
}

impl LayaQuestion {
    /// Parse the loose `questions[qid]` wire shape used by AIRI's callers.
    ///
    /// Accepts:
    /// - `{ "type": "choice", "instructions": "...", "criteria": ["a", "b"] }`
    /// - `{ "type": "choice", "instructions": "...", "criteria": {"a": "desc", "b": null} }`
    /// - `{ "type": "score", "instructions": "...", "criteria": ["never", "sometimes", "often"] }`
    /// - `{ "type": "score", "instructions": "...", "criteria": {"0": "never", "1": "sometimes"} }`
    /// - `{ "type": "noul", "instructions": "the sky is blue" }`
    ///
    /// Array criteria become `(id, desc=id)` pairs; object criteria preserve
    /// insertion order and drop falsy descriptions (bare labels), matching
    /// `renderOptions` in the web worker.
    pub fn from_json(value: &serde_json::Value) -> Result<Self, LayaError> {
        let obj = value
            .as_object()
            .ok_or_else(|| LayaError::Input("question must be a JSON object".into()))?;
        let qtype = obj
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("choice");
        let ins = obj.get("instructions").unwrap_or(&serde_json::Value::Null);
        let instructions = match ins {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Null => String::new(),
            other => serde_json::to_string(other).map_err(|e| {
                LayaError::Input(format!(
                    "instructions must be a string or serializable: {e}"
                ))
            })?,
        };
        match qtype {
            "choice" => {
                let criteria = match obj.get("criteria") {
                    Some(serde_json::Value::Array(items)) => items
                        .iter()
                        .map(|item| {
                            let id = match item {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            (id.clone(), Some(id))
                        })
                        .collect(),
                    Some(serde_json::Value::Object(map)) => map
                        .iter()
                        .map(|(k, v)| {
                            let desc = match v {
                                serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
                                _ => None,
                            };
                            (k.clone(), desc)
                        })
                        .collect(),
                    Some(_) | None => Vec::new(),
                };
                if criteria.is_empty() {
                    return Err(LayaError::Input(
                        "choice question requires a non-empty criteria list".into(),
                    ));
                }
                Ok(LayaQuestion::Choice {
                    instructions,
                    criteria,
                })
            }
            "score" => {
                let levels = match obj.get("criteria") {
                    Some(serde_json::Value::Array(items)) => items
                        .iter()
                        .map(|item| match item {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .collect(),
                    Some(serde_json::Value::Object(map)) => map
                        .values()
                        .map(|v| match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .collect(),
                    Some(_) | None => vec![
                        "level 0".into(),
                        "level 1".into(),
                        "level 2".into(),
                        "level 3".into(),
                    ],
                };
                if levels.is_empty() {
                    return Err(LayaError::Input(
                        "score question requires at least one level".into(),
                    ));
                }
                Ok(LayaQuestion::Score {
                    instructions,
                    levels,
                })
            }
            "noul" => Ok(LayaQuestion::Noul { instructions }),
            other => Err(LayaError::Input(format!(
                "unsupported question type {other:?}"
            ))),
        }
    }

    /// The qtype discriminator for this question.
    pub fn qtype(&self) -> Qtype {
        match self {
            LayaQuestion::Choice { .. } => Qtype::Choice,
            LayaQuestion::Score { .. } => Qtype::Score,
            LayaQuestion::Noul { .. } => Qtype::Noul,
        }
    }

    /// Option list in logits order (what the graph's option axis scores).
    pub fn rendered_options(&self) -> Vec<String> {
        match self {
            LayaQuestion::Choice { criteria, .. } => criteria
                .iter()
                .map(|(id, desc)| match desc {
                    Some(d) => format!("{id}: {d}"),
                    None => id.clone(),
                })
                .collect(),
            LayaQuestion::Score { levels, .. } => levels
                .iter()
                .enumerate()
                .map(|(i, level)| format!("level {i}: {level}"))
                .collect(),
            LayaQuestion::Noul { instructions } => vec![
                format!("true: {instructions}"),
                format!("false: not {instructions}"),
            ],
        }
    }

    /// Scrub option/head text of `[MASK]` markers the way the worker does.
    fn scrub(text: &str) -> String {
        text.replace("[MASK]", " ")
    }

    /// The prompt head: `<type> question: <scrubbed instructions>`.
    pub fn head_text(&self) -> String {
        match self {
            LayaQuestion::Choice { instructions, .. }
            | LayaQuestion::Score { instructions, .. }
            | LayaQuestion::Noul { instructions } => format!(
                "{} question: {}",
                self.qtype().name(),
                Self::scrub(instructions)
            ),
        }
    }

    /// Text scored per option, with the leading space the worker prepends.
    pub fn option_texts(&self) -> Vec<String> {
        self.rendered_options()
            .into_iter()
            .map(|o| format!(" {}", Self::scrub(&o)))
            .collect()
    }
}

/// Special token ids the exported graph was trained with.
///
/// The web worker derives these from the tokenizer when present and falls back
/// to these ids otherwise (ModernBERT-large tokenizer: added_tokens
/// 50280=pad, 50281=cls, 50282=sep, 50284=mask). The shipped `tokenizer.json`
/// carries no `added_tokens`, so the fallbacks are the effective ids.
pub const PAD_ID: i64 = 50283;
/// `cls_token_id` fallback.
pub const CLS_ID: i64 = 50281;
/// `sep_token_id` fallback.
pub const SEP_ID: i64 = 50282;
/// `mask_token_id` fallback.
pub const MASK_ID: i64 = 50284;

/// Cap for one option's token span inside the prompt assembly.
pub const OPTION_TOKEN_CAP: usize = 48;
/// Head budget (tokens) for instruction text, excluding options.
pub const HEAD_MAX_LEN: usize = 192;

/// Round to four decimals, matching the web worker's `round4`.
pub(crate) fn round4(x: f32) -> f32 {
    (x * 10_000.0).round() / 10_000.0
}

/// Softmax with max-subtraction, ported from `prep.ts`.
pub fn softmax(logits: &[f32]) -> Vec<f32> {
    if logits.is_empty() {
        return Vec::new();
    }
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|&v| (v - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    exps.into_iter().map(|v| v / sum).collect()
}

/// Normalized-entropy confidence in [0, 1], ported from `confidenceFromProbs`.
pub fn confidence_from_probs(probs: &[f32]) -> f32 {
    let k = probs.len();
    if k < 2 {
        return 1.0;
    }
    let mut ent = 0.0_f32;
    for &p in probs {
        ent -= p * p.max(1e-12).ln();
    }
    1.0 - ent / (k as f32).ln()
}

/// Default decoding temperatures for the Laya family, keyed `type:bucket`.
///
/// Verbatim IEEE-754 doubles from `DEFAULT_TEMPERATURES` in `prep.ts`;
/// cast to `f32` at use, exactly as the web worker's `Math.exp` on `number`
/// semantics accept. Missing buckets fall back to 1.0, exactly like the JS lookup.
pub const DEFAULT_TEMPERATURES: &[(&str, f64)] = &[
    ("choice:2", 1.9063563346862793),
    ("choice:3-5", 1.7601518630981445),
    ("choice:6-10", 1.0000158548355103),
    ("choice:11+", 0.10058280825614929),
    ("score:3-5", 1.2514300346374512),
    ("noul:2", 1.983399510383606),
];

/// Bucket an option count for the temperature table.
pub fn temp_bucket(qtype: Qtype, k: usize) -> String {
    let size = if k <= 2 {
        "2"
    } else if k <= 5 {
        "3-5"
    } else if k <= 10 {
        "6-10"
    } else {
        "11+"
    };
    format!("{}:{size}", qtype.name())
}

/// Decode the temperature for `(qtype, k)`, falling back to 1.0.
pub fn temperature_for(qtype: Qtype, k: usize) -> f32 {
    let key = temp_bucket(qtype, k);
    DEFAULT_TEMPERATURES
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, t)| *t as f32)
        .unwrap_or(1.0)
}

/// A single decision's answer, mirroring `decodeAnswers` in the web worker.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LayaAnswer {
    /// Best-effort option id.
    Choice {
        /// Chosen option id.
        choice: String,
        /// Probability per option id, rounded to 4 decimals.
        probabilities: std::collections::BTreeMap<String, f32>,
        /// Normalized-entropy confidence, rounded to 4 decimals.
        confidence: f32,
    },
    /// Expectation over level indices.
    Score {
        /// Expected score, rounded to 4 decimals.
        score: f32,
        /// Probability per level index, rounded to 4 decimals.
        probabilities: std::collections::BTreeMap<String, f32>,
        /// Normalized-entropy confidence, rounded to 4 decimals.
        confidence: f32,
    },
    /// Boolean verdict.
    Noul {
        /// Probability the proposition holds (`p[1]` in the web worker).
        noul: f32,
        /// Probabilities for `true`/`false`.
        probabilities: std::collections::BTreeMap<String, f32>,
        /// Normalized-entropy confidence, rounded to 4 decimals.
        confidence: f32,
    },
}

/// Serialize a JSON state value the way the web worker's `pyJsonDumps` does.
///
/// The model was trained against Python's `json.dumps` formatting
/// (`', '`/`': '` separators, trailing-space-free-but-spaced arrays), so this
/// re-produces that layout byte-for-byte rather than using `serde_json`.
/// Strings are passed through verbatim when their `instructions`/`state` are
/// plain strings, same as the worker.
pub fn py_json_dumps(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".into(),
        serde_json::Value::Bool(true) => "true".into(),
        serde_json::Value::Bool(false) => "false".into(),
        serde_json::Value::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => n.to_string(),
        },
        serde_json::Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into()),
        serde_json::Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(py_json_dumps).collect();
            format!("[{}]", inner.join(", "))
        }
        serde_json::Value::Object(map) => {
            let inner: Vec<String> = map
                .iter()
                .map(|(k, v)| {
                    format!(
                        "{}: {}",
                        serde_json::to_string(k).unwrap_or_else(|_| "\"\"".into()),
                        py_json_dumps(v)
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(", "))
        }
    }
}

/// Serialize "state" the way `serializeState` does: strings verbatim, JSON otherwise.
pub fn serialize_state(state: &str) -> &str {
    state
}

/// The prepared inputs for one question, pre-padding.
#[derive(Debug, Clone)]
pub struct PreparedSequence {
    /// Full token sequence including structural tokens.
    pub ids: Vec<i64>,
    /// Token positions of each option's leading `MASK`.
    pub markers: Vec<i64>,
    /// `qtype` tensor id.
    pub qtype: i64,
    /// Number of options (`markers.len()`).
    pub option_count: usize,
}

/// Tokenize text without special tokens, applying [`crate::tokenizer::MAX_SEQ_LEN`] cap.
///
/// The graph consumes raw ids; adding CLS/SEP here would corrupt the
/// span-marker alignment (markers are absolute positions).
pub trait TextEncoder {
    /// Encode text into raw ids, truncated to the sequence cap.
    fn encode_raw(&self, text: &str) -> Result<Vec<i64>, LayaError>;
}

impl crate::tokenizer::LayaTokenizer {
    /// Encode text without special tokens, capped at [`crate::tokenizer::MAX_SEQ_LEN`].
    pub fn encode_ids(&self, text: &str) -> Result<Vec<i64>, LayaError> {
        let enc = self.encode(text, false)?;
        Ok(enc.ids.into_iter().map(i64::from).collect())
    }
}

impl TextEncoder for crate::tokenizer::LayaTokenizer {
    fn encode_raw(&self, text: &str) -> Result<Vec<i64>, LayaError> {
        self.encode_ids(text)
    }
}

/// Build the exact sequence the exported graph expects for one question,
/// given a raw-id encoder.
///
/// Mirrors the prompt-assembly loop of `layaDecideEvent`:
/// `CLS head SEP (MASK option)* SEP state SEP` with option-token budgeting.
pub fn build_sequence(
    question: &LayaQuestion,
    state: &str,
    encoder: &impl TextEncoder,
    max_seq_len: usize,
) -> Result<PreparedSequence, LayaError> {
    let scrub = |s: &str| s.replace("[MASK]", " ");

    let head = question.head_text();
    let mut head_ids = encoder.encode_raw(&head)?;

    let opt_texts = question.option_texts();
    let mut opt_ids: Vec<Vec<i64>> = opt_texts
        .iter()
        .map(|o| {
            let toks = encoder.encode_raw(o)?;
            let mut v = vec![MASK_ID];
            v.extend(toks.into_iter().take(OPTION_TOKEN_CAP));
            Ok::<Vec<i64>, LayaError>(v)
        })
        .collect::<Result<_, _>>()?;

    let total = |xs: &[Vec<i64>]| xs.iter().map(Vec::len).sum::<usize>();
    let mut opt_budget = HEAD_MAX_LEN.saturating_sub(total(&opt_ids));
    if opt_budget < 16 {
        let per = std::cmp::max(4, (HEAD_MAX_LEN - 16) / std::cmp::max(1, opt_ids.len()));
        opt_ids = opt_ids
            .into_iter()
            .map(|o| o.into_iter().take(per).collect())
            .collect();
        opt_budget = HEAD_MAX_LEN - total(&opt_ids);
    }
    head_ids.truncate(std::cmp::max(8, opt_budget));

    let mut seq: Vec<i64> = Vec::with_capacity(std::cmp::min(max_seq_len, 4096));
    seq.push(CLS_ID);
    seq.extend_from_slice(&head_ids);
    seq.push(SEP_ID);

    let mut markers: Vec<i64> = Vec::with_capacity(opt_ids.len());
    for opt in &opt_ids {
        markers.push(seq.len() as i64);
        seq.extend_from_slice(opt);
    }
    seq.push(SEP_ID);

    // State tail: room for everything, truncate state to fit, then final SEP.
    let room = max_seq_len.saturating_sub(seq.len()).saturating_sub(1);
    let scrubbed_state = scrub(state);
    let mut state_ids = encoder.encode_raw(&scrubbed_state)?;
    if state_ids.len() > room {
        tracing::warn!(
            truncated_from = state_ids.len(),
            room,
            "laya state truncated to fit max sequence"
        );
        state_ids.truncate(room);
    }
    seq.extend_from_slice(&state_ids);
    seq.push(SEP_ID);

    // Final caps applied on this path (worker slices to maxLen as well).
    seq.truncate(max_seq_len);
    let markers: Vec<i64> = markers
        .into_iter()
        .filter(|&m| (m as usize) < max_seq_len)
        .collect();

    Ok(PreparedSequence {
        option_count: markers.len(),
        ids: seq,
        markers,
        qtype: question.qtype().id(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockEncoder;
    impl TextEncoder for MockEncoder {
        fn encode_raw(&self, text: &str) -> Result<Vec<i64>, LayaError> {
            Ok(text
                .split_whitespace()
                .map(|w| w.len() as i64 % 251 + 10)
                .collect())
        }
    }

    fn sample_choice() -> LayaQuestion {
        LayaQuestion::Choice {
            instructions: "Which arm should the assistant pick?".into(),
            criteria: vec![
                ("yes".into(), Some("the yes option".into())),
                ("no".into(), Some("the no option".into())),
            ],
        }
    }

    #[test]
    fn softmax_matches_known_values() {
        let p = softmax(&[1.0, 1.0]);
        assert!((p[0] - 0.5).abs() < 1e-7);
        let p = softmax(&[10.0]);
        assert!((p[0] - 1.0).abs() < 1e-7);
        assert!(softmax(&[]).is_empty());
    }

    #[test]
    fn confidence_is_one_for_certain_and_low_for_uniform() {
        assert!((confidence_from_probs(&[1.0]) - 1.0).abs() < 1e-7);
        let uniform = confidence_from_probs(&[0.5, 0.5]);
        assert!(uniform < 0.01, "uniform should score near 0, got {uniform}");
    }

    #[test]
    fn temperature_buckets_match_web() {
        assert_eq!(temp_bucket(Qtype::Choice, 2), "choice:2");
        assert_eq!(temp_bucket(Qtype::Choice, 4), "choice:3-5");
        assert_eq!(temp_bucket(Qtype::Choice, 9), "choice:6-10");
        assert_eq!(temp_bucket(Qtype::Choice, 30), "choice:11+");
        assert_eq!(temp_bucket(Qtype::Score, 2), "score:2");
        assert_eq!(temp_bucket(Qtype::Noul, 2), "noul:2");
        assert!((temperature_for(Qtype::Choice, 2) - 1.9063563).abs() < 1e-6);
        assert!(
            (temperature_for(Qtype::Score, 2) - 1.0).abs() < 1e-7,
            "missing bucket falls back to 1.0"
        );
    }

    #[test]
    fn py_json_dumps_matches_python_layout() {
        let v = serde_json::json!({"a": 1, "b": [true, null, "x"], "c": {"d": false}});
        let s = py_json_dumps(&v);
        assert_eq!(s, r#"{"a": 1, "b": [true, null, "x"], "c": {"d": false}}"#);
    }

    #[test]
    fn build_sequence_marks_options_and_pads_state() {
        let q = sample_choice();
        let prepared = build_sequence(&q, "state goes here", &MockEncoder, 4096).expect("build");
        assert_eq!(prepared.ids[0], CLS_ID);
        assert_eq!(prepared.ids.last(), Some(&SEP_ID));
        assert_eq!(prepared.markers.len(), 2);
        // Each marker points at the leading MASK of its option run.
        for &m in &prepared.markers {
            assert_eq!(prepared.ids[m as usize], MASK_ID);
        }
        assert_eq!(prepared.qtype, 0);
        assert_eq!(prepared.option_count, 2);
    }

    #[test]
    fn build_sequence_respects_seq_cap() {
        let q = LayaQuestion::Noul {
            instructions: "word ".repeat(400),
        };
        let prepared = build_sequence(&q, "tail ", &MockEncoder, 32).expect("build");
        assert!(prepared.ids.len() <= 32);
    }

    #[test]
    fn from_json_accepts_array_and_object_criteria() {
        let arr =
            serde_json::json!({"type": "choice", "instructions": "pick", "criteria": ["a", "b"]});
        let obj = serde_json::json!({"type": "choice", "instructions": "pick", "criteria": {"a": "desc", "b": null}});
        let LayaQuestion::Choice { criteria, .. } = LayaQuestion::from_json(&arr).unwrap() else {
            panic!()
        };
        assert_eq!(criteria.len(), 2);
        let LayaQuestion::Choice { criteria, .. } = LayaQuestion::from_json(&obj).unwrap() else {
            panic!()
        };
        assert_eq!(criteria[0].1.as_deref(), Some("desc"));
        assert_eq!(criteria[1].1, None);
    }

    #[test]
    fn from_json_score_object_criteria_uses_values_in_order() {
        let v = serde_json::json!({"type": "score", "instructions": "rate", "criteria": {"a": "low", "b": "high"}});
        let LayaQuestion::Score { levels, .. } = LayaQuestion::from_json(&v).unwrap() else {
            panic!()
        };
        assert_eq!(levels, vec!["low", "high"]);
    }
}
