// SPDX-License-Identifier: GPL-3.0-or-later

//! Integration tests against a mock ACP agent implemented as a `python3 -c`
//! subprocess. The mock speaks newline-delimited JSON-RPC 2.0 on stdio.
//!
//! Every test skips silently (with an `eprintln!` note) when `python3` is not
//! available, so the suite stays green on minimal systems.

use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use airi_acp::{
    AcpAgentClient, AcpError, CloseSessionResult, DeleteSessionResult, PermissionPolicy,
    PromptDecision, SessionConfigValue, SessionUpdate, StopReason,
};

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
/// * `sessions` — implements the session-management RPCs: `session/load`
///   replays two `agent_message_chunk` notifications ("Loaded ", "history")
///   then answers with modes + config options (`sess-missing` gets `-32002`);
///   `session/resume` answers with modes + config options, no replay;
///   `session/list` paginates two canned sessions (`nextCursor: "page2"`,
///   then `sess-mock-2`); `session/delete` answers `{}` (`sess-missing` gets
///   `-32002`); `session/set_mode` answers `{}`; `session/set_config_option`
///   answers with one updated config option. `basic` doubles as the
///   "capability not advertised" agent — its catch-all answers `-32601`.
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
        session_caps = {"close": {}}
        if mode == "sessions":
            session_caps = {"list": {}, "delete": {}, "resume": {}, "close": {}, "additionalDirectories": {}}
        send({
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": True,
                    "promptCapabilities": {"image": False, "audio": False, "embeddedContext": False},
                    "mcpCapabilities": {"http": True, "sse": False},
                    "sessionCapabilities": session_caps,
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
    elif method == "session/load" and mode == "sessions":
        sid = msg["params"]["sessionId"]
        if sid == "sess-missing":
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32002, "message": "Resource not found: sess-missing"}})
        else:
            for chunk in ["Loaded ", "history"]:
                send({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {"sessionId": sid, "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": chunk},
                    }},
                })
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "modes": {"currentModeId": "default", "availableModes": [
                    {"id": "default", "name": "Default"},
                    {"id": "plan", "name": "Plan", "description": "Planning mode"},
                ]},
                "configOptions": [
                    {"id": "model", "name": "Model", "type": "select", "currentValue": "fast",
                     "options": [{"value": "fast", "name": "Fast"}]},
                ],
            }})
    elif method == "session/resume" and mode == "sessions":
        sid = msg["params"]["sessionId"]
        if sid == "sess-missing":
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32002, "message": "Resource not found: sess-missing"}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "modes": {"currentModeId": "default", "availableModes": [
                    {"id": "default", "name": "Default"},
                ]},
                "configOptions": [],
            }})
    elif method == "session/list" and mode == "sessions":
        cursor = (msg.get("params") or {}).get("cursor")
        if cursor == "page2":
            send({"jsonrpc": "2.0", "id": mid, "result": {"sessions": [
                {"sessionId": "sess-mock-2", "cwd": "/work",
                 "additionalDirectories": ["/work/extra"]},
            ]}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "result": {"nextCursor": "page2", "sessions": [
                {"sessionId": "sess-mock-1", "cwd": "/tmp", "title": "Mock session one",
                 "updatedAt": "2026-11-01T00:00:00Z"},
            ]}})
    elif method == "session/delete" and mode == "sessions":
        sid = msg["params"]["sessionId"]
        if sid == "sess-missing":
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32002, "message": "Resource not found: sess-missing"}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif method == "session/set_mode" and mode == "sessions":
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif method == "session/set_config_option" and mode == "sessions":
        send({"jsonrpc": "2.0", "id": mid, "result": {"configOptions": [
            {"id": "model", "name": "Model", "type": "select", "currentValue": "thorough",
             "options": [{"value": "thorough", "name": "Thorough"}]},
        ]}})
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

/// Answers the next enqueued permission request on a background thread.
/// Returns a join handle yielding the request that was answered.
fn answer_next_permission(
    client: &Arc<AcpAgentClient>,
    decision: PromptDecision,
) -> std::thread::JoinHandle<airi_acp::PermissionRequest> {
    let client = Arc::clone(client);
    let requests = client.permission_requests();
    std::thread::spawn(move || {
        let request = {
            let receiver = requests.lock().expect("permission receiver lock poisoned");
            receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("timed out waiting for the permission request to be enqueued")
        };
        client
            .answer_permission(&request.request_id, decision)
            .expect("failed to answer the permission request");
        request
    })
}

