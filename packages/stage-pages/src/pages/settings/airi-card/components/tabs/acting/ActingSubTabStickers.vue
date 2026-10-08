<script setup lang="ts">
import { chatStickers } from '@proj-airi/stage-ui/assets/stickers'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

interface Props {
  cardId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
}>()

const stickerDirectivesPrompt = defineModel<string>('stickerDirectivesPrompt', { default: '' })
defineModel<boolean>('stickerWidgetsEnabled', { default: false })
const activeStickerIds = defineModel<string[]>('activeStickerIds', { default: () => [] })

const isCatalogDirty = ref(false)

// Initialize if undefined/null (preserve empty array [] when all are intentionally unchecked)
if (activeStickerIds.value === undefined || activeStickerIds.value === null) {
  activeStickerIds.value = chatStickers.map(s => s.id)
}

const isStickersEnabled = computed({
  get: () => {
    const hasActive = (activeStickerIds.value?.length ?? 0) > 0
    const hasPrompt = (stickerDirectivesPrompt.value?.trim().length ?? 0) > 0
    return hasActive || hasPrompt
  },
  set: (val: boolean) => {
    if (val) {
      enableStickersFeature()
    }
    else {
      disableStickersFeature()
    }
  },
})

function enableStickersFeature() {
  activeStickerIds.value = chatStickers.map(s => s.id)
  syncDirectivesFromCatalog()
  toast.success('Enabled reaction stickers!')
}

function disableStickersFeature() {
  activeStickerIds.value = []
  stickerDirectivesPrompt.value = ''
  isCatalogDirty.value = false
  toast.info('Disabled reaction stickers (directives cleared).')
}

function isStickerActive(id: string) {
  return activeStickerIds.value?.includes(id) ?? false
}

function toggleStickerActive(id: string) {
  const current = activeStickerIds.value ? [...activeStickerIds.value] : []
  const idx = current.indexOf(id)
  if (idx >= 0) {
    current.splice(idx, 1)
  }
  else {
    current.push(id)
  }
  activeStickerIds.value = current
  isCatalogDirty.value = true
}

function selectAllStickers() {
  activeStickerIds.value = chatStickers.map(s => s.id)
  isCatalogDirty.value = true
}

function uncheckAllStickers() {
  activeStickerIds.value = []
  isCatalogDirty.value = true
}

function handleInsertStickerToken(stickerId: string) {
  const token = `<|STICKER ${stickerId}|>`

  const current = stickerDirectivesPrompt.value || ''
  if (current.includes(stickerId)) {
    toast.info(`Sticker ${stickerId} is already mentioned in directives.`)
    return
  }

  const suffix = current.endsWith('\n') || !current ? '' : '\n'
  stickerDirectivesPrompt.value = `${current}${suffix}- ${token}\n`
  toast.success(`Inserted ${token} into directives`)
}

