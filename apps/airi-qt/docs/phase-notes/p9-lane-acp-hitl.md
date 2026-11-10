# P9 · Lane H1 — ACP agents, end-to-end in the Qt app (`airi-acp` HITL + `AcpController` + ACP Agents page)

Lane: **H1 · ACP agent path, first agentic-OS slice** — wires the Agent
Client Protocol flow into the Rust+Qt app end to end: human-in-the-loop
permission support in the `airi-acp` crate, a Qt bridge
(`AcpController`), and the settings page (`AcpAgentsPage.qml`). Owns
`apps/airi-qt/crates/airi-acp/**`, `apps/airi-qt/crates/airi-qt/src/bridges/acp.rs`,
`apps/airi-qt/qml/pages/settings/modules/acp/AcpAgentsPage.qml`.

Surrounding work this lane did **not** do (all central-registrar steps):
adding the `airi-qt` crate's dependency on `airi-acp`, registering the
bridge in `bridges/mod.rs` / `build.rs`, the `SettingsWindow.qml` nav entry
& smoke-tour wiring, the `packages/i18n/**` locale files, and anything in
the screen-capture lane (`ScreenCapturePage.qml`, `capture.rs`, locale
`shell.capture.*` keys — all present in the working tree but belong to
another lane).

Reference implementation (read-only):

- `apps/stage-tamagotchi/src/main/services/airi/acp-agents/index.ts`
  (spawn → initialize → session/new → session/prompt; `prompt` /
  `auto-read` / `auto-all` permission policies; `appData/airi/acp.json`)

## What was added to `airi-acp` (exact API)

### New public types (`types.rs`)

```rust
/// A `session/request_permission` request enqueued for the human
pub struct PermissionRequest {
    /// Server-initiated JSON-RPC id, normalized the same way as response
    /// ids (`normalize_response_id`): decimal string of a numeric id, or the
    /// raw id's JSON text when not a number. Pass back verbatim as
    /// `request_id` to `answer_permission`.
    pub request_id: String,
    /// The session the tool call belongs to (`sessionId` in the request).
    pub session_id: String,
    /// The raw `toolCall` object from the request, verbatim.
    pub tool_call: Value,
    /// The options the agent offered, in wire order.
    pub options: Vec<PermissionOption>,
}

/// How the human answered a pending permission request.
pub enum PromptDecision {
    /// Allow this one tool call only (first `allow_*` option).
    AllowOnce,
    /// Allow this tool call and remember the session — see the caveat below.
    AllowSession,
    /// Reject the tool call (first `reject_*` option, else last option).
    Reject,
}
```

### `AcpAgentClient` — new methods

```rust
/// Channel carrying `session/request_permission` requests enqueued for the
/// human (the `Prompt` policy). The same `Arc` is returned on every call; an
/// embedder may hold it for the client's lifetime. Bounded (capacity 8).
/// When the client is dropped, the send half drops and receivers observe
/// `Disconnected`.
pub fn permission_requests(&self) -> Arc<Mutex<mpsc::Receiver<PermissionRequest>>>;

/// Answer a pending permission request previously delivered through
/// `permission_requests`.
pub fn answer_permission(&self, request_id: &str, decision: PromptDecision)
    -> Result<(), AcpError>;
/// Errors: `AcpError::UnknownPermissionRequest` when the id does not match a
/// pending request (already answered, never enqueued, or the enqueue queue
/// was full and the request failed closed). Transport errors when the reply
/// cannot be written.

/// Like `prompt`, but returns the event receiver for the turn immediately.
/// Callers must keep draining it (there is no timeout in this mode; cancel
/// with `cancel` if the agent stalls).
pub fn prompt_stream(&self, session_id: &str, text: &str)
    -> Result<mpsc::Receiver<SessionEvent>, AcpError>;
```

`SessionEvent` is now public (it crosses the bridge boundary):
`SessionEvent::Update(SessionUpdate)` and
`SessionEvent::Finished(Result<Value, AcpError>)`.

