# Web Stage & Docs GitHub Pages Deployment Surface

## 1. Overview & Topology

AIRI hosts both its public documentation and a live client of **Web Stage** on GitHub Pages from a unified static bundle.

| Surface | Public URL | Build Source | Subpath / Base URL |
| :--- | :--- | :--- | :--- |
| **AIRI Docs** | `https://<owner>.github.io/<repo>/` (e.g. `https://dasilva333.github.io/airi/`) | `docs/` (VitePress) | `BASE_URL=/airi/` |
| **AIRI Web Stage** | `https://<owner>.github.io/<repo>/web-stage/` (e.g. `https://dasilva333.github.io/airi/web-stage/`) | `apps/stage-web/` (Vue 3 + Vite) | `BASE_URL=/airi/web-stage/` |

---

## 2. Architecture & Subpath Resolution

### Dynamic `BASE_URL` in `apps/stage-web`
To ensure `apps/stage-web` works seamlessly across different deployment targets (root `/` for local dev/Docker vs `/airi/web-stage/` for GitHub Pages):
1. **`apps/stage-web/vite.config.ts`**:
   Configured with dynamic base URL support:
   ```typescript
   base: env.BASE_URL || '/',
   ```
2. **`apps/stage-web/src/main.ts`**:
   Vue Router history is initialized with the injected base path:
   ```typescript
   export const router = createRouter({
     routes: routeRecords,
     history: createWebHistory(import.meta.env.BASE_URL),
   })
   ```

### Bundling Pipeline
When published:
1. `docs/` builds to `docs/.vitepress/dist/`
2. `apps/stage-web/` builds with `BASE_URL=/airi/web-stage/` to `apps/stage-web/dist/`
3. `apps/stage-web/dist/` is copied into `docs/.vitepress/dist/web-stage/`
4. The entire directory is uploaded as a single GitHub Pages artifact.

---

## 3. GitHub Actions Workflow (`.github/workflows/deploy-frontends.yml`)

The workflow triggers on pushes to `main` touching `docs/**`, `apps/stage-web/**`, `packages/**`, or manually via `workflow_dispatch`.

```yaml
name: Deploy: Frontends (Docs & Web Stage)

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'apps/stage-web/**'
      - 'packages/**'
      - '.github/workflows/deploy-frontends.yml'
  workflow_dispatch:
```

Key build steps in the workflow:
- Uses `pnpm/action-setup@v4` (reading version directly from `package.json`'s `packageManager`).
- Uses `pnpm install --no-frozen-lockfile` for CI build stability.
- Runs `pnpm run build:packages`.
- Builds Docs: `BASE_URL=/airi/ pnpm -F @proj-airi/docs run build`.
- Builds Stage-Web: `BASE_URL=/airi/web-stage/ pnpm -F @proj-airi/stage-web run build`.
- Bundles: `cp -r apps/stage-web/dist docs/.vitepress/dist/web-stage`.
- Deploys to GitHub Pages via `actions/deploy-pages@v4`.

---

## 4. Local Build & Verification Shortcuts

Convenience scripts are provided in root `package.json` and `apps/stage-web/package.json`:

### Full Pages Bundle Build
```bash
pnpm run build:pages
```
Runs `build:packages`, builds both docs and web-stage with their respective `BASE_URL`s, and bundles `apps/stage-web/dist` into `docs/.vitepress/dist/web-stage`.

### Web Stage Only (Pages subpath)
```bash
pnpm run build:web:pages
# or inside apps/stage-web:
pnpm -F @proj-airi/stage-web run build:pages
```

### Triggering Manual CI Deployment
```bash
gh workflow run deploy-frontends.yml --repo dasilva333/airi
```

---

## 5. Repository Metadata
The repository's homepage link is configured to direct visitors to the Web Stage deployment:
```bash
gh repo edit dasilva333/airi --homepage "https://dasilva333.github.io/airi/web-stage/"
```
