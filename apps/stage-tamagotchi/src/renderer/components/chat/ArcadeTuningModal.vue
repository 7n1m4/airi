<script setup lang="ts">
import { resolveArcadeProfile } from '@proj-airi/stage-ui/composables/arcade'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  gameTitle: string
  gameIdentifier: string
  customPrompt: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', text: string): void
  (e: 'reset'): void
}>()

const promptText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const defaultProfile = computed(() => resolveArcadeProfile(props.gameTitle || props.gameIdentifier))
const defaultPrompt = computed(() => defaultProfile.value.systemPromptAddendum)
const isCustomActive = computed(() => !!props.customPrompt && props.customPrompt.trim().length > 0)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      promptText.value = props.customPrompt ?? defaultPrompt.value
    }
  },
  { immediate: true },
)

const lineCount = computed(() => {
  if (!promptText.value)
    return 0
  return promptText.value.split('\n').length
})

const charCount = computed(() => promptText.value.length)

function insertSnippet(snippet: string) {
  if (!textareaRef.value) {
    promptText.value = `${promptText.value.trim()}\n\n${snippet}`
    return
  }

  const el = textareaRef.value
  const start = el.selectionStart
  const end = el.selectionEnd
  const before = promptText.value.substring(0, start)
  const after = promptText.value.substring(end)

  promptText.value = `${before}${snippet}${after}`
  setTimeout(() => {
    el.focus()
    el.selectionStart = el.selectionEnd = start + snippet.length
  }, 10)
}

function handleSave() {
  emit('save', promptText.value.trim())
  emit('close')
}