### Behaviour change: `PermissionPolicy::Prompt`

Previously `prompt` failed closed (selected the reject-style option without
asking). It now **enqueues** the request for the embedder:

1. The reader thread classifies `session/request_permission`. If the
   session is in the internal allow-for-session list (see below), it answers
   `allow_*` immediately without prompting.
2. Otherwise it builds a `PermissionRequest` (`request_id` = the
   server-initiated JSON-RPC id normalized with `normalize_response_id`,
   exactly like response ids), stores the reply context in a dedicated
   `pending_permissions: Mutex<HashMap<String, PendingPermission>>` map
   (inserted **before** the send, so a fast answerer can never observe a
   missing entry), and `try_send`s it into a bounded channel (capacity 8).
3. The agent stays blocked (no reply) until `answer_permission` writes the
   reply. If the channel is full or disconnected — or the pending-permissions
   lock is poisoned — the request fails closed: first `reject_*` option,
   else the last option, else `cancelled`, and the pending entry is removed.
   This keeps the agent from hanging silently; a warning is logged.

`answer_permission` maps decisions onto the offered options:

- `AllowOnce` / `AllowSession` → first `allow_*` option; when the agent
  offers no `allow_*` option, the **first** option (mirroring the
  `auto-all` fallback); empty option list → `cancelled`.
- `Reject` → first `reject_*` option; else the **last** option (mirroring
  the historical Electron user-deny fallback); empty list → `cancelled`.
- `AllowSession` additionally records the session in
  `session_allowlist: Mutex<HashSet<SessionId>>`. Subsequent requests from
  that session are answered `allow_*` silently (the agent re-asks; we answer
  without prompting). This is a **client-side approximation** of "allow for
  session" — ACP has no protocol-level grant. `allow_always` is *not*
  specially selected; the first `allow_*` option is used.

`AutoRead` / `AutoAll` semantics are unchanged (still answered inside the
reader thread). Unit-testable seam: the `plan_permission` function holds the
decision order (allowlist → enqueue-or-fail-closed → auto policies) and is
tested without a child process; `permission.rs` holds the pure
`decide_prompt_decision` mapping.

`prompt` behaviour is otherwise unchanged (the collection loop is now
`prompt_stream` + drain). `Drop`/`close` drains pending permission requests
(dropped, warned) and drops `subscriptions` as before.

New/updated tests: `plan_permission_*` unit tests (enqueue, id
normalization, full-queue fail-closed, allowlist short-circuit, empty
options, auto policies unchanged), `decide_prompt_decision_*` mapping tests,
integration tests `prompt_policy_enqueues_permission_request_and_reject_is_delivered`,
`prompt_policy_allow_once_delivers_allow_option`,
`prompt_policy_allow_session_auto_allows_subsequent_requests`,
`prompt_stream_delivers_updates_incrementally_and_finishes`,
`answer_permission_with_unknown_request_id_fails`. The pre-existing
integration test `prompt_policy_rejects_permission_request` was rewritten —
its premise (fail-closed prompt) no longer exists; the count went from 38
suite tests to 54 (all green).

Notable spec deviation, deliberately taken: the spec asked for a new
`mpsc::Sender<PermissionRequest>` "capacity 8"; `std::sync::mpsc` has no
bounded `Sender`, so the queue is a `sync_channel(8)` /
`SyncSender<PermissionRequest>`. The public receiver type
(`mpsc::Receiver<PermissionRequest>`) and the capacity are exactly as
specified.

## Bridge: `crates/airi-qt/src/bridges/acp.rs` (`AcpController`)

QObject, `qml_element`, namespace `airi_qt`. JSON strings cross the
boundary, like the MCP bridge.

### qproperties

