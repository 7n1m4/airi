# Port Manifest — Settings Panels / Sections

Generated from renderer settings pages, stage-ui settings scenario components, and settings stores.
`bindings:` is a best-effort regex extraction of `use*Store` references, `settings.*` keys, and store import paths — verify against source during port.

## Renderer Settings Pages (`apps/stage-tamagotchi/src/renderer/pages/settings`)

Total: **10**

- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/docs/[...path].vue`
  - bindings: (no store bindings parsed)
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/docs/index.vue`
  - bindings: (no store bindings parsed)
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/index.vue`
  - bindings: settings.title
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/modules/mcp.vue`
  - bindings: settings.pages.modules.mcp-server.title, settings.title, stores/mcp-tool-bridge
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/system/connection.vue`
  - bindings: settings.pages.connection.description, settings.pages.connection.server-auth-token.description, settings.pages.connection.server-auth-token.label, settings.pages.connection.server-hostname.description, settings.pages.connection.server-hostname.label, settings.pages.connection.title, settings.pages.connection.websocket-secure-enabled.description, settings.pages.connection.websocket-secure-enabled.label, settings.pages.system.title, stores/settings/server-channel, useServerChannelSettingsStore
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/system/developer.vue`
  - bindings: settings.animations.stage-transitions.title, settings.animations.use-page-specific-transitions.description, settings.animations.use-page-specific-transitions.title, settings.disableTransitions, settings.pages.system.developer.title, settings.title, settings.usePageSpecificTransitions, stores/settings
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/system/dock-mode.vue`
  - bindings: settings.pages.system.dock-mode.title, settings.title, stores/dock-mode, useDockModeStore
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/system/general.vue`
  - bindings: settings.pages.system.general.hide-app-icon.description, settings.pages.system.general.hide-app-icon.load-error, settings.pages.system.general.hide-app-icon.save-error, settings.pages.system.general.hide-app-icon.title, settings.pages.system.general.title, settings.title
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/system/index.vue`
  - bindings: settings.pages.system.description, settings.pages.system.title, settings.title
- [ ] `apps/stage-tamagotchi/src/renderer/pages/settings/system/window-shortcuts.vue`
  - bindings: settings.disableTransitions, settings.pages.themes.window-shortcuts.press-keys, settings.usePageSpecificTransitions, stores/settings, stores/shortcuts, useShortcutsStore

## Stage-UI Settings Scenario Components (`packages/stage-ui/src/components/scenarios/settings`)

Total: **45**

- [ ] `packages/stage-ui/src/components/scenarios/settings/ModelCacheManager.vue`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/StageControlEditor.vue`
  - bindings: settings.pages.stage.description, settings.pages.stage.title, stores/settings/control-strip
