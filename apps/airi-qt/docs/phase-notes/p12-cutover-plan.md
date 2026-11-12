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
  backend, MCP (stdio client + wired page + streamable-HTTP client + REST-side
  remote wiring), ACP agents (HITL permission UX wired), channel gateway with
  typed RPC dispatch (`renderer.info` live), Discord REST (send-only UI) +
  opt-in gateway receive (in-memory only), screen capture, BYOS local snapshot
  sync engine + wired page, MMD M0+M1 (rest-pose render, synthetic-verified).
- Gate at every wave: fmt, clippy `-D warnings`, `cargo test --workspace` (48 suites /
  598 tests), offscreen smoke exit 0, i18n parity ×10 locales.
- Manifest: **127 unchecked** of 234 — 26 stage-tamagotchi (c-class roots),
  101 stage-pages; **87 waived** (25 devtools + 62 in the 2026-11-12 v1 waiver
  batch), 20 checked. Classification lives in `p11-audit.md`; the v1 scope is
  now fully declared — nothing remains unchecked that was not consciously
  deferred (v1.1+) or Electron/web par-locked.
- Everything user-facing ships opt-in or disabled-with-tooltip where honest.
  Nothing is faked.

## 2. Decisions before "cutover" can mean anything

These are product calls, not engineering calls. All four were resolved by
the user on 2026-11-12 — see §7 (Decisions log). The recommendations below
are kept as written for the record; §7 states what was approved and what
was waived.

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
   users. **Must-fix before v1.0 — RESOLVED 2026-11-11 (wave ⑨):** plain launches
   now persist to the platform data dir; `--profile` still wins; `--smoke` stays
   throwaway.)
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
   **2026-11-12:** dev-release posture — the re-point does NOT happen until a
   Qt tag is actually cut (§7.6).

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
## 7. Decisions log

### 2026-11-12 — user calls on cutover groundwork ("next move")

1. **§2.1 card-AI suite — APPROVED as recommended: waived for v1, scheduled v1.1.**
   43 rows waived via `features.waivers.json` (foundry, guided, import-hub, all
   `CardCreationTab*` / component / composable rows under `settings/airi-card/`).
   Electron/web remains the working suite until v1.1 lands (par-lock).
2. **§2.2 knowledge-graph — APPROVED as recommended: waived for v1.** 8 rows
   (`/knowledge-graph/**`) waived; no Qt backend exists; deferred v1.1+.
3. **§2.3 artistry family — APPROVED as recommended: deferred v1.1+, not a v1 blocker.**
   11 rows waived (`settings/modules/{artistry,consciousness,vision,agentic-os}`,
   `settings/providers/artistry/**`, `settings/providers/vision/`,
   `settings/models/emotions`). Qt pages stay as honestly-disabled scaffolds.
   Manifest unchecked count: **189 → 127**; waived 25 → **87**; checked 20.
4. **§2.4 P10 MMD — M1 ships as synthetic-verified experimental.** No real
   `.pmx` model file exists anywhere on this machine or in the repo, and the
   user did not have one available (2026-11-12: "idk whats that pmx"). M1 is
   therefore **not visually accepted**: identity skinning, two-step ramp, and
   rest-pose only, verified headlessly against synthetic fixtures. M2
   (VMD animation, IK, CPU skinning, PMD/`.pmd`, `.zip` support) may proceed on
   the same synthetic-verification footing; any real-model desk check waits
   for a license-clean `.pmx` the user supplies.
5. **Push gate — no push until feature parity is confirmed.** `wip/airi-qt-rewrite`
   stays local (10+ WIP commits). "Feature parity confirmed" = every manifest
   row resolved (done or waived-with-reason) **plus** explicit user sign-off
   on the Electron par-lock; nothing is pushed, merged, or tagged before that
   flip. Do not re-ask per wave.
6. **Release posture — dev release for now.** No public/production release, no
   `v0.1.0-qt-preview` tag, no update-feed re-point, no CI release job wired to
   `prereleased`. Local dev builds (e.g. a `dpkg-deb` recipe producing a
   `airi-qt-dev` package) are fine as groundwork; `PRODUCT_NAME` scrub and the
   update-check re-point happen only when a Qt tag is actually cut. (§2.6
   recommendation (a)+(b) stands for whenever that happens; (c) remains out of
   scope without signing infrastructure.)
7. **Optional later lanes — approved ("ok"), with standing exclusions.**
   Discord command dispatch remains out of scope (the gateway card is an
   inbox, never a command processor). MCP registry wiring proceeds only after
   the live registry shape is verified — never on guessed shapes. Sync
   S3/Hyperdrive needs an explicit provider/product decision first.
   GUI-thread gateway dispatch is deferred (no rich `renderer.*` handler
   exists yet — YAGNI).

Bottom line: v1 scope is now fully declared (every unchecked row is either
Electron/web par-locked or consciously deferred to v1.1+), nothing ships
before parity is user-confirmed, and any Qt release is dev-grade until the
user flips it.
### 2026-11-12 (wave ⑪ integration) — module-services port landed; approvals

- Wave ⑪ (memory/speech/hearing/modules/card export) landed as `9824713f5`.
  Manifest reclassified: **116 unchecked / 85 waived / 33 checked**.
- The user approved (2026-11-12): (a) the recommended next-wave order —
  **⑫ GUI-thread gateway dispatch → ⑬ lifetime-memory + memory-signals
  pages → P1 daemon milestone** (system-embedding arc starts after).
  (b) The system-embedding research posture **as written** (§I decisions
  adopted as recommended): hybrid (b) posture; optional sudo mode for
  v1.1+ (never default); L1 observe default / L2 polkit HITL = v1 ceiling /
  L3 user-authored standing rules v1.1 after sudo-mode foundation /
  L4 eBPF (aya) armed per-session, opt-in, design approved but P5 scope
  is its own milestone later); no root daemon; never CAP_SYS_ADMIN;
  multi-user machines out of scope for sudo mode.
- L1→L4 means: AIRI is never PID 1; egress stays in the user-session
  process alone; the root-*adjacent* helper (when it exists) carries no
  network stack.