| name | type | meaning |
|---|---|---|
| `agentsJson` | QString | Configured agents: `[{name, command, args, env, enabled, permissionPolicy, summary}]`. Read from disk; empty when unset. Never fabricated. |
| `activeAgent` | QString | Name of the running agent, `""` when stopped |
| `sessionId` | QString | Agent session id (`session/new`), `""` when none |
| `agentState` | QString | `"stopped" \| "running" \| "error"` (auto notify signal `agentStateChanged` from the qproperty setter) |
| `lastError` | QString | Last error, `""` when clear |
| `working` | bool | A prompt turn is in flight |
| `transcriptJson` | QString | `[{"kind", "text"}]`; kinds: `user`, `agent`, `thought`, `tool`, `plan`, `system`, `other` |
| `pendingPermissionJson` | QString | The head pending permission request (`null` when none): `{"requestId","sessionId","toolCall","options":[{"optionId","name","kind"}]}` |

### signals

`transcriptChanged`, `permissionRequested` (payload is carried by
`pendingPermissionJson`). The spec-listed `agentStateChanged` signal is the
**auto-generated qproperty notify signal** — a custom `agentStateChanged`
qsignal collided with it at the cxx-qt macro level (known limitation of the
auto-notify naming); the property setter emits it, which is the same wire
signal QML listens to.

### invokables (`cxx_name`)

- `refreshAgents()` — re-read the config file → `agentsJson`
- `addStdioAgent(name, command, argsJson, envJson, permissionPolicy) -> bool`
  — **deviation from the spec's 4-argument signature**: an `envJson`
  parameter was added because the page collects environment entries and the
  config schema supports them. `argsJson` = JSON array of strings (space-
  split accepted by the page); `envJson` = JSON object of string values;
  `permissionPolicy` validated ∈ `prompt|auto-read|auto-all`.
- `removeAgent(name) -> bool` — stops the agent first when it is active
- `setAgentEnabled(name, enabled) -> bool`
- `setAgentPermissionPolicy(name, policy) -> bool` — validates; live-applies
  to the running client via `client.set_permission_policy` when the agent is
  the active one
- `startAgent(name) -> bool` — spawn → `initialize` → `session/new` with
  `cwd` = the profile directory (falls back to the process cwd). One agent
  at a time: starting while one runs fails with an explicit error.
- `stopAgent() -> bool` — `session/close` (best-effort), then kill, join,
  clear runtime state; idempotent
- `promptAgent(text) -> bool` — appends a `user` transcript entry, calls
  `client.prompt_stream`, sets `working`; updates accumulate via
  `pumpUpdates`
- `cancelPrompt() -> bool` — `session/cancel`
- `answerPermission(requestId, decision) -> bool` — `decision` ∈
  `allow_once|allow_session|reject`; maps to `PromptDecision` and calls
  `client.answer_permission`; pops the answered request from the pending
  queue and republishes `pendingPermissionJson`
- `pumpUpdates()` — QML calls on a 100 ms timer: drains
  `SessionEvent`s into `transcriptJson` (consecutive agent/thought/user
  chunks coalesce into one entry), moves newly enqueued permission requests
  into `pendingPermissionJson` + emits `permissionRequested`, and flips a
  live agent to `error` when the reader hits EOF (`is_closed()`)

### Config file

`<profile>/airi/acp.json` (`--profile`), else
`<platform-data>/airi-qt/acp.json` (`dirs::data_dir()`) — same convention as
Electron's `appData/airi/acp.json`. Schema:
`{"agents": {name: {command, args, env, enabled, permissionPolicy}}}`
(camelCase `permissionPolicy`, matching Electron). Saves are atomic
(`tmp` + rename). No Python/Electron defaults are ever injected — absent or
empty file → empty list.

### Transcript entry mapping

`agent_message_chunk` → `agent`; `agent_thought_chunk` → `thought`;
`user_message_chunk` → `user`; `tool_call` → `tool` (title or toolCallId);
`tool_call_update` → `tool` (`<id> → <status>` or `<id>: <title>`);
`plan` → `plan` (raw JSON); anything else → `other` (`<update>: <raw JSON>`).
`session/prompt` response → a `system` entry `turn finished (<stopReason>)`;
a failed turn sets `lastError` and adds a `system` entry `prompt failed: …`.

