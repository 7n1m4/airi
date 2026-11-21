<script setup lang="ts">
import { Alert } from '@proj-anima/ui'
</script>

<template>
  <Alert v-bind="$attrs">
    <template v-for="(_, slot) in $slots" #[slot]="scope">
      <slot :name="slot" v-bind="scope || {}" />
    </template>
  </Alert>
</template>
