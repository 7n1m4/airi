---
name: airi-release-packaging-deploy
description: >-
  Package/release/deploy AIRI: versioning, tags, release scripts, Electron installers, CI signing/notarization, auto-update feeds, Capacitor APK/IPA, Docker images, GitHub Pages, edge-worker publishing. Cloud relay implementation uses airi-cloud-relay-infrastructure.
---

# AIRI Release, Packaging & Deploy

Deployment surface map for shipping AIRI. Desktop releases are manual + script-assisted on the fork; Electron CI builds cover Win/macOS/Linux; there is currently no mobile release channel (the Capacitor app was purged 2026-11-13; the unified Rust native app will add one); stage-web ships as Docker/OCI; edge workers deploy per-user via Cloudflare.

## 1. Surface Map

| Surface | App | Artifacts | Ship path |
|---|---|---|---|
| Windows | `stage-tamagotchi` | `AIRI-<ver>.exe` + `.zip` (portable) | Local: `pnpm run release:win` (fork `dasilva333/airi`) |
| macOS | `stage-tamagotchi` | `AIRI-<ver>.dmg` (arm64 + x64) | Local: `pnpm run release:mac` (notarized) |
| Linux | `stage-tamagotchi` | `.deb`, `.rpm`, `.flatpak` (x64 + arm64) | CI only (`release-linux-desktop.yml`, incl. Flatpak via flathub SDK) |
| Mobile (planned) | unified Rust native app (`crates/airi-slint`) | TBD | Purged 2026-11-13; see `docs/proposal-unified-rust-native-app.md` |
| Web & Docs | `stage-web` / `docs` | static sites | `deploy-frontends.yml` → GitHub Pages (`/airi/` & `/airi/web-stage/`) |
| Edge relay | `apps/stage-edge` | Cloudflare Worker (per-user) | Built into users' accounts via OAuth PKCE during onboarding; see `airi-cloud-relay-infrastructure` skill |

## 2. Desktop Stable Release (Windows & macOS)

Canonical references: **`docs/content/en/docs/contributing/windows-release-guide.md`** and **`docs/content/en/docs/contributing/macos-release-guide.md`**. The workflow unified by `scripts/release/publish-win.js` / `publish-mac.js`:

1. **Release notes first.** Inspect commits (`git log [previous-tag]..HEAD --oneline`); draft user-facing notes saved to `release-notes.md` (uncommitted) following these communication standards:
   - **User-Centric Framing**: Speak from the user's experience instead of exposing internal plumbing. Emphasize what the user can now do and what annoyance was removed (e.g. *"You can now retry a failed message directly from the chat"* instead of *"Refactored chat action menu state"*; *"Previously, provider dropdowns were cut off on narrow screens. We fixed this so..."*).
   - **Audience Hierarchy**: Group notes logically:
     - `## ✨ Product Updates` (User-facing enhancements across Local models, Chat, Stage, Providers).
     - `### 🛠️ To Developers` (Plugin SDK, API contracts, desktop window managers).
     - `### 🧪 To Contributors` (Packaging scripts, CI/CD, internal harnesses, audit tools).
     - `### ⚠️ Upgrade Notes` (Only when manual user action or configuration migration is required).
   - **Traceable Footnotes & Upstream Attribution**: Keep bullet points punchy and readable without inline commit SHA clutter. When features, fixes, or localizations derive from upstream PRs (tracked in `docs/UPSTREAM_RADAR.md` or port commits), always cite and thank the upstream authors and PR links (e.g., `Special thanks to upstream contributor @author for PR [#1234](url)`).
   - Present inline in natural Markdown (never inside an unrendered raw code fence).
2. **Version stamp.** `apps/stage-tamagotchi/package.json` → `[major].[minor].[patch]-stable.[YYYYMMDD]`.
3. **Tag.** `git tag v<version> && git push origin v<version>` (fork remote; never touch upstream without authorization).
4. **Build + publish.** `pnpm run release:win` or `pnpm run release:mac`.
   - Windows supports `--build-only` (stop after build for smoke test, then `pnpm run release:win --upload-only`) since Win installers need interactive smoke testing; macOS uploads directly.
   - `publish-mac.js` automatically dispatches the `Release: Linux Desktop` workflow (`release-linux-desktop.yml`) on GitHub Actions right after uploading macOS assets, enabling concurrent cloud compilation of Linux x64/arm64 packages while the user transitions to Windows.
   - `publish-win.js` automatically runs release asset verification (`node scripts/github/ci-status.mjs --release`) after uploading Windows binaries to confirm all 14 cross-platform assets are attached.
   - Both scripts: `git -c http.sslVerify=false pull && fetch --tags --force`, warn if version date-stamp ≠ today (multi-machine drift: someone forgot to push), physical `node_modules` override cleanup (discord.js/undici/ws etc. copied packages removed before Vite bundling), `NODE_OPTIONS=--max-old-space-size=12288`, `GH_SSL_NO_VERIFY=true`, `GITHUB_TOKEN` deleted so `gh` falls back to keyring auth, artifact discovery (`AIRI-<ver>*.exe|zip` / `.dmg`), release creation/upload to `--repo dasilva333/airi --clobber` using `release-notes.md` if present.
