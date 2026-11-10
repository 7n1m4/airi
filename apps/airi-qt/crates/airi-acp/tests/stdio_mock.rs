// SPDX-License-Identifier: GPL-3.0-or-later

//! Integration tests against a mock ACP agent implemented as a `python3 -c`
//! subprocess. The mock speaks newline-delimited JSON-RPC 2.0 on stdio.
//!
//! Every test skips silently (with an `eprintln!` note) when `python3` is not
//! available, so the suite stays green on minimal systems.

use std::process::Command;
use std::time::Duration;

use airi_acp::{AcpAgentClient, CloseSessionResult, PermissionPolicy, SessionUpdate, StopReason};

/// Modes the mock agent understands (passed as argv[1]):
///
/// * `basic` — initialize echoes capabilities; `session/new` returns
///   `sess-mock-1`; `session/prompt` streams two `agent_message_chunk`
///   notifications ("Hello ", "world") then answers with
///   `{"stopReason": "end_turn"}`; `session/close` answers `{}`.
/// * `perm_read` — like `basic`, but the prompt turn begins with a
///   `session/request_permission` whose tool call is a read-like tool
///   (`kind: "read"`, title "Read file"). The option id the client selects
///   is echoed back as the agent message so the test can assert it.
/// * `perm_write` — like `perm_read`, but the tool call is write-like
///   (`kind: "edit"`, title "Edit file").
const MOCK_AGENT: &str = r#"
import sys
import json

mode = sys.argv[1]
SESSION_ID = "sess-mock-1"

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def recv():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)

def tool_call():
    if mode == "perm_read":
        return {"toolCallId": "tc-1", "title": "Read file", "kind": "read", "status": "pending"}
    return {"toolCallId": "tc-2", "title": "Edit file", "kind": "edit", "status": "pending"}

while True:
    msg = recv()
    method = msg.get("method")
    mid = msg.get("id")

    if method == "initialize":
        send({
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": True,
                    "promptCapabilities": {"image": False, "audio": False, "embeddedContext": False},
                    "mcpCapabilities": {"http": True, "sse": False},
                    "sessionCapabilities": {"close": {}},
                },
                "authMethods": [],
                "agentInfo": {"name": "mock-agent", "version": "0.0.1"},
            },
        })
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": SESSION_ID}})
    elif method == "session/prompt":
        sid = msg["params"]["sessionId"]
        if mode.startswith("perm_"):
            send({
                "jsonrpc": "2.0",
                "id": 9001,
                "method": "session/request_permission",
                "params": {
                    "sessionId": sid,
                    "toolCall": tool_call(),
                    "options": [
                        {"optionId": "allow-1", "name": "Allow once", "kind": "allow_once"},
                        {"optionId": "reject-1", "name": "Reject once", "kind": "reject_once"},
                    ],
                },
            })
            resp = recv()
            outcome = (resp.get("result") or {}).get("outcome") or {}
            chosen = outcome.get("optionId", "cancelled")
            send({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {"sessionId": sid, "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": chosen},
                }},
            })
        else:
            for chunk in ["Hello ", "world"]:
                send({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {"sessionId": sid, "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": chunk},
                    }},
                })
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
    elif method == "session/cancel":
        pass  # notification: no response
    elif method == "session/close":
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif mid is not None:
        send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "mock: unsupported method"}})
"#;

