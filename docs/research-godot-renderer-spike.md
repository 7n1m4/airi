<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Research: Godot 4 renderer spike (E4-T1 / E4-T2)

**Status:** research spike · **Date:** 2026-11-21 · **Scope:** `godot/**` scaffold plus backend/plugin research for Wave 4 of the authoritative [Flutter control surface + on-demand Godot pet design](./design-flutter-godot-pivot.md).
**Method:** in-tree documents and source were read at `bad8fc69`. Per the pivot's cross-links and the header of [`UPSTREAM_RADAR.md`](./UPSTREAM_RADAR.md), **no upstream AIRI fetch, merge, rebase or push was performed**; the upstream sidecar section below is reconstructed only from local docs. External facts (vendor/plugin docs) came from public web documentation retrieved 2026-11-21 and are cited by URL in §7.

## 0. Conclusions

1. Both backends are viable on desktop, but they are **not symmetric**. Live2D via GDCubism is the more turnkey renderer but carries a three-layer proprietary licensing stack and a user-supplied Cubism Core binary. 3D via `godot-vrm` is permissively licensed and asset-simple (`.vrm` is glTF-based), but VRM/MToon runtime support in Godot is community-maintained and version-sensitive; MMD is an asset-conversion pipeline, not a first-class Godot runtime path.
2. **Per-card plugin selection is the right boundary.** The daemon emits high-level events; the Godot side owns the event→animation mapping (pivot doc invariant 4, `docs/design-flutter-godot-pivot.md:137-140`). A small `IPetRenderer` interface plus a factory lets a card choose `live2d.gdcubism` or `vrm` without leaking backend types into the WS client.
3. **Do not import the upstream Godot sidecar as a unit.** Its stated fork stance is "paused"/`ignore` (shortlist, `docs/project-selective-upstream-sync-shortlist.md:20,57-69,209-245`) and the newer Kirie migration is explicitly `Auto-Reject / Do Not Port` (`docs/UPSTREAM_RADAR.md:1843`). Reuse it as *reading material* only. A neutral recommendation with reasoning is in §3; this does not resolve the still-OPEN sub-question in the pivot doc (`docs/design-flutter-godot-pivot.md:67,327-330`).
4. The `crates/anima-render/src/vrm/lipsync.rs:3-7,24-38` smoothing (fast attack, ~120 ms exponential decay, `[0,1]` clamp) is the reference math to reproduce on the Godot side. It is a small, pure algorithm and should be ported to C# when a real morph-target backend lands — not moved into the daemon.
5. **C# export is a desktop-first bet.** Windows/Linux/macOS are fully supported; Android/iOS are experimental (Godot 4.2+); web is unsupported for C# in Godot 4. This matches the pivot's "desktop first, mobile TBD" posture (decision B and the still-open mobile composition question, `docs/design-flutter-godot-pivot.md:73,207-209`).
6. The E4-T2 scaffold is **source-only and protocol-agnostic**. No event frame shape is guessed: every protocol-dependent method is a documented `TODO(Wave 0)` stub pending the event-lane types owned by another agent.

## 1. Live2D in Godot 4 — GDCubism

### What it is and maturity

- **GDCubism** (`MizunagiKB/gd_cubism`) is an **unofficial** GDExtension that exposes the Live2D Cubism SDK to GDScript **and C#**. It targets Godot **4.3+** (older 4.1/4.2 releases exist as `v0.8.2-godot4.1`). Since 0.9 it uses **direct rendering**, reducing Godot-side load and GPU memory; `GDCubismUserModel` is no longer a `SubViewport` (wrap it in one if you need that behavior). Internally it links Live2D's **Cubism Native Framework**. [
  sources §7: gd_cubism README / docs-site
  ]
- Live2D itself acknowledged the project as a **Community SDK** on its creator forum in 2023-09-19, which is meaningful signal for an unofficial integration, but the project still asks users **not to contact Live2D about GDCubism** and historically distributes **source, not bundled binaries**. [
  sources §7: Live2D forum threads
  ]
- Practical maturity read: actively maintained and usable for a desktop pet, but the toolchain is heavier than a Godot-only addon — building the extension requires `godot-cpp`, scons and a separately downloaded Cubism SDK for Native. Prebuilt binaries are a licensing-sensitive topic (see below). No GDCubism code exists anywhere in this tree today (pivot doc §6, `docs/design-flutter-godot-pivot.md:237`).

