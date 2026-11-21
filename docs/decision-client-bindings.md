<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Decision D5: How Dart (Flutter) and C# (Godot) obtain the daemon wire types

- **Status:** accepted (user, 2026-11-21). Bead `airi-wxp.10` is **CLOSED (ratified)**; this document is the accepted ADR, not a recommendation.
- **Date:** 2026-11-21
- **Blocks:** `airi-wxp.2` (E2 protocol work), `airi-wxp.3` (E3 Flutter), and the Godot wave (E4).
- **Cross-links:** [Flutter/Godot pivot](./design-flutter-godot-pivot.md) (decision 1 = reuse Rust gateway, decision 9 = JSON only, Wave 0 "Bindings" bullet, §8 "Specta drift" risk, §5 open D5) · [Daemon-hosted gateway](./design-daemon-gateway.md) (WS :6121 topology, "Protocol stays 1", gRPC/UDS parked, control-plane DTOs via the same specta pipeline).
- **Citation shorthand:** bare `wire.rs` / `dispatch.rs` = `crates/anima-channel/src/`; `export-wire-types.rs` = `crates/anima-channel/examples/`; `anima-channel.ts` = `packages/server-shared/src/types/generated/`.

## Context

- Rust is the canonical schema owner: `wire.rs` types are serialized directly by the session (`crates/anima-channel/src/session.rs:173,363`), exported to TypeScript by `crates/anima-channel/examples/export-wire-types.rs:18-39`, and checked in at `packages/server-shared/src/types/generated/anima-channel.ts:1-6`.
- The drift check is one command, owned by the Rust workspace: `package.json:20` (`pnpm check:wire-types`) wraps `cargo run -p anima-channel --example export-wire-types --locked -- --check` (`export-wire-types.rs:32-55`), and CI runs that exact command in the `wire-types` job (`.github/workflows/ci.yml:29-48`). Nothing else guards a generated artifact today.
- **Only TypeScript is emitted.** `crates/anima-channel/Cargo.toml:10-26` pulls `specta`, `specta-typescript`, `specta-serde` (dev) and nothing else; the whole lockfile contains only `specta`, `specta-macros`, `specta-serde`, `specta-typescript` (`Cargo.lock:7218-7256`). `Cargo.toml:50-57` pins `specta = "=2.0.0-rc.28"` + `specta-typescript 0.0.15` + `specta-serde 0.0.15` in lockstep. There is no Dart exporter and no checked-in Dart/C# generator.
- **Both thin clients already exist as scaffolds, but neither has bindings or tests.** `apps/flutter/pubspec.yaml:1-20` (only `web_socket_channel`, `flutter_test`) and `godot/AnimaPet.csproj:1-11` (Godot.NET.Sdk 4.7, net10.0) are transport/render skeletons. The Dart side already hand-writes a total frame parser (`apps/flutter/lib/daemon_client/protocol.dart:34-132`) and hand-writes the auth/RPC shapes from `wire.rs` (`apps/flutter/lib/daemon_client/rpc.dart:1-7`); event payloads are deliberately left as `Map<String,dynamic>` pending "generated Dart bindings" (`protocol.dart:45-69`). The C# side is all `NotImplementedException` stubs that say "Do NOT guess the auth frame, subscribe verb, or event envelope here; replace these stubs with generated bindings once they land, and add the matching drift check" (`godot/scripts/Net/DaemonClient.cs:32-36,61-90`), with the same assumption in `godot/scripts/Main.cs:18` and `godot/scripts/Renderers/CardRenderConfig.cs:18`. There are no `*_test.dart` files, no C# test project, and no Dart/C# CI job (`.github/workflows/ci.yml:15-165`).
- **The written plan assumed generation (pre-ratification).** At review time, pivot Wave 3/4 scope said "generated Dart bindings" and "generated GDScript/C# bindings" (`design-flutter-godot-pivot.md:313,322`), and Wave 0 asked for "a generator plan ... with checked-in generated files and a drift check" (`:275-278`). D5 had to **confirm or explicitly redirect** those in-tree TODOs; the pivot wording was redirected on 2026-11-21, while the in-tree source TODOs remain for their owning implementation waves.
- Upstream Specta's language table (crates.io / docs.rs snapshot read 2026-11-21, **external, not in-tree**) lists TypeScript + Swift as stable; Rust, OpenAPI, Go, Kotlin, JSON Schema, Zod, Valibot, Python, **C# (`specta-csharp`, experimental)** and Java as experimental; **no Dart exporter**. Exporter versions do not track the core version, so adopting `specta-csharp` would add a pre-1.0 dependency whose compatibility with the pinned rc.28 is unverified.
- The vocabulary is small and stable. Client frames: auth, `module:authenticate`, ping, heartbeat, `rpc` (`wire.rs:478-520`). Server frames: auth, `module:authenticated`, pong, heartbeat, `rpc`, `error` plus the new Wave-0 `event` (`wire.rs:526-590`, event variant at `:579-589`). Built-in RPC methods: exactly four (`dispatch.rs:255-260`); the daemon adds `core.status` (`design-daemon-gateway.md:175`). Wave 0 adds five topics (`EventTopic`, `wire.rs:222-239`), five payload structs plus an untagged `EventPayload` (`wire.rs:295-401`), `GatewayEvent`/`EventSubscriptionReply` (`wire.rs:440-474`) and `event.subscribe`/`event.unsubscribe`. Everything is additive; protocol stays 1 (`dispatch.rs:73`, `design-daemon-gateway.md:91`).
- The wire is **JSON text** with type-tagged frames (`wire.rs:479,525`; `session.rs:173,363`) and a few deliberately untyped slots (`payload`/`id` as `serde_json::Value`, mapped with `specta_typescript::Unknown` at `wire.rs:513,517,560,567,587`). The `specta(...)` overrides are themselves exporter-specific (`wire.rs:103,139,448`), so a second exporter would need its own override syntax, not just a new dependency.
- Named-string carve-outs survive the AIRI→Anima rename and must stay literal in any binding: protocol `airi-channel/1` (`dispatch.rs:73`), D-Bus `org.moeru.airi.Daemon1` (`crates/anima-daemon/src/control.rs:39-41`), and persisted `airi:*` keys (`docs/data-catalog.md:1054-1064,1193-1204`). Only crate names, paths and generated artifacts use `anima-*` (`export-wire-types.rs:18-22`). Note the module doc at `wire.rs:9-12` is stale on this point (still says `airi-channel`/`airi-channel.ts`) — a rename cleanup, not a D5 decision.

