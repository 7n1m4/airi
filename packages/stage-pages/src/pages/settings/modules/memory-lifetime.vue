<script setup lang="ts">
import LifetimeMemoryView from './components/LifetimeMemoryView.vue'
</script>

<template>
  <div class="relative flex flex-col pb-12">
    <LifetimeMemoryView show-breadcrumb show-change-character />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: The Eternal Thread
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