### Licensing (the binding constraint)

GDCubism is **MIT-licensed for the wrapper code only** (Copyright 2023 MizunagiKB). It cannot work alone, so distribution is governed by at least three layers:

| Layer | License | Consequence for Anima |
|---|---|---|
| GDCubism GDExtension source | MIT | Fine to vendor/reference with notice. |
| Cubism Components + Cubism Native Framework | **Live2D Open Software License** | Must be observed when building/using; incompatible-license clause matters for the combined work. |
| Cubism Core (the runtime binary loaded at startup) | **Live2D Proprietary Software License** | Must **not** be committed to this repo. Users obtain it from Live2D's official download after accepting the terms. |
| Publishing a commercial content | **SDK Release License** (business entities; individuals/small-scale enterprises exempt except Expandable Application) | Agreement must be completed **at least one month prior to release**. Legal review required before shipping a GDCubism-backed build. |

Live2D's own forum guidance is that a GDCubism build may be distributed **provided users are clearly directed to read and agree to the Live2D license terms** and fetch Cubism Core themselves. [
  sources §7: GDCubism license page; Live2D SDK Release License; forum topic 3414
  ]

### Platform support (as published by the plugin)

| Platform | Architectures |
|---|---|
| Windows | x86_32, x86_64 |
| macOS | x86_64, arm64, universal |
| Linux | x86_64 |
| iOS | arm64 / universal — **experimental** |
| Android | armv7 / arm64v8 — **experimental** |

Live2D's own platform table notes **64-bit only** support on Linux and iOS for Cubism SDK for Native. Desktop is therefore the safe target; mobile is experimental on both sides. [
  sources §7: gd_cubism README "Support platform"; Live2D platform support status
  ]

### Asset format and event mapping

- Models are **Cubism model files** (`.model3.json` plus `.moc3`, textures, physics/pose files) authored in Live2D Cubism Editor. Generation-specific loaders matter: upstream discussion #2197 about Cubism 2 support is visible in the local radar (`docs/UPSTREAM_RADAR.md:34,267`) but is **upstream context only**, not a decision here.
- Lip-sync should map `lip_sync.rms` into a Cubism lip-sync/parameter group; `emotion.tag` into expression motions/parameters. This is the direct analogue of the morph-weight port discussed in §2 — same events, different target parameters. The TypeScript glue is a *reference for mapping knowledge*, not something to port (pivot doc decision A, `docs/design-flutter-godot-pivot.md:67`).

## 2. 3D in Godot 4 — VRM / MMD, compared with `anima-render`

### Plugins and tooling

- **`V-Sekai/godot-vrm`**: MIT-licensed importer/exporter for **VRM 0.0 and 1.0**, with a standalone **MToon** shader, spring bones and node constraints; targets Godot 4.0+. Install paths are fixed — `addons/vrm` and `addons/Godot-MToon-Shader` **must not be renamed** because generated scripts/materials hard-code them. `VRMC_vrm_animation` (VRMA) is listed as *future work*, so humanoid animation-library import is not complete. [
  sources §7: V-Sekai/godot-vrm README
  ]
- **Active fork `AzPepoze/godot-vrm`** (created 2026-05-29) continues the project for **Godot 4.3+**, with C++ GDExtension physics for spring bones/node constraints, wind and collision; published in the Godot Asset Library as "VRM Importer & MToon Shader" 2.6.1 (2026-09-30, MIT). Its own feature table marks VRM 1.0 export of humanoid bones/expressions as WIP. [
  sources §7: AzPepoze/godot-vrm; Asset Library entry 5222
  ]
