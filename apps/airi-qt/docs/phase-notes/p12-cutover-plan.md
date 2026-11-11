<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P12 — Qt cutover groundwork (decision document; nothing here is executed)

Status: **groundwork only**. Every item below is either (a) already done,
(b) researched with a recommendation, or (c) a user decision. This document
does not authorize a freeze, a release, a push, or a merge. Today is
2026-11-11; the branch `wip/airi-qt-rewrite` holds 9 unpushed WIP commits.

Explicit non-goal, locked by the user 2026-11-11: **Electron/web stays on
par** — `apps/stage-tamagotchi` and `apps/stage-web` are untouched by the Qt
rewrite, remain the devtools home, and remain shipping until the user says
otherwise. "Cutover" here means *making the Qt app the primary desktop
product*, not deleting anything.

## 1. Where we actually are

- Qt build: full settings shell (27 pages), real LLM path (cloud/OpenAI-compatible
  first), chat + memory + retrieval, cards (library/editor/models-explore), vault
  backend, MCP (stdio client + wired page + streamable-HTTP client), ACP
  agents (HITL permission UX wired), channel gateway with typed RPC dispatch
  (`renderer.info` live), Discord REST (send-only UI) + gateway client crate,
  screen capture, BYOS local snapshot sync engine + wired page, MMD M0 complete.
- Gate at every wave: fmt, clippy `-D warnings`, `cargo test --workspace` (47 suites /
  586 tests), offscreen smoke exit 0, i18n parity ×10 locales.
- Manifest: **189 unchecked** of 234 — 26 stage-tamagotchi, 163 stage-pages.
  Classification lives in `p11-audit.md`: of the unchecked set, ~61 are (a)
  gaps (8 knowledge-graph + ~53 others), the remainder are (c)/(d)/blocked-on-lanes.
- Everything user-facing ships opt-in or disabled-with-tooltip where honest.
  Nothing is faked.

## 2. Decisions before "cutover" can mean anything

These are product calls, not engineering calls. Each has a recommendation;
none is executed.

