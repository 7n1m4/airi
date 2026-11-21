<script setup lang="ts">
import MindMapExplorer from '@proj-anima/stage-pages/pages/knowledge-graph/MindMapExplorer.vue'

const emit = defineEmits<{
  (e: 'ready'): void
}>()
</script>

<template>
  <div class="h-full w-full overflow-hidden">
    <MindMapExplorer @ready="emit('ready')" />
  </div>
</template>