- **Version warning:** Godot 4.7 changed APIs and broke older Asset Store copies of VRM/MToon (V-Sekai issue #149, opened 2026-07-04); maintainers state the fix exists on GitHub but the store version was stale. Any adoption must pin a Godot-4.7-compatible source/revision and validate import in CI rather than trusting the Asset Library listing.
- **MMD:** Godot has no built-in MMD/VMD importer. Community practice is conversion (VMD → VRMA → VRM/GLB → Godot `Animation` resources) or a custom `EditorImportPlugin`; Japanese MMD bone names versus VRM humanoid names are a recurring source of friction. Treat MMD as an **offline asset-conversion concern**, not a runtime backend — it does not need its own `IPetRenderer` implementation. [
  sources §7: Godot/MMD community write-up
  ]

### Reference math already in-tree

`crates/anima-render/src/vrm/lipsync.rs:3-7` documents the contract: *speech `rms` → `aa` vowel morph weight*, mirroring the Unity sidecar with **fast attack, exponential decay (~120 ms), clamped `[0,1]`**. The implementation at `lipsync.rs:24-38` is:

- `set_rms(rms)` clamps the incoming sample to `[0,1]`;
- `tick(dt)` snaps the weight straight up when `rms > weight`, otherwise decays linearly by `dt / 0.120` with a floor at `rms`;
- finally clamps the result to `[0,1]`.

The pivot explicitly assigns this mapping to the Godot side, not the daemon (`docs/design-flutter-godot-pivot.md:137-140`), and Wave 4 asks to "reproduce `lipsync.rs` smoothing if using a morph-target avatar" (`docs/design-flutter-godot-pivot.md:320-334`). For VRM the resulting weight drives a VRM blend shape (e.g. `aa`/`A`) through `godot-vrm`'s blend-shape bindings; for Live2D the same weight drives a Cubism parameter. The ~15-40 Hz RMS tap caveat in the design doc (`docs/design-flutter-godot-pivot.md:231-233`) still applies — do not assume a 30-60 Hz event rate.

## 3. The upstream Godot sidecar (local docs only; no fetch)

### What it is

The shortlist describes it as **not a model format** but an alternate **Godot 4 sidecar window** (Electron host + local WebSocket) that upstream merged into `main` while still experimental (`docs/project-selective-upstream-sync-shortlist.md:57-69`). Three PRs make up the P5 tier (`docs/project-selective-upstream-sync-shortlist.md:209-245`):

| PR | Content (as recorded locally) |
|---|---|
| #1697 | G0 bootstrap: Godot 4 + C# project, empty scene (box + camera), **no avatar loading**. |
| #1724 | G0 sidecar preview: settings toggle, launch/stop lifecycle, WebSocket handshake, export/packaging contract. **Skeleton only.** |
| #1830 | Experimental sidecar display path, **VRM-only**, with massive vendored VRM/MToon addons; VRM 1.0 runtime incomplete; **not** Live2D / Spine / MMD. |

A later, much larger change — PR **#2739 / commit `671fbf0d33`** (2026-10-02) — merged the experimental `apps/stage-tamagotchi-kirie` tree: **+31k LOC across 299 files**, a Godot 4.7.2 + .NET 10 + CEF host for the Vue renderer with its own migration roadmap (`docs/UPSTREAM_RADAR.md:1818,1862`). The radar also tracks follow-up #1865 (`stage-tamagotchi-godot` main-scene path, `docs/UPSTREAM_RADAR.md:1709`) and a Godot-C# skill doc (`docs/UPSTREAM_RADAR.md:1866`).

### Current repo stance

- Shortlist tier **P5 — "Godot stage — paused (spike upstream `main` first)"**; suggested pass order says *skip P5 (try upstream Godot on `main` before any port)* (`docs/project-selective-upstream-sync-shortlist.md:20,31`). Sync classes are `ignore` / `ignore until spike says yes → then import` (`docs/project-selective-upstream-sync-shortlist.md:69,221,233,245`).
- Radar marks PR #2739 as **`Auto-Reject / Do Not Port`** because it reintroduces deprecated `controls-island` and conflicts with this fork's decoupled Electron + Control Strip design (`docs/UPSTREAM_RADAR.md:1842-1843`). It separately warns never to pull or mix components from the Kirie tree into our surfaces (`docs/UPSTREAM_RADAR.md:1847`).
- The pivot design deliberately keeps import as a **separate OPEN sub-question** and does not resolve it (`docs/design-flutter-godot-pivot.md:67,327-330,409-413`).

### Neutral recommendation (not a decision)

**Do not import the sidecar as a unit; build fresh, but read it.** Reasons, for and against:

- *Against import:* its host is Electron + a local WS handshake, whereas Anima's single writer is `anima-daemon` and every GUI is a thin WS client (pivot decisions 1-3, `docs/design-flutter-godot-pivot.md:64-66`). It is VRM-only while decision A selected **both** backends. It carries large vendored addon trees and an incomplete VRM 1.0 runtime. #2739 is a desktop-host migration, not an avatar renderer, and is already auto-rejected.
- *For selective reading:* #1697/#1724 are useful examples of Godot 4 + C# project layout, sidecar lifecycle and export/packaging contract; #1865 records a main-scene path lesson. These are cheap to re-derive from Godot docs, which is what this scaffold does.
- *Recommendation:* keep the sub-question open. Revisit import only **after** Wave 0 event-lane bindings exist, with a time-boxed local trial of upstream `main` and a measured value judgement — and only with explicit authorization, since the pivot forbids fetch/merge/rebase/push here (`docs/design-flutter-godot-pivot.md:426-431`).

## 4. Decision matrix and plugin boundary

| Backend | Licensing / toolchain | Asset pipeline | Mobile support | Maturity / risk |
|---|---|---|---|---|
| **Live2D — GDCubism** | Wrapper MIT; Cubism Open + **Proprietary** Core; SDK Release License on commercial release; needs scons + `godot-cpp` + user-downloaded SDK | `.model3.json` + `.moc3` + textures/physics; model authored in Cubism Editor | Desktop native; iOS/Android **experimental** in plugin; 64-bit only on Linux/iOS upstream | Usable on desktop, but legal review and per-user SDK acquisition are mandatory |
| **3D — `V-Sekai/godot-vrm`** | MIT; pure Godot addon paths `addons/vrm` + `addons/Godot-MToon-Shader` | `.vrm` (glTF 2.0 based) + MToon; no conversion needed for the model itself | Inherits Godot export support (desktop solid; mobile experimental for C#); VRMA import incomplete | Broad VRM 0/1 import, spring bones; version-sensitive on Godot 4.7 |
| **3D — `AzPepoze/godot-vrm`** | MIT; GDExtension (C++) for physics | Same `.vrm`; active fork, Asset Library 2.6.1 | Same as above; GDExtension must be built per target | Better maintained for 4.3+; humanoid/expression export still WIP |
| **MMD (VMD)** | Tooling varies; often community/converter scripts | Offline conversion VMD→VRMA→VRM/GLB→`Animation`; Japanese↔humanoid bone-name mapping | n/a (conversion-time concern) | Not a runtime backend; keep out of `IPetRenderer` |

**Plugin boundary implemented by the scaffold:** `godot/scripts/Renderers/IPetRenderer.cs` defines the contract (`Initialize`, `SetLipSync`, `SetEmotion`, `Process`, `Dispose`, `BackendId`). `CardRenderConfig` carries a provisional per-card `PetRenderBackend` choice plus an asset path — it is *not* a wire type; the authoritative card schema stays daemon-side (`extensions.airi` / `AiriCard`, intentionally kept as AIRI carve-outs). `PetRendererFactory.Create` selects the plugin. `Live2dRenderer` and `VrmRenderer` are explicit `NotImplementedException` stubs. `godot/scripts/Net/DaemonClient.cs` never sees a renderer type, so the transport stays independent of the backend and the pet window can outlive the Flutter window.

## 5. C# export targets — confirmation

Godot's own documentation confirms:

- **Desktop (Windows, Linux, macOS): fully supported** for C# projects in Godot 4; desktop exports ship the .NET runtime.
- **Android and iOS: supported since 4.2 but experimental.** Android uses the Mono runtime (arm64/x64 only; newer Godot requires .NET 9+ to export); iOS uses NativeAOT (arm64 only, macOS + Xcode required, x64 simulator template only).
- **Web: not supported** for C# in Godot 4 at all.
- Godot 4.7 documentation states C# targets **.NET 10+ / C# 14**; the .NET SDK is a separate install from the .NET-enabled editor build.

For Anima this means: **desktop first** for the pet renderer; mobile export remains TBD and is coupled to the still-open question of how Flutter control UI and Godot pet share one mobile screen (pivot §5 open item, `docs/design-flutter-godot-pivot.md:207-209`). The scaffold therefore pins a 4.7-era `Godot.NET.Sdk` with `net10.0` and adds only desktop-oriented window settings.

## 6. Scaffold inventory and verification

Created (all under the owned `godot/**` tree):

- `godot/project.godot` — Godot 4 project, C# feature, transparent/borderless/always-on-top window settings, `gl_compatibility` renderer chosen for alpha-friendly desktop compositing.
- `godot/Main.tscn` — minimal main scene bound to `scripts/Main.cs`.
- `godot/AnimaPet.csproj` — `Godot.NET.Sdk/4.7.0`, `net10.0`, dynamic loading, nullable enabled.
- `godot/scripts/Main.cs` — spike entry node; owns the current `IPetRenderer`, swaps cards, forwards `_Process`.
- `godot/scripts/Renderers/{IPetRenderer,CardRenderConfig,PetRendererFactory,Live2dRenderer,VrmRenderer}.cs` — plugin boundary and stubs.
- `godot/scripts/Net/DaemonClient.cs` — documented `ws://127.0.0.1:6121` skeleton; auth/subscribe/dispatch are `TODO(Wave 0)` stubs.
- `godot/README.md` — structure, prerequisites, how to run, explicit non-goals.

Verification performed: `project.godot` parses headlessly (all window/rendering keys preserved with no unknown-setting errors); the plain scene-without-script form loads; all C# sources pass a local `net10.0` compile-check against minimal Godot API stubs (0 errors; one expected `CS0067` warning for the unused `RawEventReceived` skeleton event). That compile-check caught and fixed a missing `using System;` in `IPetRenderer.cs`. **Limitation:** the installed editor is `4.7.2.stable.arch_linux.ed1daf0bf`, a **non-.NET build** — headless import reports `Resource file not found: res://Main.cs (expected type: Script)`. The .NET SDK `10.0.114` is installed, but no GodotSharp NuGet restore / real Godot build was attempted (write-safe scope). A .NET-enabled Godot editor must perform the authoritative import/build.

## 7. Sources

**Local (re-read for this spike; no upstream fetch):**

- `docs/design-flutter-godot-pivot.md` — decision A (:67), decisions 1-3 (:64-66), decision B (:73), open mobile composition (:207-209), §6 reality table (:231-237), invariant 4 (:137-140), Wave 4 (:320-334), open sidecar sub-question (:327-330, :409-413), cross-links (:426-431).
- `docs/project-selective-upstream-sync-shortlist.md` — P5 tier (:20, :31), "Godot stage — paused" (:57-69), PR detail (:209-245).
- `docs/UPSTREAM_RADAR.md` — Cubism 2 discussion (:34, :267), #1865 (:1709), #2739 summary (:1818) and auto-reject/warnings (:1842-1847), #2739 commit (:1862), Godot-C# skill doc (:1866).
- `crates/anima-render/src/vrm/lipsync.rs` — smoothing contract (:3-7) and implementation (:24-38).
- `apps/stage-tamagotchi/src/main/services/airi/daemon-gateway.ts` — D-Bus control plane constants (:13-15) and 6121 default port (:57-65). Used only to document the future endpoint; no protocol frame shape copied.

**External (public docs, retrieved 2026-11-21):**

- GDCubism: <https://github.com/MizunagiKB/gd_cubism> (README.en.adoc), <https://mizunagikb.github.io/gd_cubism/gd_cubism/0.9/en/license.html>, <https://mizunagikb.github.io/gd_cubism/gd_cubism/0.9/en/index.html>.
- Live2D: <https://www.live2d.com/en/sdk/license> (SDK Release License), <https://docs.live2d.com/en/cubism-sdk-manual/platform/>, forum threads <https://creatorsforum.live2d.com/t/topic/1942> and <https://creatorsforum.live2d.com/t/topic/3414>.
- VRM: <https://github.com/V-Sekai/godot-vrm>, <https://github.com/AzPepoze/godot-vrm>, <https://godotengine.org/asset-library/asset/5222>, <https://github.com/V-Sekai/godot-vrm/issues/149>.
- Godot C#: <https://docs.godotengine.org/en/stable/about/list_of_features.html>, <https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/>, <https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_basics.html>, <https://godotengine.org/article/platform-state-in-csharp-for-godot-4-2>, <https://godotengine.org/article/godotsharp-packages-net8>.

**Citations that did not resolve:** none. All local file/line citations above were opened and re-checked; PR #1697/#1724/#1830 content is quoted from the local shortlist and was **not** independently fetched, by design.