#[test]
fn prompt_policy_enqueues_permission_request_and_reject_is_delivered() {
    require_python3!();
    let client = Arc::new(spawn_mock("perm_read", PermissionPolicy::Prompt));
    let session = initialize_and_session(&client);

    let answering = answer_next_permission(&client, PromptDecision::Reject);
    let result = client
        .prompt(&session, "please read")
        .expect("prompt failed");
    let request = answering.join().expect("answering thread panicked");

    assert_eq!(request.session_id, "sess-mock-1");
    assert_eq!(request.options.len(), 2);
    assert!(request.request_id.parse::<u64>().is_ok());
    assert_eq!(request.tool_call["toolCallId"], "tc-1");
    assert_eq!(
        result.final_text, "reject-1",
        "a human reject must be delivered to the agent as the reject-style option"
    );
}

#[test]
fn prompt_policy_allow_once_delivers_allow_option() {
    require_python3!();
    let client = Arc::new(spawn_mock("perm_write", PermissionPolicy::Prompt));
    let session = initialize_and_session(&client);

    let answering = answer_next_permission(&client, PromptDecision::AllowOnce);
    let result = client
        .prompt(&session, "please edit")
        .expect("prompt failed");
    answering.join().expect("answering thread panicked");

    assert_eq!(result.final_text, "allow-1");
}

#[test]
fn prompt_policy_allow_session_auto_allows_subsequent_requests() {
    require_python3!();
    let client = Arc::new(spawn_mock("perm_read", PermissionPolicy::Prompt));
    let session = initialize_and_session(&client);

    // First turn: answer AllowSession — the allowlist is recorded.
    let answering = answer_next_permission(&client, PromptDecision::AllowSession);
    let first = client
        .prompt(&session, "please read")
        .expect("first prompt failed");
    answering.join().expect("answering thread panicked");
    assert_eq!(first.final_text, "allow-1");

    // Second turn: nobody answers. The session allowlist must short-circuit
    // the enqueue and allow the re-asked request automatically.
    let second = client
        .prompt(&session, "please read again")
        .expect("second prompt failed");
    assert_eq!(
        second.final_text, "allow-1",
        "an allow-for-session answer must auto-allow the next request from that session"
    );
}

#[test]
fn answer_permission_with_unknown_request_id_fails() {
    require_python3!();
    let client = spawn_mock("basic", PermissionPolicy::Prompt);
    let error = client
        .answer_permission("no-such-request", PromptDecision::Reject)
        .expect_err("answering an unknown request id must fail");
    assert!(matches!(
        error,
        airi_acp::AcpError::UnknownPermissionRequest(id) if id == "no-such-request"
    ));
}

#[test]
fn prompt_stream_delivers_updates_incrementally_and_finishes() {
    require_python3!();
    let client = Arc::new(spawn_mock("basic", PermissionPolicy::Prompt));
    let session = initialize_and_session(&client);

    let events = client
        .prompt_stream(&session, "hi there")
        .expect("prompt_stream failed");
    let mut text = String::new();
    let mut saw_agent_chunk = false;
    let mut stop_reason = None;
    for event in events {
        match event {
            airi_acp::SessionEvent::Update(update) => {
                if let Some(chunk) = airi_acp::SessionUpdate::agent_text(&update) {
                    saw_agent_chunk = true;
                    text.push_str(chunk);
                }
            }
            airi_acp::SessionEvent::Finished(Ok(result)) => {
                stop_reason = result
                    .get("stopReason")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                break;
            }
            airi_acp::SessionEvent::Finished(Err(error)) => panic!("turn failed: {error}"),
        }
    }

    assert!(saw_agent_chunk, "expected at least one agent_message_chunk");
    assert_eq!(text, "Hello world");
    assert_eq!(stop_reason.as_deref(), Some("end_turn"));
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

#[test]
fn load_session_accumulates_replayed_updates() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let result = client
        .load_session("sess-mock-1", Some(std::path::Path::new("/tmp")))
        .expect("load_session failed");
    assert_eq!(result.session_id, "sess-mock-1");
    assert_eq!(result.updates.len(), 2);
    let text: String = result
        .updates
        .iter()
        .filter_map(SessionUpdate::agent_text)
        .collect();
    assert_eq!(text, "Loaded history");
    assert!(result
        .updates
        .iter()
        .all(|u| matches!(u, SessionUpdate::AgentMessageChunk(_))));
    let modes = result
        .modes
        .as_ref()
        .expect("modes missing from load result");
    assert_eq!(modes.current_mode_id, "default");
    assert_eq!(modes.available_modes.len(), 2);
    assert_eq!(modes.available_modes[1].id, "plan");
    assert_eq!(modes.available_modes[1].name, "Plan");
    assert_eq!(
        modes.available_modes[1].description.as_deref(),
        Some("Planning mode")
    );
    let config_options = result
        .config_options
        .as_ref()
        .expect("configOptions missing from load result");
    assert_eq!(config_options.len(), 1);
    assert_eq!(config_options[0]["id"], "model");
}