function handleReset() {
  promptText.value = defaultPrompt.value
  emit('reset')
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="val => { if (!val) emit('close') }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[9998] bg-black/65 backdrop-blur-sm transition-opacity" />
      <DialogContent
        :class="[
          'fixed inset-0 m-auto z-[9999]',
          'h-[85dvh] max-w-3xl w-[94dvw]',
          'flex flex-col overflow-hidden',
          'border border-neutral-200/50 rounded-3xl bg-white/95 p-0 shadow-2xl outline-none backdrop-blur-2xl',
          'dark:border-neutral-800/50 dark:bg-neutral-900/95',
        ]"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-neutral-200/40 px-6 py-4 dark:border-neutral-800/40">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 flex items-center justify-center rounded-2xl bg-purple-500/10 text-purple-600 shadow-sm dark:text-purple-400">
              <div class="i-solar:tuning-square-2-bold text-2xl" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <DialogTitle class="text-base text-neutral-900 font-bold tracking-tight dark:text-neutral-100">
                  AI Game Guidance &amp; Tuning
                </DialogTitle>
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="[
                    isCustomActive
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                      : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700',
                  ]"
                >
                  {{ isCustomActive ? 'Custom Tuned' : 'Default Profile' }}
                </span>
              </div>
              <p class="text-xs text-neutral-500 font-medium">
                Tune tactical rules, toolbar coordinates, and mechanics for <strong class="text-neutral-700 dark:text-neutral-300">{{ gameTitle || 'current game' }}</strong>
              </p>
            </div>
          </div>

          <button
            class="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title="Close"
            @click="emit('close')"
          >
            <div class="i-solar:close-circle-bold text-xl" />
          </button>
        </div>

        <!-- Guidance Banner & Snippet Bar -->
        <div class="border-b border-neutral-200/30 bg-neutral-50/60 p-4 dark:border-neutral-800/30 dark:bg-neutral-950/30">
          <p class="mb-3 text-[11px] text-neutral-600 leading-relaxed dark:text-neutral-400">
            This guidance is injected directly into AIRI's vision model prompt whenever she observes the game screen. You can specify exact toolbar coordinates [0-1000], important hotkeys, zone layouts, or strategic priorities.
          </p>

          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="mr-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Snippets:</span>
            <button
              type="button"
              class="border border-neutral-200/70 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-700/70 hover:border-purple-400 dark:bg-neutral-800/80 hover:bg-purple-50 dark:text-neutral-300 hover:text-purple-600 dark:hover:bg-purple-950/40 dark:hover:text-purple-300"
              @click="insertSnippet('\n- Screen Layout & Normalized Coordinates [0-1000]:\n  • Toolbar/Menu: (X: 50, Y: 150)\n  • Play Area: X: 150 to 850, Y: 150 to 850\n')"
            >
              + Coords Template
            </button>
            <button
              type="button"
              class="border border-neutral-200/70 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-700/70 hover:border-purple-400 dark:bg-neutral-800/80 hover:bg-purple-50 dark:text-neutral-300 hover:text-purple-600 dark:hover:bg-purple-950/40 dark:hover:text-purple-300"
              @click="insertSnippet('\n- Key Controls:\n  • Arrow Keys for directional navigation\n  • \'Enter\' to confirm, \'Space\' to action/pause, \'Escape\' to cancel\n')"
            >
              + Key Controls
            </button>
            <button
              type="button"
              class="border border-neutral-200/70 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-700/70 hover:border-purple-400 dark:bg-neutral-800/80 hover:bg-purple-50 dark:text-neutral-300 hover:text-purple-600 dark:hover:bg-purple-950/40 dark:hover:text-purple-300"
              @click="insertSnippet('\n- Strategic Priorities:\n  1. Prioritize essential resource infrastructure\n  2. Avoid trapped corners or unpowered zones\n  3. Verify visual result before repeating moves\n')"
            >
              + Strategic Priorities
            </button>
          </div>
        </div>

        <!-- Markdown Editor Body -->
        <div class="relative flex flex-1 flex-col overflow-hidden p-4">
          <textarea
            ref="textareaRef"
            v-model="promptText"
            class="h-full w-full resize-none border border-neutral-200/80 rounded-2xl bg-white p-4 text-xs text-neutral-800 leading-relaxed font-mono shadow-inner outline-none transition-all dark:border-neutral-700/80 focus:border-purple-500 dark:bg-neutral-950/60 dark:text-neutral-200 placeholder:text-neutral-400 focus:ring-2 focus:ring-purple-500/20"
            placeholder="Enter custom game rules, coordinates, and strategic advice for AIRI..."
            spellcheck="false"
          />

          <!-- Footer Counters -->
          <div class="mt-2 flex items-center justify-between px-1 text-[11px] text-neutral-400">
            <span class="flex items-center gap-1.5">
              <span class="i-solar:code-file-bold text-xs" />
              <span>Base profile: <strong>{{ defaultProfile.name }}</strong></span>
            </span>
            <span>{{ lineCount }} lines • {{ charCount }} characters</span>
          </div>
        </div>

        <!-- Modal Footer Actions -->
        <div class="flex items-center justify-between border-t border-neutral-200/40 bg-neutral-50/80 px-6 py-3.5 dark:border-neutral-800/40 dark:bg-neutral-950/40">
          <div>
            <button
              type="button"
              class="flex items-center gap-1.5 border border-neutral-200/80 rounded-xl bg-white px-3 py-1.5 text-xs text-neutral-600 font-medium transition-colors dark:border-neutral-700/80 hover:border-red-300 dark:bg-neutral-800 hover:bg-red-50 dark:text-neutral-300 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
              title="Reset prompt back to the built-in profile default"
              @click="handleReset"
            >
              <div class="i-solar:restart-bold text-xs" />
              <span>Reset to Default</span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="dark:hover:bg-neutral-750 border border-neutral-200/80 rounded-xl bg-white px-4 py-1.5 text-xs text-neutral-600 font-medium transition-colors dark:border-neutral-700/80 dark:bg-neutral-800 hover:bg-neutral-100 dark:text-neutral-300"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 border border-purple-500/40 rounded-xl from-purple-600 to-indigo-600 bg-gradient-to-r px-5 py-1.5 text-xs text-white font-bold shadow-sm transition-all active:scale-95 hover:from-purple-700 hover:to-indigo-700"
              @click="handleSave"
            >
              <div class="i-solar:diskette-bold text-xs" />
              <span>Save Guidance</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
