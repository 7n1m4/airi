<script setup lang="ts">
import { SelectTab } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { PropertyColor, PropertyNumber } from '../../../../data-pane'
import { Section } from '../../../../layouts'
import { ColorPalette } from '../../../../widgets'

const props = withDefaults(defineProps<{
  store: any
  positioningStore?: any
  modelId?: string
  modelSize: { x: number, y: number, z: number }
  palette: string[]
  sceneMutationLocked?: boolean
}>(), {
  sceneMutationLocked: false,
})

// The scene stores are pinia/localStorage based and are shared by reference,
// so their writable state is unwrapped into a local binding: writes go through
// the store itself, not through the `store` prop.
const store = computed(() => props.store)

const { t } = useI18n()

const activeTab = ref('placement')

const tabOptions = computed(() => [
  { value: 'placement', label: 'Placement', icon: 'i-solar:square-academic-cap-bold-duotone' },
  { value: 'lighting', label: 'Lighting', icon: 'i-solar:lightbulb-bold-duotone' },
])

const envOptions = computed(() => [
  { value: 'hemisphere', label: 'Hemisphere', icon: 'i-solar:globus-bold-duotone' },
  { value: 'skyBox', label: 'SkyBox', icon: 'i-solar:panorama-bold-duotone' },
])

const settingsLockClass = computed(() => props.sceneMutationLocked ? 'pointer-events-none opacity-50' : '')

// Unified positioning helpers
const modelKey = computed(() => props.modelId || 'default')

const computedX = computed({
  get: () => {
    if (props.positioningStore) {
      return props.positioningStore.getPosition(modelKey.value).x
    }
    return store.value.modelOffset?.x || 0
  },
  set: (val) => {
    if (props.positioningStore) {
      const current = props.positioningStore.getPosition(modelKey.value)
      props.positioningStore.setPosition(modelKey.value, { ...current, x: val })
    }
    else if (store.value.modelOffset) {
      store.value.modelOffset.x = val
    }
  },
})

const computedY = computed({
  get: () => {
    if (props.positioningStore) {
      return props.positioningStore.getPosition(modelKey.value).y
    }
    return store.value.modelOffset?.y || 0
  },
  set: (val) => {
    if (props.positioningStore) {
      const current = props.positioningStore.getPosition(modelKey.value)
      props.positioningStore.setPosition(modelKey.value, { ...current, y: val })
    }
    else if (store.value.modelOffset) {
      store.value.modelOffset.y = val
    }
  },
})

const computedScale = computed({
  get: () => {
    if (props.positioningStore) {
      return props.positioningStore.getPosition(modelKey.value).scale
    }
    return store.value.cameraDistance || 1
  },
  set: (val) => {
    if (props.positioningStore) {
      const current = props.positioningStore.getPosition(modelKey.value)
      props.positioningStore.setPosition(modelKey.value, { ...current, scale: val })
    }
    else {
      store.value.cameraDistance = val
    }
  },
})
</script>

