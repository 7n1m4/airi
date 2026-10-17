<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import { useBackgroundStore } from '../../../../stores'
import { useChatSessionStore } from '../../../../stores/chat/session-store'
import { useAutonomousArtistryStore } from '../../../../stores/modules/artistry-autonomous'

const props = defineProps<{
  sessionId?: string
}>()

const artistryStore = useAutonomousArtistryStore()
const backgroundStore = useBackgroundStore()
const chatSessionStore = useChatSessionStore()

const { activeSessionId } = storeToRefs(chatSessionStore)

const targetSessionId = computed(() => props.sessionId || activeSessionId.value)

// Get all director notes for the target session
const notes = computed(() => {
  if (!targetSessionId.value)
    return []
  return artistryStore.directorNotes
    .filter(n => n.sessionId === targetSessionId.value)
    .sort((a, b) => b.createdAt - a.createdAt)
})

// Match images to notes by prompt
const imageMap = computed(() => {
  const map: Record<string, string> = {}
  const entries = backgroundStore.journalEntries

  for (const note of artistryStore.directorNotes) {
    if (!note.prompt)
      continue
    // Match by prompt string similarity (clean up spaces/casing)
    const notePromptClean = note.prompt.trim().toLowerCase()
    const matchedEntry = entries.find((entry) => {
      const entryTitleClean = (entry.title || '').trim().toLowerCase()
      const entryPromptClean = (entry.prompt || '').trim().toLowerCase()

      if (entryTitleClean && (notePromptClean.includes(entryTitleClean) || entryTitleClean.includes(notePromptClean)))
        return true
      if (entryPromptClean && (notePromptClean.includes(entryPromptClean) || entryPromptClean.includes(notePromptClean)))
        return true

      // Snippet check for slight variations
      if (entryPromptClean.length > 20 && notePromptClean.length > 20) {
        const entrySnippet = entryPromptClean.substring(0, 60)
        const noteSnippet = notePromptClean.substring(0, 60)
        if (notePromptClean.includes(entrySnippet) || entryPromptClean.includes(noteSnippet))
          return true
      }
      return false
    })
    if (matchedEntry && matchedEntry.id) {
      const url = backgroundStore.getBackgroundUrl(matchedEntry.id)
      if (url) {
        map[note.id] = url
      }
    }
  }
  return map
})

// Parse the scratchpad string (usually formatted as key-value pairs)
function parseScratchpad(scratch?: string) {
  if (!scratch?.trim())
    return []
  const lines = scratch.split('\n')
  const pairs: Array<{ key: string, value: string }> = []
  for (const line of lines) {
    const splitIndex = line.indexOf(':')
    if (splitIndex !== -1) {
      const key = line.substring(0, splitIndex).trim()
      const value = line.substring(splitIndex + 1).trim()
      if (key && value) {
        pairs.push({ key, value })
      }
    }
    else if (line.trim()) {
      pairs.push({ key: 'State', value: line.trim() })
    }
  }
  return pairs
}

// Copy prompt to clipboard helper
const copiedNoteId = ref<string | null>(null)
async function copyPrompt(promptText: string, noteId: string) {
  try {
    await navigator.clipboard.writeText(promptText)
    copiedNoteId.value = noteId
    setTimeout(() => {
      if (copiedNoteId.value === noteId) {
        copiedNoteId.value = null
      }
    }, 2000)
  }
  catch {
    // Clipboard failed
  }
}

// Fullscreen image preview overlay states
const previewImageUrl = ref<string | null>(null)
const previewImageTitle = ref<string | null>(null)
function previewImage(url: string, title?: string) {
  previewImageUrl.value = url
  previewImageTitle.value = title || 'Narrative Image'
}
</script>

