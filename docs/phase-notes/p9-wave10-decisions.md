<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ⑩ — v1 waivers, cutover decisions, dev-release groundwork

User direction 2026-11-12 ("next move 1…5"). No push; dev release for now;
no production release until feature parity is user-confirmed.

## Manifest waivers (user decision — "apply all recommended")

`features.waivers.json` gained **62 entries** (43 card-AI suite + 8 knowledge-graph
+ 11 artistry family), each with a dated reason. Regenerated `features.md`:

| | before | after |
| --- | --- | --- |
| unchecked | 189 | **127** |
| waived | 25 | **87** |
| checked | 20 | 20 |

Remaining unchecked: 26 stage-tamagotchi (c-class Electron-only roots), 101
stage-pages (provider/module/settings rows with working Electron counterparts,
no Qt backend — par-locked). **The Qt v1 scope is fully declared**; everything
not done is either Electron/web par-locked or consciously deferred to v1.1+.
Qt scaffold pages for the deferred families are untouched (honestly disabled).

## Cutover decisions (recorded in `p12-cutover-plan.md` §7)

1. Card-AI — waived for v1, v1.1.
2. Knowledge-graph — waived for v1, v1.1+.
3. Artistry family — deferred v1.1+; pages stay disabled; not a v1 blocker.
4. MMD — M1 ships as **synthetic-verified experimental** (no real `.pmx`
   available; desk check pending a license-clean model).
5. **No push until feature parity is user-confirmed** (manifest fully resolved
   + explicit par-lock sign-off). Branch stays local.
6. **Dev release for now** — no tag, no public release, no update-feed
   re-point; dev-grade packaging only.
7. Optional later lanes approved with standing exclusions (Discord command
   dispatch stays out; registry wiring gated on live shape verification;
   S3/Hyperdrive needs a provider decision; GUI-thread gateway dispatch
   deferred — no rich `renderer.*` handler exists yet).

## Dev packaging (`packaging/`, not distributed)

`build-deb.sh` produces `dist/airi-qt-dev_0.1.0~dev1_amd64.deb`: debug build by
default (`--release` available), desktop entry (`AIRI (Qt dev)`), 512×512 icon,
GPL-3.0-or-later copyright + changelog, `Depends:` approximate (Qt6 Quick3D is
the one most likely missing on user machines — documented), `Recommends:
ffmpeg`. **No `dpkg-deb` on this Arch machine** — the script assembled the AR
archive by hand (`ar`+`tar`+xz); layout verified by extraction
(control/data/debian-binary all correct, desktop-file-validate clean).
Placeholder status: untested on Debian/Ubuntu, not for distribution, nothing
pushed. `dist/` gitignored. Release pipeline, `PRODUCT_NAME` scrub, and
update-feed re-point remain future, gated on items 5–6.

## Verification (this wave)

- Offscreen `--smoke` — exit 0 (splash, control-strip, chat, settings, about, stage).
- i18n parity 4/4; audit clean. No Rust/QML/locale changes this wave.
- `p11-audit.md` carries a dated waiver note; `p12-cutover-plan.md` carries the
  full decisions log (§7) and refreshed §1 numbers (127/87/20).

## In flight

- Lane C1 — MCP-HTTP bearer-token auth for remote streamable-HTTP MCP servers
  (opt-in; static `Authorization: Bearer`; never logged; no UI change).
  Report lands with its own note; gate + commit at integration.
## 11. Settings-surface cuts (user decision 2026-11-12, follow-up to "app ready?")

User checked the settings UI (looks decent) and directed two cuts to avoid
duplicate/vendor-centric surfaces:

1. **Onboarding v2 (`OnboardingPage.qml`) — cut.** The settings shell now
   offers the Onboarding V3 wizard only (nav ✨ "Onboarding V3", index 15).
   v2 was a disabled static port of `onboarding.vue`; v3 is the kept surface.
2. **Gemini notice (`GeminiNoticePage.qml`) — cut.** The vendor-centric
   "Gemini Quantum Leap" notice surface is removed; rationale recorded by the
   user: every model/provider presents equal opportunities — no showcase
   screens for a single vendor. `google-gemini` remains a peer provider in
   the catalog (right alongside Anthropic/OpenAI-compatible/etc.).

What changed: 2 QML files deleted; `SettingsWindow.qml` nav/stack renumbered
(27 → 25 pages, indexes 0–24, both AListItems and StackLayout renumbered in
lockstep); `build.rs` registers only `OnboardingV3Page` and drops the
Gemini notice; the notice hub lists the fade-on-hover surface only (gemini
row + separator removed; `footnote` updated); i18n keys removed ×10 locales
(`onboarding.back`, `onboarding.v2.*`, `settings.nav.onboarding`,
`settings.nav.gemini`, `notice.gemini.*`, `notice.index.gemini{Title,
Subtitle}`, `notice.index.routeGemini`); `p11-audit.md` rows annotated.
No Rust logic changed.

Verification: fmt/clippy clean; 614 tests green; offscreen smoke exit 0
(settings window loads, tour unchanged); i18n parity 4/4; yaml audit ×10.