Bridge-generated strings are plain English and are not i18n'd (see the
"i18n" section).

## The page: `qml/pages/settings/modules/acp/AcpAgentsPage.qml`

Same shape and density as `McpSettingsPage.qml`: `Item` root, `Flickable` +
`ColumnLayout`, header row (title + state badge), single honest capability
banner (`Theme.warning` border, text: stdio/live-subprocess note + `fs/*`/
`terminal/*` unimplemented — agents that want the filesystem will ask or be
denied by policy), `RowLayout` with the two cards (agents list / add agent),
an active-session card, then the transcript card.

Top row:

- **Configured Agents** (`ACard` per agent, from `agentsJson`): enable
  `ASwitch`, permission-policy badge, `summary` (command + args), `Start`/
  `Stop` (accent when stopped, default when running), `Delete` (Danger).
  `ASwitch.onToggled` → `setAgentEnabled`; buttons → `startAgent` /
  `stopAgent` / `removeAgent`; page then re-reads `agentsJson`. Empty state
  → `AEmptyState` with guidance, no fabricated defaults.
- **Add Stdio Agent** card: name, command, args (JSON array or
  space-separated), env (`KEY=value` per line, `#` comments skipped),
  permission-policy `ASelect` (`prompt`/`auto-read`/`auto-all`), Add button
  (enabled when name+command non-empty) → `addStdioAgent` and fields reset.

Session card: active agent name + elided `sessionId`, `Stop Agent` (visible
while running), live permission-policy `ASelect` for the active agent
(re-bound from the agents list, `onActivated` → `setAgentPermissionPolicy`),
and the **inline permission bar** (visible when
`pendingPermission !== null`): badge + tool title + the three decision
buttons — the same decisions as the modal, usable without opening it.

Transcript card: `AEmptyState` when empty; otherwise a `ListView` of
`{kind, text}` entries with a per-kind `ABadge`
(user=info, agent=accent, thought=default, tool=warning, plan=warning,
system/other=default) and wrapped text; `onTranscriptChanged` re-reads
`transcriptJson` and re-pins `positionViewAtEnd()`. Below it an input row:
enabled only while `agentState === "running" && !working`, `ATextField`
(Enter sends), `Send` (accent), `Cancel` (enabled while `working`) →
`cancelPrompt()`.

Permission `AModal` (`id: permissionModal`): title `shell.acp.permission.title`;
body text; the tool-call title/kind; the agent's offered option names;
buttons **Allow once** (accent) / **Allow for session** (default) /
**Reject** (danger) + a Ghost **Not now** (dismiss — the agent stays
blocked; the inline bar keeps the request answerable). Opened from
`onPermissionRequested`. `onAgentStateChanged` closes the modal when the
agent leaves `running` (agent stopped/died mid-request — stale modals are
worse than missing ones) — a deliberate improvement over always-on modals.

Strings: all user-facing strings go through `I18n.tr("shell.acp.*")`
(41 keys, listed below; locale files were **not** edited). Colors via
`Theme.*`; components only from `qml/components` (ABadge, AButton, ACard,
AEmptyState, AModal, ASelect, ASeparator, ASwitch, ATextArea, ATextField).
`pragma ComponentBehavior: Bound` is set (delegates qualify root ids with
`page.`/`controller.`), which is what keeps qmllint at zero warnings — see
verification. Qt Quick 6 semantics.

## Permission flow, end to end