5. **Manual fallback:** `pnpm -F @proj-airi/stage-tamagotchi run build:win|build:mac`, then `GITHUB_TOKEN="" GH_SSL_NO_VERIFY="true" gh release upload [tag] <artifact> --repo dasilva333/airi --clobber`.

### Windows-specific
- Always ship the portable `.zip` alongside the `.exe` (WDAC/AppLocker/SmartScreen blocks unsigned installers). CLI error "An Application Control policy has blocked this file" → advise Properties→Unblock, `Unblock-File`, admin run, or the zip.
- Code signing for the `.exe` is a standing action item (see guide §6).
- `app.asar` / `airi.exe` file locks are pre-checked by the script; if locked, ask the USER to close the holding process. **Never run `taskkill` autonomously** per the guide's hard rule.

### macOS-specific
- `build:mac` produces `.dmg` + `.app` in `apps/stage-tamagotchi/dist`; arch flags `--arm64` (default on Apple Silicon) / `--x64`.
- Notarization entitlements in `build/entitlements.mac.plist`; CI uses `CSC_CONTENT` + `APPLE_ID` secrets; local builds need the Apple Developer cert in keychain.
- `electron-builder.config.ts` `extendInfo` must keep `NSMicrophoneUsageDescription` + `NSCameraUsageDescription`.

## 3. Electron Linux CI / CD (`.github/workflows/release-linux-desktop.yml`)

Triggers: `release: prereleased` (auto-publish), `workflow_dispatch` (manual, `build_only` / `artifacts_only` / `tag`), nightly `schedule` (cron `0 0 * * *`).

Build matrix: `ubuntu-latest` (x64: deb, rpm, Flatpak via flathub SDK), `ubuntu-24.04-arm` (arm64: deb, rpm, Flatpak). Windows and macOS desktop releases are built locally via `publish-win.js` and `publish-mac.js`.

- Publish policy: `--publish=never` for electron-builder; artifacts renamed and uploaded via `softprops/action-gh-release` to the release tag.
- Linux runners run `jlumbroso/free-disk-space` first (historic "No space left" archive failures).

## 4. Mobile — superseded (2026-11-13)

The Capacitor app `apps/stage-pocket` was **purged** (web tech on mobile rejected; see `docs/proposal-unified-rust-native-app.md`). All Android APK / iOS IPA release flows, the `packages/cap-vite` tool, and the `dev:pocket:*` scripts are deleted. Mobile distribution will be designed for the unified Rust native app (Slint, desktop + mobile from one screen-size-reactive codebase) and documented here when it exists. There is no mobile release channel until then.

## 5. Web & Docs Frontends / GitHub Pages / Edge

- **Docker:** Retired and removed. Web Stage is deployed continuously alongside the documentation as static frontends on GitHub Pages.
- **Docs & Web Stage on GitHub Pages:** `.github/workflows/deploy-frontends.yml` → on push to `main` touching `docs/**`, `apps/stage-web/**`, or `packages/**` (or manual `workflow_dispatch`):
   - Builds Docs with `BASE_URL=/airi/` → `docs/.vitepress/dist`
   - Builds Web Stage with `BASE_URL=/airi/web-stage/` → `apps/stage-web/dist`
   - Bundles Web Stage into docs output (`docs/.vitepress/dist/web-stage`)
   - Deploys static bundle to GitHub Pages: Docs at `https://<user>.github.io/airi/` and Web Stage at `https://<user>.github.io/airi/web-stage/`.
   - Local verification script: `pnpm run build:pages` (full bundle) or `pnpm run build:web:pages` (`stage-web` only).
   - Architecture & details in `docs/design-web-stage-pages-deployment.md`.