## Decision (ratified 2026-11-21)

**Adopt Option 3, hardened with Rust-generated conformance fixtures.** Keep the Rust `#[derive(Type)]` structs in `crates/anima-channel/src/wire.rs` as the single source of truth and keep the generated TS file plus `check:wire-types` exactly as-is. Do **not** add a Dart or C# exporter dependency, and do **not** introduce a second schema-of-record.

1. Flutter (Dart) and Godot (C#) write thin, hand-maintained codecs that mirror the checked-in TS file: type-tagged frame dispatch, the four RPC verbs, the `event` frame, the five `EventTopic` payloads, and the subscribe RPC. `payload`/`id` stay raw JSON (`Object?`/`dynamic`/`JsonElement`), matching `Unknown` today.
2. Add a Rust-side **golden fixture artifact** generated from the same type collection (`wire.rs:604-630`) — one canonical JSON example per client frame, RPC reply and event topic — checked in and guarded by a `--check` flag in the same style as `export-wire-types.rs:32-55`. Prefer deriving fixtures from the existing wire-shape tests (`wire.rs:641-702,875-908`) over duplicating literals.
3. Dart and C# each decode/encode the same fixtures in a conformance test in their own CI job. A wire change is legal only when the Rust drift check **and all three conformance jobs** are green in the same PR.

This is additive to Wave 0: the event frame and topics land in `anima-channel` first; no client binding choice changes the protocol, auth, TLS, D-Bus plane or JSON framing.

**Staging.** The typed Dart/C# models the scaffolds wait for are delivered as part of this option (from the TS reference + fixtures), not by a generator. Concretely, "generated bindings land" in the scaffold TODOs (`protocol.dart:47-50`, `DaemonClient.cs:32-36`) resolves to "typed client models + conformance fixtures land". The pivot's Wave 0/3/4 wording was corrected to this fixtures approach on 2026-11-21; the in-tree scaffold TODOs remain for their owning implementation waves (out of scope for this ADR). Generation can be revisited later behind the same fixtures if a viable exporter/toolchain appears — see Option 4.

## Rationale

- **No Dart generator exists.** Option 1 is not a "turn on a generator" decision for Flutter; it means authoring and permanently maintaining a new Specta exporter (untagged enums, internally tagged enums, exporter-specific `specta(...)` overrides, arbitrary `Unknown` values). A third-party OSS exporter would itself be a pre-1.0 dependency. The cost is unbounded; the vocabulary is ~12 frame variants.
- **C# has only an experimental exporter** (external check above). Taking it would couple Godot bindings to an rc-pinned core and to exporter output churn, while still leaving Dart hand-written — i.e. paying tooling cost for one of three languages.
- **A neutral schema would create a second source of truth or change the wire.** protobuf/flatbuffers would replace JSON text frames (forbidden: protocol v1 is additive/JSON only, pivot decision 9, `design-daemon-gateway.md:138-145`). JSON Schema `specta-jsonschema` does not change the wire but is experimental, still exported from the same Rust types (so it adds a second artifact and drift check), and Dart/C# would need runtime validation + model codegen tooling on top. gRPC is already rejected at `design-daemon-gateway.md:138-145`.
- **Thin clients + a tiny stable vocabulary make hand-written codecs cheap.** Clients hold view state only and never own core state (pivot invariants 1-3, `design-flutter-godot-pivot.md:128-135`). Most payload fields are strings, `bool`, `f32`, `u64` and optional values; the only non-obvious case is untagged `EventPayload` (`wire.rs:388-401`), which clients already dispatch by `topic` — no schema tool is needed to express that.
- **The in-tree scaffolds already prove the hand-written path is viable.** Both parse/dispatch JSON frames with a few dozen lines (`protocol.dart:90-132`; the C# stub deliberately defers only because bindings were assumed). The missing piece is five typed event payloads and a subscribe RPC — a bounded, reviewable change, not a generator project.
- **Conformance fixtures replace generated-code safety with verified behavior.** They are derived from the Rust types, so they cannot silently drift from the daemon; each language proves it decodes real daemon JSON, including the new event frames, rather than a hand-maintained document.
- **Reversibility.** If `specta-csharp` stabilizes or the model surface grows, C# can move to generation later behind the same conformance suite. Nothing in this recommendation forecloses that; it just does not pay for it up front.

## Alternatives Considered

### Option 1 — Extend specta + generated bindings to Dart and C#

- **Pros:** one generator, typed models in all three languages; C# exporter already exists upstream (experimental); no hand-maintained model code; matches the current written direction (`design-flutter-godot-pivot.md:313,322`) and the in-tree scaffold TODOs, so no documentation/TODO redirect is needed.
- **Cons:** **no Dart exporter exists** — a custom exporter is net-new work and permanent maintenance; `specta-csharp` is experimental and version-uncoupled from the pinned `specta =2.0.0-rc.28` (`Cargo.toml:50-57`); `specta(...)` overrides are TS-exporter-specific (`wire.rs:103,448,587`) so a second exporter is more than a dependency bump; untagged `EventPayload` and `Unknown` fields may not round-trip cleanly through generated models; three generator toolchains to version in CI.
- **Verdict:** reject for Dart, not justified for C# at today's vocabulary size.

### Option 2 — Language-neutral schema (JSON Schema / protobuf / flatbuffers) + thin hand-written clients

- **Pros:** one language-neutral artifact; schema tooling is mature for JSON Schema; decouples client model docs from TS syntax.
- **Cons:** binary formats violate the additive-JSON-only protocol constraint (`design-daemon-gateway.md:91,138-145`; pivot decision 9 at `design-flutter-godot-pivot.md:72`); JSON Schema would be a *second* generated artifact from the same Rust types (`specta-jsonschema` is experimental externally) with its own drift check and no compile-time tie to `serde`; Dart/C# still need codegen or runtime validation to use it, so it does not remove hand-written client work — it relocates it.
- **Verdict:** reject; pays a new toolchain and second source of truth without changing the wire or eliminating client code.

### Option 3 — Hand-written clients from the generated TS file as reference + conformance suite

- **Pros:** zero new dependencies or generators; works for both target languages immediately; Rust remains the only source of truth; goldens are generated from the same types as the TS file; bounded cost proportional to a small stable vocabulary; no wire-format change; reversible.
- **Cons:** model code must be updated manually when a new frame/topic lands; conformance is a CI guard, not compile-time type safety; untagged-union discrimination must be implemented by hand (mitigated: dispatch on `topic`, which clients must do anyway); **requires redirecting the written plan** — pivot Wave 3/4 wording (`design-flutter-godot-pivot.md:313,322`) and five scaffold TODOs (`protocol.dart:47-50`, `rpc.dart:3-7`, `DaemonClient.cs:32-36`, `Main.cs:18`, `CardRenderConfig.cs:18`) promised generated bindings at review time (pivot wording since redirected; source TODOs remain for their owning waves).
- **Verdict:** **recommended**.

### Option 4 (hybrid) — generated C# via `specta-csharp`, hand-written Dart

- **Pros:** typed C# models without authoring an exporter; matches Godot's stronger static-typing story.
- **Cons:** retains all experimental-dependency and version-pin risks for one of three clients; two maintenance paths instead of one; still needs the same conformance fixtures to prove wire correctness, so it saves little while costing a new CI toolchain.
- **Verdict:** not now; revisit only if Godot's model surface grows materially.

## Consequences

- **Positive:** `check:wire-types` stays the single canonical guard; no new crate is added to the workspace lockset; Wave-0 event frames are consumed identically by all three clients; protocol string `airi-channel/1`, D-Bus `org.moeru.airi.Daemon1` and `airi:*` keys remain untouched.
- **Negative:** three small codec implementations exist (TS generated, Dart hand-written, C# hand-written); a new topic requires three coordinated PRs; a missed Dart/C# update is caught in CI, not at compile time against Rust. The pivot's Wave 0/3/4 wording was corrected to the fixtures approach on 2026-11-21; the five in-tree "generated bindings" TODOs cited in Option 3's cons remain for their owning implementation waves — this ADR does not edit source.
- **Neutral:** the fixture generator is a second Rust example alongside `export-wire-types.rs`; it shares `type_collection()` and the `--check` pattern, so it adds code, not a new concept.

## Verification / CI plan

| Artifact | Today | Proposed guard | Owner |
|---|---|---|---|
| TS bindings | generated file + `package.json:20`, CI `wire-types` job `.github/workflows/ci.yml:29-48` | unchanged | `anima-channel` maintainers; whoever edits `wire.rs` |
| Golden JSON fixtures | none | new `export-wire-fixtures` example, same `--check` flag; run in the existing `wire-types` job (a sibling step) | same Rust owner; regenerate in the same PR as `wire.rs` |
| Dart codec | hand-written scaffold, no typed payloads/tests (`protocol.dart:34-132`, `rpc.dart:1-7`); `flutter_test` already declared (`apps/flutter/pubspec.yaml:16-18`) | add typed payloads + `flutter test` consuming the fixtures; new CI job | Flutter / control-surface owner, Wave 3 (`airi-wxp.3`) |
| C# codec | `NotImplementedException` stubs, no test project (`DaemonClient.cs:32-90`, `godot/AnimaPet.csproj:1-11`) | add typed models + a test project running the fixtures; new CI job | Godot / pet-renderer owner, Wave 4 |

- A wire change is merged only with `cargo test --workspace --locked`, `pnpm check:wire-types`, the fixture `--check`, and all three conformance jobs green.
- Fixtures must be generated, never hand-edited; `--check` fails loudly like `export-wire-types.rs:49-52`.
- Fixture content is transport-agnostic JSON, so mobile (remote thin client, pivot decision B) reuses the same conformance suite; only the TLS/peer-trust story changes there.
- **CI ownership rule:** the Rust side owns *producing* fixtures; each client owner owns *consuming* them. The Rust owner cannot land a wire change that breaks a client without that client's job going red — that is the cross-language drift guard.

## Open Questions

1. Who are the named owners for the new Dart and C# conformance jobs and for correcting the five "generated bindings" TODOs? (The pivot Wave 0/3/4 wording was already corrected on 2026-11-21.) The projects exist but no test suite or CI job does (`.github/workflows/ci.yml:15-165` verified).
2. Should fixtures be a new example, or a second output of `export-wire-types`? Recommendation: new example reusing `type_collection()` (`wire.rs:604-630`) and the `--check` pattern.
3. Should fixtures be derived from the existing wire-shape assertions (`wire.rs:641-702,875-908`) or written as separate expected JSON? Recommendation: derive, to avoid two sets of literals.
4. Can Dart/C# JSON libraries decode untagged `EventPayload` (`wire.rs:388-401`) from shape alone, or must all clients dispatch by `topic` first? Needs a spike in Wave 3/4; the recommendation assumes topic-driven dispatch.
5. Is there a `specta-csharp` release compatible with `specta =2.0.0-rc.28`? Not verifiable from this tree (external, experimental); only relevant if Option 4 is later reopened.
6. Rename cleanup: `wire.rs:9-12` still names `airi-channel`/`airi-channel.ts` while the exporter and generated file use `anima-channel` (`export-wire-types.rs:18-22`, `anima-channel.ts:2`). Flag as a follow-up, not part of D5.
7. Wave 0's event frame/payload types are present in the working tree at review time but not yet committed at `bad8fc69`; this recommendation assumes they land. If the event vocabulary changes, fixtures and all three codecs change with it by the CI rule above.
