# tsdown (package builds)

- **Scope**: library bundling for `packages/*` (entry, format, dts, target, platform). App builds stay with their workspace scripts.
- **Rules**: keep deps external (no bundling Electron, Vue, or workspace peers); explicit entry per package export; dts on for public contracts; no build-time secrets.
- **Migrating from tsup**: port entry + external + dts flags 1:1, then verify with the affected workspace `typecheck`/build per `airi-codebase-verification`. Keep the diff to bundler config only.
