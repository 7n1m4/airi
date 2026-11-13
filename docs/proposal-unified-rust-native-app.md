# Proposal: Unified Rust Native App (replaces stage-pocket)

**Status:** note · **Recorded:** 2026-11-13 · **Decision owner:** project lead

## Decision

The Capacitor/WebView hybrid mobile app (`apps/stage-pocket`) is **purged** (2026-11-13):

- Web tech on mobile is a lost cause for AIRI — it reintroduces the two-runtimes-one-codebase tax on the surface where touch, lifecycle, and device APIs matter most, and it was never more than a packaging of the shared Vue renderer in a phone shell.
- Mobile gets replaced by a **unified Rust native app**: one native (Slint) codebase, no webview, state owned by the daemon (see the pivot in [`README.md`](./README.md)), surfaces as thin WS clients.
- The unified app is expected to grow out of [`crates/airi-slint`](../crates/airi-slint), the existing Rust shell.

Historical design context is kept in [`archive/project-mobile-revamp.md`](./archive/project-mobile-revamp.md) (superseded — useful for the interaction-plane UX research, not for implementation). The desktop Electrobun/Vue app is **not** affected by this decision.

## UI requirement: one codebase, two form factors

**The Slint UI must be reactive to screen-size changes so the same app can be built for both desktop and mobile.** Concretely:

- No fixed-pixel desktop layouts; layouts derive from the window/screen size (breakpoint categories, portrait vs landscape, phone vs tablet vs desktop).
- Touch-first metrics on small screens (target sizes, spacing), mouse/keyboard affordances on large screens — selected on size, not on a separate code path.
- Navigation that collapses gracefully (rail/strip on desktop → drawer/tabbed on phone) without a second component tree.
- `.slint` components stay shared; only the layout roots and density presets may diverge. A screen-size breakpoint system is a prerequisite for any mobile release.

Slint targets desktop and mobile natively (Slint 1.18.1, Android + iOS backends), so no port to a second UI stack is required. Licensing is compatible: open-source (GPL path) and proprietary royalty-free both cover open-source mobile builds.

## Consequences

- **Mobile gateway pairing is the unlock**: a Rust native client speaks the same WS gateway protocol (`airi-gateway`/`airi-channel`, port 6121) as every other surface. LAN/remote use makes gateway TLS (rustls + rcgen) mandatory, not optional — see the daemon-always-on topology notes.
- **On-device inference stays relevant**: [`design-ios-core-ai-native-inference.md`](./design-ios-core-ai-native-inference.md) remains the reference for iOS-side local inference and now feeds the unified app rather than a Capacitor wrapper.
- **`stage-pocket` is gone from the workspace**: root scripts, CI (swiftlint step), `packages/cap-vite` (now unused — removal candidate), `isStageCapacitor()` gating sites in the shared renderer, and public docs iOS sections are all affected; cleanup is being tracked in the purge notes.
- **Screen telemetry, push, haptics, camera**: mobile-only platform bridges will be needed for device integration; expected to land as Rust bridge modules in `airi-slint`/a dedicated crate, not as webview shims.

## Open questions

- Code signing + distribution (App Store / Play Store vs sideload) for the Rust native app — needs a packaging lane comparable to the desktop release pipeline.
- Exact breakpoint system and minimum screen-size floor in `.slint`; whether the desktop shell keeps its Shell (portrait-anchored control strip) as a `mode` preset or as a layout root variant.
- Whether `apps/stage-web` remains the browser surface long-term, or is also folded into the Rust native strategy later.
- Rust gateway client placement: extend `airi-channel` as a client module vs a new `airi-gateway-client` crate.
