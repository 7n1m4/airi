import type { DisplayModel } from '../display-models'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset, useEventListener } from '@vueuse/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'

export type StageModelRenderer = 'live2d' | 'vrm' | 'spine' | 'mmd' | 'disabled' | undefined
export type GunslingerStance = 'off' | 'cat' | 'blk' | 'gray'

// HMR epoch (Strategy C): bumped by the single dispose ledger at the bottom of
// this module. Guards the selection watcher below against double model loads
// from a superseded generation. See docs/project-hmr-resilience-architecture.md.
let stageModelEpoch = 0

export const useSettingsStageModel = defineStore('settings-stage-model', () => {
  const displayModelsStore = useDisplayModelsStore()
  let stageModelUpdateQueue: Promise<void> = Promise.resolve()
  const stageModelStorageKey = 'settings/stage/model'
  const gunslingerStanceStorageKey = 'settings/stage/gunslinger-stance'

  const stageModelSelectedState = useLocalStorageManualReset<string>(stageModelStorageKey, 'preset-live2d-1')
  const stageModelSelected = computed<string>({
    get: () => stageModelSelectedState.value,
    set: (value) => {
      stageModelSelectedState.value = value
    },
  })
  const stageModelSelectedDisplayModel = refManualReset<DisplayModel | undefined>(undefined)
  const stageModelSelectedUrl = refManualReset<string | undefined>(undefined)
  const stageModelSelectedFile = refManualReset<File | undefined>(undefined)
  const stageModelRenderer = refManualReset<StageModelRenderer>(undefined)

  const gunslingerStanceState = useLocalStorageManualReset<GunslingerStance>(gunslingerStanceStorageKey, 'off')
  const gunslingerStance = computed<GunslingerStance>({
    get: () => gunslingerStanceState.value,
    set: (val) => {
      gunslingerStanceState.value = val
    },
  })

  function cycleGunslingerStance(): GunslingerStance {
    const sequence: GunslingerStance[] = ['off', 'cat', 'blk', 'gray']
    const nextIdx = (sequence.indexOf(gunslingerStanceState.value) + 1) % sequence.length
    const next = sequence[nextIdx]
    gunslingerStanceState.value = next
    return next
  }

  const stageViewControlsEnabled = useLocalStorageManualReset<boolean>('settings/stage/view-controls-enabled', true)
  const stageViewControlsMode = ref<'x' | 'y' | 'z' | 'scale'>('scale')
  const lastReloadReason = ref<string | undefined>(undefined)
  const mmdTextureMap = ref<Map<string, string | ImageBitmap>>(new Map())

  function isSameFile(f1?: Blob | File, f2?: Blob | File) {
    if (f1 === f2)
      return true
    if (!f1 || !f2)
      return false
    if (f1.size !== f2.size)
      return false
    if (f1.type !== f2.type)
      return false

    const name1 = (f1 as File).name
    const name2 = (f2 as File).name
    if (name1 && name2 && name1 !== name2)
      return false

    const mod1 = (f1 as File).lastModified
    const mod2 = (f2 as File).lastModified
    if (mod1 && mod2 && mod1 !== mod2)
      return false

    return true
  }

  function revokeStageModelUrl(url?: string) {
    if (url?.startsWith('blob:')) {
      // Graceful delayed revocation: allow in-flight GLTFLoader/texture decoders to complete cleanly
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        }
        catch {}
      }, 5000)
    }
  }

  function cleanupMmdTextures() {
    for (const value of mmdTextureMap.value.values()) {
      if (value instanceof ImageBitmap) {
        value.close()
      }
      else if (typeof value === 'string' && value.startsWith('blob:')) {
        URL.revokeObjectURL(value)
      }
    }
    mmdTextureMap.value.clear()
  }

  function replaceStageModelUrl(nextUrl?: string) {
    if (stageModelSelectedUrl.value === nextUrl)
      return

    revokeStageModelUrl(stageModelSelectedUrl.value)
    stageModelSelectedUrl.value = nextUrl
  }

  async function performUpdateStageModel() {
    const selectedModelId = stageModelSelectedState.value

    // NOTICE: Text-only companions resolve to `displayModelId === 'none'`.
    // Bail out here so booting or switching to them never emits a spurious
    // "Model not found (none)" toast from the lookup below.
    if (!selectedModelId || selectedModelId === 'none') {
      replaceStageModelUrl(undefined)
      cleanupMmdTextures()
      stageModelSelectedDisplayModel.value = undefined
      stageModelSelectedFile.value = undefined
      stageModelRenderer.value = 'disabled'
      return
    }

    try {
      const model = await displayModelsStore.getDisplayModel(selectedModelId)

      const isControlStrip = typeof window !== 'undefined' && (window as any).electron && (
        window.location.hash === '#/'
        || window.location.hash === ''
      )

      if (isControlStrip) {
        if (model) {
          switch (model.format) {
            case DisplayModelFormat.Live2dZip:
              stageModelRenderer.value = 'live2d'
              break
            case DisplayModelFormat.VRM:
              stageModelRenderer.value = 'vrm'
              break
            case DisplayModelFormat.SpineZip:
              stageModelRenderer.value = 'spine'
              break
            case DisplayModelFormat.PMXZip:
            case DisplayModelFormat.PMXDirectory:
            case DisplayModelFormat.PMD:
              stageModelRenderer.value = 'mmd'
              break
            default:
              stageModelRenderer.value = 'disabled'
              break
          }
          stageModelSelectedDisplayModel.value = model
        }
        else {
          stageModelSelectedDisplayModel.value = undefined
          stageModelRenderer.value = 'disabled'
        }
        return
      }

      console.info('[StageModel:performUpdateStageModel] Fetched model from displayModelsStore:', {
        selectedModelId,
        modelFound: !!model,
        modelType: model?.type,
        modelFormat: model?.format,
        file: (model as any)?.file,
        fileType: typeof (model as any)?.file,
        fileIsFile: (model as any)?.file instanceof File,
        fileIsBlob: (model as any)?.file instanceof Blob,
        fileHasArrayBuffer: typeof (model as any)?.file?.arrayBuffer === 'function',
        fileKeys: (model as any)?.file && typeof (model as any)?.file === 'object' ? Object.keys((model as any)?.file) : [],
      })

      if (!model) {
        console.warn(`[StageModel] Model with ID "${selectedModelId}" not found — absent from IndexedDB or unreadable.`)
        toast.error(`Model not found (${selectedModelId}). Preserving current stage model.`)
        return
      }

      if (model.type === 'file') {
        if (!model.file || typeof model.file.arrayBuffer !== 'function') {
          console.warn(`[StageModel] Model file is missing or is not a valid Blob/File instance for model ${model.id}:`, model.file)
          toast.error(`Failed to load model "${model.name || model.id}": file is missing or corrupt.`)
          return
        }

        // If we already have a URL for this exact model and file, don't re-create it.
        // Re-creating the URL triggers replaceStageModelUrl which revokes the active one.
        const isSameModel = stageModelSelectedDisplayModel.value?.id === model.id
        const isSameFileData = isSameFile(stageModelSelectedFile.value, model.file)
        if ((isSameModel || isSameFileData) && stageModelSelectedUrl.value?.startsWith('blob:')) {
          stageModelSelectedDisplayModel.value = model
          stageModelSelectedFile.value = model.file
          // Update renderer just in case
          switch (model.format) {
            case DisplayModelFormat.Live2dZip:
              stageModelRenderer.value = 'live2d'
              break
            case DisplayModelFormat.VRM:
              stageModelRenderer.value = 'vrm'
              break
            case DisplayModelFormat.SpineZip:
              stageModelRenderer.value = 'spine'
              break
            case DisplayModelFormat.PMXZip:
            case DisplayModelFormat.PMXDirectory:
            case DisplayModelFormat.PMD:
              stageModelRenderer.value = 'mmd'
              break
            default:
              stageModelRenderer.value = 'disabled'
              break
          }
          return
        }

        if (model.format === DisplayModelFormat.PMXZip || model.format === DisplayModelFormat.PMD) {
          try {
            const textureFiles = await displayModelsStore.getDisplayModelTextures(model.id)

            cleanupMmdTextures()

            const map = new Map<string, string | ImageBitmap>()
            await Promise.all(textureFiles.map(async (tex) => {
              const pathKey = tex.relativePath.toLowerCase()
              if (pathKey.endsWith('.tga')) {
                map.set(pathKey, URL.createObjectURL(tex.file))
                return
              }
              try {
                const bitmap = await createImageBitmap(tex.file)
                map.set(pathKey, bitmap)
              }
              catch (e) {
                console.warn(`[StageModel] Failed to pre-decode ${tex.relativePath}, falling back to Blob URL:`, e)
                map.set(pathKey, URL.createObjectURL(tex.file))
              }
            }))
            mmdTextureMap.value = map

            const nextUrl = `${URL.createObjectURL(model.file)}#${model.file.name}`
            replaceStageModelUrl(nextUrl)
            stageModelSelectedFile.value = model.file
          }
          catch (e) {
            console.error('[StageModel] Failed to load MMD textures:', e)
            const nextUrl = URL.createObjectURL(model.file)
            replaceStageModelUrl(nextUrl)
            stageModelSelectedFile.value = model.file
          }
        }
        else {
          const nextUrl = URL.createObjectURL(model.file)
          replaceStageModelUrl(nextUrl)
          stageModelSelectedFile.value = model.file
        }
      }
      else if (model.type === 'url') {
        // For URL types, we only update if it actually changed
        if (stageModelSelectedUrl.value !== model.url) {
          replaceStageModelUrl(model.url)
        }
        stageModelSelectedFile.value = undefined
      }

      switch (model.format) {
        case DisplayModelFormat.Live2dZip:
          stageModelRenderer.value = 'live2d'
          break
        case DisplayModelFormat.VRM:
          stageModelRenderer.value = 'vrm'
          break
        case DisplayModelFormat.SpineZip:
          stageModelRenderer.value = 'spine'
          break
        case DisplayModelFormat.PMXZip:
        case DisplayModelFormat.PMXDirectory:
        case DisplayModelFormat.PMD:
          stageModelRenderer.value = 'mmd'
          break
        default:
          stageModelRenderer.value = 'disabled'
          break
      }

      stageModelSelectedDisplayModel.value = model
    }
    catch (error) {
      console.error('[StageModel] Failed to update stage model:', error)
      toast.error(`Failed to load stage model. Preserving current model.`)
    }
  }

  async function updateStageModel(reason?: string): Promise<void> {
    if (reason)
      lastReloadReason.value = reason

    const task = stageModelUpdateQueue.then(async () => {
      await performUpdateStageModel()
    }).catch((err) => {
      console.error('[StageModel] Queue error:', err)
    })

    stageModelUpdateQueue = task
    return task
  }

  async function initializeStageModel(reason?: string) {
    await updateStageModel(reason || 'initialization')
  }

  useEventListener('unload', () => {
    revokeStageModelUrl(stageModelSelectedUrl.value)
    cleanupMmdTextures()
  })

  // Epoch-guarded: a superseded generation's watcher must not fire heavy
  // model reloads (IndexedDB fetch + blob URL churn) after HMR re-evaluation.
  const setupEpoch = stageModelEpoch
  watch(stageModelSelectedState, (_newValue, _oldValue) => {
    if (setupEpoch !== stageModelEpoch)
      return
    void updateStageModel('manual selection')
  })

  async function resetState() {
    revokeStageModelUrl(stageModelSelectedUrl.value)

    stageModelSelectedState.reset()
    stageModelSelectedDisplayModel.reset()
    stageModelSelectedUrl.reset()
    stageModelSelectedFile.reset()
    stageModelRenderer.reset()
    stageViewControlsEnabled.reset()
    stageViewControlsMode.value = 'scale'
    cleanupMmdTextures()

    await updateStageModel('reset state')
  }

  return {
    stageModelRenderer,
    stageModelSelected,
    stageModelSelectedUrl,
    stageModelSelectedFile,
    stageModelSelectedDisplayModel,
    stageViewControlsEnabled,
    stageViewControlsMode,
    gunslingerStance,
    cycleGunslingerStance,
    lastReloadReason,
    mmdTextureMap,

    initializeStageModel,
    updateStageModel,
    resetState,
  }
})

// NOT a Phase-0B-pure store despite the briefing: this module owns Blob URLs and
// ImageBitmaps, so a bare accept would duplicate native resources per reload.
// Accept + single dispose ledger (Strategy E) + epoch guard (Strategy C) instead
// — the 0C-lite the source requires. Blob/ImageBitmap refs transfer via Pinia
// state patching; the unload listener is idempotent. No-op in production
// (import.meta.hot is undefined).
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStageModel, import.meta.hot))

  import.meta.hot.dispose(() => {
    stageModelEpoch++
  })
}