function syncDirectivesFromCatalog() {
  const activeList = chatStickers.filter(s => isStickerActive(s.id))
  if (activeList.length === 0) {
    stickerDirectivesPrompt.value = ''
    isCatalogDirty.value = false
    toast.info('Cleared sticker directives (no active stickers selected).')
    return
  }

  let prompt = `## Instruction: Reaction Stickers
You have access to character reaction stickers to punctuate conversation and express emotional beats.

### Token Syntax
- To send an inline reaction sticker in the chat, emit: \`<|STICKER id|>\`

### Active Character Sticker Catalog
Use ONLY the following sticker IDs matching appropriate conversational moments:
`
  for (const s of activeList) {
    prompt += `- \`${s.id}\`: ${s.description} (emotions: ${s.emotions.join(', ')})\n`
  }

  prompt += `\n### Guidelines
- Punctuate naturally: Use stickers during humor, shock, warmth, greetings, teasing, or emotional emphasis.
- Never spam: Do not emit more than 1 sticker per turn unless specifically roleplaying heavy emotion.
- Mood alignment: Choose the sticker ID matching the current conversation vibe.
`

  stickerDirectivesPrompt.value = prompt
  isCatalogDirty.value = false
  toast.success(`Synced directives from ${activeList.length} active stickers!`)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header Card with Feature Enable Toggle -->
    <div class="border border-primary-500/20 rounded-2xl bg-primary-500/5 p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="rounded-xl bg-primary-500/10 p-2.5 text-xl text-primary-500">
            <div class="i-solar:sticker-smile-circle-bold-duotone" />
          </div>
          <div>
            <h3 class="text-base text-neutral-800 font-semibold dark:text-neutral-100">
              Chibi Reaction Stickers
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Configure character reaction stickers. Directives are frozen in the system prompt for prefix-cache stability. The character emits <code class="rounded bg-neutral-200/50 px-1 py-0.5 text-primary-600 dark:bg-neutral-800/50 dark:text-primary-400">&lt;|STICKER &lt;id&gt;|&gt;</code> tokens in chat replies.
            </p>
          </div>
        </div>
      </div>

      <!-- Feature Toggle: Enable / Disable Reaction Stickers -->
      <div class="mt-4 border-t border-primary-500/10 pt-4">
        <label class="flex cursor-pointer items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              Enable Reaction Stickers
            </span>
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
              When disabled, clears all sticker prompt directives and deselects the catalog. When enabled, selects all stickers and generates active directives.
            </span>
          </div>
          <div class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              v-model="isStickersEnabled"
              type="checkbox"
              class="peer sr-only"
            >
            <div class="h-6 w-11 rounded-full bg-neutral-200 transition-colors after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-neutral-300 dark:border-neutral-600 after:rounded-full after:bg-white dark:bg-neutral-700 peer-checked:bg-primary-500 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:peer-focus:ring-primary-800" />
          </div>
        </label>
      </div>
    </div>

    <!-- Directives Editor Card -->
    <div class="border border-neutral-200 rounded-xl p-4 dark:border-neutral-700">
      <div class="max-w-full">
        <label class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div>
              <div class="flex items-center gap-1.5 text-sm font-medium">
                <span>Sticker Directives & Persona Instructions</span>
              </div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400">
                Instruction prompt guiding the LLM on when, how frequently, and which reaction stickers to emit.
              </div>
            </div>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
              :class="[
                isCatalogDirty
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/40 ring-2 ring-primary-400 ring-offset-1 dark:ring-offset-neutral-900 animate-pulse hover:bg-primary-600'
                  : 'bg-primary-500/10 text-primary-600 hover:bg-primary-500 hover:text-white dark:text-primary-400 dark:hover:bg-primary-500 dark:hover:text-white',
              ]"
              :title="isCatalogDirty ? 'Sticker roster has changed — click to sync directives' : 'Generate directives from currently active catalog stickers'"
              @click="syncDirectivesFromCatalog"
            >
              <div class="i-solar:restart-bold text-xs" :class="{ 'animate-spin': isCatalogDirty }" />
              <span>Sync from Catalog</span>
              <span
                v-if="isCatalogDirty"
                class="ml-0.5 rounded bg-white/20 px-1 py-0.2 text-[10px] text-white font-semibold tracking-wider uppercase"
              >
                Needs Sync
              </span>
            </button>
          </div>

          <div class="relative w-full">
            <textarea
              v-model="stickerDirectivesPrompt"
              rows="8"
              placeholder="Enter instructions for sticker usage and token syntax..."
              class="focus:primary-300 dark:focus:primary-400/50 text-disabled:neutral-400 dark:text-disabled:neutral-600 cursor-disabled:not-allowed w-full border-2 border-neutral-100 rounded-lg border-solid bg-neutral-50 py-2 pl-3 pr-10 text-xs leading-relaxed font-mono shadow-sm outline-none transition-all duration-200 ease-in-out dark:border-neutral-900 dark:bg-neutral-950 focus:bg-neutral-50 dark:focus:bg-neutral-900"
            />
            <button
              type="button"
              style="position: absolute; top: 8px; right: 8px; z-index: 50; display: flex; height: 32px; width: 32px; align-items: center; justify-content: center; border-radius: 8px; border: none; cursor: pointer; background: transparent;"
              class="text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-primary-500 dark:hover:bg-neutral-800 dark:hover:text-primary-400"
              title="Optimize with AI"
              @click.prevent="emit('sparkle-click', 'actingStickerDirectives')"
            >
              <span class="i-ph:sparkle animate-pulse text-lg" style="display: inline-block; width: 1.2em; height: 1.2em;" />
            </button>
          </div>
        </label>
      </div>
    </div>

    <!-- Gallery / Active Roster Card -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h4 class="flex items-center gap-2 text-sm text-neutral-800 font-semibold dark:text-neutral-200">
            <span>Sticker Catalog</span>
            <span class="text-xs text-neutral-400 font-normal">({{ chatStickers.length }} built-in stickers)</span>
          </h4>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            • Click image to toggle active status • Insert Token adds to prompt
          </span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <button
            type="button"
            class="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            @click="selectAllStickers"
          >
            Select All
          </button>
          <span class="text-neutral-300 dark:text-neutral-600">|</span>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            @click="uncheckAllStickers"
          >
            Uncheck All
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-6 md:grid-cols-4 sm:grid-cols-3">
        <div
          v-for="sticker in chatStickers"
          :key="sticker.id"
          class="group relative flex flex-col items-center justify-between border rounded-xl bg-white/60 p-3 text-center transition-all dark:bg-neutral-900/60 hover:shadow-md"
          :class="[
            isStickerActive(sticker.id)
              ? 'border-primary-500/40 bg-primary-500/5 dark:bg-primary-500/10'
              : 'border-neutral-200 dark:border-neutral-800 opacity-60 hover:opacity-100',
          ]"
        >
          <!-- Active Checkbox in top right -->
          <div class="absolute right-2 top-2 z-10">
            <input
              type="checkbox"
              :checked="isStickerActive(sticker.id)"
              class="cursor-pointer rounded text-primary-500 focus:ring-primary-400"
              title="Toggle active roster status"
              @change="toggleStickerActive(sticker.id)"
            >
          </div>

          <!-- Clickable Image for Toggling Active Status -->
          <button
            type="button"
            class="h-20 w-20 flex cursor-pointer items-center justify-center overflow-hidden border-none bg-transparent"
            title="Click image to toggle active status"
            @click="toggleStickerActive(sticker.id)"
          >
            <img
              :src="sticker.src"
              :alt="sticker.description"
              class="max-h-full max-w-full object-contain transition-transform group-hover:scale-110"
            >
          </button>

          <div class="mt-2 w-full">
            <div class="truncate text-xs text-neutral-700 font-semibold dark:text-neutral-200">
              {{ sticker.description }}
            </div>
            <div class="truncate text-[10px] text-neutral-400 font-mono">
              {{ sticker.id }}
            </div>
          </div>

          <div class="mt-2 w-full flex items-center">
            <button
              class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-neutral-100 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
              title="Insert token into prompt"
              @click="handleInsertStickerToken(sticker.id)"
            >
              <div class="i-solar:add-circle-bold text-xs" />
              <span>Insert Token</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