<template>
  <Section
    :title="t('settings.pages.models.sections.section.scene')"
    icon="i-solar:people-nearby-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80 dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <ColorPalette class="mb-4 mt-2" :colors="palette.map(hex => ({ hex, name: hex }))" mx-auto />

    <!-- Tab Selection -->
    <div class="mb-4 px-2">
      <SelectTab v-model="activeTab" :options="tabOptions" size="sm" />
    </div>

    <div :class="settingsLockClass">
      <!-- === Placement Tab === -->
      <div v-if="activeTab === 'placement'" flex="~ col gap-4" p-2>
        <div grid="~ cols-5 gap-y-2 gap-x-1" items-center>
          <PropertyNumber
            v-model="computedX"
            :config="{ min: props.positioningStore ? -500 : -props.modelSize.x * 2, max: props.positioningStore ? 500 : props.modelSize.x * 2, step: props.positioningStore ? 1 : props.modelSize.x / 1000, label: 'X', formatValue: val => val?.toFixed(props.positioningStore ? 0 : 4), disabled: sceneMutationLocked }"
            :label="t('settings.vrm.scale-and-position.x')"
          />
          <PropertyNumber
            v-model="computedY"
            :config="{ min: props.positioningStore ? -500 : -props.modelSize.y * 2, max: props.positioningStore ? 500 : props.modelSize.y * 2, step: props.positioningStore ? 1 : props.modelSize.y / 1000, label: 'Y', formatValue: val => val?.toFixed(props.positioningStore ? 0 : 4), disabled: sceneMutationLocked }"
            :label="t('settings.vrm.scale-and-position.y')"
          />
          <PropertyNumber
            v-if="!props.positioningStore"
            v-model="store.modelOffset.z"
            :config="{ min: -props.modelSize.z * 2, max: props.modelSize.z * 2, step: props.modelSize.z / 1000, label: 'Z', formatValue: val => val?.toFixed(4), disabled: sceneMutationLocked }"
            :label="t('settings.vrm.scale-and-position.z')"
          />
          <PropertyNumber
            v-model="store.modelRotationY"
            :config="{ min: -180, max: 180, step: 1, label: t('settings.vrm.scale-and-position.rotation-y'), disabled: sceneMutationLocked }"
            :label="t('settings.vrm.scale-and-position.rotation-y')"
          />
          <PropertyNumber
            v-model="computedScale"
            :config="{ min: props.positioningStore ? 0.1 : props.modelSize.z || 0.1, max: props.positioningStore ? 5 : (props.modelSize.z || 1) * 20, step: 0.01, label: props.positioningStore ? 'Scale' : t('settings.vrm.scale-and-position.camera-distance'), formatValue: val => val?.toFixed(4), disabled: sceneMutationLocked }"
            :label="props.positioningStore ? 'Scale' : t('settings.vrm.scale-and-position.camera-distance')"
          />
          <PropertyNumber
            v-model="store.cameraFOV"
            :config="{ min: 1, max: 180, step: 1, label: t('settings.vrm.scale-and-position.fov'), disabled: sceneMutationLocked }"
            :label="t('settings.vrm.scale-and-position.fov')"
          />
        </div>
      </div>

      <!-- === Lighting Tab === -->
      <div v-else-if="activeTab === 'lighting'" flex="~ col gap-6" p-2>
        <!-- Directional Light -->
        <div flex="~ col gap-2">
          <div class="px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
            Directional Light
          </div>
          <div grid="~ cols-5 gap-y-2 gap-x-1" items-center>
            <PropertyNumber
              v-model="store.directionalLightRotation.x"
              :config="{ min: -180, max: 180, step: 1, label: 'X°', formatValue: val => val?.toFixed(0), disabled: sceneMutationLocked }"
              label="Rotation X"
            />
            <PropertyNumber
              v-model="store.directionalLightRotation.y"
              :config="{ min: -180, max: 180, step: 1, label: 'Y°', formatValue: val => val?.toFixed(0), disabled: sceneMutationLocked }"
              label="Rotation Y"
            />
            <PropertyColor
              v-model="store.directionalLightColor"
              :disabled="sceneMutationLocked"
              label="Color"
            />
            <PropertyNumber
              v-model="store.directionalLightIntensity"
              :config="{ min: 0, max: 10, step: 0.01, label: 'Intensity', disabled: sceneMutationLocked }"
              label="Intensity"
            />
          </div>
        </div>

        <!-- Ambient Light -->
        <div flex="~ col gap-2">
          <div class="px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
            Ambient Light
          </div>
          <div grid="~ cols-5 gap-y-2 gap-x-1" items-center>
            <PropertyColor
              v-model="store.ambientLightColor"
              :disabled="sceneMutationLocked"
              label="Color"
            />
            <PropertyNumber
              v-model="store.ambientLightIntensity"
              :config="{ min: 0, max: 10, step: 0.01, label: 'Intensity', disabled: sceneMutationLocked }"
              label="Intensity"
            />
          </div>
        </div>

        <!-- Environment -->
        <div flex="~ col gap-2">
          <div class="px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
            Environment
          </div>
          <div class="mb-1">
            <SelectTab v-model="store.envSelect" :options="envOptions" :disabled="sceneMutationLocked" size="sm" />
          </div>

          <div v-if="store.envSelect === 'hemisphere'" grid="~ cols-5 gap-y-2 gap-x-1" items-center>
            <PropertyColor
              v-model="store.hemisphereSkyColor"
              :disabled="sceneMutationLocked"
              label="Sky Color"
            />
            <PropertyColor
              v-model="store.hemisphereGroundColor"
              :disabled="sceneMutationLocked"
              label="Ground Color"
            />
            <PropertyNumber
              v-model="store.hemisphereLightIntensity"
              :config="{ min: 0, max: 10, step: 0.01, label: 'Intensity', disabled: sceneMutationLocked }"
              label="Intensity"
            />
          </div>
          <div v-else grid="~ cols-5 gap-y-2 gap-x-1" items-center>
            <PropertyNumber
              v-model="store.skyBoxIntensity"
              :config="{ min: 0, max: 1, step: 0.01, label: 'Intensity', disabled: sceneMutationLocked }"
              label="Skybox Intensity"
            />
          </div>
        </div>
      </div>
    </div>
  </Section>
</template>
