<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

onMounted(() => {
  router.replace('/settings/providers#transcription')
})
</script>

<template>
  <div class="flex items-center justify-center p-8 text-xs text-neutral-400 font-mono">
    Redirecting to Hearing Providers...
  </div>
</template>
