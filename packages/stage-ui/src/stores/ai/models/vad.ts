import type { MaybeRefOrGetter } from 'vue'

import { merge } from '@moeru/std'
import { ref, toRef, watch } from 'vue'

import { createVAD, createVADStates } from '../../../workers/vad'

interface UseVADOptions {
  threshold?: MaybeRefOrGetter<number>

  onSpeechStart?: () => void
  onSpeechEnd?: () => void
}

export function useVAD(workerUrl: string, options?: UseVADOptions) {
  const defaultOptions: UseVADOptions = {
    threshold: ref(0.6),
  }

  options = merge(defaultOptions, options)

  const vad = ref<Awaited<ReturnType<typeof createVAD>>>()
  const manager = ref<ReturnType<typeof createVADStates>>()
  const inferenceError = ref<string>()
  const maxIsSpeechHistory = 50

  const isSpeech = ref(false)
  const isSpeechProb = ref(0)
  const isSpeechHistory = ref<number[]>([])

  const loaded = ref(false)
  const loading = ref(false)
  let initialization: Promise<void> | undefined
  let generation = 0

  const threshold = toRef(options.threshold)

  async function init() {
    if (loaded.value)
      return

    if (initialization)
      return await initialization

    const currentGeneration = ++generation
    loading.value = true
    inferenceError.value = ''

    const currentInitialization = (async () => {
      const createdVad = await createVAD({
        sampleRate: 16000,
        speechThreshold: threshold.value,
        exitThreshold: (threshold.value ?? 0.6) * 0.3,
        minSilenceDurationMs: 400,
      })
      if (generation !== currentGeneration)
        return

      // Set up event handlers
      createdVad.on('speech-start', () => {
        isSpeech.value = true
        options?.onSpeechStart?.()
      })

      createdVad.on('speech-end', () => {
        isSpeech.value = false
        options?.onSpeechEnd?.()
      })

      createdVad.on('debug', ({ data }) => {
        if (data?.probability !== undefined) {
          isSpeechProb.value = data.probability

          // Update VAD history for visualization
          isSpeechHistory.value.push(data.probability)
          if (isSpeechHistory.value.length > maxIsSpeechHistory) {
            isSpeechHistory.value.shift()
          }
        }
      })

      createdVad.on('status', ({ type, message }) => {
        if (type === 'error') {
          inferenceError.value = message
        }
      })

      // Create and initialize audio manager
      const m = createVADStates(createdVad, workerUrl, {
        minChunkSize: 512,
        // NOTICE: VAD will have it's own audio context since
        // it needs special sample rate and latency settings
        audioContextOptions: {
          sampleRate: 16000,
          latencyHint: 'interactive',
        },
      })

      try {
        await m.initialize()
        if (generation !== currentGeneration) {
          m.dispose()
          return
        }

        vad.value = createdVad
        manager.value = m
        loaded.value = true
      }
      catch (error) {
        m.dispose()
        throw error
      }
    })()

    const settledInitialization = currentInitialization
      .catch((error) => {
        if (generation === currentGeneration)
          inferenceError.value = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        if (initialization === settledInitialization)
          initialization = undefined
        if (generation === currentGeneration)
          loading.value = false
      })

    initialization = settledInitialization
    await settledInitialization
  }

  async function start(stream: MediaStream) {
    const currentManager = manager.value
    const currentGeneration = generation
    if (!currentManager)
      return

    await currentManager.start(stream)
    if (generation !== currentGeneration || manager.value !== currentManager)
      currentManager.dispose()
  }

  function stop() {
    manager.value?.stop()
  }

  function dispose() {
    generation += 1
    initialization = undefined
    manager.value?.stop()
    manager.value?.dispose()
    manager.value = undefined
    vad.value = undefined

    isSpeech.value = false
    isSpeechProb.value = 0
    isSpeechHistory.value = []

    loaded.value = false
    loading.value = false
  }

  watch(threshold, (newVal) => {
    if (vad.value && newVal) {
      vad.value.updateConfig({ speechThreshold: newVal, exitThreshold: newVal * 0.3 })
    }
  })

  return {
    isSpeech,
    isSpeechProb,
    isSpeechHistory,
    loaded,
    loading,
    inferenceError,
    threshold,

    init,
    start,
    stop,
    dispose,
  }
}
