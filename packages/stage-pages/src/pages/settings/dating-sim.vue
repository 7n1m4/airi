<script setup lang="ts">
import { Section } from '@proj-anima/stage-ui/components'
import { useDatingSimStore } from '@proj-anima/stage-ui/stores/dating-sim'
import { useLLM } from '@proj-anima/stage-ui/stores/llm'
import { useConsciousnessStore } from '@proj-anima/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-anima/stage-ui/stores/providers'
import { Button } from '@proj-anima/ui'
import { ref } from 'vue'

const datingSimStore = useDatingSimStore()
const isGenerating = ref(false)

// Binding settings directly to datingSimStore.settings

function toggleDatingSim(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.checked) {
    datingSimStore.enable()
  }
  else {
    datingSimStore.disable()
  }
}

function testDatingSim() {
  datingSimStore.triggerTestSync()
}

async function testLiveGeneration() {
  isGenerating.value = true
  try {
    const llm = useLLM()
    const providers = useProvidersStore()
    const consciousness = useConsciousnessStore()
    const provider = await providers.getProviderInstance(consciousness.activeProvider)

    if (!provider || !consciousness.activeModel) {
      console.error('No active model or provider')
      return
    }

    const v = await import('valibot')
    const generated = await llm.generateObject(
      consciousness.activeModel,
      provider as any,
      {
        messages: [
          { role: 'system', content: 'You are a Dating Sim engine. Generate 4 conversation topics and 2 gift items. Keep them under 4 words.' },
        ],
        schema: v.object({
          topics: v.array(v.string()),
          items: v.array(v.string()),
        }),
      },
    )
    const object = generated as any

    const liveChoices = [
      ...object.topics.map((t: string, i: number) => ({ id: `t${i}`, text: t, icon: 'i-solar:chat-round-dots-bold-duotone', action: 'llm_topic' })),
      ...object.items.map((t: string, i: number) => ({ id: `i${i}`, text: t, icon: 'i-solar:gift-bold-duotone', action: 'llm_item', cost: 1 })),
    ]

    datingSimStore.triggerTestSyncCustom(liveChoices, 'Which topic or item would you like to choose?')
  }
  catch (err) {
    console.error('Live Generation Failed:', err)
  }
  finally {
    isGenerating.value = false
  }
}

function clearTest() {
  datingSimStore.clearTestSync()
}
</script>

