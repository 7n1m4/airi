// SPDX-License-Identifier: GPL-3.0-or-later

//! Permission-policy decision logic for `session/request_permission`.
//!
//! Kept pure (no I/O) so the policy table can be unit-tested exhaustively.
//! The Electron main-process implementation
//! (`apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts`) had
//! three branches: `auto-all` and `auto-read` were byte-identical (both pick
//! the first `kind.startsWith("allow")` option, falling back to
//! `options[0]`) — i.e. `auto-read` never actually inspected the tool call.
//! This crate implements the documented intent instead:
//!
//! * [`PermissionPolicy::Prompt`] — the crate has no user to prompt, so it
//!   fails closed: select the first `reject_*` option, falling back to the
//!   last option (matching the shape of the Electron user-deny path, whose
//!   `startsWith("deny")` check never matched the real `reject_*` kinds and
//!   also fell back to the last option).
//! * [`PermissionPolicy::AutoRead`] — allow when the tool call is read-like,
//!   otherwise reject. Read-like means the tool call's `kind` is `read`
//!   (case-insensitive) or its `title` contains `read` (case-insensitive).
//!   The Electron service had no equivalent check at all.
//! * [`PermissionPolicy::AutoAll`] — allow everything: first `allow_*`
//!   option, or the first option when no allow option is offered
//!   (matching Electron's `|| options[0]` fallback).
//!
//! When the agent offers no options at all, every policy answers with the
//! protocol-level `cancelled` outcome instead of `selected`.

use serde_json::Value;

use crate::types::{PermissionOption, PermissionPolicy};

/// What the client should answer a permission request with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PermissionOutcome {
    /// Select the given option id.
    Select(String),
    /// Protocol-level `outcome: "cancelled"` (agent offered no options).
    Cancelled,
}

/// Decides how to answer a `session/request_permission` request.
///
/// `tool_call` is the raw `toolCall` object from the request (a
/// `ToolCallUpdate` on the wire); it is inspected leniently.
pub(crate) fn decide_permission(
    policy: PermissionPolicy,
    tool_call: &Value,
    options: &[PermissionOption],
) -> PermissionOutcome {
    if options.is_empty() {
        return PermissionOutcome::Cancelled;
    }
    match policy {
        PermissionPolicy::AutoAll => select_allow(options)
            .or_else(|| options.first().map(|o| o.option_id.clone()))
            .map(PermissionOutcome::Select)
            .unwrap_or(PermissionOutcome::Cancelled),
        PermissionPolicy::AutoRead => {
            if is_read_tool(tool_call) {
                select_allow(options)
                    .or_else(|| options.first().map(|o| o.option_id.clone()))
                    .map(PermissionOutcome::Select)
                    .unwrap_or(PermissionOutcome::Cancelled)
            } else {
                select_deny(options)
                    .map(PermissionOutcome::Select)
                    .unwrap_or(PermissionOutcome::Cancelled)
            }
        }
        PermissionPolicy::Prompt => select_deny(options)
            .map(PermissionOutcome::Select)
            .unwrap_or(PermissionOutcome::Cancelled),
    }
}

/// First option whose `kind` starts with `allow`, in wire order.
fn select_allow(options: &[PermissionOption]) -> Option<String> {
    options
        .iter()
        .find(|o| o.kind.starts_with("allow"))
        .map(|o| o.option_id.clone())
}

/// First option whose `kind` starts with `reject`, else the last option
/// (mirrors the Electron user-deny fallback of `options[options.length - 1]`).
fn select_deny(options: &[PermissionOption]) -> Option<String> {
    options
        .iter()
        .find(|o| o.kind.starts_with("reject"))
        .or_else(|| options.last())
        .map(|o| o.option_id.clone())
}

/// Read-like heuristic for the `auto-read` policy: `kind == "read"` or the
/// title contains `read`, case-insensitive. Intentionally ignores `name` and
/// `rawInput` — a broader heuristic would auto-allow more than the user asked
/// for.
pub(crate) fn is_read_tool(tool_call: &Value) -> bool {
    let kind = tool_call
        .get("kind")
        .and_then(Value::as_str)
        .map(str::to_lowercase)
        .unwrap_or_default();
    if kind == "read" {
        return true;
    }
    let title = tool_call
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_lowercase)
        .unwrap_or_default();
    title.contains("read")
}

/// Builds the JSON-RPC `result` object for a permission decision.
pub(crate) fn permission_result(outcome: &PermissionOutcome) -> Value {
    match outcome {
        PermissionOutcome::Select(option_id) => serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": option_id },
        }),
        PermissionOutcome::Cancelled => serde_json::json!({
            "outcome": { "outcome": "cancelled" },
        }),
    }
}