#[test]
fn load_session_reports_missing_session_as_typed_not_found() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let error = client
        .load_session("sess-missing", Some(std::path::Path::new("/tmp")))
        .expect_err("loading a missing session must fail");
    assert!(matches!(error, AcpError::SessionNotFound(id) if id == "sess-missing"));
}

#[test]
fn resume_session_returns_setup_state_without_replay() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let result = client
        .resume_session("sess-mock-1", Some(std::path::Path::new("/tmp")))
        .expect("resume_session failed");
    assert_eq!(result.session_id, "sess-mock-1");
    assert!(result.updates.is_empty(), "resume does not replay history");
    let modes = result
        .modes
        .as_ref()
        .expect("modes missing from resume result");
    assert_eq!(modes.current_mode_id, "default");
    assert_eq!(modes.available_modes.len(), 1);
}

#[test]
fn list_sessions_parses_and_follows_pagination() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let sessions = client.list_sessions().expect("list_sessions failed");
    assert_eq!(sessions.len(), 2, "expected both pages of canned sessions");
    assert_eq!(sessions[0].session_id, "sess-mock-1");
    assert_eq!(sessions[0].cwd, "/tmp");
    assert_eq!(sessions[0].title.as_deref(), Some("Mock session one"));
    assert_eq!(
        sessions[0].updated_at.as_deref(),
        Some("2026-11-01T00:00:00Z")
    );
    assert!(sessions[0].additional_directories.is_empty());
    assert_eq!(sessions[1].session_id, "sess-mock-2");
    assert_eq!(sessions[1].cwd, "/work");
    assert_eq!(sessions[1].title, None);
    assert_eq!(sessions[1].updated_at, None);
    assert_eq!(sessions[1].additional_directories, ["/work/extra"]);
}

#[test]
fn delete_session_acknowledges() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let outcome = client
        .delete_session("sess-mock-1")
        .expect("delete_session failed");
    assert_eq!(outcome, DeleteSessionResult::AgentAcknowledged);
}

#[test]
fn delete_session_reports_missing_session_as_typed_not_found() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let error = client
        .delete_session("sess-missing")
        .expect_err("deleting a missing session must fail");
    assert!(matches!(error, AcpError::SessionNotFound(id) if id == "sess-missing"));
}

#[test]
fn set_mode_and_set_config_option_round_trip() {
    require_python3!();
    let client = spawn_mock("sessions", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    client
        .set_mode("sess-mock-1", "plan")
        .expect("set_mode failed");

    let result = client
        .set_config_option(
            "sess-mock-1",
            "model",
            &SessionConfigValue::ValueId("thorough".to_string()),
        )
        .expect("set_config_option failed");
    assert_eq!(result.config_options.len(), 1);
    assert_eq!(result.config_options[0]["currentValue"], "thorough");

    let result = client
        .set_config_option("sess-mock-1", "fast", &SessionConfigValue::Boolean(true))
        .expect("set_config_option (boolean) failed");
    assert_eq!(result.config_options.len(), 1);
}

#[test]
fn unsupported_agent_fails_with_typed_error_no_hang() {
    require_python3!();
    // The `basic` mock has a catch-all that answers -32601 for anything it
    // does not implement.
    let client = spawn_mock("basic", PermissionPolicy::Prompt);
    client.initialize().expect("initialize failed");

    let error = client
        .load_session("sess-mock-1", Some(std::path::Path::new("/tmp")))
        .expect_err("load_session must fail on an agent without the capability");
    assert!(matches!(error, AcpError::Unsupported { ref method } if method == "session/load"));

    let error = client
        .resume_session("sess-mock-1", Some(std::path::Path::new("/tmp")))
        .expect_err("resume_session must fail on an agent without the capability");
    assert!(matches!(error, AcpError::Unsupported { ref method } if method == "session/resume"));

    let error = client
        .list_sessions()
        .expect_err("list_sessions must fail on an agent without the capability");
    assert!(matches!(error, AcpError::Unsupported { ref method } if method == "session/list"));

    let error = client
        .delete_session("sess-mock-1")
        .expect_err("delete_session must fail on an agent without the capability");
    assert!(matches!(error, AcpError::Unsupported { ref method } if method == "session/delete"));

    let error = client
        .set_mode("sess-mock-1", "plan")
        .expect_err("set_mode must fail on an agent without the capability");
    assert!(matches!(error, AcpError::Unsupported { ref method } if method == "session/set_mode"));

    let error = client
        .set_config_option(
            "sess-mock-1",
            "model",
            &SessionConfigValue::ValueId("fast".to_string()),
        )
        .expect_err("set_config_option must fail on an agent without the capability");
    assert!(
        matches!(error, AcpError::Unsupported { ref method } if method == "session/set_config_option")
    );
}
