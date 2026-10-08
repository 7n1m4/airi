# pnpm (monorepo)

- **Run scoped**: `pnpm -F <workspace> <script>` (typecheck, build, test). Never run broad `lint:fix` as validation.
- **Lockfile**: commit `pnpm-lock.yaml`; CI uses `--frozen-lockfile`. Auth lives in `.npmrc` / CI secrets, never in `package.json#pnpm`.
- **Catalogs/overrides**: prefer workspace catalog for shared versions; overrides/patches only with a `// NOTICE:` cause + linked issue.
- **Store**: global virtual store is normal; `allowBuilds`/`minimumReleaseAge` guard supply chain. Don't vendor `node_modules`.
