# Port Manifest — Pinia Stores

Generated from `packages/stage-ui/src/stores/**` and `apps/stage-tamagotchi/src/renderer/stores/**` (excluding `.test.ts`).

Total store/module files: **188** (stage-ui 172 + renderer 16)

## packages/stage-ui

## (root) (50)

- [ ] `packages/stage-ui/src/stores/agentic-intentions.ts`
- [ ] `packages/stage-ui/src/stores/agentic.ts`
- [ ] `packages/stage-ui/src/stores/animadex-wizard.ts`
- [ ] `packages/stage-ui/src/stores/audio.ts`
- [ ] `packages/stage-ui/src/stores/auth.ts`
- [ ] `packages/stage-ui/src/stores/background.ts`
- [ ] `packages/stage-ui/src/stores/backup.ts`
- [ ] `packages/stage-ui/src/stores/cadence-delivery.ts`
- [ ] `packages/stage-ui/src/stores/characters.ts`
- [ ] `packages/stage-ui/src/stores/chat.ts`
- [ ] `packages/stage-ui/src/stores/companion.ts`
- [ ] `packages/stage-ui/src/stores/configurator.ts`
- [ ] `packages/stage-ui/src/stores/custom-characters.ts`
- [ ] `packages/stage-ui/src/stores/dating-sim.ts`
- [ ] `packages/stage-ui/src/stores/display-models.ts`
- [ ] `packages/stage-ui/src/stores/echo-chips.ts`
- [ ] `packages/stage-ui/src/stores/embassy-inbox.ts`
- [ ] `packages/stage-ui/src/stores/entity-ledger.ts`
- [ ] `packages/stage-ui/src/stores/event-log.ts`
- [ ] `packages/stage-ui/src/stores/faculty-defaults.ts`
- [ ] `packages/stage-ui/src/stores/index.ts`
- [ ] `packages/stage-ui/src/stores/journal-preview.ts`
- [ ] `packages/stage-ui/src/stores/lhack.ts`
- [ ] `packages/stage-ui/src/stores/live2d.ts`
- [ ] `packages/stage-ui/src/stores/llm.ts`
- [ ] `packages/stage-ui/src/stores/markdown-stress.ts`
- [ ] `packages/stage-ui/src/stores/mcp-tool-bridge.ts`
- [ ] `packages/stage-ui/src/stores/mcp-web-config.ts`
- [ ] `packages/stage-ui/src/stores/mcp.ts`
- [ ] `packages/stage-ui/src/stores/memory-lifetime.ts`
- [ ] `packages/stage-ui/src/stores/memory-short-term.ts`
- [ ] `packages/stage-ui/src/stores/memory-text-journal.ts`
- [ ] `packages/stage-ui/src/stores/nap-chat-coordinator.ts`
- [ ] `packages/stage-ui/src/stores/nap-chat.ts`
- [ ] `packages/stage-ui/src/stores/onboarding.ts`
- [ ] `packages/stage-ui/src/stores/peers.ts`
- [ ] `packages/stage-ui/src/stores/perf-tracer-bridge.ts`
- [ ] `packages/stage-ui/src/stores/plugin-host-capabilities.ts`
- [ ] `packages/stage-ui/src/stores/presence.ts`
- [ ] `packages/stage-ui/src/stores/proactivity-telemetry.ts`
- [ ] `packages/stage-ui/src/stores/proactivity.ts`
- [ ] `packages/stage-ui/src/stores/provider-catalog.ts`
- [ ] `packages/stage-ui/src/stores/providers.ts`
- [ ] `packages/stage-ui/src/stores/speech-runtime.ts`
- [ ] `packages/stage-ui/src/stores/stage-widgets.ts`
- [ ] `packages/stage-ui/src/stores/startup-resources.ts`
- [ ] `packages/stage-ui/src/stores/stickers.ts`
- [ ] `packages/stage-ui/src/stores/sync-engine-merge.ts`
- [ ] `packages/stage-ui/src/stores/sync-engine.ts`
- [ ] `packages/stage-ui/src/stores/vhack.ts`
## ai (1)

- [ ] `packages/stage-ui/src/stores/ai/models/vad.ts`
## analytics (1)

- [ ] `packages/stage-ui/src/stores/analytics/index.ts`
## character (5)

