<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import MarkdownRenderer from '../../../markdown/markdown-renderer.vue'

import { useDatingSimStore } from '../../../../stores/dating-sim'
import { buildSystemPrompt, useAiriCardStore } from '../../../../stores/modules/airi-card'

const props = defineProps<{
  characterId?: string
}>()

const cardStore = useAiriCardStore()
const { activeCardId } = storeToRefs(cardStore)

const targetCardId = computed(() => props.characterId || activeCardId.value)
const card = computed(() => {
  if (!targetCardId.value)
    return undefined
  return cardStore.getCard(targetCardId.value)
})

// View toggle state: 'structured' | 'raw'
const viewMode = ref<'structured' | 'raw'>('structured')

// Check if Dating Sim is active
const datingSimState = computed(() => {
  try {
    const datingSimStore = useDatingSimStore()
    if (datingSimStore.enabled && datingSimStore.activeStoryline) {
      return {
        active: true,
        story: datingSimStore.activeStoryline,
        premise: datingSimStore.customPremise || datingSimStore.activeStoryline.premise || '',
      }
    }
  }
  catch {
    // Pinia not ready or dating sim store not present
  }
  return { active: false, story: null, premise: '' }
})

// Raw Combined System Prompt
const rawCombinedPrompt = computed(() => {
  return buildSystemPrompt(card.value)
})

// Structured prompt parts for detailed diagnostic display
const sections = computed(() => {
  if (!card.value)
    return []

  const list: Array<{
    title: string
    icon: string
    content: string
    badge?: string
    isMarkdown?: boolean
  }> = []

  // 1. Core System Prompt
  if (card.value.systemPrompt?.trim()) {
    list.push({
      title: 'Core Directive',
      icon: 'i-solar:shield-keyhole-bold-duotone',
      content: card.value.systemPrompt,
      badge: 'System Prompt',
      isMarkdown: true,
    })
  }

  // 2. Personality & Profile
  if (card.value.personality?.trim() || card.value.description?.trim()) {
    const content = [
      card.value.description ? `**Description:**\n${card.value.description}` : '',
      card.value.personality ? `**Personality Profile:**\n${card.value.personality}` : '',
    ].filter(Boolean).join('\n\n')

    list.push({
      title: 'Identity & Personality',
      icon: 'i-solar:user-bold-duotone',
      content,
      badge: 'Profile',
      isMarkdown: true,
    })
  }

  // 3. Greetings
  if (card.value.greetings && card.value.greetings.length > 0) {
    const content = card.value.greetings.map(g => `- ${g}`).join('\n')
    list.push({
      title: 'Dialog Starters',
      icon: 'i-solar:chat-line-bold-duotone',
      content,
      badge: 'Greetings',
    })
  }

  // 4. Acting & Mannerisms
  const acting = card.value.extensions?.airi?.acting
  if (acting) {
    const parts: string[] = []
    if (acting.modelExpressionPrompt?.trim()) {
      parts.push(`**Model Expressions:**\n${acting.modelExpressionPrompt}`)
    }
    if (acting.speechExpressionPrompt?.trim()) {
      parts.push(`**Speech Expressions:**\n${acting.speechExpressionPrompt}`)
    }
    if (acting.speechMannerismPrompt?.trim()) {
      parts.push(`**Speech Mannerisms:**\n${acting.speechMannerismPrompt}`)
    }

    if (parts.length > 0) {
      list.push({
        title: 'Mannerisms & Expressions',
        icon: 'i-solar:masks-bold-duotone',
        content: parts.join('\n\n'),
        badge: 'Acting',
        isMarkdown: true,
      })
    }
  }

  // 5. Dating Sim Injections
  if (datingSimState.value.active && datingSimState.value.story) {
    const story = datingSimState.value.story
    const premise = datingSimState.value.premise
    const parts: string[] = []

    if (premise) {
      parts.push(`**Story Premise:**\n${premise}`)
    }
    if (story.appearances) {
      parts.push(`**Story Appearance adjustments:**\n${story.appearances}`)
    }
    if (story.scene) {
      parts.push(`**Location / Scene Setting:**\n${story.scene}`)
    }

    if (parts.length > 0) {
      list.push({
        title: 'Dating Sim Scenario Injections',
        icon: 'i-solar:heart-bold-duotone',
        content: parts.join('\n\n'),
        badge: 'Story Premise',
        isMarkdown: true,
      })
    }
  }

  // 6. Subsystem Hooks (Memory & Journaling instructions)
  const artistry = card.value.extensions?.airi?.artistry
  const generation = card.value.extensions?.airi?.generation
  const isImageJournalAllowed = !generation?.known?.allowedTools || generation.known.allowedTools.includes('image_journal')
  const textJournal = card.value.extensions?.airi?.textJournal
  const isTextJournalAllowed = !generation?.known?.allowedTools || generation.known.allowedTools.includes('text_journal')

  const subsystemParts: string[] = []

  if (isImageJournalAllowed && artistry?.provider && artistry.provider !== 'none' && artistry.widgetInstruction && !artistry.autonomousEnabled) {
    if (artistry.widgetInstruction?.trim()) {
      subsystemParts.push(`**Image Journaling (Artistry):**\n${artistry.widgetInstruction}`)
    }
  }

  if (isTextJournalAllowed) {
    const textJournalInstruction = textJournal?.widgetInstruction
    if (textJournalInstruction?.trim()) {
      subsystemParts.push(`**Text Journaling (Memory):**\n${textJournalInstruction}`)
    }
  }

  if (subsystemParts.length > 0) {
    list.push({
      title: 'Autonomous Subsystem instructions',
      icon: 'i-solar:cpu-bold-duotone',
      content: subsystemParts.join('\n\n'),
      badge: 'Subsystems',
      isMarkdown: true,
    })
  }

  return list
})
</script>

