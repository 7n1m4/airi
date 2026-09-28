---
name: airi-infra-library-references
description: >-
  Look up UnoCSS, tsdown, pnpm, VueUse, and docs-prose conventions for AIRI.
  Task-selected references only; UnoCSS attributify stays banned, useDark keeps
  transitions, useLocalStorage honors ManualReset. Bundler and prose detail
  lives in references/.
---

# AIRI Infra & Library References

Router over generic library docs. Load only the reference the task needs; domain behavior stays in peer skills. Fork vetoes win over any upstream generic advice.

## Selector

| Query | Load |
| :--- | :--- |
| UnoCSS utilities, shortcuts, icons, theme | `references/unocss.md` |
| Package bundling (entry, dts, externals) | `references/tsdown.md` |
| Workspace commands, catalogs, lockfile, CI | `references/pnpm.md` |
| Which VueUse composable, lifecycle traps | `references/vueuse.md` |
| Tighten user-facing or docs prose | `references/prose.md` |

## Fork vetoes (non-negotiable)

- **No UnoCSS attributify mode**, no long inline class strings. Grouped `:class="[...]"` arrays per `airi-ui-design-conventions`.
- **Build on `@proj-airi/ui`** (reka-ui) + Iconify (`carbon:*`, `solar:*`, `ph:*`); no bespoke raw controls or inline SVGs.
- **`useDark({ disableTransition: false })`** when calling VueUse directly; never strip focus outlines without a `focus-visible:ring` replacement.
- **`useLocalStorage` vs ManualReset**: Control Strip `buttons` layout uses ManualReset semantics — do not "simplify" to plain `useLocalStorage` (wipes user layouts on catalog gating).
- **Chromatic over hexes**: `primary` derives from `--chromatic-hue`; `neutral` surfaces stay static. Never hardcode brand hexes.

## Peer boundaries

- Component choice, class grouping, theming, motion, a11y → `airi-ui-design-conventions`.
- Validation commands, typecheck scope, release safety → `airi-codebase-verification`.
- Window sync, persistence ownership, echo guards → `airi-broadcast-channels`.
- Translations mechanics → `airi-i18n-localization`; prose style → `references/prose.md` here.
