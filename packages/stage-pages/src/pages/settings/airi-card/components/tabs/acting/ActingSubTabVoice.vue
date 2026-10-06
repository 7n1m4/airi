<script setup lang="ts">
import type { SpeechCapabilitiesInfo } from '@proj-airi/stage-ui/stores/providers'

interface Props {
  selectedSpeechProviderLabel: string
  actingSpeechCapabilitiesLoading: boolean
  actingGroupedExpressionTags: { category: string, tags: { tag: string, description?: string }[] }[]
  actingMannerismOptions: NonNullable<SpeechCapabilitiesInfo['mannerisms']>
  insertSpeechTag?: (tag: string, description?: string) => void
  insertSpeechMannerism?: (id: string) => void
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
}>()

const selectedActingSpeechExpressionPrompt = defineModel<string>('selectedActingSpeechExpressionPrompt', { required: true })

const FALLBACK_MOOD_TAGS = [
  { tag: 'happy', description: 'Happy / Joy / Laugh / Grin / Smile' },
  { tag: 'flustered', description: 'Flustered / Blush / Shy / Heart-Curl Tail' },
  { tag: 'angry', description: 'Angry / Mad / Annoy / Jagged Starburst & Anger Mark 💢' },
  { tag: 'surprised', description: 'Surprise / Shock / Gasp / Impact Flash' },
  { tag: 'thinking', description: 'Thinking / Ponder / Cloud Bubble & Thought Dots' },
  { tag: 'sad', description: 'Sad / Cry / Sorrow / Drooping Tail & Raindrops' },
  { tag: 'yandere', description: 'Yandere / Possessive / Vignette & Heartbeat Pulse' },
  { tag: 'sleepy', description: 'Sleepy / Tired / Yawn / Floating Fireflies' },
]

const CAPTION_FX_STRUCTURAL_TAGS = [
  { snippet: 'u-um...', tag: 'Stutter', description: 'Flustered ➔ Blush Wash, Sweat Drop & Wobble' },
  { snippet: '(hmm... what if...)', tag: 'Parenthetical Aside', description: 'Inner Monologue ➔ Scalloped Cloud & Thought Dots' },
  { snippet: 'WHAT?! No way!!', tag: 'Punctuation Spike', description: 'Shock ➔ Impact Burst & Spring Scale Punch' },
  { snippet: 'Nya~ meow!', tag: 'Cat Speech', description: 'Playful ➔ Dynamic Wagging Tail' },
  { snippet: 'belong to me... 🖤', tag: 'Yandere Cue', description: 'Possessive ➔ Dark Vignette & Heartbeat Pulse' },
]

function handleInsertSpeechTag(tag: string, description?: string) {
  if (props.insertSpeechTag) {
    props.insertSpeechTag(tag, description)
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <div class="i-solar:soundwave-bold-duotone text-lg text-primary-500" />
          <h4 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
            Voice Acting & Audio Tags
          </h4>
        </div>
        <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
          Teach AIRI how to use provider-side vocal tags, voice mannerisms, and head-tethered caption FX.
        </p>
      </div>
    </div>

    <div class="border border-neutral-200 rounded-xl p-4 dark:border-neutral-700">
      <div class="max-w-full">
        <label class="flex flex-col gap-4">
          <div>
            <div class="flex items-center gap-1 text-sm font-medium">
              Vocal Tags & Speech Directives
            </div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">
              Teach AIRI how to use provider-side vocal tags when the selected speech provider supports them.
            </div>
          </div>
          <div class="relative w-full">
            <textarea
              v-model="selectedActingSpeechExpressionPrompt"
              rows="6"
              placeholder="Voice tags, vocal mannerisms & audio directives"
              class="focus:primary-300 dark:focus:primary-400/50 text-disabled:neutral-400 dark:text-disabled:neutral-600 cursor-disabled:not-allowed w-full border-2 border-neutral-100 rounded-lg border-solid bg-neutral-50 py-1.5 pl-2 pr-9 text-sm shadow-sm outline-none transition-all duration-200 ease-in-out dark:border-neutral-900 dark:bg-neutral-950 focus:bg-neutral-50 dark:focus:bg-neutral-900"
            />
            <button
              type="button"
              style="position: absolute; top: 8px; right: 8px; z-index: 50; display: flex; height: 32px; width: 32px; align-items: center; justify-content: center; border-radius: 8px; border: none; cursor: pointer; background: transparent;"
              class="text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-primary-500 dark:hover:bg-neutral-800 dark:hover:text-primary-400"
              title="Optimize with AI"
              @click.prevent="emit('sparkle-click', 'actingSpeechExpression')"
            >
              <span class="i-ph:sparkle animate-pulse text-lg" style="display: inline-block; width: 1.2em; height: 1.2em;" />
            </button>
          </div>
        </label>
      </div>

      <div class="mt-4 flex flex-col gap-3">
        <div class="text-xs text-neutral-500">
          Voice tag helpers for provider
          <span class="text-neutral-700 font-medium dark:text-neutral-200">{{ selectedSpeechProviderLabel }}</span>
        </div>
        <div v-if="actingSpeechCapabilitiesLoading" class="text-xs text-neutral-400">
          Loading voice capability helpers...
        </div>
        <div v-else-if="actingGroupedExpressionTags.length" class="flex flex-col gap-3">
          <div v-for="group in actingGroupedExpressionTags" :key="group.category" class="flex flex-col gap-2">
            <div class="text-xs text-neutral-500 tracking-wide uppercase">
              {{ group.category }}
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="tag in group.tags"
                :key="`${group.category}:${tag.tag}`"
                type="button"
                class="border border-neutral-200 rounded-full px-3 py-1 text-xs text-neutral-600 transition-colors dark:border-neutral-700 hover:border-primary-400 dark:text-neutral-300 hover:text-primary-500"
                :title="tag.description || tag.tag"
                @click="handleInsertSpeechTag(tag.tag, tag.description)"
              >
                [{{ tag.tag }}]
              </button>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col gap-3">
          <div class="border border-primary-200/60 rounded-lg bg-primary-50/40 p-2.5 text-xs text-primary-900/80 dark:border-primary-800/40 dark:bg-primary-950/30 dark:text-primary-200">
            💡 <strong>Head-Tethered Caption FX:</strong> AIRI's live speech bubble dynamically morphs its vector shape, wags its tail, and renders WebGL ambient effects (hearts, rain, scanlines, starbursts) from these cues!
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="text-xs text-neutral-400 font-medium">
              Bracket Mood Tags
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="item in FALLBACK_MOOD_TAGS"
                :key="item.tag"
                type="button"
                class="border border-neutral-200 rounded-full px-3 py-1 text-xs text-neutral-600 transition-colors dark:border-neutral-700 hover:border-primary-400 dark:text-neutral-300 hover:text-primary-500"
                :title="item.description"
                @click="handleInsertSpeechTag(item.tag, item.description)"
              >
                [{{ item.tag }}]
              </button>
            </div>
          </div>

          <div class="mt-1 flex flex-col gap-1.5">
            <div class="text-xs text-neutral-400 font-medium">
              Structural & Punctuation Cues
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="item in CAPTION_FX_STRUCTURAL_TAGS"
                :key="item.tag"
                type="button"
                class="border border-neutral-200 rounded-full px-3 py-1 text-xs text-neutral-600 transition-colors dark:border-neutral-700 hover:border-primary-400 dark:text-neutral-300 hover:text-primary-500"
                :title="item.description"
                @click="handleInsertSpeechTag(item.snippet, item.description)"
              >
                {{ item.tag }}: <span class="font-mono opacity-80">{{ item.snippet }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
