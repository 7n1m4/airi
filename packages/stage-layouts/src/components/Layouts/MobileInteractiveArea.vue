<script setup lang="ts">
import MobileWhisperSheet from './MobileWhisperSheet.vue'

const props = defineProps<{
  tools?: any[]
}>()

const emit = defineEmits<{
  (e: 'settingsOpen', open: boolean): void
}>()
</script>

<template>
  <MobileWhisperSheet :tools="props.tools" @settings-open="emit('settingsOpen', $event)" />
</template>
