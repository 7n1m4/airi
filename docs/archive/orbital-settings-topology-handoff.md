# Handoff: Orbital Settings Topology Playground

## Status and intent

Build an isolated developer playground for a compact, animated visualization of AIRI's settings hierarchy. The concept was supplied and explicitly authorized for experimentation by Eiki. The attached `noding around.md` is the canonical conceptual input, but it is deliberately provisional and contains fixture-specific assumptions.

This is not yet a request to replace production settings navigation. Incubate it behind:

`Settings > System > Developers > Orbital Navigation Playground`

If the application already has an established developer-tools route or feature-flag convention, follow that convention instead of inventing a parallel one.

## Architectural verdict

Implement a real, data-driven topology renderer inside a developer playground.

Do **not** create a static animation that merely resembles Eiki's screenshots. Do **not** immediately wire an experimental control into production navigation. The playground must support both:

1. **Eiki fixture mode** — renders the simplified reference tree from `noding around.md` for visual exploration and comparison.
2. **Live settings mode** — derives the topology from the fork's real settings route metadata and reacts to actual navigation state.

The rendering algorithm must be generic. Counts such as 10 areas, 18 subpages, 14 module pages, and 4 system pages are fixture data—not global limits.

## Important correction: there is no "magic 18" rendering rule

The source specification defines:

- 1 root hub
- 10 area nodes
- 18 total subpage nodes
- 14 children beneath Modules
- 4 children beneath System
- 29 total nodes

The number 18 describes the fixture's total set of subpages. It does not say that every orbit must contain exactly 18 dots, that 18 is a maximum, or that real routes must be curated down to 18.

For any displayed sibling group, render the sibling count supplied by the underlying tree:

- 0 children: terminal node; render no child markers.
- 1 child: render one meaningful marker, not eighteen placeholders.
- N children: distribute N markers along the applicable track.
- Large N: apply a declared density strategy without modifying the source topology.

Empty decorative dots may be explored as a visual treatment, but they must never masquerade as real routes. If empty slots are shown, distinguish them unmistakably from nodes and expose a playground toggle to disable them.

## Product distinction

The existing settings UI is a conventional, highly discoverable page hierarchy with search, shortcuts, category cards, and normal route transitions. Preserve that architecture.

This experiment adds a compact focus-plus-context representation of navigation:

- Where am I?
- Which ancestors brought me here?
- How many siblings exist at the current depth?
- Which sibling is active?
- Does the current node have children?
- What changed when I navigated?

It must complement rather than replace labels, back navigation, search, or accessibility semantics.

## Canonical topology model

Represent settings as a rooted directed tree:

```ts
interface SettingsTopologyNode {
  id: string
  label: string
  shortLabel?: string
  route?: string
  parentId: string | null
  children: string[]
  order: number
  kind?: 'root' | 'area' | 'page'
  glyph?: string
  disabled?: boolean
  hidden?: boolean
  metadata?: Record<string, unknown>
}

interface SettingsTopology {
  rootId: string
  nodesById: Record<string, SettingsTopologyNode>
}
```

Names may be adjusted to match repository conventions. Preserve these invariants:

- Exactly one root.
- Every non-root visible node has exactly one visible parent.
- Child order is deterministic.
- IDs are stable and not derived from translated display labels.
- The current route resolves to zero or one visible node.
- Cycles, missing parents, duplicate IDs, and unreachable nodes fail validation in development.

If the real application configuration is not strictly a tree—for example, one screen is reachable from multiple categories—create a **navigation projection** with stable aliases rather than forcing the underlying domain model to become a tree.

## Path semantics

For the active node, derive the unique root-to-node path:

```text
[Settings, Providers, Chat, OpenAI]
```

Treat navigation as path editing:

- **Back:** remove the final segment.
- **Sibling switch:** replace the final segment with another child of the same parent.
- **Descend:** append a child.
- **Branch switch:** prune to the lowest common ancestor, then append the new suffix.
- **Area switch:** commonly prune to the root, then append the target branch.

Compute the previous and next active paths for every transition. Animation must be derived from the path delta rather than guessed from component mount order.

Useful transition classification:

```ts
type TopologyTransition
  = | { type: 'initial', nextPath: string[] }
    | { type: 'descend', commonDepth: number, added: string[] }
    | { type: 'ascend', commonDepth: number, removed: string[] }
    | { type: 'sibling', commonDepth: number, from: string, to: string }
    | { type: 'branch', commonDepth: number, removed: string[], added: string[] }
    | { type: 'unresolved' }
```

