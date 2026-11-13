# Project: Positioning Store Migration

## Goal
The goal of this project is to migrate the positioning controls (scale, X/Y/Z position) for character models (Spine, Live2D, VRM) from global, type-specific stores to a type-agnostic, per-file persistence store (`usePositioningStore`). This ensures that position and scale settings are remembered for each specific model rather than being shared globally across all models of the same type.

## Scope of the System
Positioning control exists in multiple stages and applications across the workspace:
*   `apps/stage-tamagotchi` (The main active stage and settings)
*   `apps/stage-web` (Web-based stage)
*   `apps/stage-pocket` (Mobile/Pocket stage)

## Progress Log
*   **[x] Spine Support Groundwork**: Created `usePositioningStore` and fully wired up Spine models to use it in the main stage (`stage-tamagotchi`) and the models settings page.
*   **[x] Control Island Sync**: Fixed the Control Island on the main page to read and write to the new store for Spine.
*   **[/] Live2D & VRM Transition**: Currently in progress. We are moving them to the new store but keeping the old stores as fallbacks to avoid breaking other apps.

## Transition Strategy (Fallbacks)
To avoid breaking other applications that still rely on the old stores (`useLive2d` and `useVRMStore`):
1.  We are **not** deleting the state from the old stores yet.
2.  Components like `Live2D.vue` and `ThreeScene.vue` will be updated to accept `xOffset`, `yOffset`, and `scale` as optional props.
3.  If props are provided, the component will use them (allowing the main app to use the new store).
4.  If props are **not** provided, the component will fall back to reading from the old stores.

## Note for Future Work: Revisit Other Apps
The following apps still read directly from `useLive2d` or old stores and need to be refactored to use the new `usePositioningStore` pattern:
*   **`apps/stage-pocket`**: Revisit and update to pass props to the scene components from the new store.
*   **`apps/stage-web`**: Revisit and update to pass props to the scene components from the new store.
