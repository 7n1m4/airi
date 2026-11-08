<script setup lang="ts">
import { LifetimeProvisioningModal } from '@proj-airi/stage-ui/components'

const props = withDefaults(defineProps<{
  characterId: string
  universeId?: string
  open: boolean
}>(), {
  universeId: 'global',
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'completed'): void
}>()
</script>

<template>
  <LifetimeProvisioningModal
    :character-id="props.characterId"
    :universe-id="props.universeId"
    :open="props.open"
    @update:open="emit('update:open', $event)"
    @completed="emit('completed')"
  />
</template>