/// Parses the `options` array of a permission request leniently. Entries
/// without a string `optionId` are skipped; `name` and `kind` default to `""`.
pub(crate) fn parse_permission_options(params: Option<&Value>) -> Vec<PermissionOption> {
    params
        .and_then(|p| p.get("options"))
        .and_then(Value::as_array)
        .map(|opts| {
            opts.iter()
                .filter_map(|o| {
                    Some(PermissionOption {
                        option_id: o.get("optionId")?.as_str()?.to_string(),
                        name: o
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        kind: o
                            .get("kind")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts() -> Vec<PermissionOption> {
        vec![
            PermissionOption {
                option_id: "allow-1".into(),
                name: "Allow once".into(),
                kind: "allow_once".into(),
            },
            PermissionOption {
                option_id: "reject-1".into(),
                name: "Reject once".into(),
                kind: "reject_once".into(),
            },
        ]
    }

    #[test]
    fn auto_all_picks_first_allow() {
        let out = decide_permission(
            PermissionPolicy::AutoAll,
            &json!({"kind": "execute"}),
            &opts(),
        );
        assert_eq!(out, PermissionOutcome::Select("allow-1".into()));
    }

    #[test]
    fn auto_read_allows_kind_read() {
        let out = decide_permission(
            PermissionPolicy::AutoRead,
            &json!({"kind": "read"}),
            &opts(),
        );
        assert_eq!(out, PermissionOutcome::Select("allow-1".into()));
    }

    #[test]
    fn auto_read_allows_title_containing_read() {
        let out = decide_permission(
            PermissionPolicy::AutoRead,
            &json!({"kind": "execute", "title": "Read config file"}),
            &opts(),
        );
        assert_eq!(out, PermissionOutcome::Select("allow-1".into()));
    }

    #[test]
    fn auto_read_denies_edit_kind() {
        let out = decide_permission(
            PermissionPolicy::AutoRead,
            &json!({"kind": "edit", "title": "Edit a file"}),
            &opts(),
        );
        assert_eq!(out, PermissionOutcome::Select("reject-1".into()));
    }

    #[test]
    fn prompt_rejects_read_tool_too() {
        let out = decide_permission(PermissionPolicy::Prompt, &json!({"kind": "read"}), &opts());
        assert_eq!(out, PermissionOutcome::Select("reject-1".into()));
    }

    #[test]
    fn deny_falls_back_to_last_option_when_no_reject_kind() {
        let options = vec![
            PermissionOption {
                option_id: "only-allow".into(),
                name: "Only".into(),
                kind: "allow_once".into(),
            },
            PermissionOption {
                option_id: "also-allow".into(),
                name: "Also".into(),
                kind: "allow_always".into(),
            },
        ];
        let out = decide_permission(PermissionPolicy::Prompt, &json!({}), &options);
        assert_eq!(out, PermissionOutcome::Select("also-allow".into()));
    }

    #[test]
    fn auto_all_falls_back_to_first_option_when_no_allow_kind() {
        let options = vec![PermissionOption {
            option_id: "reject-only".into(),
            name: "No".into(),
            kind: "reject_once".into(),
        }];
        let out = decide_permission(PermissionPolicy::AutoAll, &json!({}), &options);
        assert_eq!(out, PermissionOutcome::Select("reject-only".into()));
    }

    #[test]
    fn empty_options_cancels() {
        for policy in [
            PermissionPolicy::Prompt,
            PermissionPolicy::AutoRead,
            PermissionPolicy::AutoAll,
        ] {
            let out = decide_permission(policy, &json!({"kind": "read"}), &[]);
            assert_eq!(out, PermissionOutcome::Cancelled);
        }
    }

    #[test]
    fn parse_options_skips_entries_without_option_id() {
        let params = json!({
            "sessionId": "s",
            "toolCall": {"toolCallId": "t"},
            "options": [
                {"optionId": "a", "name": "A", "kind": "allow_once"},
                {"name": "no id", "kind": "allow_once"},
                {"optionId": "b", "kind": "reject_once"}
            ]
        });
        let parsed = parse_permission_options(Some(&params));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].option_id, "a");
        assert_eq!(parsed[1].kind, "reject_once");
        assert_eq!(parsed[1].name, "");
    }

    #[test]
    fn permission_result_selected_shape() {
        let value = permission_result(&PermissionOutcome::Select("x".into()));
        assert_eq!(
            value,
            json!({"outcome": {"outcome": "selected", "optionId": "x"}})
        );
    }

    #[test]
    fn permission_result_cancelled_shape() {
        let value = permission_result(&PermissionOutcome::Cancelled);
        assert_eq!(value, json!({"outcome": {"outcome": "cancelled"}}));
    }

    #[test]
    fn is_read_tool_ignores_non_string_fields() {
        assert!(!is_read_tool(&json!({"kind": 5, "title": null})));
        assert!(is_read_tool(&json!({"kind": "READ"})));
        assert!(is_read_tool(&json!({"title": "pread the file"})));
    }
}
