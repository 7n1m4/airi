---
name: airi-ui-design-conventions
description: >-
  Apply AIRI UI design conventions, UnoCSS grouped array classes, @proj-airi/ui primitives (BasicButton, Button, GhostButton, IconButton, OverlayButton, FieldInput, BottomDrawer), Chromatic dynamic hue, theme switching surfaces, motion timings, and component audit rules.
---

# AIRI UI Design Conventions & System Guidelines

This skill defines the visual identity, component selection rules, UnoCSS class conventions, and theming practices across all AIRI user interfaces (`stage-tamagotchi`, `stage-web`, `stage-pocket`).

Treat the stage as a space for the character, with compact floating controls around it. Treat settings as a readable sequence of labeled decisions. Use translucency and blur to relate floating controls to the character stage, and use stable neutral surfaces where users read descriptions, enter values, or compare options.

---

## 1. Core Principles & Architecture

- **Build on `@proj-airi/ui`**: Always use `@proj-airi/ui` primitives (built on `reka-ui`) and Iconify icons (`carbon:*`, `solar:*`, `ph:*`). Never build bespoke raw DOM controls or inline custom SVGs.
- **Dynamic Theming Over Static Hexes**: Never hardcode brand hex colors (e.g. `#3b82f6`). Color tokens (`primary`, `neutral`) dynamically adapt to the user's selected `--chromatic-hue` and dark/light mode settings.
- **Readable Class Arrays**: Always format substantial UnoCSS utility lists as multi-line Vue class arrays. Never use long unwrapped class strings or UnoCSS attribute mode.
- **Decoupled Desktop Surfaces**: Keep the Actor Stage (`windows/stage`, `RendererStage.vue`) pristine for rendering. Keep interactions on the Control Strip (`ControlStrip.vue`, `ControlStripHost.vue`), Desktop Chatbox (`pages/chat.vue`), or modal dialogs. Never resurrect deprecated `controls-island` components.

---

## 2. UnoCSS & Template Styling Rules

Follow these rules across every Vue template and styling file:

### 2.1 Readably Grouped Class Arrays
Bind grouped class arrays for readability and maintainability:

```vue
:class="[
  'px-3 py-2',
  'flex items-center gap-2',
  'rounded-lg text-sm font-medium',
  'bg-white/50 dark:bg-black/50 backdrop-blur-md',
  'border border-neutral-200/50 dark:border-neutral-800/50',
  'transition-all duration-200 ease-in-out',
]"
```

- **Forbidden Syntax**:
  - Long inline class strings: `class="px-3 py-2 flex items-center gap-2 rounded-lg text-sm bg-white/50 dark:bg-black/50 border border-neutral-200/50"` (violates readablity).
  - UnoCSS Attributify mode: `px="3" py="2" flex="~ items-center" bg="white/50 dark:black/50"` (breaks type safety and consistency).
- **Refactoring Requirement**: When modifying existing components that have legacy inline class strings or attributify groups, refactor those classes into grouped arrays in the same change.

### 2.2 Reusing Project Styling Infrastructure
- Check `uno.config.ts` for established shortcuts, rules, and font definitions (`sans`, `sans-rounded`, `cute`) before adding new utilities.
- Search `apps/stage-web/src/styles/` and `packages/ui/src/components/animations/` for existing transitions before creating custom animations.
- When creating transitions, avoid scoped `<style>` blocks inside Vue `<Transition>` components; Vue's style scoping hash can desync from runtime class compilation under UnoCSS, leaving elements stuck at `opacity: 0`. Use shared UnoCSS transition classes instead.

---

## 3. Colors & Chromatic Dynamic Theming

AIRI uses a dynamic OKLCH/Chromatic color system driven by a single hue angle:

- **Root Configuration**: `uno.config.ts` configures Chromatic palettes, fonts, and animation shortcuts.
- **CSS Fallback Variables**: `packages/ui/src/fallback.css` defines `--chromatic-hue` and shade-specific chroma variables.
- **Theme Store**: `packages/stage-ui/src/stores/settings/theme.ts` (`useSettingsTheme()`) persists the user's selected hue angle (`hue`). Default: `220.44` (Sky Blue).
- **Global Stylesheet**: `packages/ui/src/main.css` injects fallback variables, lamp glow animations, and core component styles.

### Palette Roles
- **`primary`**: Dynamically derives from `--chromatic-hue`. Automatically adjusts saturation and lightness for light/dark modes. Used for primary call-to-actions, active toggle states, and focus accents.
- **`neutral`**: Stable slate/gray scale for backgrounds, surfaces, text, and borders (`neutral-50` to `neutral-950`).
- **Semantic Accents**: Independent color scales (e.g. `red` for destructive actions, `orange`/`amber` for warnings, `green` for success/ready indicators).
- **`Callout`**: Contextual message containers supporting `primary`, `violet`, `lime`, and `orange`. A color palette alone does not convey accessibility status; always pair colors with clear descriptive text or icons.