<template>
  <div :class="['flex flex-col gap-6', 'mx-auto max-w-2xl', 'p-4 pb-20']">
    <Section
      title="Dating Sim Preferences"
      icon="i-solar:heart-bold-duotone"
      :class="['rounded-2xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    >
      <div :class="['flex flex-col gap-4', 'p-4']">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-medium">
              Enable Dating Sim Overlay
            </h3>
            <p class="text-sm text-neutral-500">
              Activates the zero-window immersive UI for choices and subtitles.
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" :checked="datingSimStore.enabled" class="peer sr-only" @change="toggleDatingSim">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div>
            <h3 class="font-medium">
              Test Overlay
            </h3>
            <p class="text-sm text-neutral-500">
              Injects mock choices and subtitles into the stage.
            </p>
          </div>
          <div class="flex gap-2">
            <Button variant="secondary" @click="clearTest">
              Clear
            </Button>
            <Button variant="secondary" :disabled="isGenerating" @click="testLiveGeneration">
              <span v-if="isGenerating">Generating...</span>
              <span v-else>Live Generate AI Topics</span>
            </Button>
            <Button variant="primary" @click="testDatingSim">
              Inject Test
            </Button>
          </div>
        </div>
      </div>
    </Section>

    <Section
      title="Universal Features"
      icon="i-solar:settings-bold-duotone"
      :class="['rounded-2xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    >
      <div :class="['flex flex-col gap-4', 'p-4']">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">
              Branching Choice Overlay
            </h3>
            <p class="text-sm text-neutral-500">
              Render dynamic dialogue choices from the DSL store.
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="datingSimStore.settings.branchingChoices" type="checkbox" class="peer sr-only">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div>
            <h3 class="font-medium">
              Inline Captions Overlay
            </h3>
            <p class="text-sm text-neutral-500">
              Render character dialogue/subtitles directly overlaying the bottom screen.
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="datingSimStore.settings.inlineCaption" type="checkbox" class="peer sr-only">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div>
            <h3 class="font-medium">
              Lightning Rounds (Timed Choices)
            </h3>
            <p class="text-sm text-neutral-500">
              Enable choice countdown timers to simulate high-pressure quick responses.
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="datingSimStore.settings.lightningRounds" type="checkbox" class="peer sr-only">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-medium">
                Context Depth
              </h3>
              <p class="text-sm text-neutral-500">
                Number of recent messages to include as context for generating suggestions/choices.
              </p>
            </div>
            <span class="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500 font-bold font-mono dark:bg-blue-400/10 dark:text-blue-400">
              {{ datingSimStore.settings.contextDepth }} messages
            </span>
          </div>
          <input
            v-model.number="datingSimStore.settings.contextDepth"
            type="range"
            min="5"
            max="30"
            step="1"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-blue-600 dark:bg-neutral-700"
          >
        </div>

        <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-medium">
                Game Mode
              </h3>
              <p class="text-sm text-neutral-500">
                Choose between sandbox dialogue assisting and goal-driven dating sessions.
              </p>
            </div>
            <select
              v-model="datingSimStore.settings.gameMode"
              class="border border-neutral-300 rounded-lg bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
            >
              <option value="open_ended">
                Sandbox (Open-Ended)
              </option>
              <option value="goal_driven">
                Date Session (Goal-Driven)
              </option>
            </select>
          </div>
        </div>

        <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-medium">
                Scenery Image Spawn Route
              </h3>
              <p class="text-sm text-neutral-500">
                Choose how story scenario concept arts are delivered to the interface.
              </p>
            </div>
            <select
              v-model="datingSimStore.settings.sceneryRoute"
              class="border border-neutral-300 rounded-lg bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
            >
              <option value="background">
                Stage Background (Clean Overlay)
              </option>
              <option value="widget">
                Standalone Widget
              </option>
              <option value="bg_widget">
                Background & Widget (Default)
              </option>
              <option value="inherit">
                Respect Autonomous Artistry settings
              </option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div>
            <h3 class="font-medium">
              Show Choice Weights
            </h3>
            <p class="text-sm text-neutral-500">
              Display intimacy, tension, and AP costs directly on overlay choices (Debug Mode).
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="datingSimStore.settings.showChoiceWeights" type="checkbox" class="peer sr-only">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <div v-if="datingSimStore.settings.gameMode === 'goal_driven'" class="flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-medium">
                  Max Score Threshold
                </h3>
                <p class="text-sm text-neutral-500">
                  Target score required to resolve the date session.
                </p>
              </div>
              <span class="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500 font-bold font-mono dark:bg-blue-400/10 dark:text-blue-400">
                {{ datingSimStore.settings.maxScore }} points
              </span>
            </div>
            <input
              v-model.number="datingSimStore.settings.maxScore"
              type="range"
              min="10"
              max="30"
              step="1"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-blue-600 dark:bg-neutral-700"
            >
          </div>

          <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-medium">
                  Max Session Turns
                </h3>
                <p class="text-sm text-neutral-500">
                  Turn/message limit constraint for the session.
                </p>
              </div>
              <span class="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500 font-bold font-mono dark:bg-blue-400/10 dark:text-blue-400">
                {{ datingSimStore.settings.maxTurns }} turns
              </span>
            </div>
            <input
              v-model.number="datingSimStore.settings.maxTurns"
              type="range"
              min="5"
              max="15"
              step="1"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-blue-600 dark:bg-neutral-700"
            >
          </div>
        </div>
      </div>
    </Section>

    <Section
      title="Live2D Exclusives"
      icon="i-solar:crown-bold-duotone"
      :class="['rounded-2xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    >
      <div :class="['flex flex-col gap-4', 'p-4']">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">
              RPG Intimacy Gating
            </h3>
            <p class="text-sm text-neutral-500">
              Affinity scores unlock secret voice lines, outfits, and responses.
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="datingSimStore.settings.intimacyGating" type="checkbox" class="peer sr-only">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div>
            <h3 class="font-medium">
              Delta Ticking Engine
            </h3>
            <p class="text-sm text-neutral-500">
              Background timers for auto-ticks and character heartbeats.
            </p>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="datingSimStore.settings.autoTicks" type="checkbox" class="peer sr-only">
            <div class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-checked:bg-blue-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>
      </div>
    </Section>

    <Section
      title="Character Metrics (Test Data)"
      icon="i-solar:graph-up-bold-duotone"
      :class="['rounded-2xl', 'bg-white/80 dark:bg-black/75', 'backdrop-blur-lg']"
    >
      <div :class="['flex flex-col gap-6', 'p-6']">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              Intimacy
            </h3>
            <span class="text-pink-500 font-bold">{{ datingSimStore.variables.Intimacy }}</span>
          </div>
          <input v-model.number="datingSimStore.variables.Intimacy" type="range" min="0" max="100" step="1" class="w-full accent-pink-500">
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              Tension
            </h3>
            <span class="text-yellow-500 font-bold">{{ datingSimStore.variables.Tension }}</span>
          </div>
          <input v-model.number="datingSimStore.variables.Tension" type="range" min="0" max="100" step="1" class="w-full accent-yellow-500">
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              Action Points
            </h3>
            <span class="text-blue-500 font-bold">{{ datingSimStore.variables.ActionPoints }}</span>
          </div>
          <input v-model.number="datingSimStore.variables.ActionPoints" type="range" min="0" max="5" step="1" class="w-full accent-blue-500">
        </div>

        <div class="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              Positive Score
            </h3>
            <span class="text-emerald-500 font-bold">{{ datingSimStore.variables.positiveScore }}</span>
          </div>
          <input v-model.number="datingSimStore.variables.positiveScore" type="range" min="0" :max="datingSimStore.settings.maxScore" step="1" class="w-full accent-emerald-500">
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              Negative Score
            </h3>
            <span class="text-red-500 font-bold">{{ datingSimStore.variables.negativeScore }}</span>
          </div>
          <input v-model.number="datingSimStore.variables.negativeScore" type="range" min="0" :max="datingSimStore.settings.maxScore" step="1" class="w-full accent-red-500">
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              Turns Elapsed
            </h3>
            <span class="text-purple-500 font-bold">{{ datingSimStore.variables.turnsElapsed }}</span>
          </div>
          <input v-model.number="datingSimStore.variables.turnsElapsed" type="range" min="0" :max="datingSimStore.settings.maxTurns" step="1" class="w-full accent-purple-500">
        </div>
      </div>
    </Section>
  </div>
  <!-- Background Icon Decoration -->
  <div
    v-motion
    :class="[
      'text-neutral-200/50 dark:text-neutral-600/20',
      'pointer-events-none fixed bottom-0 right--5 z--1',
      'size-60 flex items-center justify-center',
    ]"
    :style="{ top: 'calc(100dvh - 15rem)' }"
    :initial="{ scale: 0.9, opacity: 0, y: 20 }"
    :enter="{ scale: 1, opacity: 1, y: 0 }"
    :duration="500"
  >
    <div :class="['text-6xl', 'i-solar:heart-bold-duotone']" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Dating Sim Preferences
  icon: i-solar:heart-bold-duotone
  settingsEntry: true
  order: 4
  stageTransition:
    name: slide
</route>