```
Agent subprocess                         airi-acp (reader thread)              Qt bridge                QML page
───────────────                        ──────────────────────────              ───────────              ─────────
session/request_permission ───────────► handle_message:
  id: 9001                            1. policy == Prompt?
  toolCall: {kind:"read", …}          2. session in allowlist? ──yes──► reply allow_* immediately
  options: [allow-1, reject-1]        3. no → insert PendingPermission{reply_id:9001,…}
                                         into pending_permissions
                                      4. try_send(PermissionRequest{request_id:"9001",…})
                                         ──► channel (sync_channel, cap 8)
                                      5. return — agent blocks, no reply yet
                                                            │
                                                            ▼
                                        100 ms pump (QML Timer → pumpUpdates()):
                                        drain channel → pendingPermissionJson
                                        = {"requestId":"9001","sessionId":…,
                                           "toolCall":{…},"options":[…]}
                                        emit permissionRequested()
                                                            │
                                                            ▼
                                        Connections.onPermissionRequested:
                                        reloadPendingPermission() → modal.open()
                                        (inline bar also becomes visible)
                                                            │
                                                            ▼  user taps a button
                                        answerPermission("9001","allow_once")
                                                            ▼
                                                            answer_permission():
                                                              map decision → wire:
                                                              Allow* → first allow_* (else first),
                                                              Reject → first reject_* (else last)
                                                              (empty options → outcome:"cancelled")
                                                              AllowSession also: session_allowlist.insert(session)
                                                              write {"jsonrpc":"2.0","id":9001,
                                                                      "result":{"outcome":
                                                                        {"outcome":"selected",
                                                                         "optionId":…}}}
                                                            ▼
session/request_permission response ◄────────────────── reply on agent stdin
agent proceeds / aborts the tool call
```

Wire notes:

- `requestId` is the server-initiated JSON-RPC id **normalized like a
  response id** (`normalize_response_id`: numeric → decimal string,
  numeric-looking strings trimmed-parsed). It is *not* the tool-call id.
- The pending entry is inserted into `pending_permissions` **before** the
  channel send, so a fast `answer_permission` can never observe a missing
  entry. If the channel is full/disconnected (or the lock is poisoned) the
  request fails closed (reject-style selection) instead of hanging the
  agent, and a warning is logged.
- `AllowSession` = client-side approximation only. The agent will re-ask on
  its next tool call; the client answers `allow_*` silently for that session.
  There is no protocol-level "allow for session" grant; `allow_always` is
  not specially negotiated (the first `allow_*` option is selected).
- The reply echoes the agent's original (un-normalized) `id` value verbatim.

## Honesty / explicit limits

- **`fs/*` and `terminal/*` are not implemented.** `clientCapabilities` is
  sent empty, so a compliant agent must not call them. An agent whose only
  job is file I/O will be blocked at its first file operation: with the
  `prompt` policy the human is asked (and can keep saying no); with
  `auto-read` only read-like tools pass; with `auto-all` everything passes.
- **Not ported at all:** `session/load`, `session/list`, `session/delete`,
  `session/resume`, `session/set_mode`, `session/set_config_option`,
  `authenticate`, `logout`, MCP servers in `session/new`, elicitation,
  protocol v2 / other unstable features. Unknown server-initiated requests
  get `-32601`.
- **One agent session at a time.** `startAgent` while one runs fails with an
  explicit error. No multi-session UI, no session list.
- **AllowSession is an approximation** (see above).
- **No ACP registry/discovery UI.** The add-agent card is the whole
  onboarding flow; nothing is seeded from the Electron default or anywhere.
- `new_session` cwd = profile dir (fallback: process cwd); absolute-ised by
  the crate.
- `session/prompt` in stream mode has no client-side timeout — the agent can
  stall forever; `working` stays `true` until the agent answers the prompt
  request. `Cancel` sends `session/cancel` and asks the agent to wind down
  (the agent may acknowledge late or not at all); stop/kill the agent to
  abort unconditionally.
- Transcripts are ephemeral (not persisted). Only one `working` spinner.
  `system` entries (`turn finished (…)`, `prompt failed (…)`) are plain
  English from the bridge, not i18n'd.
