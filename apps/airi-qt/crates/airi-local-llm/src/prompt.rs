// SPDX-License-Identifier: GPL-3.0-or-later

//! Chat prompt assembly.
//!
//! Two paths, tried in order by the provider:
//!
//! 1. **Model chat template** — llama.cpp's built-in template engine via
//!    `LlamaModel::chat_template(None)` + `LlamaModel::apply_chat_template`.
//!    Preferred: the GGUF ships the format the model was fine-tuned with.
//! 2. **Generic fallback** — [`fallback_prompt`], a simple
//!    `### System:` / `### User:` / `### Assistant:` layout. Used when the
//!    model has no template or the engine rejects it.
//!
//! DEVIATION (documented loudly): the fallback is *not* a valid template for
//! any particular model — it is a last-resort approximation that works
//! tolerably with instruction-tuned models that understand turn markers. If
//! you see degraded output with a template-less GGUF, that is expected;
//! prefer a model with a baked-in template.

use airi_llm::{ChatMessage, Role};

/// Render a role as the fallback `### <Role>:` marker label.
fn role_label(role: Role) -> &'static str {
    match role {
        Role::System => "System",
        Role::User => "User",
        Role::Assistant => "Assistant",
        Role::Tool => "Tool",
    }
}

/// Generic fallback chat prompt.
///
/// Produces:
///
/// ```text
/// ### System:
/// <system prompt, when present>
///
/// ### User:
/// <content>
///
/// ### Assistant:
/// <content>
///
/// ### Assistant:
/// ```
///
/// The trailing `### Assistant:\n` opens the assistant turn; the model is
/// expected to complete it. The `### User` marker is registered as a stop
/// pattern by the generation loop so the model cannot run on into a fake
/// next user turn.
///
/// `system` (the request-level system prompt) is emitted first; system
/// *messages* in the history are emitted in place, in order.
pub(crate) fn fallback_prompt(system: Option<&str>, messages: &[ChatMessage]) -> String {
    let mut out = String::new();
    if let Some(system) = system {
        let trimmed = system.trim();
        if !trimmed.is_empty() {
            out.push_str("### System:\n");
            out.push_str(trimmed);
            out.push_str("\n\n");
        }
    }
    for message in messages {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        out.push_str("### ");
        out.push_str(role_label(message.role));
        out.push_str(":\n");
        out.push_str(content);
        out.push_str("\n\n");
    }
    out.push_str("### Assistant:\n");
    out
}

/// BOS markers emitted textually by the common chat templates. If the
/// rendered prompt already starts with one, the tokenizer must not add a
/// second BOS on top.
pub(crate) const TEMPLATE_BOS_MARKERS: &[&str] =
    &["<|begin_of_text|>", "<|start_of_text|>", "<bos>", "<s>"];

/// Whether the rendered prompt already starts with a BOS marker.
pub(crate) fn prompt_has_bos_marker(prompt: &str) -> bool {
    TEMPLATE_BOS_MARKERS.iter().any(|m| prompt.starts_with(m))
}

#[cfg(test)]
mod tests {
    use super::*;
    use airi_llm::ChatMessage;

    fn msg(role: Role, content: &str) -> ChatMessage {
        ChatMessage {
            role,
            content: content.to_string(),
            tool_call_id: None,
        }
    }

    #[test]
    fn simple_user_turn_opens_assistant() {
        let out = fallback_prompt(None, &[msg(Role::User, "hello")]);
        assert_eq!(out, "### User:\nhello\n\n### Assistant:\n");
    }

    #[test]
    fn system_param_is_prepended() {
        let out = fallback_prompt(Some("be terse"), &[msg(Role::User, "hello")]);
        assert_eq!(
            out,
            "### System:\nbe terse\n\n### User:\nhello\n\n### Assistant:\n"
        );
    }

    #[test]
    fn system_messages_in_history_are_kept_in_place() {
        let out = fallback_prompt(
            None,
            &[msg(Role::System, "from-history"), msg(Role::User, "hi")],
        );
        assert_eq!(
            out,
            "### System:\nfrom-history\n\n### User:\nhi\n\n### Assistant:\n"
        );
    }

    #[test]
    fn multi_turn_history_renders_in_order() {
        let out = fallback_prompt(
            Some("sys"),
            &[
                msg(Role::User, "u1"),
                msg(Role::Assistant, "a1"),
                msg(Role::User, "u2"),
            ],
        );
        assert_eq!(
            out,
            "### System:\nsys\n\n### User:\nu1\n\n### Assistant:\na1\n\n### User:\nu2\n\n### Assistant:\n"
        );
    }

    #[test]
    fn empty_messages_are_skipped() {
        let out = fallback_prompt(None, &[msg(Role::User, "   "), msg(Role::User, "real")]);
        assert_eq!(out, "### User:\nreal\n\n### Assistant:\n");
    }

    #[test]
    fn tool_messages_use_tool_label() {
        let out = fallback_prompt(None, &[msg(Role::Tool, "result")]);
        assert_eq!(out, "### Tool:\nresult\n\n### Assistant:\n");
    }

    #[test]
    fn bos_marker_detection() {
        assert!(prompt_has_bos_marker("<|begin_of_text|>..."));
        assert!(prompt_has_bos_marker("<s>x"));
        assert!(!prompt_has_bos_marker("plain prompt"));
    }
}
