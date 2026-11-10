# Port Manifest — eventa / IPC Channels

Generated from `apps/stage-tamagotchi/src/shared/eventa.ts`.

Exported eventa constants: **108**; unique channel string literals containing `:`: **95**

Raw channel literals:

- [ ] `

export interface ElectronAcpAgentConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
  permissionPolicy?: ElectronAcpPermissionPolicy
}

export interface ElectronAcpConfigFile {
  agents: Record<string, ElectronAcpAgentConfig>
}

export interface ElectronAcpRuntimeStatus {
  path: string
  agents: Array<{
    name: string
    state: `
- [ ] `
    command: string
    args: string[]
    pid: number | null
    lastError?: string
  }>
  updatedAt: number
}

export interface ElectronAcpSessionStatus {
  id: string
  agentName: string
  acpSessionId: string
  cwd: string
}

export interface ElectronAcpApplyResult {
  path: string
  started: Array<{ name: string }>
  failed: Array<{ name: string, error: string }>
  skipped: Array<{ name: string, reason: string }>
}

export const electronAcpOpenConfigFile = defineInvokeEventa<{ path: string }>(`
- [ ] `)

export interface ElectronAcpSessionUpdatePayload {
  sessionId: string
  update: Record<string, unknown>
}

export interface ElectronAcpPermissionRequestPayload {
  requestId: string
  sessionId: string
  toolCall: Record<string, unknown>
  options: Array<{ optionId: string, name?: string, kind?: string }>
}

export const electronAcpSessionUpdate = defineEventa<ElectronAcpSessionUpdatePayload>(`
- [ ] `)
export const electronAcpCancel = defineInvokeEventa<void, { sessionId: string }>(`
- [ ] `)
export const electronAcpCloseSession = defineInvokeEventa<void, { sessionId: string }>(`
- [ ] `)
export const electronAcpCreateSession = defineInvokeEventa<ElectronAcpSessionStatus, { agentName: string, cwd?: string }>(`
- [ ] `)
export const electronAcpPrompt = defineInvokeEventa<{ stopReason: string, finalText: string }, { sessionId: string, text: string }>(`
- [ ] `)
export const electronAcpRespondPermission = defineInvokeEventa<void, { requestId: string, outcome: `
- [ ] `)
export const widgetsRemoveEvent = defineEventa<{ id: string }>(`
- [ ] `)
export const widgetsUpdateEvent = defineEventa<{ id: string, componentProps?: Record<string, any> }>(`
- [ ] `eventa:event:electron:show-toast`
- [ ] `eventa:event:electron:splash:state-changed`
- [ ] `eventa:event:electron:windows:caption-overlay:follow-stage-position-changed`
- [ ] `eventa:event:electron:windows:caption-overlay:follow-stage-visibility-changed`
- [ ] `eventa:event:electron:windows:lifecycle:changed`
- [ ] `eventa:event:electron:windows:main:config-changed`
- [ ] `eventa:event:electron:windows:settings:navigate`
- [ ] `eventa:event:stage-three-runtime-trace:forwarded`
- [ ] `eventa:event:stage-three-runtime-trace:remote-disable`
- [ ] `eventa:event:stage-three-runtime-trace:remote-enable`
- [ ] `eventa:invoke:electron:app:quit`
- [ ] `eventa:invoke:electron:beat-sync:ensure`
- [ ] `eventa:invoke:electron:dialog:select-directories`
- [ ] `eventa:invoke:electron:mcp:apply-and-restart`
- [ ] `eventa:invoke:electron:mcp:call-tool`
- [ ] `eventa:invoke:electron:mcp:get-config`
- [ ] `eventa:invoke:electron:mcp:get-runtime-status`
- [ ] `eventa:invoke:electron:mcp:list-tools`
- [ ] `eventa:invoke:electron:mcp:open-config-file`
- [ ] `eventa:invoke:electron:mcp:update-config`
- [ ] `eventa:invoke:electron:plugins:capability:update`
- [ ] `eventa:invoke:electron:plugins:inspect`
- [ ] `eventa:invoke:electron:plugins:list`
- [ ] `eventa:invoke:electron:plugins:load`
- [ ] `eventa:invoke:electron:plugins:load-enabled`
- [ ] `eventa:invoke:electron:plugins:set-enabled`
- [ ] `eventa:invoke:electron:plugins:unload`
- [ ] `eventa:invoke:electron:server-channel:apply-config`
- [ ] `eventa:invoke:electron:server-channel:get-config`
- [ ] `eventa:invoke:electron:show-toast`
- [ ] `eventa:invoke:electron:splash:dismiss`
- [ ] `eventa:invoke:electron:splash:get-snapshot`
- [ ] `eventa:invoke:electron:splash:report-milestone`
- [ ] `eventa:invoke:electron:stage-mate:ensure-model`
- [ ] `eventa:invoke:electron:stage-mate:get-state`
- [ ] `eventa:invoke:electron:stage-mate:save-model`
- [ ] `eventa:invoke:electron:stage-mate:set-viewport-mode`
- [ ] `eventa:invoke:electron:stage-mate:sync-outfits`
- [ ] `eventa:invoke:electron:stage-mate:toggle-visibility`
- [ ] `eventa:invoke:electron:stage:ensure`
- [ ] `eventa:invoke:electron:stage:release`
- [ ] `eventa:invoke:electron:start-dragging-window`
- [ ] `eventa:invoke:electron:window:close`
- [ ] `eventa:invoke:electron:window:hide`
- [ ] `eventa:invoke:electron:window:set-always-on-top`
- [ ] `eventa:invoke:electron:window:set-ignore-mouse-events`
- [ ] `eventa:invoke:electron:windows:apply-size-preset`
- [ ] `eventa:invoke:electron:windows:caption-overlay:get-follow-stage-position`
- [ ] `eventa:invoke:electron:windows:caption-overlay:get-follow-stage-visibility`
- [ ] `eventa:invoke:electron:windows:caption:get-state`
- [ ] `eventa:invoke:electron:windows:caption:set-follow-stage-position`
- [ ] `eventa:invoke:electron:windows:caption:set-follow-stage-visibility`
- [ ] `eventa:invoke:electron:windows:caption:sync-docking`
- [ ] `eventa:invoke:electron:windows:caption:toggle-visibility`
- [ ] `eventa:invoke:electron:windows:chat:get-state`
- [ ] `eventa:invoke:electron:windows:chat:open`
- [ ] `eventa:invoke:electron:windows:control-strip:sync-state`
- [ ] `eventa:invoke:electron:windows:customizer:get-state`
- [ ] `eventa:invoke:electron:windows:customizer:toggle-visibility`
- [ ] `eventa:invoke:electron:windows:devtools:open`
- [ ] `eventa:invoke:electron:windows:get-monitor-count`
- [ ] `eventa:invoke:electron:windows:lifecycle:get`
- [ ] `eventa:invoke:electron:windows:main:devtools:open`
- [ ] `eventa:invoke:electron:windows:main:get-config`
- [ ] `eventa:invoke:electron:windows:reset-positions`
- [ ] `eventa:invoke:electron:windows:settings:devtools:open`
- [ ] `eventa:invoke:electron:windows:settings:open`
- [ ] `eventa:invoke:electron:windows:stage:get-disabled`
- [ ] `eventa:invoke:electron:windows:stage:set-always-on-top`
- [ ] `eventa:invoke:electron:windows:stage:toggle-visibility`
- [ ] `eventa:invoke:electron:windows:widgets:add`
- [ ] `eventa:invoke:electron:windows:widgets:clear`
- [ ] `eventa:invoke:electron:windows:widgets:fetch`
- [ ] `eventa:invoke:electron:windows:widgets:hide`
- [ ] `eventa:invoke:electron:windows:widgets:open`
- [ ] `eventa:invoke:electron:windows:widgets:prepare`
- [ ] `eventa:invoke:electron:windows:widgets:remove`
- [ ] `eventa:invoke:electron:windows:widgets:resize`
- [ ] `eventa:invoke:electron:windows:widgets:update`
- [ ] `invoke:action`
- [ ] `invoke:open`
- [ ] `invoke:page-mounted`
- [ ] `invoke:page-unmounted`
- [ ] `proj-airi:plugin-sdk:apis:protocol:resources:providers:list-providers`
- [ ] `s canonical `document.title` (single source of truth) up to
// the main process so the native window chrome stays in sync as routes change.
export const electronWindowSetTitle = defineInvokeEventa<void, { title: string }>(`

