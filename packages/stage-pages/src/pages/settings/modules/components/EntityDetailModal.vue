<script setup lang="ts">
import type { EntityType } from '@proj-airi/stage-ui/libs/search/entity-ledger'

import { useEntityLedgerStore } from '@proj-airi/stage-ui/stores/entity-ledger'
import { useSystemOneStore } from '@proj-airi/stage-ui/stores/modules/system-one'
import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  open: boolean
  entityId: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'deleted', entityId: string): void
}>()

const entityLedgerStore = useEntityLedgerStore()
const systemOneStore = useSystemOneStore()

const isReclassifying = ref(false)
const reclassifyError = ref<string | null>(null)

const entity = computed(() => {
  if (!props.entityId)
    return null
  return entityLedgerStore.activeLedger.entities.get(props.entityId) || null
})

const sources = computed(() => {
  if (!props.entityId)
    return []
  return entityLedgerStore.getEntitySources(props.entityId)
})

const claims = computed(() => {
  if (!props.entityId)
    return []
  return entityLedgerStore.getEntityClaims(props.entityId)
})

const systemOneAudit = computed(() => {
  return entity.value?.attributes?.systemOne || null
})

const availableTypes: EntityType[] = [
  'person',
  'animal',
  'place',
  'organization',
  'activity',
  'concept',
  'unknown',
]

function close() {
  emit('update:open', false)
}

async function handleTypeSelect(newType: EntityType) {
  if (!entity.value)
    return
  await entityLedgerStore.updateEntityType(entity.value.entityId, newType)
}

async function handleReclassify() {
  if (!entity.value || isReclassifying.value)
    return

  isReclassifying.value = true
  reclassifyError.value = null

  try {
    const result = await entityLedgerStore.reclassifyEntity(entity.value.entityId)
    if (!result) {
      reclassifyError.value = 'Classification returned no decision or failed.'
    }
  }
  catch (err: any) {
    reclassifyError.value = err?.message || String(err)
  }
  finally {
    isReclassifying.value = false
  }
}

async function handleDelete() {
  if (!entity.value)
    return
  if (confirm(`Remove entity "${entity.value.label}" and its indexed references from the Knowledge Graph?`)) {
    const id = entity.value.entityId
    await entityLedgerStore.deleteEntity(id)
    emit('deleted', id)
    close()
  }
}

function formatTimestamp(ts?: number | string): string {
  if (!ts)
    return 'Unknown'
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? String(ts) : date.toLocaleString()
}
</script>

