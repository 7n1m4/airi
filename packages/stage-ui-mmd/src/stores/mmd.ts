import type { Emotion } from '../constants/emotions'
import type { MorphSlot } from '../constants/morphs'

import localforage from 'localforage'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { EMOTION_ACTION_NAME } from '../constants/actions'
import { useMMDViewControl } from './view-control'

export interface MMDMotionDescriptor {
  id: string
  name: string
}

interface PersistedMMDMotion {
  id: string
  name: string
  file: File
}

export type MMDGazeMode = 'camera' | 'mouse' | 'none'

export interface MMDOneShotAction {
  name: string
  loop: boolean
  nonce: number
}

type BroadcastChannelEvents
  = | { type: 'mmd-should-update-view' }
    | { type: 'mmd-play-one-shot', request: MMDOneShotAction }
    | { type: 'mmd-preview-expression', value: string | null }
    | { type: 'mmd-current-motion', value: string }

const MOTION_STORAGE_PREFIX = 'mmd-motion-'

export const useMmd = defineStore('mmd', () => {
  const { post, data } = useBroadcastChannel<BroadcastChannelEvents, BroadcastChannelEvents>({
    name: 'airi-stores-stage-ui-mmd',
  })
  const shouldUpdateViewHooks = ref(new Set<() => void>())
  const oneShotAction = ref<MMDOneShotAction>()

  const { position, rotationY, reset: resetViewControl } = useMMDViewControl()

  const onShouldUpdateView = (hook: () => void) => {
    shouldUpdateViewHooks.value.add(hook)
    return () => {
      shouldUpdateViewHooks.value.delete(hook)
    }
  }

  function shouldUpdateView() {
    post({ type: 'mmd-should-update-view' })
    shouldUpdateViewHooks.value.forEach(hook => hook())
  }

  const currentMotion = ref<string>('swaying_arms_and_hips.vmd')
  const previewExpression = ref<string | null>(null)

  watch(previewExpression, (val) => {
    post({ type: 'mmd-preview-expression', value: val })
  })

  watch(currentMotion, (val) => {
    post({ type: 'mmd-current-motion', value: val })
  })

  watch(data, (event) => {
    if (event?.type === 'mmd-should-update-view') {
      shouldUpdateViewHooks.value.forEach(hook => hook())
    }
    else if (event?.type === 'mmd-play-one-shot') {
      oneShotAction.value = event.request
    }
    else if (event?.type === 'mmd-preview-expression') {
      if (previewExpression.value !== event.value)
        previewExpression.value = event.value
    }
    else if (event?.type === 'mmd-current-motion') {
      if (currentMotion.value !== event.value)
        currentMotion.value = event.value
    }
  })

  function playOneShotAction(name: string, loop = false) {
    const request: MMDOneShotAction = { name, loop, nonce: (oneShotAction.value?.nonce ?? 0) + 1 }
    oneShotAction.value = request
    post({ type: 'mmd-play-one-shot', request })
  }

  // Physics, solver and gaze toggles
  const physicsEnabled = useLocalStorageManualReset<boolean>('settings/mmd/physics-enabled', true)
  const ikEnabled = useLocalStorageManualReset<boolean>('settings/mmd/ik-enabled', true)
  const grantEnabled = useLocalStorageManualReset<boolean>('settings/mmd/grant-enabled', true)
  const physicsGravity = useLocalStorageManualReset<number>('settings/mmd/physics-gravity', 98)
  const gazeMode = useLocalStorageManualReset<MMDGazeMode>('settings/mmd/gaze-mode', 'mouse')

  // Custom Motions IndexedDB Storage
  const customMotions = useLocalStorageManualReset<MMDMotionDescriptor[]>('settings/mmd/custom-motions', () => [])

  const deletedMotions = useLocalStorageManualReset<string[]>('settings/mmd/deleted-motions', () => [])

  async function addMotion(file: File): Promise<MMDMotionDescriptor> {
    const name = file.name.replace(/\.vmd$/i, '')
    const existing = customMotions.value.find(motion => motion.name === name)
    const id = existing?.id ?? `${MOTION_STORAGE_PREFIX}${crypto.randomUUID()}`

    await localforage.setItem<PersistedMMDMotion>(id, { id, name, file })
    if (!existing)
      customMotions.value = [...customMotions.value, { id, name }]

    // Clear from deleted motions if re-added
    deletedMotions.value = deletedMotions.value.filter(d => d !== id)

    return { id, name }
  }

  async function getMotionFile(id: string): Promise<File | undefined> {
    const persisted = await localforage.getItem<PersistedMMDMotion>(id)
    return persisted?.file
  }

  async function clearMotions(): Promise<void> {
    const motions = customMotions.value
    customMotions.value = []
    for (const motion of motions) {
      await localforage.removeItem(motion.id)
      if (!deletedMotions.value.includes(motion.id)) {
        deletedMotions.value = [...deletedMotions.value, motion.id]
      }
    }
  }

  async function removeMotion(id: string): Promise<void> {
    const motion = customMotions.value.find(m => m.id === id)
    customMotions.value = customMotions.value.filter(m => m.id !== id)
    if (motion && currentMotion.value === motion.name)
      currentMotion.value = ''
    await localforage.removeItem(id)
    if (!deletedMotions.value.includes(id)) {
      deletedMotions.value = [...deletedMotions.value, id]
    }
  }

  const availableMorphs = ref<string[]>([])
  const morphMappings = ref<Record<string, string>>({})
  const hiddenMorphs = ref<string[]>([])

  const idleMotionName = computed({
    get: () => currentMotion.value,
    set: (val) => { currentMotion.value = val },
  })

  const isModelLoaded = ref(false)

  const morphOverrides = useLocalStorageManualReset<Partial<Record<MorphSlot, string>>>('settings/mmd/morph-overrides', () => ({}))
  const emotionActionMap = useLocalStorageManualReset<Record<Emotion, string>>(
    'settings/mmd/emotion-action-map',
    () => ({ ...EMOTION_ACTION_NAME }),
  )
  const availableMaterials = useLocalStorageManualReset<{ name: string, label: string, index: number }[]>(
    'settings/mmd/available-materials',
    () => [],
  )
  const materialOpacity = useLocalStorageManualReset<Record<string, number>>('settings/mmd/material-opacity', () => ({}))

  const albedoGlow = useLocalStorageManualReset<number>('settings/mmd/albedo-glow', 0.45)
  const renderScale = useLocalStorageManualReset<number>('settings/mmd/render-scale', 1)

  // Camera and Light aliases/computed proxies for nyueki UI compatibility:
  const cameraFov = computed({
    get: () => cameraFOV.value,
    set: (v) => { cameraFOV.value = v },
  })

  const ambientColor = computed({
    get: () => ambientLightColor.value,
    set: (v) => { ambientLightColor.value = v },
  })
  const ambientIntensity = computed({
    get: () => ambientLightIntensity.value,
    set: (v) => { ambientLightIntensity.value = v },
  })

  const directionalColor = computed({
    get: () => directionalLightColor.value,
    set: (v) => { directionalLightColor.value = v },
  })
  const directionalIntensity = computed({
    get: () => directionalLightIntensity.value,
    set: (v) => { directionalLightIntensity.value = v },
  })
  const directionalPosition = computed({
    get: () => directionalLightPosition.value,
    set: (v) => { directionalLightPosition.value = v },
  })

  const availableMotions = ref<string[]>([
    'brushoff_nice_and_tidy.vmd',
    'circulation.vmd',
    'crossed_arms_look_around_confident.vmd',
    'fixing_hair_or_wig.vmd',
    'getting_item_out_of_bra.vmd',
    'hat_flip.vmd',
    'impatient_foot_tapping.vmd',
    'shy.vmd',
    'skittish_mermay.vmd',
    'smelling_something_in_the_air.vmd',
    'something_in_the_sky.vmd',
    'stretching.vmd',
    'swaying_arms_and_hips.vmd',
    'tracker.vmd',
  ])

  // Placement, Camera & Lighting configurations
  const scale = useLocalStorageManualReset<number>('settings/mmd/scale', 1)
  const modelOffset = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/modelOffset', { x: 0, y: 0, z: 0 })
  const modelRotationY = useLocalStorageManualReset<number>('settings/mmd/modelRotationY', 0)
  const modelSize = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/modelSize', { x: 0, y: 0, z: 0 })
  const modelOrigin = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/modelOrigin', { x: 0, y: 0, z: 0 })

  const cameraFOV = useLocalStorageManualReset<number>('settings/mmd/cameraFOV', 40)
  const cameraPosition = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/camera-position', { x: 0, y: 0, z: -1 })
  const cameraDistance = useLocalStorageManualReset<number>('settings/mmd/cameraDistance', 0)
  const trackingMode = useLocalStorageManualReset<'camera' | 'mouse' | 'none'>('settings/mmd/trackingMode', 'none')
  const followSpeed = useLocalStorageManualReset<number>('settings/mmd/followSpeed', 0.1)
  const eyeHeight = useLocalStorageManualReset<number>('settings/mmd/eyeHeight', 0)
  const lookAtTarget = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/lookAtTarget', { x: 0, y: 0, z: 0 })

  const directionalLightPosition = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/scenes/scene/directional-light/position', { x: 0, y: 1, z: 3 })
  const directionalLightTarget = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/scenes/scene/directional-light/target', { x: 0, y: 1, z: 0 })
  const directionalLightRotation = useLocalStorageManualReset<{ x: number, y: number, z: number }>('settings/mmd/scenes/scene/directional-light/rotation', { x: -34, y: 0, z: 0 })
  const directionalLightIntensity = useLocalStorageManualReset<number>('settings/mmd/scenes/scene/directional-light/intensity', 9.06)
  const directionalLightColor = useLocalStorageManualReset<string>('settings/mmd/scenes/scene/directional-light/color', '#4a3413')

  const hemisphereSkyColor = useLocalStorageManualReset<string>('settings/mmd/scenes/scene/hemisphere-light/sky-color', '#FFFFFF')
  const hemisphereGroundColor = useLocalStorageManualReset<string>('settings/mmd/scenes/scene/hemisphere-light/ground-color', '#222222')
  const hemisphereLightIntensity = useLocalStorageManualReset<number>('settings/mmd/scenes/scene/hemisphere-light/intensity', 1.55)

  const ambientLightColor = useLocalStorageManualReset<string>('settings/mmd/scenes/scene/ambient-light/color', '#FFFFFF')
  const ambientLightIntensity = useLocalStorageManualReset<number>('settings/mmd/scenes/scene/ambient-light/intensity', 1.32)

  const envSelect = useLocalStorageManualReset<'hemisphere' | 'skyBox'>('settings/mmd/envEnabled', 'hemisphere')
  const skyBoxIntensity = useLocalStorageManualReset<number>('settings/mmd/skyBoxIntensity', 0.1)

  function resetState() {
    availableMorphs.value = []
    morphMappings.value = {}
    hiddenMorphs.value = []
    scale.reset()
    modelOffset.reset()
    modelRotationY.reset()
    modelSize.reset()
    modelOrigin.reset()
    cameraFOV.reset()
    cameraPosition.reset()
    cameraDistance.reset()
    trackingMode.reset()
    followSpeed.reset()
    eyeHeight.reset()
    lookAtTarget.reset()
    directionalLightPosition.reset()
    directionalLightTarget.reset()
    directionalLightRotation.reset()
    directionalLightIntensity.reset()
    directionalLightColor.reset()
    hemisphereSkyColor.reset()
    hemisphereGroundColor.reset()
    hemisphereLightIntensity.reset()
    ambientLightColor.reset()
    ambientLightIntensity.reset()
    envSelect.reset()
    skyBoxIntensity.reset()

    physicsEnabled.reset()
    ikEnabled.reset()
    grantEnabled.reset()
    physicsGravity.reset()
    gazeMode.reset()
    morphOverrides.reset()
    emotionActionMap.reset()
    availableMaterials.reset()
    materialOpacity.reset()
    albedoGlow.reset()
    renderScale.reset()
    resetViewControl('x')
    resetViewControl('y')
    resetViewControl('scale')
    resetViewControl('rotationY')
    void clearMotions()
    oneShotAction.value = undefined
    shouldUpdateView()
  }

  return {
    availableMorphs,
    morphMappings,
    hiddenMorphs,
    availableMotions,
    currentMotion,
    idleMotionName,
    previewExpression,
    resetState,

    physicsEnabled,
    ikEnabled,
    grantEnabled,
    physicsGravity,
    gazeMode,
    customMotions,
    deletedMotions,
    addMotion,
    getMotionFile,
    clearMotions,
    removeMotion,

    isModelLoaded,
    oneShotAction,
    playOneShotAction,
    onShouldUpdateView,
    shouldUpdateView,

    position,
    rotationY,

    morphOverrides,
    emotionActionMap,
    availableMaterials,
    materialOpacity,
    albedoGlow,
    renderScale,

    cameraFov,
    ambientColor,
    ambientIntensity,
    directionalColor,
    directionalIntensity,
    directionalPosition,

    // Placement, Camera & Lighting configurations
    scale,
    modelOffset,
    modelRotationY,
    modelSize,
    modelOrigin,
    cameraFOV,
    cameraPosition,
    cameraDistance,
    trackingMode,
    followSpeed,
    eyeHeight,
    lookAtTarget,
    directionalLightPosition,
    directionalLightTarget,
    directionalLightRotation,
    directionalLightIntensity,
    directionalLightColor,
    hemisphereSkyColor,
    hemisphereGroundColor,
    hemisphereLightIntensity,
    ambientLightColor,
    ambientLightIntensity,
    envSelect,
    skyBoxIntensity,
  }
})

export { useMmd as useMMD }