<template>
  <div class="h-full w-full flex flex-col gap-4 overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800/40">
      <div class="flex flex-col gap-0.5">
        <h4 class="text-xs text-neutral-400 font-bold tracking-wider uppercase">
          Session Timeline Logs
        </h4>
        <p class="text-[10px] text-neutral-500 leading-normal">
          Injected narrative prompts, visual state changes, and tension coefficients.
        </p>
      </div>
    </div>

    <!-- Timeline List -->
    <div class="flex-1 overflow-y-auto pr-1.5 scrollbar-thin space-y-4">
      <div v-if="notes.length === 0" class="h-32 flex flex-col items-center justify-center text-sm text-neutral-400 font-mono italic">
        <div class="i-solar:videocamera-record-bold-duotone mb-2 text-3xl" />
        &lt; No Director Monitor Logs &gt;
      </div>

      <div
        v-for="note in notes"
        :key="note.id"
        class="flex flex-col overflow-hidden border border-neutral-200/60 rounded-xl bg-white shadow-sm transition-all md:flex-row dark:border-neutral-800 dark:bg-neutral-950/20 hover:shadow-md"
      >
        <!-- 1. Left Column: Image Thumbnail (20% or w-40 max) -->
        <div class="group relative aspect-square shrink-0 overflow-hidden border-r border-neutral-200/40 bg-neutral-100 md:aspect-auto md:h-auto md:w-44 dark:border-neutral-800/40 dark:bg-neutral-900">
          <img
            v-if="imageMap[note.id]"
            :src="imageMap[note.id]"
            class="h-full w-full cursor-pointer object-cover transition-transform duration-500 group-hover:scale-105"
            @click="previewImage(imageMap[note.id], note.title)"
          >
          <div v-else class="h-full w-full flex flex-col items-center justify-center p-4 text-neutral-400 dark:text-neutral-600">
            <div class="i-solar:gallery-wide-linear mb-1.5 text-3xl" />
            <span class="text-[8px] font-bold tracking-wider uppercase opacity-60">No Associated Media</span>
          </div>

          <!-- Hover Overlay to Zoom Image -->
          <div
            v-if="imageMap[note.id]"
            class="pointer-events-none absolute inset-0 flex cursor-pointer items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <div class="i-solar:magnifer-zoom-in-bold text-xl text-white" />
          </div>
        </div>

        <!-- 2. Middle Column: Details (55%) -->
        <div class="min-w-0 flex flex-1 flex-col gap-3 border-b border-neutral-200/40 p-4 md:border-b-0 md:border-r dark:border-neutral-800/40">
          <!-- Top Row Header -->
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 truncate">
              <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-200">
                {{ note.title || 'Narrative Injection' }}
              </span>
              <!-- Target Badge -->
              <span
                class="rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider uppercase"
                :class="note.target === 'assistant'
                  ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/20 dark:text-rose-400'
                  : 'bg-indigo-50 text-indigo-500 dark:bg-indigo-950/20 dark:text-indigo-400'"
              >
                {{ note.target || 'system' }}
              </span>
            </div>
            <!-- Intensity Coefficient -->
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="text-[9px] text-neutral-400 font-bold">Tension:</span>
              <div class="relative h-1.5 w-16 overflow-hidden border border-neutral-200/20 rounded-full bg-neutral-100 dark:bg-neutral-900">
                <div
                  class="h-full rounded-full bg-primary-500"
                  :style="{ width: `${note.intensity || 50}%` }"
                />
              </div>
              <span class="text-[9px] text-neutral-700 font-bold dark:text-neutral-300">
                {{ note.intensity || 50 }}/100
              </span>
            </div>
          </div>

          <!-- Description / Main Content -->
          <div class="text-xs text-neutral-700 leading-relaxed dark:text-neutral-300">
            <p>{{ note.content }}</p>
          </div>

          <!-- Concepts Chips -->
          <div v-if="note.selected_concepts && note.selected_concepts.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="concept in note.selected_concepts"
              :key="concept"
              class="rounded bg-neutral-100 px-1.5 py-0.5 text-[8px] text-neutral-500 font-bold tracking-tight uppercase dark:bg-neutral-900 dark:text-neutral-400"
            >
              {{ concept }}
            </span>
          </div>

          <!-- Generation Prompt Code Block -->
          <div v-if="note.prompt?.trim()" class="dark:border-neutral-850 group/prompt relative overflow-hidden border border-neutral-200/60 rounded-xl bg-neutral-50/50 p-3 dark:bg-neutral-950/40">
            <div class="mb-1 flex items-center justify-between">
              <span class="text-[9px] text-neutral-400 font-bold tracking-wider uppercase">Generation Prompt</span>
              <button
                class="border border-neutral-200/30 rounded-lg bg-neutral-100 p-1 text-[9px] text-neutral-500 font-bold transition-all active:scale-95 dark:bg-neutral-900 hover:bg-neutral-200 hover:text-primary-500 dark:hover:bg-neutral-800"
                @click="copyPrompt(note.prompt || '', note.id)"
              >
                {{ copiedNoteId === note.id ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <p class="select-all text-[10px] text-neutral-600 leading-normal font-mono dark:text-neutral-400">
              {{ note.prompt }}
            </p>
          </div>
        </div>

        <!-- 3. Right Column: Scratchpad State Board (25%) -->
        <div class="flex shrink-0 flex-col gap-2 bg-neutral-50/30 p-4 md:w-64 dark:bg-neutral-950/10">
          <span class="text-[9px] text-neutral-400 font-bold tracking-wider uppercase">Visual State Board</span>

          <div class="flex-1 overflow-y-auto text-[10px] font-mono space-y-1.5">
            <div
              v-for="pair in parseScratchpad(note.scratchpad)"
              :key="pair.key"
              class="flex flex-col border-b border-neutral-100/50 pb-1.5 last:border-b-0 dark:border-neutral-900/50"
            >
              <span class="text-[8px] text-neutral-400 font-semibold tracking-wider uppercase dark:text-neutral-500">{{ pair.key }}</span>
              <span class="text-neutral-700 leading-normal dark:text-neutral-300">{{ pair.value }}</span>
            </div>
            <div
              v-if="!note.scratchpad?.trim()"
              class="h-full flex items-center justify-center text-[9px] text-neutral-400 italic"
            >
              No Scratchpad State
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Fullscreen Image Preview Dialog -->
    <div
      v-if="previewImageUrl"
      class="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/95 p-4 transition-all duration-300"
      @click="previewImageUrl = null"
    >
      <button
        class="absolute right-6 top-6 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-95 hover:bg-white/20"
        @click="previewImageUrl = null"
      >
        <div class="i-solar:close-circle-bold text-2xl" />
      </button>

      <div class="animate-in zoom-in-95 relative max-h-[80vh] max-w-[90vw] flex flex-col items-center gap-4 duration-200" @click.stop>
        <img
          :src="previewImageUrl"
          class="max-h-[75vh] max-w-full rounded-2xl object-contain shadow-2xl"
        >
        <div class="text-center">
          <h4 class="text-sm text-white/90 font-semibold">
            {{ previewImageTitle }}
          </h4>
        </div>
      </div>
    </div>
  </div>
</template>
