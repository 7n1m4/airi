# `godot/` — Anima pet renderer spike (E4-T2)

A **Godot 4 C# project** for the on-demand pet renderer described in
[`docs/design-flutter-godot-pivot.md`](../docs/design-flutter-godot-pivot.md).
It is a thin WS client of the Rust `anima-daemon` (port 6121); it owns no core
state and no backend implementation yet. Research and the decision matrix live
in [`docs/research-godot-renderer-spike.md`](../docs/research-godot-renderer-spike.md).

## Layout

```text
godot/
  project.godot                  Godot 4 project; transparent/borderless window, C# enabled
  AnimaPet.csproj                Godot.NET.Sdk 4.7 / net8.0 (tests target net10.0)
  Main.tscn                      minimal main scene
  scripts/
    Main.cs                      entry node; connects to the daemon, subscribes to
                                 PetTopics, routes decoded events to the active renderer
    Renderers/
      IPetRenderer.cs            backend-agnostic contract (Initialize/SetLipSync/SetEmotion/Process)
      CardRenderConfig.cs        provisional per-card backend + asset path (NOT a wire type)
      PetRendererFactory.cs      selects Live2d or Vrm from the card config
      Live2dRenderer.cs          GDCubism stub (throws NotImplementedException)
      VrmRenderer.cs             godot-vrm/MToon stub (throws NotImplementedException)
      LipSyncSmoother.cs         speech RMS → aa-weight smoother (port of anima-render/vrm/lipsync.rs)
    Net/
      DaemonClient.cs            ws://127.0.0.1:6121 client; auth + event.subscribe + event pump
      DaemonEvents.cs            EventTopics constants + typed payload records + IDaemonEventSink
      EventPayloadDecoder.cs     hand-written thin codec: event frame `data` → typed records (D5)
  tests/
    AnimaPet.Tests.csproj        xUnit project (net10.0); compiles the decoder + smoother directly
    EventPayloadDecoderTests.cs  golden-fixture round-trip tests for every event topic
    LipSyncSmootherTests.cs      port-mirror tests for the lip-sync smoother
    fixtures/                    golden JSON fixtures (one per event topic + edge cases)
```

## How the decoder is wired into the scene

1. `Main._Ready()` constructs a `DaemonClient` (reads the auth token from the
   daemon-owned `server-channel/config.json`, honoring
   `AIRI_SERVER_CHANNEL_CONFIG`), calls `ConnectAsync()` (sends
   `{"type":"auth","authToken":…}`, waits for `{"type":"auth","ok":true}`),
   then `SubscribeAsync(EventTopics.PetTopics)`.
2. A background `PumpAsync` task reads `{"type":"event","topic":…,"data":…}`
   frames, calls `EventPayloadDecoder.Decode(topic, data)`, and raises
   `EventReceived` with the typed payload.
3. `Main.OnDaemonEvent` switches on the payload type and forwards to the
   active `IPetRenderer`.

## Event routing (daemon → renderer)

| Wire topic        | Typed payload           | Renderer call                  |
|-------------------|-------------------------|--------------------------------|
| `lip_sync.rms`    | `LipSyncRmsData`        | `IPetRenderer.SetLipSync(level)` |
| `emotion.tag`     | `EmotionTagData` (kind=emotion) | `IPetRenderer.SetEmotion(tag, intensity)` |
| `presence.changed`| `PresenceChangedData`   | informational (future: offline slouch) |
| `status.changed`  | `StatusChangedData`     | informational (future: card-switch on core loss) |

The daemon is the single owner of state; the renderer only reacts to events.

## Auth handshake (verified against `crates/anima-channel/src/session.rs`)

The first WS message **must** be:

```json
{ "type": "auth", "authToken": "<token>" }
```

The daemon replies `{"type":"auth","ok":true}` on success, or sends a typed
`error` frame + close 1008 on failure. The token is read from
`<data-dir>/airi-slint/server-channel/config.json` (the daemon-owned config;
`anima-channel/src/config.rs`). Pass an explicit `authToken` to
`DaemonClient` if that file is unavailable.

## Running the tests

```bash
# Decoder fixture tests + lip-sync smoother tests (no Godot binary needed):
dotnet test godot/tests/AnimaPet.Tests.csproj
```

The test project targets `net10.0` (the installed runtime). The Godot project
itself targets `net8.0` (Godot.NET.Sdk 4.7 requirement); the decoder and
smoother are pure managed code compiled directly into the test assembly.

## Building the Godot project

```bash
dotnet build godot/AnimaPet.csproj      # compile the C# assembly
godot --headless --path godot/ --import # import assets (requires .NET 8 runtime)
godot --headless --path godot/ --quit   # parse-check the scene
```

### Known environment constraint

Godot 4.7 mono on this machine requires the **.NET 8 runtime**
(`dotnet-runtime-8`). Only .NET 10 is installed, so Godot's own C# loader
(`GodotTools.dll`, `GodotPlugins.dll`) cannot start and
`godot --headless --quit` reports
`No loader found for resource: res://scripts/Main.cs`. The assembly itself
builds cleanly (`dotnet build` succeeds, `ScriptPathAttribute` present); the
failure is Godot's runtime lookup, not the code. Install `dotnet-runtime-8`
(or run on a machine with it) to run the headless smoke.

## Running the pet

Open `godot/` in a .NET-enabled Godot 4.7 editor and run `Main.tscn`. The
entry node connects to the daemon, subscribes to `PetTopics`, and logs
connection status. `LoadCard(...)` stops at the renderer factory's
`NotImplementedException` stubs until a backend is implemented.

## Why C#

The daemon WS client layer uses C#. Godot 4's C# support is fully supported on
Windows/Linux/macOS; Android/iOS are experimental since 4.2; web export is not
supported for C# projects. Desktop is therefore the first target. The renderer
backends themselves are plugins (GDExtension/addons) and can be GDScript or C#;
the WS/state glue is kept in C#.

## Prerequisites

1. A **.NET-enabled Godot 4.7 editor** build (the standard editor does not
   include C# support).
2. **.NET SDK 8.x** (for the Godot project) and **.NET SDK 10.x** (for the
   test project). Godot 4.7 requires .NET 8 or newer.
3. For desktop export: the matching Godot export templates.
4. Only when implementing the backends (NOT needed for this spike):
   GDCubism's GDExtension plus a separately obtained Live2D Cubism SDK for
   Native (proprietary Core), and a Godot-4.7-compatible `godot-vrm` +
   `Godot-MToon-Shader` addon pair.

No npm/pnpm/cargo install is involved; do not add this directory to the JS
workspace.

Generated `obj/`, `bin/`, `.godot/` and Godot-generated `.uid` files are build
artifacts — keep them out of commits (`.godot/` is gitignored; `.uid` files
are committed source).

## Explicit non-goals for this scaffold

- No GDCubism, VRM or MMD code is vendored. The upstream Godot sidecar import
  remains a separate OPEN question; see research §3.
- No card schema changes. `extensions.airi` / `AiriCard` remain AIRI carve-outs
  owned by the daemon.
- No Flutter, Rust, TypeScript or manifest changes are part of this wave.