<template>
  <div v-if="open && entity" class="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
    <div class="relative max-h-[90vh] max-w-4xl w-full flex flex-col overflow-hidden border border-neutral-200 rounded-[2rem] bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
      <!-- Glow Accent -->
      <div class="pointer-events-none absolute h-64 w-64 bg-primary-500/10 blur-3xl -right-20 -top-20" />

      <!-- Header -->
      <header class="relative z-10 flex flex-col gap-3 border-b border-neutral-100 p-6 dark:border-neutral-800/80">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-3">
              <h2 class="text-2xl text-neutral-900 font-bold dark:text-neutral-50">
                {{ entity.label }}
              </h2>
              <span
                class="rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase"
                :class="[
                  entity.type === 'person' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                  : entity.type === 'animal' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : entity.type === 'place' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : entity.type === 'organization' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                        : entity.type === 'activity' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : entity.type === 'concept' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                            : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
                ]"
              >
                {{ entity.type }}
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs text-neutral-400">
              <code class="text-[11px] font-mono">{{ entity.entityId }}</code>
              <span>•</span>
              <span><strong>{{ entity.mentions.size }}</strong> dialogue mentions</span>
            </div>
          </div>

          <!-- Close Button -->
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 transition-all dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
            @click="close"
          >
            <div class="i-solar:close-circle-bold text-lg" />
          </button>
        </div>

        <!-- Type Selector Bar -->
        <div class="flex flex-wrap items-center gap-1.5 pt-2">
          <span class="mr-1 text-[11px] text-neutral-400 font-bold tracking-wider uppercase">Classify As:</span>
          <button
            v-for="t in availableTypes"
            :key="t"
            type="button"
            :class="[
              'px-2.5 py-1 text-xs font-semibold rounded-lg capitalize transition-all',
              entity.type === t
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-white dark:hover:bg-neutral-800',
            ]"
            @click="handleTypeSelect(t)"
          >
            {{ t }}
          </button>
        </div>
      </header>

      <!-- Scrollable Body -->
      <div class="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
        <!-- 1. System 1 Cognitive Audit Card -->
        <section class="border border-neutral-200/80 rounded-2xl bg-neutral-50/60 p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex items-center justify-between border-b border-neutral-200/60 pb-3 dark:border-neutral-800">
            <div class="flex items-center gap-2">
              <div class="i-solar:cpu-bolt-bold-duotone text-lg text-primary-500" />
              <h3 class="text-xs text-neutral-800 font-bold tracking-wider uppercase dark:text-neutral-200">
                System 1 Cognitive Audit
              </h3>
            </div>
            <div class="flex items-center gap-2">
              <Button
                label="Re-evaluate with System 1"
                icon="i-solar:restart-bold-duotone"
                variant="secondary"
                :disabled="isReclassifying"
                @click="handleReclassify"
              />
            </div>
          </div>

          <div v-if="isReclassifying" class="flex items-center justify-center gap-3 py-6 text-xs text-primary-600 font-semibold">
            <div class="i-solar:loading-bold animate-spin text-lg" />
            <span>Querying System 1 coprocessor ({{ systemOneStore.activeModel }})...</span>
          </div>

          <div v-else-if="systemOneAudit" class="flex flex-col gap-3 pt-4">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="border border-neutral-100 rounded-xl bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/80">
                <span class="block text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Choice</span>
                <span class="text-sm text-neutral-800 font-bold capitalize dark:text-neutral-100">{{ systemOneAudit.choice }}</span>
              </div>
              <div class="border border-neutral-100 rounded-xl bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/80">
                <span class="block text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Confidence</span>
                <span class="text-sm text-neutral-800 font-bold dark:text-neutral-100">
                  {{ Math.round((systemOneAudit.confidence ?? 0.85) * 100) }}%
                </span>
              </div>
              <div class="border border-neutral-100 rounded-xl bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/80">
                <span class="block text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Model</span>
                <span class="truncate text-xs text-neutral-700 font-mono dark:text-neutral-300" :title="systemOneAudit.model">
                  {{ systemOneAudit.model || 'typesafe/jev' }}
                </span>
              </div>
              <div class="border border-neutral-100 rounded-xl bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/80">
                <span class="block text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Audited At</span>
                <span class="text-xs text-neutral-500 dark:text-neutral-400">
                  {{ formatTimestamp(systemOneAudit.timestamp) }}
                </span>
              </div>
            </div>

            <!-- Probabilities Breakdown -->
            <div v-if="systemOneAudit.probabilities && Object.keys(systemOneAudit.probabilities).length > 0" class="flex flex-col gap-1.5 pt-1">
              <span class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Probability Distribution</span>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="(prob, cat) in systemOneAudit.probabilities"
                  :key="cat"
                  class="flex items-center gap-1.5 border border-neutral-200/60 rounded-lg bg-white px-2.5 py-1 text-[11px] dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span class="text-neutral-500 capitalize dark:text-neutral-400">{{ cat }}:</span>
                  <span class="text-neutral-800 font-bold dark:text-neutral-100">{{ Math.round(Number(prob) * 100) }}%</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="pt-4 text-xs text-neutral-400 italic">
            No System 1 decision recorded yet. Click "Re-evaluate with System 1" to classify this entity live in context.
          </div>

          <div v-if="reclassifyError" class="mt-3 border border-rose-500/20 rounded-xl bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
            {{ reclassifyError }}
          </div>
        </section>

        <!-- 2. Dialogue Provenance & Context Mentions -->
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="i-solar:chat-round-line-bold-duotone text-base text-emerald-500" />
              <h3 class="text-xs text-neutral-800 font-bold tracking-wider uppercase dark:text-neutral-200">
                Dialogue Provenance & Occurrences ({{ sources.length }})
              </h3>
            </div>
            <span class="text-[11px] text-neutral-400">Chronological Dialogue Turns</span>
          </div>

          <div v-if="sources.length === 0" class="border border-neutral-100 rounded-2xl bg-neutral-50/50 p-6 text-center text-xs text-neutral-400 dark:border-neutral-800/80 dark:bg-neutral-900/30">
            No direct dialogue turn sources recorded for this entity.
          </div>

          <div v-else class="max-h-72 flex flex-col gap-2.5 overflow-y-auto pr-1">
            <div
              v-for="src in sources"
              :key="src.turnId"
              class="border border-neutral-200/70 rounded-xl bg-white p-3.5 shadow-sm transition-all dark:border-neutral-800 dark:bg-neutral-900/60"
            >
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <span class="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-700 font-bold dark:bg-neutral-800 dark:text-neutral-200">
                  {{ src.speaker }}
                </span>
                <div class="flex items-center gap-2 text-[10px] text-neutral-400">
                  <span class="font-mono">{{ src.turnId }}</span>
                  <span>•</span>
                  <span>{{ formatTimestamp(src.timestamp) }}</span>
                </div>
              </div>
              <p class="text-xs text-neutral-700 leading-relaxed dark:text-neutral-300">
                {{ src.text }}
              </p>
            </div>
          </div>
        </section>

        <!-- 3. Connected Claims & Relational Triples -->
        <section v-if="claims.length > 0" class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <div class="i-solar:diagram-up-bold-duotone text-base text-purple-500" />
            <h3 class="text-xs text-neutral-800 font-bold tracking-wider uppercase dark:text-neutral-200">
              Connected Claims ({{ claims.length }})
            </h3>
          </div>

          <div class="flex flex-col gap-2">
            <div
              v-for="c in claims"
              :key="c.claimId"
              class="flex flex-wrap items-center justify-between gap-2 border border-neutral-200/70 rounded-xl bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/60"
            >
              <div class="flex items-center gap-2 text-xs">
                <span class="text-sky-600 font-bold dark:text-sky-400">{{ c.subject }}</span>
                <span class="text-neutral-400 font-mono">➔</span>
                <span class="text-emerald-600 font-bold dark:text-emerald-400">{{ c.predicate }}</span>
                <span class="text-neutral-400 font-mono">➔</span>
                <span class="text-purple-600 font-bold dark:text-purple-400">{{ c.object }}</span>
              </div>
              <span v-if="c.dateInfo?.formatted_label" class="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 font-bold dark:text-amber-400">
                {{ c.dateInfo.formatted_label }}
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- Footer -->
      <footer class="relative z-10 flex items-center justify-between border-t border-neutral-100 bg-neutral-50/50 p-4 dark:border-neutral-800/80 dark:bg-neutral-900/50">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-rose-600 font-bold transition-all hover:bg-rose-50 dark:text-rose-400 hover:text-rose-700 dark:hover:bg-rose-950/30"
          @click="handleDelete"
        >
          <div class="i-solar:trash-bin-trash-bold-duotone text-sm" />
          <span>Mark as Noise / Delete</span>
        </button>

        <Button
          label="Done"
          variant="primary"
          @click="close"
        />
      </footer>
    </div>
  </div>
</template>
