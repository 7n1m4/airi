<script setup lang="ts">
import CloudflareConnectDialog from '../dialogs/cloudflare/CloudflareConnectDialog.vue'
import ConsciousnessProbeTester from './ConsciousnessProbeTester.vue'
import ConsciousnessRouteSelector from './ConsciousnessRouteSelector.vue'

import { useConsciousnessConfig } from './useConsciousnessConfig'

const props = withDefaults(defineProps<{
  mode?: 'onboarding' | 'settings'
}>(), {
  mode: 'settings',
})

const emit = defineEmits<{
  (e: 'verified'): void
  (e: 'change', value: { provider: string, model: string }): void
}>()

const config = useConsciousnessConfig({
  mode: props.mode,
  onVerified: () => emit('verified'),
  onChange: val => emit('change', val),
})

defineExpose({
  config,
  verified: config.verified,
})
</script>

<template>
  <div :class="['w-full max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,65%)_minmax(0,35%)] gap-5 lg:gap-6 items-start']">
    <!-- Left: configuration column -->
    <ConsciousnessRouteSelector :config="config" />

    <!-- Right: shared verification panel -->
    <ConsciousnessProbeTester :config="config" />

    <!-- Cloudflare Connect Dialog -->
    <CloudflareConnectDialog
      v-model="config.isConnectModalOpen.value"
      @connected="config.handleCloudflareConnected"
    />
  </div>
</template>
