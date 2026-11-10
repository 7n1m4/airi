# Port Manifest — Speech / Hearing / Audio (TTS · STT · VAD)

Generated from `packages/stage-ui/src/stores/modules/**` (module stores) and `providers/<id>` (provider libs).

Pipeline shape: mic/system-audio capture → `hearing` store (`hearing-speech-input-pipeline`) → VAD (`vad` ai-model store) → STT (provider registry `transcription`) → chat LLM → TTS (provider registry `speech`) → `speech-runtime` playback queue → speaker.

Total entries: **25**

- [ ] `packages/stage-ui/src/stores/ai/models/vad.ts`
- [ ] `packages/stage-ui/src/stores/audio.ts`
- [ ] `packages/stage-ui/src/stores/modules/hearing-speech-input-pipeline.ts`
- [ ] `packages/stage-ui/src/stores/modules/hearing-store.ts`
- [ ] `packages/stage-ui/src/stores/modules/hearing.ts`
- [ ] `packages/stage-ui/src/stores/modules/speech.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/stream-transcription.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/token.ts`
- [ ] `packages/stage-ui/src/stores/providers/aliyun/utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/elevenlabs/list-models.ts`
- [ ] `packages/stage-ui/src/stores/providers/elevenlabs/native.ts`
- [ ] `packages/stage-ui/src/stores/providers/kokoro-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/ming3-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/moss-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/pocket-audio-utils.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/speech.ts`
- [ ] `packages/stage-ui/src/stores/providers/registry/transcription.ts`
- [ ] `packages/stage-ui/src/stores/providers/sse-audio-stream.ts`
- [ ] `packages/stage-ui/src/stores/providers/voicevox/engine.ts`
- [ ] `packages/stage-ui/src/stores/providers/web-llm/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/web-speech-api/index.ts`
- [ ] `packages/stage-ui/src/stores/providers/whisper-local/index.ts`
- [ ] `packages/stage-ui/src/stores/settings/audio-device.ts`
- [ ] `packages/stage-ui/src/stores/speech-runtime.ts`