<template>
  <div class="h-full w-full flex flex-col gap-4 overflow-hidden">
    <!-- View Switcher -->
    <div class="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800/40">
      <div class="flex flex-col gap-0.5">
        <h4 class="text-xs text-neutral-400 font-bold tracking-wider uppercase">
          Prompt Builder Inspection
        </h4>
        <p class="text-[10px] text-neutral-500 leading-normal">
          Active fields composed into context for <span class="text-primary-500 font-bold">{{ card?.name || 'Character' }}</span>.
        </p>
      </div>
      <div class="flex border border-neutral-200 rounded-lg bg-neutral-100/50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900/50">
        <button
          class="rounded-md px-2.5 py-1 text-[10px] font-bold transition-all"
          :class="viewMode === 'structured' ? 'bg-white dark:bg-neutral-800 shadow-sm text-primary-500' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'"
          @click="viewMode = 'structured'"
        >
          Structured Fields
        </button>
        <button
          class="rounded-md px-2.5 py-1 text-[10px] font-bold transition-all"
          :class="viewMode === 'raw' ? 'bg-white dark:bg-neutral-800 shadow-sm text-primary-500' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'"
          @click="viewMode = 'raw'"
        >
          Raw Payload
        </button>
      </div>
    </div>

    <!-- Active View Area -->
    <div class="flex-1 overflow-y-auto pr-1.5 scrollbar-thin">
      <div v-if="!card" class="h-32 flex flex-col items-center justify-center text-sm text-neutral-400 font-mono italic">
        <div class="i-solar:bookmark-square-open-bold-duotone mb-2 text-3xl" />
        &lt; No Character Selected &gt;
      </div>

      <!-- A. Structured view -->
      <div v-else-if="viewMode === 'structured'" class="space-y-3">
        <div
          v-for="section in sections"
          :key="section.title"
          class="border border-neutral-200/60 rounded-xl bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/20"
        >
          <div class="mb-2 flex items-center justify-between border-b border-neutral-100/60 pb-1.5 dark:border-neutral-800/40">
            <div class="flex items-center gap-2">
              <div :class="[section.icon, 'text-base text-primary-500']" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">{{ section.title }}</span>
            </div>
            <span v-if="section.badge" class="rounded-full bg-primary-50 px-2 py-0.5 text-[8px] text-primary-500 font-bold tracking-wider uppercase dark:bg-primary-950/30 dark:text-primary-400">
              {{ section.badge }}
            </span>
          </div>

          <div class="whitespace-pre-wrap text-xs text-neutral-600 leading-relaxed font-sans dark:text-neutral-400">
            <MarkdownRenderer v-if="section.isMarkdown" :content="section.content" />
            <span v-else>{{ section.content }}</span>
          </div>
        </div>
      </div>

      <!-- B. Raw concatenated view -->
      <div v-else class="h-full">
        <div class="min-h-[200px] border border-neutral-200 rounded-xl border-dashed bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
          <MarkdownRenderer
            v-if="rawCombinedPrompt"
            :content="rawCombinedPrompt"
            class="text-xs text-neutral-700 leading-6 font-mono dark:text-neutral-300"
          />
          <div v-else class="h-32 flex items-center justify-center text-xs text-neutral-400 font-mono italic">
            &lt; Empty System Prompt Payload &gt;
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