1. **The card-AI suite** (`/settings/airi-card/**` — foundry, guided,
   import-hub, ~55 `CardCreationTab*` / component rows). ~55–60 unchecked
   rows, the single biggest remaining block, and the hardest (each tab is a
   mini studio). Options: schedule as a dedicated milestone (multi-wave),
   waive for v1 (card creation stays at the current "library + editor +
   models" level; AI-assisted authoring waits), or carve a thin vertical
   (e.g. `foundry` only). **Recommendation: waive for v1, schedule v1.1.**
   The Electron app keeps the suite meanwhile (par-lock makes this safe).
2. **Knowledge graph** (8 unchecked rows). A Mind-Map-style explorer with no
   backend in Qt at all (the Vue store + canvas are browser-rendered).
   Options: greenfield Qt Quick3D/scene-graph port (a wave of its own,
   low user value vs cost right now) or waive for v1. **Recommendation: waive for v1.**
3. **Artistry** (6 `/settings/modules/artistry` + 4 providers + 3 tab rows),
   **consciousness** (1), **vision** (2 + module page), **agentic-os** (1
   module page), **acting / stickers / emotion** models (~8). All have
   working Electron counterparts; none exists in Qt beyond scaffolds.
   **Recommendation: keep as honestly-disabled Qt pages; schedule v1.1+; do
   not block cutover.** Par-lock covers the gap.
4. **P10 MMD**: M0 done; M1 (rest-pose render) landing now (lane J2); M2
   (VMD animation + IK + CPU skinning + `MmdStage`) is the minimum for
   "MMD usable". **Recommendation: ship v1 with M1+M2; M3/M4 optional.**
5. **Default profile location.** Non-flag launches currently resolve the
   profile to a throwaway temp dir (`main.rs`), so settings/cards/models
   vanish every launch. This is the #1 correctness bug in front of real
   users. **Must-fix before v1.0.** (Fix: default to the platform data dir
   unless `--profile`/`--smoke` says otherwise — a small, honest change,
   not attempted in this doc.)
6. **Update mechanism.** `airi_core::update::check_for_update` calls
   `api.github.com/repos/anlmalabs/airi/releases/latest`, unauthenticated,
   8 s timeout, **check + notify only** (`bridges/update.rs`). There is no
   download path and must not be one without signing.
   Options: (a) keep check+notify, point it at a dedicated preview/rc
   release stream; (b) distro packages + notify (user upgrades via package
   manager / download page); (c) signed self-update — requires a signing
   identity + key custody (cosign/gpg), a release pipeline, and is out of
   scope until that exists. **Recommendation: (a)+(b) for v1.** Noting
   honestly: today's endpoint watches the *Electron* release feed, so as
   soon as airi-qt publishes its first release, the check must be pointed
   at an airi-qt-tagged feed or it will nag about the wrong binary.

## 3. Packaging & release (what exists, what is missing)

- Release tooling exists for the Electron line: `.github/workflows/release-linux-desktop.yml`
  (deb/rpm/flatpak on `prereleased`, `PRODUCT_NAME: 'airi-dasilva333'` — a
  fork literal that must be scrubbed if reused) and `release-update-readme-links.yml`.
- Electron packaging: `electron-builder` with `appId: ai.moeru.airi`,
  `build:linux|deb|rpm` scripts. That pipeline packages *Electron*, not airi-qt.
- Missing for airi-qt: (i) a release-profile Qt build recipe; (ii) a packaging
  script producing a .deb (via `dpkg-deb` — no new dependency) or AppImage
  (linuxdeploy) — either is a small script + a CI job; (iii) ffmpeg/Qt6
  runtime dependency story (Qt6 Quick3D + system ffmpeg) — the single most
  likely install-time failure point on user machines; (iv) release-notes
  link target for the update check.
- None of this exists. **All of it is pre-v1 work, and none of it is started.**

## 4. Merge/push plan (proposal — decision belongs to the user)

- `wip/airi-qt-rewrite` is the integration branch; every wave snapshot is a
  squashed WIP commit (9 as of this note); the tree is green at each.
- Proposed cutover landing flow: squash-land the branch as a **single
  milestone commit** (or a short series: `airi-qt: P0–P12 …`) onto a PR
  branch → open PR with the wave notes as the description → human review pass
  (licenses: GPL-3.0, Spine runtime version, cargo-deny/license inventory,
  SBOM gap) → merge to `main` → tag `v0.1.0-qt-preview`.
- Cadence: nothing has been pushed yet. **The push itself is a user decision
  and is deliberately not done here.** Risk note: the longer the branch lives
  unpushed, the more painful review gets; pushing earlier (as WIP PRs or a
  long-lived branch upstream of review) is cheap and safe since it is our own work.
- After preview: Electron remains default-shipped until the user flips the
  recommendation; `apps/stage-tamagotchi` gets no freeze until that flip.

## 5. Pre-v1 checklist (honest, ordered)

1. Default profile persistence (§2.5) — **blocking**.
2. P10 M1 (in flight) + M2 — MMD usable.
3. Card-AI/knowledge-graph/artistry calls (§2.1–2.4) — **user decisions**.
4. Packaging recipe + release job + install docs (§3).
5. Update check re-point (§2.6) + release tag push.
6. License inventory: GPL-3.0-or-later crate license, vendored Spine runtime,
   SIL Open Font / assets audit, PMX/PMD model policy (never vendored).
7. Wayland reality check for real users (capture fails there; window flags;
   layer-shell `StaysOnTop` quirks) — tested on X11 only.
8. Data safety: snapshot-before-restore UX already guarded; still missing a
   "close the app before restore" affordance for the torn-page case.
9. Cutover announcement + Electron maintenance-mode note in the Electron README.

## 6. What this document does NOT decide

- Whether/when to push or merge anything.
- Any Electron freeze/removal — Electron/web par-lock is untouched.
- Any license change.
- Any release.

Bottom line: engineering is in strong shape (gates green, honest UI, real
backends). The remaining gap to a first Qt preview is **packaging + default
persistence + release plumbing**; the remaining gap to v1.0 is **the §2
product calls**. Both are user decisions with recommendations attached.