Exported constants grouped by domain:

## window/settings/caption/chat/customizer/splash/onboarding/about/notice/widgets/devtools/dashboard/inlay

- [ ] `captionFollowStagePositionChanged`
- [ ] `captionFollowStageVisibilityChanged`
- [ ] `captionGetFollowStagePosition`
- [ ] `captionGetFollowStageVisibility`
- [ ] `electronCaptionSetFollowStagePosition`
- [ ] `electronCaptionSetFollowStageVisibility`
- [ ] `electronCaptionSyncDocking`
- [ ] `electronCaptionToggleVisibility`
- [ ] `electronCustomizerToggleVisibility`
- [ ] `electronGetCaptionWindowState`
- [ ] `electronGetChatWindowState`
- [ ] `electronGetCustomizerWindowState`
- [ ] `electronGetMainWindowConfig`
- [ ] `electronGetStageDisabled`
- [ ] `electronGetWindowLifecycleState`
- [ ] `electronMainWindowConfigChanged`
- [ ] `electronOnboardingClose`
- [ ] `electronOnboardingCompleted`
- [ ] `electronOnboardingSkipped`
- [ ] `electronOpenChat`
- [ ] `electronOpenDevtoolsWindow`
- [ ] `electronOpenMainDevtools`
- [ ] `electronOpenOnboarding`
- [ ] `electronOpenSettings`
- [ ] `electronOpenSettingsDevtools`
- [ ] `electronResetWindowPositions`
- [ ] `electronSettingsNavigate`
- [ ] `electronSplashDismiss`
- [ ] `electronSplashGetSnapshot`
- [ ] `electronSplashReportMilestone`
- [ ] `electronSplashStateChanged`
- [ ] `electronStageEnsure`
- [ ] `electronStageMateEnsureModel`
- [ ] `electronStageMateGetState`
- [ ] `electronStageMateSaveModel`
- [ ] `electronStageMateSetViewportMode`
- [ ] `electronStageMateSyncOutfits`
- [ ] `electronStageMateToggleVisibility`
- [ ] `electronStageRelease`
- [ ] `electronStageSetAlwaysOnTop`
- [ ] `electronStageToggleVisibility`
- [ ] `electronStartDraggingWindow`
- [ ] `electronWindowClose`
- [ ] `electronWindowHide`
- [ ] `electronWindowLifecycleChanged`
- [ ] `electronWindowSetAlwaysOnTop`
- [ ] `electronWindowSetTitle`
- [ ] `stageThreeRuntimeTraceForwardedEvent`
- [ ] `stageThreeRuntimeTraceRemoteDisableEvent`
- [ ] `stageThreeRuntimeTraceRemoteEnableEvent`
- [ ] `widgetsAdd`
- [ ] `widgetsClear`
- [ ] `widgetsClearEvent`
- [ ] `widgetsFetch`
- [ ] `widgetsHideWindow`
- [ ] `widgetsOpenWindow`
- [ ] `widgetsPrepareWindow`
- [ ] `widgetsRemove`
- [ ] `widgetsRemoveEvent`
- [ ] `widgetsRenderEvent`
- [ ] `widgetsResizeWindow`
- [ ] `widgetsUpdate`
- [ ] `widgetsUpdateEvent`
## plugin

