# UnoCSS (fork subset)

- **Config first**: check `uno.config.ts` for shortcuts, rules, fonts (`sans`, `sans-rounded`, `cute`) before adding utilities.
- **Animations**: search `apps/stage-web/src/styles/` and `packages/ui/src/components/animations/` before creating transitions. No scoped `<style>` inside Vue `<Transition>` (hash desync leaves `opacity: 0`); use shared UnoCSS classes.
- **Banned**: attributify mode (`px="3"`, `flex="~ items-center"`), long unwrapped class strings. Refactor legacy touches into grouped `:class="[...]"` arrays in the same change.
- **Icons**: Iconify preset only; never inline custom SVGs for standard actions.
- **Theme**: `primary` tracks `--chromatic-hue` (see `packages/ui/src/fallback.css`, `stores/settings/theme.ts`); `neutral-50…950` for surfaces/text/borders.