- [ ] `packages/stage-ui/src/stores/character/index.ts`
- [ ] `packages/stage-ui/src/stores/character/notebook.ts`
- [ ] `packages/stage-ui/src/stores/character/orchestrator/agents/event-handler-spark-notify/index.ts`
- [ ] `packages/stage-ui/src/stores/character/orchestrator/index.ts`
- [ ] `packages/stage-ui/src/stores/character/orchestrator/store.ts`
## chat (26)

- [ ] `packages/stage-ui/src/stores/chat/compaction.ts`
- [ ] `packages/stage-ui/src/stores/chat/composer-draft-bridge.ts`
- [ ] `packages/stage-ui/src/stores/chat/constants.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-providers/datetime.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-providers/eternal-record.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-providers/expressions.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-providers/index.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-providers/scenes.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-providers/stickers.ts`
- [ ] `packages/stage-ui/src/stores/chat/context-store.ts`
- [ ] `packages/stage-ui/src/stores/chat/data-store.ts`
- [ ] `packages/stage-ui/src/stores/chat/error-formatter.ts`
- [ ] `packages/stage-ui/src/stores/chat/grounding-assembler.ts`
- [ ] `packages/stage-ui/src/stores/chat/hooks.ts`
- [ ] `packages/stage-ui/src/stores/chat/input-bridge.ts`
- [ ] `packages/stage-ui/src/stores/chat/intrusion-staging.ts`
- [ ] `packages/stage-ui/src/stores/chat/intrusions.ts`
- [ ] `packages/stage-ui/src/stores/chat/maintenance.ts`
- [ ] `packages/stage-ui/src/stores/chat/message-sanitizer.ts`
- [ ] `packages/stage-ui/src/stores/chat/recent-topics.ts`
- [ ] `packages/stage-ui/src/stores/chat/salience.ts`
- [ ] `packages/stage-ui/src/stores/chat/session-message-merge.ts`
- [ ] `packages/stage-ui/src/stores/chat/session-store.ts`
- [ ] `packages/stage-ui/src/stores/chat/state.ts`
- [ ] `packages/stage-ui/src/stores/chat/stream-store.ts`
- [ ] `packages/stage-ui/src/stores/chat/tool-bridge.ts`
## devtools (2)

- [ ] `packages/stage-ui/src/stores/devtools/plugin-host-debug.ts`
- [ ] `packages/stage-ui/src/stores/devtools/websocket-inspector.ts`
## mods (4)

- [ ] `packages/stage-ui/src/stores/mods/api/channel-gateway.ts`
- [ ] `packages/stage-ui/src/stores/mods/api/channel-server.ts`
- [ ] `packages/stage-ui/src/stores/mods/api/context-bridge.ts`
- [ ] `packages/stage-ui/src/stores/mods/api/events.ts`
## modules (31)

- [ ] `packages/stage-ui/src/stores/modules/airi-card.ts`
- [ ] `packages/stage-ui/src/stores/modules/arcade-knowledge.ts`
- [ ] `packages/stage-ui/src/stores/modules/artistry-autonomous.ts`
- [ ] `packages/stage-ui/src/stores/modules/artistry-template.ts`
- [ ] `packages/stage-ui/src/stores/modules/artistry.ts`
- [ ] `packages/stage-ui/src/stores/modules/cloudflare-auth.ts`
- [ ] `packages/stage-ui/src/stores/modules/cloudflare.ts`
- [ ] `packages/stage-ui/src/stores/modules/consciousness.ts`
- [ ] `packages/stage-ui/src/stores/modules/cors-proxy-worker-script.ts`
- [ ] `packages/stage-ui/src/stores/modules/discord-outbound.ts`
- [ ] `packages/stage-ui/src/stores/modules/discord.ts`
- [ ] `packages/stage-ui/src/stores/modules/gaming-factorio.ts`
- [ ] `packages/stage-ui/src/stores/modules/gaming-module-factory.ts`
- [ ] `packages/stage-ui/src/stores/modules/gemini-live-seams.ts`
- [ ] `packages/stage-ui/src/stores/modules/hearing-speech-input-pipeline.ts`
- [ ] `packages/stage-ui/src/stores/modules/hearing-store.ts`
- [ ] `packages/stage-ui/src/stores/modules/hearing.ts`
- [ ] `packages/stage-ui/src/stores/modules/index.ts`
- [ ] `packages/stage-ui/src/stores/modules/libp2p.ts`
- [ ] `packages/stage-ui/src/stores/modules/live-session.ts`
- [ ] `packages/stage-ui/src/stores/modules/nan0.ts`
- [ ] `packages/stage-ui/src/stores/modules/screen-watcher.ts`
- [ ] `packages/stage-ui/src/stores/modules/speech.ts`
- [ ] `packages/stage-ui/src/stores/modules/system-one.ts`
- [ ] `packages/stage-ui/src/stores/modules/text-to-motion.ts`
- [ ] `packages/stage-ui/src/stores/modules/tools/bash.ts`
- [ ] `packages/stage-ui/src/stores/modules/tools/motion.ts`
- [ ] `packages/stage-ui/src/stores/modules/tools/text-journal.ts`
- [ ] `packages/stage-ui/src/stores/modules/twitter.ts`
- [ ] `packages/stage-ui/src/stores/modules/vision.ts`
- [ ] `packages/stage-ui/src/stores/modules/vision/orchestrator.ts`
## providers (38)