## Visual concept to explore

The current leading concept folds linear hierarchy into compact tracks:

- A depth or sibling group may be represented as a line, arc, or partial orbit.
- Diamonds represent actual topology nodes.
- Filled/doubled diamonds represent active or anchored nodes.
- Hollow diamonds represent inactive siblings.
- Ancestor connections remain visible but visually subordinate.
- Deeper levels may unfold as nested or connected arcs.
- A compact form may live inside the header or as a clock-like instrument near a corner.

This is a design space, not a locked drawing. Include at least two renderer layouts behind a playground control:

1. **Header track:** compact horizontal/folded representation intended to coexist with the existing title.
2. **Orbital instrument:** larger radial/semicircular representation useful for studying topology and motion.

Keep rendering geometry separate from topology logic so layouts can be swapped without rebuilding route integration.

Suggested layers:

```text
SettingsTopologyAdapter      real routes -> validated tree
TopologyPathResolver         current route -> active path
TopologyTransitionResolver   previous path + next path -> semantic delta
TopologyLayout               tree/path/delta -> geometric scene
TopologyRenderer             scene -> SVG/DOM
TopologyMotionController     semantic delta -> animation timeline
DeveloperPlayground          fixtures, toggles, diagnostics
```

Prefer SVG for the initial renderer because curves, diamonds, dashed connectors, viewBox scaling, and accessible groups are natural there. Follow existing repository dependencies and conventions; do not add a heavyweight visualization library unless the current stack genuinely needs it.

## Motion grammar

Motion should explain navigation rather than decorate it.

Prototype these rules:

- **Sibling change:** the active diamond moves to the target sibling position. Other markers remain stable.
- **Descend:** the selected parent becomes an anchor; the child track unfolds from it; the target child resolves active.
- **Ascend:** the child track contracts toward its parent; the active child is visually absorbed by or exits through the parent diamond.
- **Branch switch:** collapse the removed suffix to the common ancestor, then unfold the added suffix.
- **Initial render:** resolve without implying that the user navigated from a fictional previous node.

Do not animate by remounting the entire SVG. Preserve keyed nodes so spatial continuity is real.

Provide:

- normal speed
- slow-motion debug speed
- instant/no-motion mode
- respect for `prefers-reduced-motion`

Animation cancellation must be deterministic during rapid navigation. A newer navigation event supersedes or retargets the current transition without leaving duplicated markers or stale paths.

## Density and scaling

Never mutate or silently curate the real settings tree merely to fit a drawing. Instead declare rendering policies.

Recommended initial policy:

- 1–8 siblings: full spacing and labels where appropriate.
- 9–18 siblings: compressed spacing, active/adjacent emphasis.
- 19+ siblings: focus-plus-context mode; render every node if visually feasible, otherwise aggregate distant siblings into clearly marked ranges while keeping an inspect/debug mode that shows all nodes.

Those thresholds are initial playground values, not canon. Expose them as controls.

For one-child groups, explore whether the track adds useful meaning. It may be visually collapsed while remaining present in the semantic path. Never invent empty siblings to make the composition appear balanced.

## Playground requirements

The developer page should include:

### Data controls

- Source: `Eiki fixture` / `Live settings` / `Synthetic stress tree`
- Active-node picker
- Navigate parent/previous sibling/next sibling/first child
- Synthetic depth and branching controls
- Invalid-data fixtures: cycle, missing parent, duplicate ID, unreachable node

### Rendering controls

- Layout: header track / orbital instrument
- Light / dark / high-contrast preview
- Normal / slow / no motion
- Show labels
- Show node IDs
- Show inactive siblings
- Show optional decorative slots
- Show bounding boxes and anchor points
- Resize preview across narrow, standard, and wide widths

### Diagnostics

- Current route
- Active path
- Previous path
- Transition classification
- Sibling index and sibling count at each depth
- Node/edge/leaf counts
- Validation errors
- Rendered-node count versus source-node count

## Live settings adapter

Do not duplicate the settings inventory by hand if an authoritative route/menu registry already exists. Inspect the repository first and derive the projection from the closest canonical source.

Possible sources, in priority order:

1. Existing typed settings navigation manifest.
2. Router metadata plus explicit settings-parent metadata.
3. Existing settings category/module registry.
4. A dedicated projection manifest only if no canonical structure exists.

If labels, icons, routes, and parentage currently live in Vue components, do not perform a broad refactor merely to support this POC. Build the narrowest adapter possible and document any drift risk.

