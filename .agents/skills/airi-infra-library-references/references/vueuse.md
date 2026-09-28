# VueUse (lookup + traps)

- **Default to catalog**: map requirement → composable before hand-rolling (`useBroadcastChannel`, `useLocalStorage`, `useDark`/`useTheme`, mouse/media-query sensors).
- **BroadcastChannel**: prefer `useBroadcastChannel` (auto unmount, typed `{ data, post }`); raw `new BroadcastChannel` must be SSR-guarded and closed manually. Payloads must be structured-clone-safe (no DOM nodes, class instances, or Blobs).
- **Theme**: `useDark({ disableTransition: false })`; `AnimatedContent`/`BottomDrawer` honor `prefers-reduced-motion`.
- **Storage trap**: Control Strip `buttons` uses ManualReset gating (`BUTTONS_CATALOG_VERSION` keyed merge) — plain `useLocalStorage` would wipe layouts. Match existing semantics when touching layout keys.