---

## 4. Theme Switching Surfaces

There are **4 canonical surfaces** where the user can view or alter the theme:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Theme Switching Surfaces                          │
├────────────────────────────────┬───────────────────────────────────────┤
│ 1. Onboarding V3 (Appearance)  │ Full 24-color spectrum + dark toggle  │
│ 2. Settings > General          │ System dark/light mode toggle         │
│ 3. Settings Header             │ SettingsThemeHeaderWidget quick-swatch│
│ 4. Control Strip Action        │ 'theme-mode' quick-cycle button       │
└────────────────────────────────┴───────────────────────────────────────┘
```

1. **Onboarding V3 Appearance Step** (`packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3/steps/step-appearance.vue`):
   - First-run experience presenting a **24-color spectrum preset grid** grouped into 4 distinct aesthetic rows:
     - *Warm & Fire* (Crimson `#E11D48`, Coral `#F43F5E`, Tangerine `#EA580C`, Marigold `#F59E0B`, Amber `#EAB308`, Lemon `#84CC16`)
     - *Nature & Earth* (Emerald, Mint, Forest, Teal, Jade, Olive)
     - *Ocean & Sky* (Cyan, Sky, Azure, Royal, Indigo, Periwinkle)
     - *Cyber & Neon* (Purple, Violet, Magenta, Pink, Rose, Neon)
   - Embeds `<SettingsThemeHeaderWidget shrink-0 />`, language selector, and dark/light toggle.
2. **Settings > General** (`packages/stage-pages/src/pages/settings/system/general.vue`):
   - Primary administrative toggle under System Settings.
   - Binds `FieldCheckbox` directly to `const { isDark: dark } = useTheme()`.
3. **Settings Master-Detail Header** (`packages/stage-layouts/src/components/Layouts/SettingsMasterDetail/SettingsBreadcrumbHeader.vue` and `packages/stage-ui/src/components/layouts/page-header.vue`):
   - Header bar of the Settings window renders `<SettingsThemeHeaderWidget shrink-0 />`.
   - Allows changing the theme and hue dynamically while browsing any settings sub-page.
4. **Control Strip Quick Action** (`packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue`):
   - Action ID `'theme-mode'` handled in `useControlStripAction()`.
   - Enabled by default on mobile (`DEFAULT_MOBILE_BUTTONS`); configurable on desktop via the Customizer window (`apps/stage-tamagotchi/src/renderer/pages/customizer.vue`).
   - Immediately cycles between light and dark mode directly from the floating stage ribbon without opening settings.

> [!IMPORTANT]
> **Theme Composable Rule**: Always use `const { isDark } = useTheme()` from `@proj-airi/ui`. If calling VueUse's `useDark()` directly, you MUST set `{ disableTransition: false }` to avoid breaking smooth theme transitions across UnoCSS variables.

---

## 5. Component Hierarchy & Selection Matrix

Always choose components from `@proj-airi/ui` according to their intended role:

### 5.1 Buttons (`packages/ui/src/components/misc/`)

| Component | Default Props & Characteristics | Primary Use Case |
| :--- | :--- | :--- |
| **`BasicButton`** | Headless base. Handles sizes (`sm`, `md`, `lg`), loading spinner, disabled state, and active press feedback. No default background or border. | Building custom compound button appearances or custom-styled action triggers. |
| **`Button`** | Defaults: `color="neutral"`, `variant="secondary"`, `shape="rect"`, `size="md"`, `outline=true`. Solid/soft surface with focus outlines. | Primary & secondary actions in dialogs, forms, and settings pages. For primary CTA: `variant="primary"` `color="primary"`. |
| **`GhostButton`** | Transparent at rest; subtle primary tint on hover/focus. Supports `active` prop for toggle state. | Low-emphasis toolbars, header utility actions, tabs, and optional secondary toggles. |
| **`IconButton`** | Unpadded button container. Sized directly around the icon. | Compact icon-only actions (copy, retry, close, options dropdowns). |
| **`OverlayButton`** | Translucent neutral surface, `backdrop-blur-md`, `rounded-xl`. | Floating stage overlay actions that sit on top of the avatar/background. |

### 5.2 Form Inputs & Controls (`packages/ui/src/components/form/`)

| Component | Characteristics | Usage |
| :--- | :--- | :--- |
| **`FieldInput`** | Combines label (`text-sm font-medium`), description (`text-xs text-neutral-500 dark:text-neutral-400`), and input slot with `gap-4`. | Standard settings form field row. |
| **`Input`** | Neutral fill, 2px border, `rounded-lg`, `shadow-sm`. Transitions border and outline on focus. | Text input fields. *(Notice: template styles variants; avoid relying on unstyled `size` prop variations)*. |
| **`FieldCheckbox`** | Label + description with an animated switch thumb (250ms transition). | Boolean settings toggles. |
| **`Select` / `FieldSelect`** | Neutral surface trigger with `rounded-lg`; popup floating menu with `rounded-xl`. | Dropdown option pickers. |
| **`FieldSlider` / `Range`** | Chromatic thumb tracking with numerical output and step indicators. | Sliders (audio volume, model scale, motion speed). |