The live adapter must exclude developer-hidden, unauthorized, or unavailable routes using the same policy as the real settings UI. Do not visualize routes a user cannot actually open.

## Fixture mode

Recreate `noding around.md` as a typed fixture, retaining its assumptions for comparison:

- Root: Settings
- Ten areas
- Fourteen Modules children
- Four System children
- All other areas terminal

Label it explicitly as `eiki-reference-v1` and place a comment pointing to the attached markdown. Do not describe its counts as production requirements.

Also add synthetic fixtures:

- one root only
- one terminal area
- one child
- 3x3 balanced tree
- fourteen siblings
- thirty siblings
- depth-five chain
- uneven depth-five tree

## Accessibility and usability constraints

- The visualization is supplementary; text navigation remains authoritative.
- Every interactive node needs an accessible name and current-state indication.
- Keyboard focus order must follow a predictable logical order, not arbitrary SVG geometry.
- Do not rely on fill, opacity, or ruby accent alone to indicate state.
- Maintain usable contrast in both themes.
- Reduced-motion users receive immediate state changes without scramble, orbit, or absorption effects.
- If the compact header form becomes interactive, target sizes must remain usable.
- Avoid decorative Japanese text unless its meaning is known and intentional.

## Scope boundaries for the first implementation

Do:

- Build the developer route and isolated playground.
- Build the generic topology/path/transition core.
- Add the Eiki reference fixture and synthetic stress fixtures.
- Add a narrow live-settings adapter.
- Implement one credible SVG layout first, then a second layout if the architecture remains clean.
- Add targeted unit tests for topology validation, path resolution, and transition classification.
- Add interaction tests for rapid navigation and reduced motion if the repository's test harness supports them.

Do not:

- Replace the production settings header.
- Redesign every settings page.
- Hard-code 18 slots as a product invariant.
- Add ornamental kanji or copy Eiki's complete skin wholesale.
- Introduce sound in the first pass.
- Create a global design-system rewrite.
- Modify unrelated settings behavior.

## Implementation sequence

1. Inspect repository conventions, authoritative settings registries, router metadata, developer-feature gating, animation utilities, and test setup.
2. Document the discovered live hierarchy and discrepancies from `noding around.md`.
3. Implement topology types and validation.
4. Implement active-path and transition-delta resolution with unit tests.
5. Add `eiki-reference-v1` and stress fixtures.
6. Build the developer playground shell and diagnostics.
7. Implement the first SVG layout without motion.
8. Add semantic motion incrementally: sibling, descend, ascend, then branch switch.
9. Add the live-settings adapter.
10. Verify rapid navigation, resizing, themes, reduced motion, and deep/large fixtures.
11. Keep the work isolated and present the playground for review before proposing production adoption.

## Acceptance criteria

- The playground is reachable only through the intended developer surface or flag.
- Fixture and live modes both render through the same generic pipeline.
- Changing the active real settings route updates the visualization.
- No production route count is artificially reduced to eighteen.
- Terminal, single-child, wide-sibling, and deep trees render without errors.
- The active path and sibling position are visually and diagnostically correct.
- Back, sibling, descend, and branch transitions are classified correctly.
- Rapid navigation does not leave stale geometry.
- Reduced-motion mode is respected.
- The existing settings UI and navigation behavior remain unchanged outside the playground.
- The implementation explains any divergence between the source fixture and the real fork.

## Questions the implementing agent must answer after inspection

1. What is the authoritative source of settings hierarchy in this repository?
2. Is the visible structure truly a tree, or does it require projection aliases?
3. What are the real maximum depth and maximum sibling count?
4. How are hidden, unavailable, and developer-only routes filtered today?
5. Which existing motion utilities should be reused?
6. Where should topology state live so HMR and route changes remain safe?
7. Can the visualization consume the current route without coupling itself to individual page components?

## Creative provenance

The rooted-tree formalization and folded/orbital navigation concept originate from Eiki and were shared with explicit permission to prototype and riff on. Preserve that note in playground documentation or source comments. The implementation should be an original interpretation integrated with this fork's real architecture, not a claim of independent invention.

## Deliverable expected from the local agent

Return:

- the implemented developer playground;
- a short architecture note describing the discovered settings source and adapter;
- screenshots or a short recording of fixture and live modes;
- test results;
- known visual limitations;
- a recommendation on whether the concept is ready for a production-header experiment.

Do not merge it into production settings navigation merely because the playground looks promising. Treat production adoption as a separate review decision.