- [ ] `electronPluginInspect`
- [ ] `electronPluginList`
- [ ] `electronPluginLoad`
- [ ] `electronPluginLoadEnabled`
- [ ] `electronPluginSetEnabled`
- [ ] `electronPluginUnload`
- [ ] `electronPluginUpdateCapability`
- [ ] `pluginProtocolListProviders`
## beat-sync

- [ ] `electronEnsureBeatSync`
## updater

- [ ] `electronAcpSessionUpdate`
- [ ] `electronAcpUpdateConfig`
- [ ] `electronMcpUpdateConfig`
## dialog / file

- [ ] `electronAcpOpenConfigFile`
- [ ] `electronMcpOpenConfigFile`
## acp / agent

- [ ] `electronAcpApplyAndRestart`
- [ ] `electronAcpCancel`
- [ ] `electronAcpCloseSession`
- [ ] `electronAcpCreateSession`
- [ ] `electronAcpGetConfig`
- [ ] `electronAcpGetRuntimeStatus`
- [ ] `electronAcpListSessions`
- [ ] `electronAcpPermissionRequest`
- [ ] `electronAcpPrompt`
- [ ] `electronAcpRespondPermission`
## sync / auth

- [ ] `electronControlStripSyncState`
## mcp

- [ ] `electronMcpApplyAndRestart`
- [ ] `electronMcpCallTool`
- [ ] `electronMcpGetConfig`
- [ ] `electronMcpGetRuntimeStatus`
- [ ] `electronMcpListTools`
## other

- [ ] `electronAppIconGet`
- [ ] `electronAppIconSet`
- [ ] `electronAppQuit`
- [ ] `electronApplyServerChannelConfig`
- [ ] `electronApplySizePreset`
- [ ] `electronGetCorsBypassUrls`
- [ ] `electronGetMonitorCount`
- [ ] `electronGetServerChannelConfig`
- [ ] `electronSelectDirectories`
- [ ] `electronSetCorsBypassUrls`
- [ ] `electronSetIgnoreMouseEvents`
- [ ] `electronShowToast`
- [ ] `electronShowToastEvent`
- [ ] `i18nGetLocale`
- [ ] `i18nSetLocale`