### 5.3 Drawers & Overlays (`packages/ui/src/components/overlays/`)
- **`BottomDrawer`** (`packages/ui/src/components/overlays/bottom-drawer.vue`):
  - Used for mobile whisper sheets, quick drawers, and stage action menus.
  - **Geometry**: Top corner radius `rounded-t-[32px]`, `max-w-lg` horizontal cap, maximum height `max-h-[90dvh]`, internal content padding `px-5`.
  - **Backdrop**: `bg-black/35 backdrop-blur-sm`.

---

## 6. Shapes, Radii & Spacing Standards

| Shape Type | Class / Dimension | Usage |
| :--- | :--- | :--- |
| **Standard Card / Control** | `rounded-lg` (8px) | Default inputs, standard buttons, settings section containers, select triggers. |
| **Floating Popovers / Overlays** | `rounded-xl` (12px) | Select menus, stage overlay buttons, floating action menus, tooltips. |
| **Pills & Circular Actions** | `rounded-full` | Control Strip pill, tag chips, circular icon buttons, status indicator dots. |
| **Parallelogram Button** | `rounded-lg` with `-10°` skew | Stylized anime-aesthetic buttons. *Rule: Must counter-skew content by `10°` so text remains upright*. |
| **Bottom Drawer Top** | `rounded-t-[32px]` | Bottom sheets and mobile drawer containers. |

### Spacing Conventions
- **Button Icon & Label**: `gap-2` (e.g. `<Button><Icon class="w-4 h-4" /> <span>Label</span></Button>`).
- **Form Row (Label to Control)**: `gap-4` in `FieldInput`.
- **Settings Card Padding**: `p-4` or `p-6` with `flex flex-col gap-4`.
- **Drawer Bottom Margin**: At least `1rem` plus `env(safe-area-inset-bottom)`.

---

## 7. Motion, Animations & Accessibility

AIRI animations must feel snappy, lively, and lightweight.

| Component / Utility | Duration & Curve | Behavior |
| :--- | :--- | :--- |
| **`BasicButton`, `Input`, `Textarea`** | `200ms ease-in-out` | Color, background, and border transitions on hover/focus. |
| **`FieldCheckbox` switch thumb** | `250ms ease-in-out` | Horizontal translation across switch track. |
| **`TransitionVertical`** | `250ms` (height + opacity) | Accordions, collapsible setting sections, expandable toolbars. |
| **`TransitionHorizontal`** | `500ms` (width + opacity) | Horizontal slide-in panels, sidebar collapses. |
| **`AnimatedContent`** | `220ms enter, 160ms exit` | Smooth content replacement with `6px` inner blur transition. |
| **Shared UnoCSS Overlays** | `300ms overlay, 150ms content` | Modal dialog fade and scale entrances. |

### Accessibility & Reduced Motion
- **Reduced Motion**: `AnimatedContent` and `BottomDrawer` explicitly check `prefers-reduced-motion`. When adding custom animations, wrap them in `@media (prefers-reduced-motion: no-preference)` or ensure fallback transitions are instantaneous.
- **Focus Rings**: Never strip focus outlines with `outline-none` unless replacing them with an equivalent visible `focus-visible:ring-2 focus-visible:ring-primary-500` ring.

---

## 8. Known Quirks & Component Discrepancy Audit

Keep these real source findings in mind when writing or reviewing UI:

1. **`Input.vue` Sizing Limitation**: In `packages/ui/src/components/form/input/input.vue`, a `size` prop is declared in TypeScript, but template styling only branches on `variant`. Do not rely on `size="sm"` or `size="lg"` changing input dimensions without providing explicit sizing classes.
2. **`Input.vue` Variants**: `variant="primary"` and `variant="secondary"` currently share identical style arrays.
3. **Focus Outline Disparity**: `Button` and `GhostButton` have built-in focus outlines, but `IconButton` and `OverlayButton` do not define default focus rings. When adding keyboard-navigable icon buttons, explicitly specify focus ring classes.
4. **Vue Transition Class Hashing**: Do not use scoped `<style>` for `<Transition>` enter/leave classes when building under Vite + UnoCSS. Scoped CSS hashes can desync from runtime element classes, leaving elements at `opacity: 0`. Use UnoCSS classes directly on the container.
5. **Histoire Component Previews**: Run `pnpm dev:ui` to preview and test components in Histoire stories (`packages/stage-ui/src/components/**/*.story.vue`).