- Stopping/killing the agent drops any unanswered permission requests
  (dropped, warned); pending `pendingPermissionJson` is reset and the modal
  is told to close via `onAgentStateChanged`.
- The Electron app's `acp.json` is not read; the Qt config path is
  `<profile>/airi/acp.json` or `<platform-data>/airi-qt/acp.json`.
- `initialize` / `session/new` run on the Qt thread (MCP probe idiom),
  bounded by the crate's 10 s RPC timeout; a hung agent blocks the UI up to
  that long. `stderr` is drained into `tracing::debug`.

## i18n keys needed — namespace `shell.acp.*` (English source strings)

Goes under a top-level `acp:` section in `packages/i18n/src/locales/*/shell.yaml`
(flattened to `shell.acp.*`). **Locale files were not edited in this lane.**

```yaml
acp:
  title: 'ACP Agents'
  description: 'Connect to ACP (Agent Client Protocol) agents running as subprocesses. Prompt them, watch their work, and approve or reject their tool calls.'
  notice: 'Agents run as live subprocesses over stdio. Only prompt turns and permission requests are wired — fs/* and terminal/* are not implemented, so agents that want to read or write files or spawn terminals will ask first (or be denied by your permission policy).'
  state:
    running: 'Running'
    stopped: 'Stopped'
    error: 'Error'
  agents:
    caption: 'Configured Agents'
    emptyTitle: 'No agents configured'
    emptySubtitle: 'Add your first ACP agent — command, args, and a permission policy.'
    start: 'Start'
    stop: 'Stop'
    delete: 'Delete'
  addAgent:
    caption: 'Add a Stdio Agent'
    title: 'Add Stdio Agent'
    description: 'Spawns a local agent over stdio (ACP). Example: command npx, args ["-y", "some-acp-agent"].'
    nameLabel: 'Agent Name'
    namePlaceholder: 'e.g. claude-agent'
    commandLabel: 'Command'
    commandPlaceholder: 'e.g. npx'
    argsLabel: 'Arguments (JSON array or space-separated)'
    argsPlaceholder: '["-y", "some-acp-agent"]'
    envLabel: 'Environment (KEY=value per line, optional)'
    envPlaceholder: 'FOO=bar'
    addButton: 'Add Agent'
  policyLabel: 'Permission Policy'
  session:
    caption: 'Agent Session'
    activeLabel: 'Agent session — %1'
    noAgent: 'No agent running'
    stopButton: 'Stop Agent'
  permission:
    pendingBadge: 'Permission pending'
    allowOnce: 'Allow once'
    allowSession: 'Allow for session'
    reject: 'Reject'
    title: 'Permission Request'
    body: 'The agent wants to run a tool:'
    toolKind: 'Tool kind'
    offered: 'The agent offered: %1'
    dismiss: 'Not now'
  transcript:
    caption: 'Transcript'
    emptyTitle: 'No transcript yet'
    emptySubtitle: 'Start an agent and send a prompt to see the conversation here.'
  inputPlaceholder: 'Ask the agent…'
  send: 'Send'
  cancel: 'Cancel'
```

41 keys. `%1` placeholders are required — the QML uses `String.prototype.arg()`
(consistent with the rest of the shell). The bridge itself emits a few
plain-English `system` transcript strings and `lastError` messages (not
keys, see "Transcript entry mapping").

## Verification evidence

Workspace root for all of these: `apps/airi-qt/`.

1. `cargo test -p airi-acp` — **all green**: 42 unit + 12 integration =
   54 tests. (The 38 pre-existing tests still pass, with one rewritten:
   `prompt_policy_rejects_permission_request` →
   `prompt_policy_enqueues_permission_request_and_reject_is_delivered`, since
   the fail-closed premise was removed by design.) Includes the allow-once /
   allow-session wiring, the allow-for-session auto-allow on the next turn,
   the full-queue fail-closed path, the unknown-request-id error, and a
   streaming `prompt_stream` test against the python3 mock agent.