- [ ] `packages/stage-ui/src/components/scenarios/settings/bar.vue`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/button-bar.vue`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/check-bar.vue`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/index.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/ModelCustomizer.vue`
  - bindings: stores/display-models, stores/modules/airi-card, stores/settings/control-strip, useAiriCardStore, useCustomVrmAnimationsStore, useDisplayModelsStore, useDslIntimacyStore, useModelStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/audio-studio.vue`
  - bindings: stores/audio, stores/modules/speech, stores/providers, stores/providers/types, useProvidersStore, useSpeechStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/components/ModelCustomizerSkeleton.vue`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/components/ModelPromptGeneratorModal.vue`
  - bindings: stores/llm, stores/modules/airi-card, stores/modules/consciousness, stores/providers, useAiriCardStore, useConsciousnessStore, useProvidersStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/components/ModelSceneSettings.vue`
  - bindings: settings.pages.models.sections.section.scene, settings.vrm.scale-and-position.camera-distance, settings.vrm.scale-and-position.fov, settings.vrm.scale-and-position.rotation-y, settings.vrm.scale-and-position.x, settings.vrm.scale-and-position.y, settings.vrm.scale-and-position.z
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/components/WardrobeMeshTreeNode.vue`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/HackerStudioShell.vue`
  - bindings: stores/modules/artistry, useArtistryStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/live2d/live2d-exporter.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/live2d/live2d-texture.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/live2d/use-live2d-hacker-adapter.ts`
  - bindings: stores/settings
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/spine/spine-exporter.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/spine/spine-texture.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/spine/use-spine-hacker-adapter.ts`
  - bindings: stores/settings
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/types.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/vrm/glb-exporter.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/adapters/vrm/use-vrm-hacker-adapter.ts`
  - bindings: stores/modules/airi-card, stores/settings, useAiriCardStore, useModelStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/composables/use-hacker-studio.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/domain/export-filename.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/domain/generation-guidance.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/domain/material-owners.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/domain/preview-gamma.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/domain/texture-identity.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/domain/upload-validation.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/use-hacker-studio-host.ts`
  - bindings: useModelStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/use-live2d-hacker-studio-host.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/hacker-studio/use-spine-hacker-studio-host.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/index.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/index.vue`
  - bindings: stores/display-models, stores/modules, stores/settings, stores/settings/positioning, useAiriCardStore, usePositioningStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-customization.vue`
  - bindings: stores/modules/airi-card, stores/settings, useAiriCardStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-lhack/LHackerPanel.vue`
  - bindings: stores/settings, useArtistryStore, useLHackStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`
  - bindings: settings.live2d.fps.description, settings.live2d.fps.options.unlimited, settings.live2d.fps.title, settings.live2d.scale-and-position.scale, settings.live2d.scale-and-position.x, settings.live2d.scale-and-position.y, settings.live2d.theme-color-from-model.button-extract.title, settings.stageModelSelected, stores/settings, stores/settings/positioning, usePositioningStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/mmd.vue`
  - bindings: settings.vrm.scale-and-position.follow-speed, settings.vrm.scale-and-position.mouse-tracking, settings.vrm.scale-and-position.mouse-tracking-desc, stores/mmd, stores/settings, stores/settings/positioning, usePositioningStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/model-lighting.browser.test.ts`
  - bindings: stores/mmd, useModelStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/spine.vue`
  - bindings: settings.spine.animation.mix-duration, settings.spine.animation.speed, settings.spine.fps.options.unlimited, settings.spine.rendering.max-fps, settings.spine.rendering.render-scale, settings.spine.scale-and-position.scale, settings.spine.scale-and-position.x, settings.spine.scale-and-position.y, settings.spine.theme-color-from-model.button-extract.title, stores/settings, stores/settings/positioning, stores/settings/spine
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-expressions.vue`
  - bindings: stores/modules/airi-card, stores/settings, useAiriCardStore, useModelStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-fps.browser.test.ts`
  - bindings: useModelStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-vhack/HackerPanel.vue`
  - bindings: stores/modules/artistry, stores/settings, stores/vhack, useArtistryStore, useModelStore, useVHackStore
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-vhack/index.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm.vue`
  - bindings: settings.vrm.fps.description, settings.vrm.fps.options.unlimited, settings.vrm.fps.title, settings.vrm.scale-and-position.follow-speed, settings.vrm.scale-and-position.mouse-tracking, settings.vrm.scale-and-position.mouse-tracking-desc, stores/settings/positioning, useModelStore, usePositioningStore

## Settings Stores (`packages/stage-ui/src/stores/settings`)

Total: **14**

- [ ] `packages/stage-ui/src/stores/settings/audio-device.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/captions.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/chat.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/control-strip.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/controls-island.ts`
  - bindings: stores/controls-island.ts.
- [ ] `packages/stage-ui/src/stores/settings/general.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/index.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/live2d.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/mmd.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/positioning.ts`
  - bindings: useDatingSimStore, usePositioningStore
- [ ] `packages/stage-ui/src/stores/settings/spine.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/stage-model.ts`
  - bindings: useDisplayModelsStore, usePositioningStore
- [ ] `packages/stage-ui/src/stores/settings/theme.ts`
  - bindings: (no store bindings parsed)
- [ ] `packages/stage-ui/src/stores/settings/user-profile.ts`
  - bindings: (no store bindings parsed)

## Renderer Settings Stores (`apps/stage-tamagotchi/src/renderer/stores`)

Total: **1**

- [ ] `apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts`
  - bindings: useServerChannelSettingsStore