- **Edge relay:** `apps/stage-edge` is NOT centrally deployed — each user provisions their own Cloudflare Worker + KV + R2 via OAuth PKCE during onboarding (CloudflareStageDeployer). See the `airi-cloud-relay-infrastructure` skill for maintainer-side flows.

 ## 6. Common Pitfalls

 - **`node:crypto` externalization in renderer builds.** Symptom: `Module "node:crypto" has been externalized for browser compatibility`. Fix lives in `electron.vite.config.ts` browser aliases + `src/renderer/shims/node-crypto.ts` shim; DuckDB leaks `bundles/default-node` into renderer — intercepted via the `force-node-crypto-shim` resolveId plugin. Same vector for `process`/`module`/`path` leaks. (windows-release-guide §2.)
 - **Release date-stamp mismatch warning.** If publish scripts warn the version date differs from today, another machine/agent likely forgot to push — sync tags before re-running, don't override blindly.
 - **Invalid `GITHUB_TOKEN` env overrides keyring** causing 401s on `gh release create`; always clear it for release commands. `gh` needs `workflow` scope: `gh auth refresh -h github.com -s workflow`.
 - **Engines:** root requires Node `>=20.14.0 <28.0.0`, pnpm `>=10`. macOS guide documents past lockfile failures when Node outpaced the cap.
 - **Build-breaking strictness:** TS6133 unused imports fail the pre-build typecheck; broken Vue template end-tags fail with `unplugin-vue-named-template-pre` — run `pnpm run typecheck:web` to localize.
 - **Resilient asset downloads:** build-time font/model fetches should use `packages/stage-shared/src/ts/resilient.ts` retry wrapper to survive flaky networks.
 - **taskkill ban:** never kill `node.exe`/`electron.exe` en masse to unstuck builds; coordinate with the user instead (guide §5, CAUTION).
 - **Fork vs upstream asymmetry:** the release scripts target `dasilva333/airi`; SignPath signing and several CI guards only fire on `moeru-ai/airi`. Don't assume parity.
 - **There is no mobile release channel.** The Capacitor `stage-pocket` was purged 2026-11-13 (`docs/proposal-unified-rust-native-app.md`); any "release android/ios" request means the Rust native app does not exist yet — say so, and discuss scope with the user before doing anything.

 ## When to Use

 - Running or troubleshooting `release:win` / `release:mac`, version stamping, tagging, release-note drafting.
 - Interpreting or fixing `release-linux-desktop.yml` or `deploy-frontends.yml`.
 - Electron-builder config, signing/notarization, artifact naming (`artifacts-metadata.ts`, `rename-artifacts`).
 - Any "why did the build fail" involving renderer Node-module leakage, disk space, or file locks.

 ## Verification

 - Desktop local release: the publish scripts re-verify tag/artifact existence themselves; a successful run ends with the GitHub release URL printed and the artifacts visible there.
 - Build-only validation without release: `pnpm run release:win --build-only` (smoke test window), or `pnpm -F @proj-airi/stage-tamagotchi run build:win|build:mac` for compile-level confidence. Typecheck/build per the `airi-codebase-verification` skill before any push.
 - Mobile: no channel exists — state this explicitly when asked to cut a mobile release.
 - After any file modification: `git status` and report open/unstaged files verbatim.

 ### Authoritative Documents

 - [docs/content/en/docs/contributing/windows-release-guide.md](docs/content/en/docs/contributing/windows-release-guide.md) — Windows stable-release workflow, lessons learned, WDAC/codesign action items, build-safety rules.
 - [docs/content/en/docs/contributing/macos-release-guide.md](docs/content/en/docs/contributing/macos-release-guide.md) — macOS release workflow, notarization/entitlements, troubleshooting.
 - [docs/delivery/AIRI-customer-deployment-guide.zh-CN.md](docs/delivery/AIRI-customer-deployment-guide.zh-CN.md) — customer-facing deployment guide (zh-CN).
 - `.github/workflows/release-linux-desktop.yml` · `.github/workflows/deploy-frontends.yml` — automation surfaces described above.
- [docs/rosetta-stone.md](docs/rosetta-stone.md) — repo layout & persistence references for anything release-adjacent.

## Related Skills & References

- **Peer Skills**: [[airi-cloud-relay-infrastructure]], [[airi-codebase-verification]]
- **Key Documents**: [[windows-release-guide]], [[macos-release-guide]], [[release-notes]], [[zh-CN]], [[rosetta-stone]]