fn python3_available() -> bool {
    Command::new("python3")
        .arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

macro_rules! require_python3 {
    () => {{
        if !python3_available() {
            eprintln!("skipping test: python3 is not available on this system");
            return;
        }
    }};
}

fn spawn_mock(mode: &str, policy: PermissionPolicy) -> AcpAgentClient {
    let mut client = AcpAgentClient::spawn("python3", &["-c", MOCK_AGENT, mode], None)
        .expect("failed to spawn mock ACP agent");
    client.set_permission_policy(policy);
    client.set_timeout(Duration::from_secs(5));
    client.set_prompt_timeout(Duration::from_secs(5));
    client
}

fn initialize_and_session(client: &AcpAgentClient) -> airi_acp::SessionId {
    let init = client.initialize().expect("initialize failed");
    assert_eq!(init.protocol_version, 1);
    client.new_session(None).expect("session/new failed")
}

#[test]
fn initialize_handshake_returns_agent_capabilities() {
    require_python3!();
    let client = spawn_mock("basic", PermissionPolicy::Prompt);
    let init = client.initialize().expect("initialize failed");
    assert_eq!(init.protocol_version, 1);
    assert_eq!(init.agent_capabilities.load_session, Some(true));
    assert_eq!(
        init.agent_capabilities.prompt.as_ref().unwrap().image,
        Some(false)
    );
    assert_eq!(
        init.agent_capabilities.mcp.as_ref().unwrap().http,
        Some(true)
    );
    assert!(init.agent_capabilities.session.as_ref().unwrap().close);
    let info = init.agent_info.as_ref().expect("agentInfo missing");
    assert_eq!(info.name, "mock-agent");
    assert_eq!(info.version, "0.0.1");
}

#[test]
fn new_session_returns_parseable_session_id() {
    require_python3!();
    let client = spawn_mock("basic", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");
    let session = client
        .new_session(Some(std::path::Path::new("/tmp")))
        .unwrap();
    assert_eq!(session, "sess-mock-1");
}

#[test]
fn prompt_accumulates_updates_and_reports_stop_reason() {
    require_python3!();
    let client = spawn_mock("basic", PermissionPolicy::Prompt);
    let session = initialize_and_session(&client);

    let result = client.prompt(&session, "hi there").expect("prompt failed");
    assert_eq!(result.stop_reason, StopReason::EndTurn);
    assert_eq!(result.final_text, "Hello world");
    assert_eq!(result.updates.len(), 2);
    assert!(result
        .updates
        .iter()
        .all(|u| matches!(u, SessionUpdate::AgentMessageChunk(_))));
    let text: String = result
        .updates
        .iter()
        .filter_map(SessionUpdate::agent_text)
        .collect();
    assert_eq!(text, "Hello world");
}

#[test]
fn auto_read_policy_allows_read_tool() {
    require_python3!();
    let client = spawn_mock("perm_read", PermissionPolicy::AutoRead);
    let session = initialize_and_session(&client);

    let result = client
        .prompt(&session, "please read")
        .expect("prompt failed");
    assert_eq!(result.stop_reason, StopReason::EndTurn);
    assert_eq!(
        result.final_text, "allow-1",
        "auto-read must allow read-like tools"
    );
}

#[test]
fn auto_read_policy_denies_write_tool() {
    require_python3!();
    let client = spawn_mock("perm_write", PermissionPolicy::AutoRead);
    let session = initialize_and_session(&client);

    let result = client
        .prompt(&session, "please edit")
        .expect("prompt failed");
    assert_eq!(
        result.final_text, "reject-1",
        "auto-read must reject write-like tools"
    );
}

#[test]
fn prompt_policy_rejects_permission_request() {
    require_python3!();
    let client = spawn_mock("perm_read", PermissionPolicy::Prompt);
    let session = initialize_and_session(&client);

    let result = client
        .prompt(&session, "please read")
        .expect("prompt failed");
    assert_eq!(
        result.final_text, "reject-1",
        "prompt policy fails closed (rejects) without a human in the loop"
    );
}

#[test]
fn auto_all_policy_allows_write_tool() {
    require_python3!();
    let client = spawn_mock("perm_write", PermissionPolicy::AutoAll);
    let session = initialize_and_session(&client);

    let result = client
        .prompt(&session, "please edit")
        .expect("prompt failed");
    assert_eq!(
        result.final_text, "allow-1",
        "auto-all must allow everything"
    );
}

#[test]
fn cancel_and_close_session_round_trip() {
    require_python3!();
    let client = spawn_mock("basic", PermissionPolicy::Prompt);
    let session = initialize_and_session(&client);

    client.cancel(&session).expect("cancel failed");
    let closed = client
        .close_session(&session)
        .expect("close_session failed");
    assert_eq!(closed, CloseSessionResult::AgentAcknowledged);
}
