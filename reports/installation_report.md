# AIRI Project Initialization & Setup Report

This document outlines the issues we encountered during the initial setup of the AIRI workspace on a default Windows 11 machine, specific build errors relating to the dependency graph (`tsdown` & `rolldown`), and suggested fixes to improve the contributor and user setup experience.

## 1. Environment Overview
* **OS:** Windows
* **Package Manager:** `pnpm` (v10.32.1)
* **Initial Node.js version:** v20.12.1
* **Expected Node.js version:** v24.13.0 (per `.tool-versions`)

---

## 2. Issues Encountered

### A. PowerShell Execution Policy Blocking `pnpm`
When a developer runs `pnpm install` in a fresh Windows environment, they might encounter a PowerShell `PSSecurityException` because the `pnpm.ps1` script execution is disabled by default Windows Execution Policies.

**Error Snippet:**
```text
pnpm : File C:\Users\Ansem\AppData\Roaming\npm\pnpm.ps1 cannot be loaded because running scripts is disabled on this system.
```
**Takeaway:** We worked around this by explicitly invoking `pnpm.cmd install` instead. It might be worthwhile to add a slight footnote in the `CONTRIBUTING.md` / `README.md` for Windows users about `pnpm.cmd` or running `Set-ExecutionPolicy`.

### B. Missing Strict Environment Restrictions (Fail-Fast)
While the repository includes a `.tool-versions` file indicating `nodejs 24.13.0`, this requirement isn't strictly enforced during the package resolution step.

Because `pnpm` was allowed to proceed with Node.js `v20.12.1`, it spent significant time downloading over 2.9k packages before failing deep inside the workspace postinstall step natively, leading to a much worse debug experience.

### C. `tsdown` & `rolldown` Breaking on Older Node v20 Versions
The most significant roadblock was a hard crash during the workspace post-install phase for packages relying on `tsdown` (like `@proj-airi/stream-kit` and `@proj-airi/server-sdk`).

**Error Snippet:**
```text
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'format' must be one of: 'reset', 'bold', 'dim', 'italic'... Received [ 'underline', 'gray' ]
    at styleText (node:util:210:5)
    at styleText$1 (file:///.../.pnpm/rolldown@1.0.0-rc.3/.../rolldown-build-CGNuOAoF.mjs)
```

**Root Cause:** The workspace uses `rolldown` via `tsdown`. Rolldown tries to pass an *array* of formats to the Node.js built-in `util.styleText(format, text)`. Support for passing an array into `styleText` was not added to Node.js until version **v20.14.0**. Any system running a Node.js version older than 20.14.0—even if they are on the v20 LTS line—will instantly crash on `tsdown` compilation.

### D. Finding a Reliable Node Version Manager on Windows
Attempting to automatically correct the user's Node.js version to v24.13.0 proved slightly cumbersome via default Windows tools (e.g. `winget` didn't have `24.13.0` registered in its global manifest yet, failing the requested exact version install).

**Our Fix:** We successfully used `pnpm env use --global 24.10.0` to pull a fully compatible Node 24 runtime without needing external version managers or Administrator permissions.

---

## 3. Recommendations for the Developer

1. **Enforce Node.js Engine Strictness:**
   Add an `engines` field in the root `package.json` that requires `>=20.14.0` (or specifically `24.x` as desired). Coupling this with `engine-strict=true` in `.npmrc` guarantees that `pnpm install` will reject older Node.js versions immediately, saving developers minutes of waiting and cryptic stack traces.

   ```json
   {
     "engines": {
       "node": ">=20.14.0",
       "pnpm": ">=10.0.0"
     }
   }
   ```

2. **Add a Node environment fallback in Docs:**
   In `CONTRIBUTING.md` or next to the `pnpm dev` scripts, explicitly advertise `pnpm env use --global 24` as a cross-platform, fool-proof way to get the correct Node version. This directly bypasses `nvm-windows` and `winget` discrepancies.

3. **Check `rolldown` Optional Dependencies:**
   The initial failure of the build script prior to updating Node raised a `Cannot find native binding` related to `@rolldown/binding-win32-x64-msvc`. While updating Node and forcing a reinstall resolved both issues, `rolldown` natively failing when its platform-specific dependencies miss downloading is a known upstream concern. Consider ensuring that native optional bindings correctly declare `os` and `cpu` limits if you ever move to locking them strictly.
