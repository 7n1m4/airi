<script setup lang="ts">
import { Button } from '@proj-anima/ui'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'

interface Props {
  modelValue: boolean
  cardName?: string
}

defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function handleCancel() {
  emit('update:modelValue', false)
  emit('cancel')
}

function handleConfirm() {
  emit('update:modelValue', false)
  emit('confirm')
}
</script>

<template>
  <AlertDialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <AlertDialogPortal>
      <AlertDialogOverlay class="fixed inset-0 z-[9999] bg-black/50 data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <AlertDialogContent
        class="fixed left-1/2 top-1/2 z-[9999] max-w-md w-full border border-neutral-200 rounded-2xl bg-white p-6 shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div class="flex items-start gap-4">
          <div class="rounded-xl bg-amber-500/10 p-3 text-amber-500 dark:bg-amber-400/10 dark:text-amber-400">
            <div class="i-solar:cloud-download-bold-duotone text-2xl" />
          </div>
          <div class="flex-1">
            <AlertDialogTitle class="text-base text-neutral-800 font-bold dark:text-neutral-100">
              Sync Cloud Assets
            </AlertDialogTitle>
            <AlertDialogDescription class="mt-2 text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
              The chat sessions, stage backgrounds, or display models for <b>"{{ cardName || 'this character' }}"</b> are currently stored in your cloud backup share and have not been downloaded locally.
            </AlertDialogDescription>
            <p class="mt-2 text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
              Would you like to sync these assets now and activate this character?
            </p>
          </div>
        </div>

        <div class="mt-6 flex flex-row justify-end gap-2.5">
          <AlertDialogCancel as-child>
            <Button
              variant="ghost"
              label="Cancel"
              class="h-9 px-3 text-xs"
              @click="handleCancel"
            />
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <Button
              variant="primary"
              class="h-9 flex items-center gap-1.5 px-4 text-xs font-semibold"
              @click="handleConfirm"
            >
              <div class="i-solar:cloud-download-bold text-sm" />
              <span>Sync & Activate</span>
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
