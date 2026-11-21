# `godot/` — Anima pet renderer spike (E4-T2)

A **source-only Godot 4 scaffold** for the on-demand pet renderer described in
[`docs/design-flutter-godot-pivot.md`](../docs/design-flutter-godot-pivot.md).
It is a thin WS client of the Rust `anima-daemon`; it owns no core state and no
backend implementation yet. Research and the decision matrix live in
[`docs/research-godot-renderer-spike.md`](../docs/research-godot-renderer-spike.md).

## Layout

```text
godot/
  project.godot                  Godot 4 project; transparent/borderless window, C# enabled
  AnimaPet.csproj                Godot.NET.Sdk 4.7 / net10.0
  Main.tscn                      minimal main scene
  scripts/
    Main.cs                      entry node; owns one IPetRenderer, forwards _Process
    Renderers/
      IPetRenderer.cs            backend-agnostic contract (Initialize/SetLipSync/SetEmotion/Process)
      CardRenderConfig.cs        provisional per-card backend + asset path (NOT a wire type)
      PetRendererFactory.cs      selects Live2d or Vrm from the card config
      Live2dRenderer.cs          GDCubism stub (throws NotImplementedException)
      VrmRenderer.cs             godot-vrm/MToon stub (throws NotImplementedException)
    Net/
      DaemonClient.cs            ws://127.0.0.1:6121 skeleton; auth/subscribe/dispatch are TODO(Wave 0)
```

## Why C#

The daemon WS client layer uses C#. Godot 4's C# support is fully supported on
Windows/Linux/macOS; Android/iOS are experimental since 4.2; web export is not
supported for C# projects. Desktop is therefore the first target. See research
§5. The renderer backends themselves are plugins (GDExtension/addons) and can
be GDScript or C#; the WS/state glue is the part we keep in C#.

## Prerequisites

1. A **.NET-enabled Godot 4.7 editor** build (the standard editor does not
   include C# support). This project targets Godot 4.7+.
2. **.NET SDK 10.x** (`dotnet --version`) — Godot 4.7 requires .NET 10 or newer.
3. For desktop export: the matching Godot export templates.
4. Only when implementing the backends (NOT needed for this spike):
   GDCubism's GDExtension plus a separately obtained Live2D Cubism SDK for
   Native (proprietary Core; users must accept Live2D's terms themselves), and
   a Godot-4.7-compatible `godot-vrm` + `Godot-MToon-Shader` addon pair.

No npm/pnpm/cargo install is involved; do not add this directory to the JS
workspace.

## Running the spike

Open `godot/` as a project in the .NET-enabled Godot editor, let it generate
its solution/cache files, and run `Main.tscn`. The entry node logs the daemon
endpoint; calling `LoadCard(...)` currently stops at the renderer factory's
`NotImplementedException` stubs, which is the expected state for E4-T2.

Generated `obj/`, `bin/`, `.godot/` and any Godot-generated `.uid` files are
build artifacts — keep them out of commits.

## Explicit non-goals for this scaffold

- No event frame shape, auth payload, subscribe verb or event vocabulary is
  implemented or guessed (`Net/DaemonClient.cs`). Wave 0 owns those types.
- No GDCubism, VRM or MMD code is vendored. The upstream Godot sidecar import
  remains a separate OPEN question; see research §3.
- No card schema changes. `extensions.airi` / `AiriCard` remain AIRI carve-outs
  owned by the daemon.
- No Flutter, Rust, TypeScript or manifest changes are part of this wave.
