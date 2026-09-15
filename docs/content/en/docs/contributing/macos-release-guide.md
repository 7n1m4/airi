# Apple Platforms (macOS & iOS) Stable Release Guide

This document captures the specific technical steps required to successfully build, package, and release stable versions of AIRI for Apple platforms (Electron macOS `.dmg` and Capacitor iOS `.ipa`).

## 1. Release Workflow

### Step 1: Generate & Review Release Notes
Do not proceed blindly. Draft notes inline for user review before stamping or tagging.
1. **Compare Hashes**: Analyze all commits between the previous stable tag and `HEAD`:
   ```bash
   git log [previous-tag]..HEAD --oneline
   ```
2. **Draft Summary**: Focus on outward-facing user features (new UI controls, stage widgets, bug fixes, and stability improvements).
3. **Present Inline**: Present the gathered notes inline to the user for review.
4. **Save Draft**: Once reviewed, save the notes to `release-notes.md` in the project root (uncommitted). Both desktop and iOS upload scripts automatically ingest this file.

---

### Step 2: Version Stamping & Manifest Synchronization
Ensure all manifests, package definitions, and documentation links are synchronized to avoid broken download buttons or mismatched build metadata.

1. **Desktop Version (`apps/stage-tamagotchi/package.json`)**:
   Update `version` using the date-stamped stable format:
   ```json
   "version": "[major].[minor].[patch]-stable.[YYYYMMDD]"
   ```
   *(Note: The release script checks if the date stamp matches today's date to avoid multi-machine tag drift.)*

2. **Mobile Workspace & Root Packages**:
   Synchronize `version` in `apps/stage-pocket/package.json` and the root `package.json` to keep monorepo versions aligned.

3. **iOS Native Project (`apps/stage-pocket/ios/App/App.xcodeproj/project.pbxproj`)**:
   Update native marketing and build versions:
   - `MARKETING_VERSION = [major].[minor].[patch];` (e.g., `0.9.32`)
   - `CURRENT_PROJECT_VERSION = [buildNumber];` (increment the integer build number)

4. **Update `README.md` Release Download Badges**:
   [`README.md`](../../../../README.md) contains explicit hardcoded download URLs for release assets. Update all download button targets to point to the new tag `v[version]`:
   - Windows setup: `.../releases/download/v[version]/airi-dasilva333-[version]-windows-x64-setup.exe`
   - macOS DMG: `.../releases/download/v[version]/airi-dasilva333-[version]-darwin-arm64.dmg`
   - Android APK: `.../releases/download/v[version]/AIRI-[version]-android.apk`
   - iOS IPA: `.../releases/download/v[version]/AIRI-[version]-ios.ipa`

5. **Commit Manifest Updates**:
   Commit the updated `package.json`, `project.pbxproj`, and `README.md` files to `main` before creating the release tag.

---

### Step 3: Local Tagging (User Approval Required)
Once the version bump and manifests are committed, create the matching release tag:
```bash
git tag v[version]
git push origin v[version]
```
*(Always obtain explicit user authorization before pushing tags or release commits.)*

---

### Step 4: macOS Desktop Build & Publish (Automated Utility)
Compilation and release asset uploading for macOS are unified into a single command:
```bash
pnpm run release:mac
```
This executes `scripts/release/publish-mac.js`, which handles:
- Syncing git tags and validating the date stamp.
- Removing physical `node_modules` override copies (e.g., `discord.js`, `undici`, `ws`) to prevent Vite V8 memory overflows.
- Compiling Stage-Mate (`pnpm -F @proj-airi/stage-mate run build:mac`).
- Building Stage-Tamagotchi with `NODE_OPTIONS="--max-old-space-size=12288"`.
- Packaging the `.dmg` into `apps/stage-tamagotchi/dist/`.
- Verifying/creating the GitHub release `v[version]` on `dasilva333/airi` using `release-notes.md`.
- Uploading the `.dmg` asset with `--clobber`.

---

### Step 5: iOS IPA Build & Upload (Mandatory Release Step)
> [!IMPORTANT]
> An Apple platform release is **incomplete** until both the macOS `.dmg` and the iOS `.ipa` are published. Because [`README.md`](../../../../README.md) advertises direct download badges for both platforms, omitting this step leaves the iOS download button pointing to a **404 Not Found** release asset.

To compile the web bundle, sync native Capacitor dependencies, build the `.xcarchive`, package the `.ipa`, and upload directly to the active GitHub release:
```bash
pnpm run release:ios
```
*(Or from the pocket workspace: `pnpm -F @proj-airi/stage-pocket run release:ios`.)*

This script (`apps/stage-pocket/scripts/build-ipa.ts`):
1. Executes `pnpm run build && pnpm exec cap sync ios` to compile the web bundle into `dist/` and sync assets into `ios/App/App/public/`.
2. Automatically patches `CapApp-SPM/Package.swift` to ensure Swift 6.0 compatibility and links `CoreLLMKit` / `CoreMLBackend` for native on-device AI.
3. Runs `xcodebuild archive` to create `build/App.xcarchive`.
4. Extracts `App.app` into an `ipa-staging/Payload` container and packages `AIRI-[version]-ios.ipa` (and `App.ipa`).
5. Uploads `AIRI-[version]-ios.ipa` to the matching GitHub release `v[version]` on `dasilva333/airi` with `--clobber`.

---

### Step 6: Local iOS Simulation & Manual Xcode Prerequisites
If you are developing locally, testing in the Xcode iOS Simulator, or exporting manual archives (Ad Hoc / TestFlight / App Store Connect):

> [!WARNING]
> Xcode has no knowledge of Vite or pnpm. If you launch the simulator or archive without compiling the web frontend, `ios/App/App/public` will be empty and the app will crash to a blank white screen with `The file “index.html” couldn’t be opened`.

1. **Pre-build & Sync Web Assets**:
   Always compile the web application and sync assets into the iOS container first:
   ```bash
   pnpm run open:ios
   # (This automatically executes: pnpm run build && cap sync ios && cap open ios)
   ```
   Or manually:
   ```bash
   pnpm -F @proj-airi/stage-pocket run build
   pnpm -F @proj-airi/stage-pocket exec cap sync ios
   ```
2. **Local Headless IPA Compilation (Without Upload)**:
   ```bash
   pnpm run build:pocket:ipa
   ```
   Output: `apps/stage-pocket/build/AIRI-[version]-ios.ipa`.
3. **Manual Xcode Archive / Distribution**:
   - In Xcode, select target **App** and destination **Any iOS Device (arm64)**.
   - Select **Product** → **Archive**.
   - In Organizer, choose **Distribute App** (App Store Connect / Ad-Hoc / Enterprise / Development).

---

### Step 7: Manual Desktop Alternative / Verification
If you need to run macOS desktop packaging manually:
1. **Build macOS Executable**:
   ```bash
   pnpm -F @proj-airi/stage-tamagotchi run build:mac
   ```
2. **Publish to GitHub Releases**:
   ```bash
   GITHUB_TOKEN="" GH_SSL_NO_VERIFY="true" gh release upload v[version] apps/stage-tamagotchi/dist/AIRI-[version]-darwin-arm64.dmg --repo dasilva333/airi --clobber
   ```

---

## 2. Platform Specific Considerations

### Notarization & Entitlements
- **macOS Desktop**: Entitlements are specified in `build/entitlements.mac.plist`. CI notarizes via `CSC_CONTENT` and `APPLE_ID`. Local builds require an Apple Developer certificate in your macOS Keychain.
- **iOS Mobile**: Automatic code signing is set up via Xcode. Headless `xcodebuild` uses `-allowProvisioningUpdates CODE_SIGN_STYLE=Automatic`.

### Dynamic Hardware Permissions
- **macOS (`apps/stage-tamagotchi/electron-builder.config.ts`)**: `extendInfo` must keep `NSMicrophoneUsageDescription` and `NSCameraUsageDescription`.
- **iOS (`apps/stage-pocket/ios/App/App/Info.plist`)**: Must include `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` for audio pipelines and local transcription, along with `NSAllowsArbitraryLoads: true` for LAN HTTP access to local model runtimes.

### Architecture Support
- **macOS**: Supports `arm64` (Apple Silicon, default) and `x64` (Intel). Flags: `electron-builder --mac --arm64` or `--x64`.
- **iOS**: Targets 64-bit ARM iOS devices (`generic/platform=iOS`, minimum deployment target iOS 18.0).

---

## 3. Troubleshooting & Past Roadblocks

### Node Version Mismatch
- **Symptoms**: Engine check warnings or lockfile discrepancies during pnpm operations.
- **Cause**: Strict `engines` requirement in root `package.json` (`>=20.14.0 <28.0.0`).
- **Resolution**: Ensure the system Node.js version satisfies the declared range.

### Strict TypeScript Errors (TS6133)
- **Symptoms**: `pnpm run typecheck` or pre-build step crashes on unused imports or variables.
- **Resolution**: Run `pnpm -F @proj-airi/stage-tamagotchi run typecheck` prior to release to identify and clean up any unused symbols.

### Vue Template Compilation Errors
- **Symptoms**: `[unplugin-vue-named-template-pre] Element is missing end tag.`
- **Resolution**: Run `pnpm run typecheck:web` locally to locate and correct unmatched Vue template tags.

### Xcode SPM Dependency or CoreAI Failures
- **Symptoms**: `xcodebuild archive` fails resolving Swift Package Manager packages or complains about missing `CoreLLMKit`.
- **Resolution**: Run `pnpm -F @proj-airi/stage-pocket run ios:resolve` to refresh SPM dependencies, or verify that `apps/stage-pocket/scripts/build-ipa.ts` successfully executed `patchSpmPackageForCoreAI()`.

### iOS Simulator Blank White Screen (Missing `index.html`)
- **Symptoms**: Simulator or device launches into a blank screen with error: `[DevBridge] Navigation failed: The file “index.html” couldn’t be opened because there is no such file.`
- **Cause**: The Vite web bundle was never compiled into `apps/stage-pocket/dist` or synced to `apps/stage-pocket/ios/App/App/public`.
- **Resolution**: Run `pnpm -F @proj-airi/stage-pocket run build && pnpm -F @proj-airi/stage-pocket exec cap sync ios` (or `pnpm run open:ios`), then re-run the scheme in Xcode.