2. `cargo clippy -p airi-acp --all-targets -- -D warnings` — **clean**.
3. `cargo fmt -p airi-acp -- --check` — **clean** (and
   `rustfmt --edition 2021 --check` clean for the bridge).
4. `cargo check -p airi-qt` — the bridge compiles (verified by temporarily
   registering `pub mod acp;` + `airi-acp = { path = "../airi-acp" }`, then
   **reverting**; see "Integration steps"). No warnings. The final committed
   tree intentionally does not contain the registration — it happens in the
   central session.
5. `qmllint` (Qt 6.12.0) of the page in a module sandbox (verbatim copy of
   `qml/` + `qmldir` + non-C++ stubs for `Theme`/`I18n`/`AcpController`/
   `McpController`; flat and `com/airi/airiqt/` layouts both tried):
   **zero errors, zero warnings** on `AcpAgentsPage.qml` (with
   `pragma ComponentBehavior: Bound`; the `Theme.*`/`I18n.*` singleton
   accesses resolve). For calibration, `McpSettingsPage.qml` under the same
   sandbox emits 1 `[unqualified]` warning. Note: the cxx-qt build generates
   its own `qmldir`/`qmltypes` for the real module; do not read the sandbox
   `qmldir` into the app.
6. Runtime instantiation in the same sandbox (`qml -I`, `QT_QPA_PLATFORM=offscreen`,
   Window harness): the page **instantiates cleanly**; with a stateful stub
   emitting `permissionRequested` + a canned `pendingPermissionJson`, the
   modal opens and the permission path runs without binding errors (the only
   output line is the expected `QString::arg` note until the `%1`-bearing
   i18n key lands — the placeholder is part of the reported key).
7. `cargo check -p airi-qt` exercised the bridge macros (qproperties,
   signals, invokables) end to end. Full GUI run with a real ACP agent was
   **not** performed (no agent binary was spawned; the python3 mock agent
   was used for the client-level tests only).

## Integration steps for the central session

1. `crates/airi-qt/Cargo.toml`: `airi-acp = { path = "../airi-acp" }`
   (verified working).
2. `crates/airi-qt/src/bridges/mod.rs`: `pub mod acp;`.
3. `crates/airi-qt/build.rs`: add `manifest_dir.join("src/bridges/acp.rs")`
   to `files`, and
   `module = module.qml_file("qml/pages/settings/modules/acp/AcpAgentsPage.qml");`
4. `SettingsWindow.qml`: add the nav row + page slot (`navIndex` 25 is taken
   by the screen-capture lane as of this writing — watch the numbering), or
   follow whatever the wave ⑥ convention turns out to be.
5. `packages/i18n/src/locales/*/shell.yaml`: add the `acp:` block listed
   above to every locale (English source at minimum).
6. Optionally: smoke-tour registration in `SettingsWindow` /
   `WindowManager` (out of scope here).

## Honesty notes

- The working tree contains another lane's untracked/modified files
  (`capture.rs`, `capture_item.*`, `screen-capture/*`, `shell.capture.*`
  locale keys, `ScreenCapturePage` nav) — **not** part of this lane; do not
  attribute or revert them.
- This lane deliberately did not edit `build.rs`, `SettingsWindow.qml`,
  `bridges/mod.rs`, `Cargo.toml` (crate or workspace), `Cargo.lock`, or any
  locale file. `Cargo.lock`/`Cargo.toml` were temporarily edited only to
  verify the bridge compiles, then reverted byte-for-byte.
- 130+ `[unqualified]` → 0 after adding `pragma ComponentBehavior: Bound`;
  the two remaining `[unqualified]`-adjacent `Info:` notes are gone with it.
- The `QString::arg` stderr line observed during sandbox testing was caused
  by the sandbox `I18n.tr` stub returning the raw key (no `%1`); it resolves
  once the reported keys land — the placeholders are part of the spec.
