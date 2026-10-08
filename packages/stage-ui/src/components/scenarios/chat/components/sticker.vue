<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { chatStickers } from '../../../../assets/stickers'
import { useStickersStore } from '../../../../stores/stickers'

const props = defineProps<{ stickerId: string }>()
const stickersStore = useStickersStore()

const stickerInfo = computed(() => {
  return chatStickers.find(s => s.id === props.stickerId)
})

const imgUrl = ref<string>(stickerInfo.value?.src || '')

watch(() => props.stickerId, async (id) => {
  if (stickerInfo.value?.src) {
    imgUrl.value = stickerInfo.value.src
    return
  }
  const url = await stickersStore.getStickerUrl(id)
  if (url) {
    imgUrl.value = url
  }
}, { immediate: true })
</script>

<template>
  <div class="my-1 inline-flex select-none">
    <img
      v-if="imgUrl"
      :src="imgUrl"
      :alt="stickerInfo?.description || stickerId"
      width="160"
      height="160"
      :class="['size-36 max-w-full rounded-lg object-contain drop-shadow-sm transition-transform hover:scale-105']"
    >
    <span v-else :class="['text-xs text-neutral-400 dark:text-neutral-500 italic']">
      [Sticker: {{ stickerInfo?.description || stickerId }}]
    </span>
  </div>
</template>
