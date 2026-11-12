<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P12 Lane G — GUI-thread gateway dispatch (wave ⑫)

Lane: GUI-thread dispatch for `--gateway` channel clients acting on the user's session. Exclusively typed, allowlisted, **opt-in, off by default** verbs — the first sanctioned path for gateway RPC to touch the GUI thread, replacing the hard read-only posture of `renderer.*`.

Crates: `apps/airi-qt/crates/airi-qt` (new bridge + additive handler registrations), `apps/airi-qt/crates/airi-channel` (one new typed error code). Nothing else was touched in this lane, plus this note. **No git writes.** Central integration required before the app builds or the bridge runs — see [Central integration steps](#central-integration-steps).

## What shipped

| Piece | File | State |
|---|---|---|
| Dispatch core + Qt pump qobject | `crates/airi-qt/src/bridges/gateway_pump.rs` (NEW) | complete, tested in /tmp copy |
| `renderer.notify` / `renderer.window.raise` / `renderer.stage.visibility` handler registrations | `crates/airi-qt/src/gateway_handlers.rs` (EDIT, additive) | complete — **requires** `pub mod gateway_pump;` to compile |
| `RpcError::actions_disabled()` → `rpc_actions_disabled`, mapping at the renderer-handler call site | `crates/airi-channel/src/dispatch.rs` (EDIT, additive) | complete, tested in the real tree |
| This note | `docs/phase-notes/p12-lane-gui-thread-dispatch.md` | complete |

Explicitly **not** shipped: any UI change; the Main.qml patch (it is in this note, do-not-apply); new verbs; egress/network changes; registration in `bridges/mod.rs` / `build.rs` / QML module (all central).

## Design

### `GatewayPumpController` (cxx-qt qobject, `airi_qt` namespace)

- **qproperties**: `pendingCount` (`i32`, outstanding = waiting + in-flight actions; for smoke/debug only), `enabled` (`bool`, live mirror of the config flag, re-read on every pump tick).
- **qinvokables**:
  - `pumpRequests()` — Qt thread; called by an always-on 50 ms QML Timer in Main.qml. Drains up to 16 pending actions; `renderer.notify` executes in Rust on the Qt thread (notify-rust, session bus only); the two window verbs emit `requestWindowAction`; every action is answered (inline reply, QML completion, or the 2 s timeout).
  - `completeWindowAction(id: quint64, ok: bool, payloadJson: QString)` — called from QML after a GUI verb executes; parses the payload, completes the pending oneshot, returns `true` when a slot was open.
- **qsignal**: `requestWindowAction(id: quint64, method: QString, payloadJson: QString)` — `Connections { target: gatewayPump }` in Main.qml routes to `WindowManager`.
- State lives in a process-wide static (`DISPATCH`), not in the QObject; the struct only mirrors the two properties for QML.

### Static dispatch core (plain Rust, no Qt)

`static DISPATCH: OnceLock<Arc<GuiDispatch>>` with the mandated shape:

```rust
struct GuiDispatch {
    pending: Mutex<VecDeque<PendingAction>>,   // FIFO, capped at 16
    slots:   Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    seq:     AtomicU64,                        // id sequence (starts at 1)
    timeout: Duration,                          // 2 s in production
}

pub(crate) fn dispatch_request(method: &str, payload: &Value) -> Result<Value, String>
```

`dispatch_request` (called from the registered `renderer.*` handlers, i.e. on channel connection reader threads):

1. **`allow_actions()`** — re-reads `<profile>/server-channel/config.json` *per call* (tiny file; nothing cached). `"allowActions": true` (JSON boolean, strict) enables; anything else — missing file, missing key, wrong type, unreadable file, invalid JSON — fails closed. Path resolution mirrors `bridges::discord_gateway` / `main.rs`: `<profile>/server-channel/config.json` when a profile dir is registered (always, from `main`; default launches have it equal to `airi_channel::default_config_path()`), else `dirs::data_dir()/airi-qt/server-channel/config.json`.
2. If disabled → `Err("actions-disabled: gateway actions are off; set \"allowActions\": true in <path>")` — airi-channel maps the `actions-disabled` prefix to `rpc_actions_disabled`.
3. If enabled → validate the verb + payload **fail-fast** (unknown verbs / unknown keys / oversize strings / wrong types never reach the queue), enqueue, store the oneshot, park on `recv_timeout(2s)`. On timeout → retire the entry (slot + pending), `Err("handler timed out")`. On disconnected sender → `Err("handler went away")`.

Unblocked pump: `pumpRequests()` drains (≤16), `renderer.notify` runs in Rust on the Qt thread, window verbs emit `requestWindowAction`; QML executes and calls `completeWindowAction`, which parses `payloadJson` and completes the oneshot.

### Verbs — typed allowlist, exactly these three, no others

| method | payload | executor | reply `data` |
|---|---|---|---|
| `renderer.notify` | `{title, body}` — both required strings; `title` non-empty (after trim), ≤200 chars; `body` ≤400 chars; Unicode-aware caps; unknown keys rejected | Rust: `notify_rust::Notification` on the Qt thread, `appname` fixed to `AIRI`, **session bus only** | `{notified: true}` or `Err(msg)` |
| `renderer.window.raise` | `{which: "chat"\|"settings"\|"about"\|"stage"}` — unknown keys rejected | QML: `WindowManager.open*` (existing windows are raised, not re-created) | `{raised: which}` |
| `renderer.stage.visibility` | `{}` or `{visible?: bool}` | QML: `WindowManager.toggleStage()` (empty) or `stageWindow.visible = …` (provided) | `{visible: bool}` |

**There is no eval.** No arbitrary QML/JS execution, no `Function()`, no dynamic property writes, no screen-content access, no input injection, no window-creation-other-than-the-allowlisted-four, no `quit`. `renderer.notify` reaches **this session's notification daemon only** and cannot target other apps or other buses. The `renderer.*` read-only surface (`renderer.info`) is unchanged.

Registration (`gateway_handlers::build`) is **unconditional**: the dispatch core enforces the flag at request time. Flipping `config.json` takes effect on the next RPC — no app restart. If the config is healed (missing/invalid file ⇒ token regenerated), the healer rewrites only `hostname` + `authToken` and drops `allowActions` — i.e. healing also fails closed.

## Thread model

```text
 gateway client (loopback websocket, --gateway, authenticated)
   │  {"type":"rpc","action":"renderer.notify","payload":{"title":"t","body":"b"},"id":"c1"}
   ▼
 channel connection reader thread          [airi-channel dispatch_renderer; auth already enforced]
   │  handler lookup (registry) → gateway_handlers::build closure
   │  dispatch_request()                   ◄── re-reads config flag HERE, per call
   ▼
 GuiDispatch (process-wide static — plain Rust; the config re-read happens in dispatch_request, not here)
   │  validate (verb + payload)  ── unknown verb/keys → Err before enqueue
   │  enqueue PendingAction{id, method, payload}; store oneshot Sender in `slots`
   │  park on recv_timeout(2s)  ──────────────────────── reader thread parks here
   ▼
 Qt thread                                [50 ms Timer in Main.qml → gatewayPump.pumpRequests()]
   ├─ renderer.notify           → notify_rust (org.freedesktop.Notifications on the session bus) → complete inline
   ├─ renderer.window.raise     → emit requestWindowAction(id, method, payloadJson) ─┐
   └─ renderer.stage.visibility → emit requestWindowAction(id, method, payloadJson) ─┤
                                                                                    ▼
                                              QML Connections: route to WindowManager
                                              (openChat/openSettings/openAbout/openStage, toggleStage)
                                              → gatewayPump.completeWindowAction(id, ok, JSON.stringify(result))
                                                                                    │
 QML completion → GuiDispatch::complete(id, parse_completion(ok, json)) ◄────────────┘
   │  payload_json parse: ok → JSON crosses verbatim; failure → {"error":…} unwrapped, or raw string
   ▼
 reader thread unblocks → rpc reply {"ok":true,"data":{…},"id":"c1"}
```

Threading notes:

- The 2 s bound caps how long any connection thread parks **regardless of QML health** — a wedged GUI (or a `stageWindow` that never reports) yields `handler timed out`, and the pending entry is retired so a late completion is ignored (`completeWindowAction` returns `false`).
- Lock order is always `pending` → `slots` (see `retire`); no lock is held across a blocking wait or a Qt call.
- The pump never touches QObjects across threads: it drains the static queue on the Qt thread, and the only Qt-facing hop is the `requestWindowAction` signal, consumed by QML.
- `pendingCount` is updated only on Qt-thread events (pump tick / completion). It is a smoke/debug signal, not a precise real-time counter across threads.

## Config example

`<profile>/server-channel/config.json` (e.g. `~/.local/share/airi-qt/server-channel/config.json`):

```json
{
  "hostname": "127.0.0.1",
  "authToken": "<uuid-v4 — unchanged>",
  "allowActions": true
}
```

`"allowActions": true` must be a JSON boolean. Anything else — or the key absent — means GUI-dispatch verbs reply `rpc_actions_disabled` (`gateway actions are disabled (set allowActions=true to enable)`) while `renderer.info` and all existing read-only methods keep working. Removing the key disarms actions on the very next RPC; no restart.

## Security analysis

**Flag posture.** Off by default; two layers must both be opted into (`--gateway` to bind the channel server, `allowActions` to enable GUI verbs). The flag is re-read per request, not cached at startup, so disabling takes effect immediately. The config file lives next to the auth token and inherits its protection. Healing the config drops `allowActions` (fail-closed). The error message for a disabled request names the key and file path but never the config contents or the token.

**Typed allowlist.** Exactly three verbs cross the GUI boundary. There is deliberately **no** `renderer.eval`, `renderer.runQml`, or generic `renderer.window.open(url)`; `renderer.window.raise` resolves to a fixed enum of four window kinds, and `renderer.stage.visibility` toggles or sets one boolean on one window. A gateway client with the token can: ping, read build/liveness/aggregate counts, raise four windows, and toggle stage visibility — and nothing else.

**Why no eval.** The gateway is reachable by anything holding the loopback auth token — a leaked token must not become code execution on the user's machine. Allowlisted verbs degrade gracefully: worst case is four windows appearing and a desktop notification. Eval would hand the attacker the full Qt/QML surface, the filesystem, and the user's session. If a future wave needs a new verb, it is a code change with review, not a config toggle or a protocol extension.

**Payload constraints.** Unknown keys are rejected (tight allowlist), notify title/body are capped at 200/400 Unicode scalar values (matching the crate's journal-truncation convention), `which` is a closed enum, `visible` must be a real boolean. Validation happens at dispatch time (fail fast) and is re-checked at execution time (defense in depth). The notification title/body are treated as untrusted input: they cross to D-Bus verbatim but are **never logged** anywhere in the crate.

**Timeout bounds.** 2 s park bound per request; 16-action queue bound with `actions-queue-full` overflow; 16-action drain cap per 50 ms tick. A misbehaving client can enqueue at most 16 outstanding actions, and none of them parks a connection thread longer than 2 s.

**Re-read per request.** `allow_actions()` does one tiny file read per RPC on the connection thread. This is intentional over a cached `AtomicBool` refreshed by the pump: the pump can be delayed, dropped, or crashed while the flag must stay authoritative. A 100-byte file read at RPC frequency is cheaper than the consistency question.

**Error mapping.** `rpc_actions_disabled` (new, stable code) is mapped in exactly one place — the renderer-handler call site, which matches the `actions-disabled` message prefix. All other handler errors keep `rpc_handler_error` (512-char truncation) and panics keep `rpc_handler_panic` (generic message, payload logged server-side only). `rpc_handler_error` remains the default for everything, including `actions-queue-full` and validation failures.

**Not a security boundary by itself.** The gateway remains loopback-bound by default, token-authenticated, and opt-in. A non-loopback bind is already an explicit, documented posture change (`SERVER_CHANNEL_PORT` sets only the port; the hostname is the config's). `allowActions` does not weaken any of that; it only ratifies the three verbs above.

## Central integration steps (all require explicit central action)

1. **`crates/airi-qt/src/bridges/mod.rs`** — add `pub mod gateway_pump;` (alphabetical between `hearing` and `i18n`).
2. **`crates/airi-qt/build.rs`** — add `manifest_dir.join("src/bridges/gateway_pump.rs"),` to the `files` array (every `#[cxx_qt::bridge]` file must be listed). **Without steps 1–2 the `airi-qt` crate does not compile as of this lane** — `gateway_handlers.rs` references `crate::bridges::gateway_pump`. That is the deliberate handoff state: do not "fix" by editing `bridges/mod.rs` in this lane.
3. **`apps/airi-qt/qml/Main.qml`** — create the controller, the timer, and the Connections block (do-not-apply QML, exact text):

```qml
    // GUI-thread gateway dispatch (wave ⑫). Opt-in via "allowActions": true in
    // <profile>/server-channel/config.json; off by default. See
    // docs/phase-notes/p12-lane-gui-thread-dispatch.md.
    GatewayPumpController {
        id: gatewayPump
    }

    Timer {
        interval: 50
        repeat: true
        running: true
        onTriggered: gatewayPump.pumpRequests()
    }

    // Route GUI verbs from the gateway to the same handlers the Control Strip uses.
    Connections {
        target: gatewayPump
        function onRequestWindowAction(id, method, payloadJson) {
            var ok = true
            var result = ({})
            try {
                var p = JSON.parse(payloadJson)
                if (method === "renderer.window.raise") {
                    var which = p.which
                    switch (which) {
                    case "chat":     WindowManager.openChat();     break
                    case "settings": WindowManager.openSettings(); break
                    case "about":    WindowManager.openAbout();    break
                    case "stage":    WindowManager.openStage();    break
                    default:         ok = false; result = { error: "unknown window: " + which }
                    }
                    if (ok)
                        result = { raised: which }   // open* raises if the window exists
                } else if (method === "renderer.stage.visibility") {
                    var visible
                    if (p.visible === true || p.visible === false) {
                        var stage = WindowManager.stageWindow
                        if (stage) {
                            stage.visible = p.visible
                            visible = p.visible
                        } else if (p.visible) {
                            WindowManager.openStage()   // no stage window yet → opening it *is* visible=true
                            visible = true
                        } else {
                            visible = false             // nothing to hide
                        }
                    } else {
                        visible = WindowManager.toggleStage()   // returns the new visibility
                    }
                    result = { visible: visible }
                } else {
                    ok = false
                    result = { error: "unknown gateway verb: " + method }
                }
            } catch (e) {
                ok = false
                result = { error: String(e) }
            }
            gatewayPump.completeWindowAction(id, ok, JSON.stringify(result))
        }
    }
```

   No new strings, no locales, no UI surface. `Main.qml` already imports `com.airi.airiqt 1.0`; `WindowManager` is already the singleton used by the tray/desktop paths.
4. **CMake**: there is no CMake step — the app builds via cargo + cxx-qt-build; steps 1–3 are the entire build wiring. Qt itself is resolved by `qt-build-utils` from the system Qt (as today; nothing new).
5. **`bridges/mod.rs` registration also makes `GatewayPumpController` visible to the smoke tour** (optional): print `gatewayPump.pendingCount` / `gatewayPump.enabled` in the smoke output if the Tour wants to observe it. Zero UI; not required.
6. **`airi-channel` is already integrated** (this lane edited it in the real tree): `cargo test -p airi-channel` passes.
7. **GUI smoke is central's gate.** This lane does not claim a smoke pass; the bridge is unregistered here by construction.

## Verification

Commands (this lane):

- Real tree — `cargo test -p airi-channel`: `--lib` **71 passed** (dispatch.rs gained exactly one test: `renderer_handler_actions_disabled_maps_to_actions_disabled`, 19 → 20 in-file); `tests/channel_server.rs` **7 passed**; doc-tests 0. `cargo clippy -p airi-channel --all-targets -- -D warnings` clean. The pre-existing `bridges/chat.rs` / `bridges/memory.rs` modifications in the working tree belong to another lane and were not touched.
- /tmp copy (`/tmp/opencode/airi-qt-verify`) — full tree copied excluding `target/`/`dist/`, with `pub mod gateway_pump;` **and** the `build.rs` `files` entry added **there only**; the real tree's `bridges/mod.rs`/`build.rs` are untouched. `cargo check -p airi-qt --all-targets`, `cargo test -p airi-qt`, `cargo clippy -p airi-qt --all-targets -- -D warnings`, `cargo fmt -p airi-qt -- --check` — results in *Test evidence*.
- The real tree `cargo test -p airi-qt` **fails to compile** as of this lane (missing module registration) and is expected to go green after central steps 1–2.

Tests (all in-module, `#[cfg(test)]`, never touching D-Bus/Qt/the real profile dir):

- Flag parsing against temp dirs: missing file → false; `"allowActions": true` → true; explicit `false` → false; non-boolean (`"true"`, `1`, `null`, `{}`) → false; absent key → false; garbage JSON → false.
- Disabled path: `dispatch_request("renderer.notify", …)` with no resolvable config fails closed (`actions-disabled:` prefix, message names the key). Production entry point; `cfg(test)` swaps config resolution to `None`, so the unit tests never read the user's real `server-channel/config.json`.
- Full roundtrip with a test executor: the requester parks on a worker thread; the test thread plays the pump (drain → stub complete). Covers notify and GUI-verb completions (`completeWindowAction` semantics, including `{"visible":true}` JSON verbatim).
- Timeout: `GuiDispatch` with 80 ms timeout → `Err("handler timed out")`; outstanding queue drains to zero; a late `complete()` finds no oneshot; the action never executes.
- FIFO ordering + drain limit (`drain(2)` of 3 returns oldest 2; remainder preserves order).
- Pending cap: 16 enqueues succeed, the 17th refuses with `actions-queue-full:`.
- Payload untouched: notify payload with multibyte/line-break content crosses enqueue→drain byte-identical; visibility payloads `{}` and `{"visible":false}` round-trip verbatim.
- Verb validation matrix (notify title/body caps at 200/400 scalar values including 🦀-style multibyte, unknown keys, wrong types; `raise` closed enum + unknown keys; `visibility` shapes; unknown verbs refused before enqueue).
- `parse_completion`: ok-path verbatim JSON, `{"error":…}` unwrap on failure, raw-string fallback, 512-char truncation.

## Test evidence

Commands (all inside `/tmp/opencode/airi-qt-verify`, a byte-copy of the app tree **excluding `target/` and `dist/`**, with `pub mod gateway_pump;` in `bridges/mod.rs` and the `build.rs` `files` entry added **there only**; the real tree's `mod.rs`/`build.rs` untouched):

- `cargo test -p airi-qt` → **44 passed, 0 failed** (unit tests, `--lib` binary) — includes the 20 new `bridges::gateway_pump::tests::*` tests. Pre-existing bridge tests (desktop, providers, mcp, memory, speech, discord_gateway) all still pass.
- `cargo check -p airi-qt --all-targets` → clean (this is also what compiles the cxx-qt bridge, QML module registration, and the window-pump qobject).
- `cargo clippy -p airi-qt --all-targets -- -D warnings` → clean (finished in 1m 09s after a full re-check of all workspace members).
- `cargo fmt -p airi-qt -- --check` → clean (gateway_pump.rs was formatted and the formatted copy synced back into the real tree).
- Real tree: `cargo fmt -p airi-channel -- --check` clean after a single `rustfmt` pass on `dispatch.rs`; `cargo test -p airi-channel` → `--lib` **71 passed**, `tests/channel_server.rs` **7 passed**; `cargo clippy -p airi-channel --all-targets -- -D warnings` clean.
- The real tree's `cargo check -p airi-qt` fails as of this lane (missing module registration — deliberate; see integration step 1–2). It is expected to go green after central registers `gateway_pump`.

One pre-existing fact surfaced while building: the `#[cxx_qt::bridge]` layer requires `use cxx_qt::CxxQtType;` for `rust_mut()` (the house pattern from `memory.rs`), and `qproperty(i32, …, READ, NOTIFY)` generates the `<name>_changed()` notify signals but **no** Rust setter — property writes go through `rust_mut()` + the notify call, exactly like `MemoryController`.

## Not-done list

- **No new verbs.** Exactly `renderer.notify`, `renderer.window.raise`, `renderer.stage.visibility`. Adding one requires a new wave + review (see "Why no eval").
- **No UI.** `pendingCount`/`enabled` exist for the smoke Tour to print; nothing else exposes them. Zero QML is applied by this lane.
- **No egress changes.** No network, no new sockets, no outbound calls. Notification delivery is the session D-Bus daemon only.
- **`renderer.info` unchanged**, byte-for-byte.
- **Notification title/body are never logged**, not even on failure (only a static failure line plus the notify-rust error chain, which carries no user content).
- **No restart-free config reload beyond the flag.** `allowActions` is re-read per RPC; nothing else in the config is re-read by this lane. (Healing semantics: adding `allowActions` to a config that later fails to parse loses the key — documented, fail-closed.)
- **No `--smoke` behavior change other than notification suppression** (mirrors `desktop.rs`: smoke suppresses the real D-Bus notification and returns an error to the client).
- **No i18n strings** (no user-visible UI this wave; the QML block adds a Timer and a Connections handler, no text).
- **No git operations.** Central applies this lane's changes.
- **Integration smoke / GUI verification is central's gate**, not this lane's.
