import type { SpeechPipelineRuntime } from '../services/speech/pipeline-runtime'

import { defineStore } from 'pinia'

import { createSpeechPipelineRuntime } from '../services/speech/pipeline-runtime'

// Strategy A (version-guarded singleton): the speech bus context
// (`services/speech/bus.ts`) is a module singleton shared across HMR
// generations, so constructing a fresh runtime per re-evaluation would
// double-register all six intent listeners and fork playback/pipelines.
// Reusing the live runtime keeps one listener set, one originId, and the
// active host pipeline. See docs/project-hmr-resilience-architecture.md.
const SPEECH_RUNTIME_ABI = 1

interface SpeechRuntimeHotData {
  abi?: number
  runtime?: SpeechPipelineRuntime
  hostPipeline?: Parameters<SpeechPipelineRuntime['registerHost']>[0]
}

function getHotData(): SpeechRuntimeHotData | undefined {
  if (!import.meta.hot)
    return undefined
  const data = import.meta.hot.data as { speechRuntime?: SpeechRuntimeHotData }
  data.speechRuntime ??= {}
  return data.speechRuntime
}

export const useSpeechRuntimeStore = defineStore('speech-runtime', () => {
  const hotData = getHotData()

  let runtime: SpeechPipelineRuntime
  if (hotData && hotData.abi === SPEECH_RUNTIME_ABI && hotData.runtime) {
    // Successor generation: adopt the live runtime (listeners, host, intents intact).
    runtime = hotData.runtime
  }
  else {
    runtime = createSpeechPipelineRuntime()
    if (hotData) {
      hotData.runtime = runtime
      hotData.abi = SPEECH_RUNTIME_ABI
      // Adopt a pipeline preserved by the previous generation (e.g. after an
      // ABI bump dropped the runtime while the host component stayed mounted).
      const preserved = hotData.hostPipeline
      if (preserved)
        void runtime.registerHost(preserved)
    }
  }

  function openIntent(options?: Parameters<typeof runtime.openIntent>[0]) {
    return runtime.openIntent(options)
  }

  async function registerHost(pipeline: Parameters<typeof runtime.registerHost>[0]) {
    await runtime.registerHost(pipeline)
    if (hotData)
      hotData.hostPipeline = pipeline
  }

  async function unregisterHost(pipeline?: Parameters<typeof runtime.unregisterHost>[0]) {
    await runtime.unregisterHost(pipeline)
    // Mirror the runtime's identity guard: only clear the stash when the
    // unregistered pipeline is the stashed one (or no identity given).
    if (hotData && (!pipeline || hotData.hostPipeline === pipeline))
      hotData.hostPipeline = undefined
  }

  function isHost() {
    return runtime.isHost()
  }

  async function dispose() {
    await runtime.dispose()
  }

  // Strategy E (single teardown ledger — exactly ONE dispose per module):
  // cancel in-flight remote intents so a torn-down generation cannot keep
  // speaking. The runtime object + host pipeline intentionally stay in
  // hot.data for successor reuse; local intents stay owned by chat/pacing.
  // No-op in production/test (import.meta.hot is undefined).
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      try {
        runtime.cancelAllIntents('hmr-module-teardown')
      }
      catch (err) {
        console.warn('[SpeechRuntime:HMR] Cancel during HMR dispose failed:', err)
      }
    })
  }

  return {
    openIntent,
    registerHost,
    unregisterHost,
    isHost,
    dispose,
  }
})
