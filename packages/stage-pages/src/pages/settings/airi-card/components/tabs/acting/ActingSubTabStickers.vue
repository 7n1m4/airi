<script setup lang="ts">
import { chatStickers } from '@proj-airi/stage-ui/assets/stickers'
import { useStickersStore } from '@proj-airi/stage-ui/stores/stickers'
import { computed } from 'vue'
import { toast } from 'vue-sonner'

interface Props {
  cardId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
}>()

const stickerDirectivesPrompt = defineModel<string>('stickerDirectivesPrompt', { default: '' })
const stickerWidgetsEnabled = defineModel<boolean>('stickerWidgetsEnabled', { default: false })
const activeStickerIds = defineModel<string[]>('activeStickerIds', { default: () => [] })

const stickersStore = useStickersStore()

// If activeStickerIds is empty, initialize to all bundled stickers
const effectiveActiveIds = computed<string[]>({
  get: () => {
    if (!activeStickerIds.value || activeStickerIds.value.length === 0) {
      return chatStickers.map(s => s.id)
    }
    return activeStickerIds.value
  },
  set: (val) => {
    activeStickerIds.value = val
  },
})

function isStickerActive(id: string) {
  return effectiveActiveIds.value.includes(id)
}

function toggleStickerActive(id: string) {
  const current = [...effectiveActiveIds.value]
  const idx = current.indexOf(id)
  if (idx >= 0) {
    current.splice(idx, 1)
  }
  else {
    current.push(id)
  }
  effectiveActiveIds.value = current
}

function handleInsertStickerToken(stickerId: string) {
  // Generate token based on whether desktop screen slappers are enabled
  const token = stickerWidgetsEnabled.value
    ? `<|STICKER ${stickerId} type="both" pos="topRight"|>`
    : `<|STICKER ${stickerId}|>`

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
    toast.warning('No active stickers selected to sync.')
    return
  }

  let prompt = `## Instruction: Reaction Stickers & Desktop Slappers\nYou have access to character reaction stickers to punctuate conversation and express emotional beats.\n\n### Token Syntax\n- To send an inline reaction sticker in the chat, emit: \`<|STICKER id|>\`\n`

  if (stickerWidgetsEnabled.value) {
    prompt += `- To slap a reaction sticker directly onto the desktop screen viewport, emit:\n  \`<|STICKER id type="slapper" pos="topRight"|>\`\n- To both display inline and slap on screen simultaneously, emit:\n  \`<|STICKER id type="both" pos="center"|>\`\n\nSupported positions for screen slappers: \`topLeft\`, \`topRight\`, \`bottomLeft\`, \`bottomRight\`, \`center\`.\n\n`
  }
  else {
    prompt += `\n`
  }

  prompt += `### Active Character Sticker Catalog\nUse ONLY the following sticker IDs matching appropriate conversational moments:\n`
  for (const s of activeList) {
    prompt += `- \`${s.id}\`: ${s.description} (emotions: ${s.emotions.join(', ')})\n`
  }

  prompt += `\n### Guidelines\n- Punctuate naturally: Use stickers during humor, shock, warmth, greetings, teasing, or emotional emphasis.\n- Never spam: Do not emit more than 1 sticker per turn unless specifically roleplaying heavy emotion.\n- Mood alignment: Choose the sticker ID matching the current conversation vibe.\n`

  stickerDirectivesPrompt.value = prompt
  toast.success(`Synced directives from ${activeList.length} active stickers!`)
}

function testSlapSticker(stickerId: string, label: string) {
  const result = stickersStore.spawnSticker(stickerId)
  if (typeof result === 'object') {
    toast.success(`Slapped "${label}" on screen!`)
  }
  else {
    toast.error(String(result))
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header Card -->
    <div class="border border-primary-500/20 rounded-2xl bg-primary-500/5 p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="rounded-xl bg-primary-500/10 p-2.5 text-xl text-primary-500">
            <div class="i-solar:sticker-smile-circle-bold-duotone" />
          </div>
          <div>
            <h3 class="text-base text-neutral-800 font-semibold dark:text-neutral-100">
              Chibi Reaction Stickers & Desktop Slappers
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Configure emotional stickers. Directives are frozen in the system prompt for prefix-cache stability. The character emits <code class="rounded bg-neutral-200/50 px-1 py-0.5 text-primary-600 dark:bg-neutral-800/50 dark:text-primary-400">&lt;|STICKER &lt;id&gt;|&gt;</code> tokens in replies.
            </p>
          </div>
        </div>
      </div>

      <!-- Feature Toggle: Screen Slappers -->
      <div class="mt-4 border-t border-primary-500/10 pt-4">
        <label class="flex cursor-pointer items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              Include Stickers as Desktop Screen Slappers
            </span>
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
              When enabled, character can slap physics-driven chibi stickers directly onto your desktop stage alongside chat bubbles.
            </span>
          </div>
          <div class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              v-model="stickerWidgetsEnabled"
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
              class="flex items-center gap-1.5 rounded-lg bg-primary-500/10 px-2.5 py-1 text-xs text-primary-600 font-medium transition-colors hover:bg-primary-500 dark:text-primary-400 hover:text-white dark:hover:bg-primary-500 dark:hover:text-white"
              title="Generate directives from currently active catalog stickers"
              @click="syncDirectivesFromCatalog"
            >
              <div class="i-solar:restart-bold text-xs" />
              <span>Sync from Catalog</span>
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
            • Click sticker card to insert token into prompt • Checkbox toggles catalog roster
          </span>
        </div>
        <button
          class="flex items-center gap-1 text-xs text-primary-500 hover:underline"
          @click="stickersStore.clearPlacements()"
        >
          <div class="i-solar:trash-bin-trash-bold text-xs" />
          <span>Clear Screen Slaps</span>
        </button>
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

          <!-- Clickable Image for Token Insertion -->
          <button
            type="button"
            class="h-20 w-20 flex cursor-pointer items-center justify-center overflow-hidden border-none bg-transparent"
            title="Click to insert sticker token into directives"
            @click="handleInsertStickerToken(sticker.id)"
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

          <div class="mt-2 w-full flex items-center gap-1.5">
            <button
              class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-neutral-100 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
              title="Insert token into prompt"
              @click="handleInsertStickerToken(sticker.id)"
            >
              <div class="i-solar:add-circle-bold text-xs" />
              <span>Insert</span>
            </button>
            <button
              class="flex items-center justify-center rounded-lg bg-primary-500/10 px-2 py-1 text-[11px] text-primary-600 font-medium transition-colors hover:bg-primary-500 dark:text-primary-400 hover:text-white dark:hover:bg-primary-500 dark:hover:text-white"
              title="Test Slap on screen"
              @click="testSlapSticker(sticker.id, sticker.description)"
            >
              <div class="i-solar:fire-bold text-xs" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