- [ ] `packages/stage-ui/src/stores/providers/aliyun/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/stream-transcription.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/token.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/apple-core-ai/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/converters.ts`
- [ ] `packages/stage-ui/src/stores/providers/elevenlabs/list-models.ts`
- [ ] `packages/stage-ui/src/stores/providers/elevenlabs/native.ts`
- [ ] `packages/stage-ui/src/stores/providers/free-ai-catalog.ts`
- [ ] `packages/stage-ui/src/stores/providers/helpers.ts`
- [ ] `packages/stage-ui/src/stores/providers/kokoro-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/ming3-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/ming3-catalog.ts`
- [ ] `packages/stage-ui/src/stores/providers/moondream/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/moss-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/openai-compatible-builder.ts`
- [ ] `packages/stage-ui/src/stores/providers/pocket-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/chat-local.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/local-engines.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/metadata.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/speech.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/transcription.ts`
- [ ] `packages/stage-ui/src/stores/providers/runtime/instance-store.ts`
- [ ] `packages/stage-ui/src/stores/providers/runtime/instances.ts`
- [ ] `packages/stage-ui/src/stores/providers/runtime/lifecycle.ts`
- [ ] `packages/stage-ui/src/stores/providers/runtime/models.ts`
- [ ] `packages/stage-ui/src/stores/providers/runtime/validation.ts`
- [ ] `packages/stage-ui/src/stores/providers/selectors/availability.ts`
- [ ] `packages/stage-ui/src/stores/providers/selectors/config.ts`
- [ ] `packages/stage-ui/src/stores/providers/sse-audio-stream.ts`
- [ ] `packages/stage-ui/src/stores/providers/types.ts`
- [ ] `packages/stage-ui/src/stores/providers/voicevox/engine.ts`
- [ ] `packages/stage-ui/src/stores/providers/web-llm/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/web-rwkv/format.ts`
- [ ] `packages/stage-ui/src/stores/providers/web-rwkv/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/web-speech-api/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/whisper-local/index.ts`
## settings (14)

- [ ] `packages/stage-ui/src/stores/settings/audio-device.ts`
- [ ] `packages/stage-ui/src/stores/settings/captions.ts`
- [ ] `packages/stage-ui/src/stores/settings/chat.ts`
- [ ] `packages/stage-ui/src/stores/settings/control-strip.ts`
- [ ] `packages/stage-ui/src/stores/settings/controls-island.ts`
- [ ] `packages/stage-ui/src/stores/settings/general.ts`
- [ ] `packages/stage-ui/src/stores/settings/index.ts`
- [ ] `packages/stage-ui/src/stores/settings/live2d.ts`
- [ ] `packages/stage-ui/src/stores/settings/mmd.ts`
- [ ] `packages/stage-ui/src/stores/settings/positioning.ts`
- [ ] `packages/stage-ui/src/stores/settings/spine.ts`
- [ ] `packages/stage-ui/src/stores/settings/stage-model.ts`
- [ ] `packages/stage-ui/src/stores/settings/theme.ts`
- [ ] `packages/stage-ui/src/stores/settings/user-profile.ts`

## apps/stage-tamagotchi renderer

## (root) (6)

- [ ] `apps/stage-tamagotchi/src/renderer/stores/controls-island.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/dock-mode.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/resources.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/stage-three-runtime-diagnostics.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/window.ts`
## settings (1)

- [ ] `apps/stage-tamagotchi/src/renderer/stores/settings/server-channel.ts`
## tools (9)

- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/acp.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/dating-sim.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/generate-motion.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/image-journal.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/index.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/mcp.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/stickers.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/text-journal.ts`
- [ ] `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/widgets.ts`
