import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { ProvisioningSession } from '../database/repos/provisioning-session.repo'
import type { LifetimeMemoryArtifact } from '../types/lifetime-memory'
import type { LifetimePackSection } from './modules/system-one'

import { useBroadcastChannel } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { ref, watch } from 'vue'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { lifetimeMemoryRepo } from '../database/repos/lifetime-memory.repo'
import { provisioningSessionRepo } from '../database/repos/provisioning-session.repo'
import { shortTermMemoryRepo } from '../database/repos/short-term-memory.repo'
import { textJournalRepo } from '../database/repos/text-journal.repo'
import { useAuthStore } from './auth'
import { useLLM } from './llm'
import { useAiriCardStore } from './modules/airi-card'
import { useConsciousnessStore } from './modules/consciousness'
import { useLiveSessionStore } from './modules/live-session'
import { useSystemOneStore } from './modules/system-one'
import { useProvidersStore } from './providers'

interface ProvisioningProgress {
  phase: 'idle' | 'aggregating' | 'chunking' | 'synthesizing' | 'distill_pass_1' | 'distill_pass_2' | 'updating' | 'success' | 'error'
  currentChunk: number
  totalChunks: number
  completedCalls: number
  totalCalls: number
  message: string
}

// Literal JSON Schemas from Bunny Mint lab
const ChunkArchiveJsonSchema = {
  type: 'object',
  properties: {
    durable_facts: { type: 'array', items: { type: 'string' } },
    recurring_preferences: { type: 'array', items: { type: 'string' } },
    recurring_topics: { type: 'array', items: { type: 'string' } },
    relationship_dynamics: { type: 'array', items: { type: 'string' } },
    user_mannerisms: { type: 'array', items: { type: 'string' } },
    meaningful_moments: { type: 'array', items: { type: 'string' } },
    inside_jokes_or_motifs: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'durable_facts',
    'recurring_preferences',
    'recurring_topics',
    'relationship_dynamics',
    'user_mannerisms',
    'meaningful_moments',
    'inside_jokes_or_motifs',
  ],
} as const

const LifetimeArchiveJsonSchema = {
  type: 'object',
  properties: {
    relationship_summary: { type: 'string' },
    recurring_preferences: { type: 'array', items: { type: 'string' } },
    recurring_topics: { type: 'array', items: { type: 'string' } },
    relationship_dynamics: { type: 'array', items: { type: 'string' } },
    user_mannerisms: { type: 'array', items: { type: 'string' } },
    meaningful_old_moments: { type: 'array', items: { type: 'string' } },
    inside_jokes_or_motifs: { type: 'array', items: { type: 'string' } },
    archive_notes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'relationship_summary',
    'recurring_preferences',
    'recurring_topics',
    'relationship_dynamics',
    'user_mannerisms',
    'meaningful_old_moments',
    'inside_jokes_or_motifs',
    'archive_notes',
  ],
} as const

const DistillPass1Schema = {
  type: 'object',
  properties: {
    relationship_core: { type: 'array', items: { type: 'string' } },
    user_patterns: { type: 'array', items: { type: 'string' } },
    shared_rituals: { type: 'array', items: { type: 'string' } },
    stable_topics: { type: 'array', items: { type: 'string' } },
    meaningful_old_moments: { type: 'array', items: { type: 'string' } },
    inside_jokes_or_motifs: { type: 'array', items: { type: 'string' } },
    compression_notes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'relationship_core',
    'user_patterns',
    'shared_rituals',
    'stable_topics',
    'meaningful_old_moments',
    'inside_jokes_or_motifs',
    'compression_notes',
  ],
} as const

// NOTICE: change_notes and changed are ordered first so autoregressive decoding
// evaluates whether durable change occurred before emitting the six pack sections.
const IncrementalMergeSchema = {
  type: 'object',
  properties: {
    change_notes: { type: 'array', items: { type: 'string' } },
    changed: { type: 'boolean' },
    relationship_core: { type: 'array', items: { type: 'string' } },
    user_patterns: { type: 'array', items: { type: 'string' } },
    shared_rituals: { type: 'array', items: { type: 'string' } },
    stable_topics: { type: 'array', items: { type: 'string' } },
    meaningful_old_moments: { type: 'array', items: { type: 'string' } },
    inside_jokes_or_motifs: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'change_notes',
    'changed',
    'relationship_core',
    'user_patterns',
    'shared_rituals',
    'stable_topics',
    'meaningful_old_moments',
    'inside_jokes_or_motifs',
  ],
} as const

interface SourceDoc {
  id: string
  layer: 'raw' | 'stmm' | 'ltmm'
  timestamp: string
  text: string
  branchLabel?: string
}

interface LifetimeArchive {
  relationship_summary: string
  recurring_preferences: string[]
  recurring_topics: string[]
  relationship_dynamics: string[]
  user_mannerisms: string[]
  meaningful_old_moments: string[]
  inside_jokes_or_motifs: string[]
  archive_notes: string[]
}

interface DistilledPack {
  relationship_core: string[]
  user_patterns: string[]
  shared_rituals: string[]
  stable_topics: string[]
  meaningful_old_moments: string[]
  inside_jokes_or_motifs: string[]
  compression_notes: string[]
}

const LOCAL_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

// NOTICE: must match memory-short-term's formatLocalDayKey so increment watermarks
// line up with STMM day keys.
export function formatLocalDayKey(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDocLocalDayKey(timestamp: string): string {
  if (LOCAL_DAY_RE.test(timestamp))
    return timestamp
  const ms = new Date(timestamp).getTime()
  return Number.isNaN(ms) ? getYesterdayLocalDayKey() : formatLocalDayKey(ms)
}

export function parseLocalDayEnd(dayKey: string): number {
  const match = LOCAL_DAY_RE.exec(dayKey)
  if (!match)
    return 0
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
}

export function getYesterdayLocalDayKey() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return formatLocalDayKey(yesterday.getTime())
}

export function clampToYesterday(dayKey: string): string {
  const yesterday = getYesterdayLocalDayKey()
  return dayKey > yesterday ? yesterday : dayKey
}

// NOTICE: mirrors memory-short-term's MAX_SOURCE_CHARS_PER_DAY so an unusually dense
// chat day cannot explode the merge prompt size.
const MAX_SOURCE_CHARS_PER_DAY = 24000
const MAX_CATCHUP_DAYS_PER_RUN = 14
const MAX_UPDATE_HISTORY_ENTRIES = 30
const MAX_MERGES_BEFORE_REBASE = 15

function normalizeDistilledPack(value: unknown): DistilledPack {
  const pack = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
  return {
    relationship_core: asStringArray(pack.relationship_core),
    user_patterns: asStringArray(pack.user_patterns),
    shared_rituals: asStringArray(pack.shared_rituals),
    stable_topics: asStringArray(pack.stable_topics),
    meaningful_old_moments: asStringArray(pack.meaningful_old_moments),
    inside_jokes_or_motifs: asStringArray(pack.inside_jokes_or_motifs),
    compression_notes: asStringArray(pack.compression_notes),
  }
}

export function countPackBullets(pack: DistilledPack): number {
  return (
    pack.relationship_core.length
    + pack.user_patterns.length
    + pack.shared_rituals.length
    + pack.stable_topics.length
    + pack.meaningful_old_moments.length
    + pack.inside_jokes_or_motifs.length
  )
}

export function arePacksContentEqual(a: DistilledPack, b: DistilledPack): boolean {
  return (
    JSON.stringify(a.relationship_core) === JSON.stringify(b.relationship_core)
    && JSON.stringify(a.user_patterns) === JSON.stringify(b.user_patterns)
    && JSON.stringify(a.shared_rituals) === JSON.stringify(b.shared_rituals)
    && JSON.stringify(a.stable_topics) === JSON.stringify(b.stable_topics)
    && JSON.stringify(a.meaningful_old_moments) === JSON.stringify(b.meaningful_old_moments)
    && JSON.stringify(a.inside_jokes_or_motifs) === JSON.stringify(b.inside_jokes_or_motifs)
  )
}

/**
 * Programmatically freezes any section that System 1 (Jev) did not unlock.
 * Even if System 2 hallucinates an edit or drops a bullet in a locked section,
 * TypeScript preserves the exact existing array from `currentPack`.
 */
export function applySurgicalSectionLock(
  currentPack: DistilledPack,
  candidatePack: DistilledPack,
  unlockedSections?: readonly LifetimePackSection[],
): DistilledPack {
  if (!unlockedSections) {
    return {
      ...candidatePack,
      compression_notes: currentPack.compression_notes,
    }
  }
  const unlocked = new Set<LifetimePackSection>(unlockedSections)
  return {
    relationship_core: unlocked.has('relationship_core') ? candidatePack.relationship_core : currentPack.relationship_core,
    user_patterns: unlocked.has('user_patterns') ? candidatePack.user_patterns : currentPack.user_patterns,
    shared_rituals: unlocked.has('shared_rituals') ? candidatePack.shared_rituals : currentPack.shared_rituals,
    stable_topics: unlocked.has('stable_topics') ? candidatePack.stable_topics : currentPack.stable_topics,
    meaningful_old_moments: unlocked.has('meaningful_old_moments') ? candidatePack.meaningful_old_moments : currentPack.meaningful_old_moments,
    inside_jokes_or_motifs: unlocked.has('inside_jokes_or_motifs') ? candidatePack.inside_jokes_or_motifs : currentPack.inside_jokes_or_motifs,
    compression_notes: currentPack.compression_notes,
  }
}

/**
 * Counts bullets across only the specified unlocked sections (or all 6 if unspecified)
 * so the contraction guard still protects unlocked sections without false-triggering
 * when a single small section is updated.
 */
export function countUnlockedPackBullets(
  pack: DistilledPack,
  unlockedSections?: readonly LifetimePackSection[],
): number {
  if (!unlockedSections || unlockedSections.length === 0)
    return countPackBullets(pack)
  return unlockedSections.reduce((sum, key) => sum + pack[key].length, 0)
}

function normalizeLifetimeArchive(value: unknown): LifetimeArchive {
  const archive = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
  return {
    relationship_summary: typeof archive.relationship_summary === 'string' ? archive.relationship_summary : 'No summary generated.',
    recurring_preferences: asStringArray(archive.recurring_preferences),
    recurring_topics: asStringArray(archive.recurring_topics),
    relationship_dynamics: asStringArray(archive.relationship_dynamics),
    user_mannerisms: asStringArray(archive.user_mannerisms),
    meaningful_old_moments: asStringArray(archive.meaningful_old_moments),
    inside_jokes_or_motifs: asStringArray(archive.inside_jokes_or_motifs),
    archive_notes: asStringArray(archive.archive_notes),
  }
}

export function buildBaseArchivePrompt(
  characterName: string,
  manifestCounts: { rawTurnCount: number, stmmBlockCount: number, ltmmEntryCount: number },
  chunkSummaries: any[],
  priorIncrementalPack?: DistilledPack,
) {
  const flattened = {
    durableFacts: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.durable_facts || []),
      ...(priorIncrementalPack?.relationship_core || []),
    ])],
    recurringPreferences: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.recurring_preferences || []),
      ...(priorIncrementalPack?.shared_rituals || []),
    ])],
    recurringTopics: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.recurring_topics || []),
      ...(priorIncrementalPack?.stable_topics || []),
    ])],
    relationshipDynamics: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.relationship_dynamics || []),
      ...(priorIncrementalPack?.relationship_core || []),
    ])],
    userMannerisms: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.user_mannerisms || []),
      ...(priorIncrementalPack?.user_patterns || []),
    ])],
    meaningfulMoments: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.meaningful_moments || []),
      ...(priorIncrementalPack?.meaningful_old_moments || []),
    ])],
    insideJokes: [...new Set([
      ...chunkSummaries.flatMap((c: any) => c.inside_jokes_or_motifs || []),
      ...(priorIncrementalPack?.inside_jokes_or_motifs || []),
    ])],
  }

  const totalDocs = manifestCounts.rawTurnCount + manifestCounts.stmmBlockCount + manifestCounts.ltmmEntryCount

  return [
    `You are building the canonical lifetime relationship archive for "${characterName}".`,
    '',
    'Write the archive from the perspective of actual interactions, not from the character system prompt.',
    'The relationship summary must be one dense paragraph of about five sentences.',
    'It should answer things like:',
    '- how does the user actually treat you?',
    '- what do they like to do with you?',
    '- what do they talk about most?',
    '- what long-ago moments still matter?',
    '',
    'Do not let one recent day overwrite the whole relationship.',
    'Preserve older meaningful moments if they are durable.',
    '',
    `Manifest context: ${totalDocs} documents (${manifestCounts.rawTurnCount} raw / ${manifestCounts.stmmBlockCount} stmm / ${manifestCounts.ltmmEntryCount} ltmm).`,
    '',
    'Durable facts:',
    ...flattened.durableFacts.map(line => `- ${line}`),
    '',
    'Recurring preferences:',
    ...flattened.recurringPreferences.map(line => `- ${line}`),
    '',
    'Recurring topics:',
    ...flattened.recurringTopics.map(line => `- ${line}`),
    '',
    'Relationship dynamics:',
    ...flattened.relationshipDynamics.map(line => `- ${line}`),
    '',
    'User mannerisms:',
    ...flattened.userMannerisms.map(line => `- ${line}`),
    '',
    'Meaningful old moments:',
    ...flattened.meaningfulMoments.map(line => `- ${line}`),
    '',
    'Inside jokes or motifs:',
    ...flattened.insideJokes.map(line => `- ${line}`),
  ].join('\n')
}

function renderLifetimeArchiveMd(characterName: string, rawArchive: LifetimeArchive | Record<string, unknown> | undefined, docCount: number, chunkCount: number) {
  console.log('[memory-lifetime] Rendering Lifetime Archive with raw data:', rawArchive)
  const archive = normalizeLifetimeArchive(rawArchive)
  return [
    `# Lifetime Archive: ${characterName}`,
    '',
    `- Documents processed: ${docCount}`,
    `- Chunk count: ${chunkCount}`,
    '',
    '## Relationship Summary',
    '',
    archive.relationship_summary,
    '',
    '## Recurring Preferences',
    ...archive.recurring_preferences.map(line => `- ${line}`),
    '',
    '## Recurring Topics',
    ...archive.recurring_topics.map(line => `- ${line}`),
    '',
    '## Relationship Dynamics',
    ...archive.relationship_dynamics.map(line => `- ${line}`),
    '',
    '## User Mannerisms',
    ...archive.user_mannerisms.map(line => `- ${line}`),
    '',
    '## Meaningful Old Moments',
    ...archive.meaningful_old_moments.map(line => `- ${line}`),
    '',
    '## Inside Jokes Or Motifs',
    ...archive.inside_jokes_or_motifs.map(line => `- ${line}`),
    '',
    '## Archive Notes',
    ...archive.archive_notes.map(line => `- ${line}`),
    '',
  ].join('\n')
}

export function renderPackForReview(rawPack: DistilledPack | Record<string, unknown> | undefined) {
  const pack = normalizeDistilledPack(rawPack)
  const lines = [
    'relationship_core:',
    ...pack.relationship_core.map(line => `- ${line}`),
    '',
    'user_patterns:',
    ...pack.user_patterns.map(line => `- ${line}`),
    '',
    'shared_rituals:',
    ...pack.shared_rituals.map(line => `- ${line}`),
    '',
    'stable_topics:',
    ...pack.stable_topics.map(line => `- ${line}`),
    '',
    'meaningful_old_moments:',
    ...pack.meaningful_old_moments.map(line => `- ${line}`),
    '',
    'inside_jokes_or_motifs:',
    ...pack.inside_jokes_or_motifs.map(line => `- ${line}`),
  ]
  if (pack.compression_notes.length > 0) {
    lines.push(
      '',
      'compression_notes:',
      ...pack.compression_notes.map(line => `- ${line}`),
    )
  }
  return lines.join('\n')
}

export function formatDayWindowDoc(doc: SourceDoc) {
  const d = new Date(doc.timestamp)
  const hh = Number.isNaN(d.getTime()) ? '00' : String(d.getHours()).padStart(2, '0')
  const mm = Number.isNaN(d.getTime()) ? '00' : String(d.getMinutes()).padStart(2, '0')
  const layer = doc.layer === 'raw' ? 'RAW' : doc.layer.toUpperCase()
  return `[${hh}:${mm}] [${layer}] ${doc.text}`
}

export function buildDayTranscriptWithBudget(docs: SourceDoc[], maxChars = MAX_SOURCE_CHARS_PER_DAY): string {
  // Sacral LTMM journal entries are never truncated; budget applies to raw turns.
  const ltmmDocs = docs.filter(d => d.layer === 'ltmm')
  const otherDocs = docs.filter(d => d.layer !== 'ltmm')

  const ltmmBlock = ltmmDocs.map(formatDayWindowDoc).join('\n')
  const rawBlock = otherDocs.map(formatDayWindowDoc).join('\n')

  const remainingBudget = Math.max(4000, maxChars - ltmmBlock.length)
  let budgetedRaw = rawBlock
  if (rawBlock.length > remainingBudget) {
    const headChars = Math.floor(remainingBudget * 0.4)
    const tailChars = remainingBudget - headChars
    budgetedRaw = [
      rawBlock.slice(0, headChars),
      '... [middle of day omitted for token budget] ...',
      rawBlock.slice(rawBlock.length - tailChars),
    ].join('\n')
  }

  return [budgetedRaw, ltmmBlock].filter(Boolean).join('\n')
}

export async function buildDayTranscriptWithWinnow(
  docs: SourceDoc[],
  maxChars = MAX_SOURCE_CHARS_PER_DAY,
  winnowRunner?: (windows: Array<{ id: string, text: string }>) => Promise<Set<string>>,
): Promise<string> {
  const ltmmDocs = docs.filter(d => d.layer === 'ltmm')
  const rawDocs = docs.filter(d => d.layer !== 'ltmm')
  const ltmmBlock = ltmmDocs.map(formatDayWindowDoc).join('\n')
  const rawCharTotal = rawDocs.reduce((sum, d) => sum + d.text.length + 20, 0)
  const remainingBudget = Math.max(4000, maxChars - ltmmBlock.length)

  // Only invoke System-1 Winnow compaction when raw turns actually exceed the daily budget
  if (winnowRunner && rawCharTotal > remainingBudget && rawDocs.length >= 4) {
    try {
      const WINDOW_SIZE = 4
      const windows: Array<{ id: string, text: string, docs: SourceDoc[] }> = []
      for (let i = 0; i < rawDocs.length; i += WINDOW_SIZE) {
        const group = rawDocs.slice(i, i + WINDOW_SIZE)
        windows.push({
          id: `w${Math.floor(i / WINDOW_SIZE)}`,
          text: group.map(formatDayWindowDoc).join('\n'),
          docs: group,
        })
      }
      const keptIds = await winnowRunner(windows.map(w => ({ id: w.id, text: w.text })))
      const compactedRawDocs = windows
        .filter(w => keptIds.has(w.id))
        .flatMap(w => w.docs)

      // Safety fallback: if every window was classified as filler, keep head+tail baseline
      if (compactedRawDocs.length > 0) {
        return buildDayTranscriptWithBudget([...compactedRawDocs, ...ltmmDocs], maxChars)
      }
    }
    catch (err) {
      console.warn('[memory-lifetime] System-1 Winnow turn compaction failed, falling back to head/tail budget:', err)
    }
  }

  return buildDayTranscriptWithBudget(docs, maxChars)
}

export function buildIncrementalMergePrompt(
  characterName: string,
  day: string,
  docs: SourceDoc[],
  currentPack: DistilledPack,
  targetTokens: number,
  unlockedSections?: readonly LifetimePackSection[],
  precomputedTranscript?: string,
) {
  const transcript = precomputedTranscript ?? buildDayTranscriptWithBudget(docs, MAX_SOURCE_CHARS_PER_DAY)
  const lockDirective = unlockedSections && unlockedSections.length > 0
    ? [
        '',
        'System-1 Audit Lock:',
        `- ONLY modify these unlocked section(s): ${unlockedSections.join(', ')}`,
        '- All other sections MUST be re-emitted unmodified.',
      ]
    : []

  return [
    `You are maintaining the lifetime relationship artifact for "${characterName}".`,
    '',
    `A new completed day of interactions is ready for review: ${day}.`,
    '',
    'Decide whether this day contains any DURABLE relationship information worth integrating:',
    '- a new recurring preference',
    '- a changed relationship pattern',
    '- a new inside joke that is clearly sticky',
    '- a major emotional event',
    '- a new stable behavior or mannerism',
    '- a new important long-horizon shared memory',
    '',
    'Core rules:',
    '- "tweak if needed" — never rewrite the relationship from scratch based on this day',
    '- preserve every durable truth already in the current pack',
    '- do not let one recent day overwrite the whole relationship',
    '- do not drop older meaningful moments',
    '- if the day was ordinary, repetitive, or holds no durable change, set changed=false and re-emit the current pack exactly',
    '- keep bullet density: 4-14 words per bullet, no essay prose, no markdown',
    `- keep the total artifact around ${targetTokens} tokens or less`,
    ...lockDirective,
    '',
    'Output contract:',
    '- change_notes: short bullets describing what you changed, or why the day warranted no change',
    '- changed: true only if you actually modified, added, or consolidated at least one bullet',
    '- emit the complete merged pack (all six sections), not only the changed sections',
    '',
    'Current lifetime pack:',
    renderPackForReview(currentPack),
    '',
    `New day ${day} records:`,
    transcript,
  ].join('\n')
}

// NOTICE: Compression Notes are intentionally excluded from distilledContent so internal
// pass-2 compiler metadata does not consume live prompt tokens on every conversation turn.
export function renderDistilledArtifactMd(characterName: string, rawPack: DistilledPack | Record<string, unknown> | undefined) {
  const pack = normalizeDistilledPack(rawPack)
  return [
    `# Distilled Lifetime Context Pack: ${characterName}`,
    '',
    '## Relationship Core',
    '',
    ...pack.relationship_core.map(line => `- ${line}`),
    '',
    '## User Patterns',
    '',
    ...pack.user_patterns.map(line => `- ${line}`),
    '',
    '## Shared Rituals',
    '',
    ...pack.shared_rituals.map(line => `- ${line}`),
    '',
    '## Stable Topics',
    '',
    ...pack.stable_topics.map(line => `- ${line}`),
    '',
    '## Meaningful Old Moments',
    '',
    ...pack.meaningful_old_moments.map(line => `- ${line}`),
    '',
    '## Inside Jokes Or Motifs',
    '',
    ...pack.inside_jokes_or_motifs.map(line => `- ${line}`),
    '',
  ].join('\n')
}

export const useMemoryLifetimeStore = defineStore('memory-lifetime', () => {
  const { userId } = storeToRefs(useAuthStore())
  const { cards } = storeToRefs(useAiriCardStore())
  const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
  const providersStore = useProvidersStore()
  const llmStore = useLLM()
  const systemOneStore = useSystemOneStore()

  // Active-universe artifact map keyed by characterId (for backwards compatibility with UI/session-store)
  const artifacts = ref<Map<string, LifetimeMemoryArtifact>>(new Map())
  // Strictly isolated universe cache keyed by `${characterId}:${universeId}`
  const artifactsByUniverse = ref<Map<string, LifetimeMemoryArtifact>>(new Map())

  const { data: lifetimeSyncSignal, post: broadcastLifetimeSync } = useBroadcastChannel<{ characterId: string, universeId?: string }, { characterId: string, universeId?: string }>({ name: 'airi:lifetime-memory-sync' })

  watch(lifetimeSyncSignal, (val) => {
    if (val?.characterId) {
      console.log(`[MemoryLifetime] Received lifetime sync signal for character: ${val.characterId} (universe: ${val.universeId}), reloading...`)
      void loadForCharacter(val.characterId, val.universeId || 'global')
    }
  })

  const activeSession = ref<ProvisioningSession | null>(null)
  const loading = ref(false)
  const isProvisioning = ref(false)
  const isUpdatingIncremental = ref(false)
  const progress = ref<ProvisioningProgress>({
    phase: 'idle',
    currentChunk: 0,
    totalChunks: 0,
    completedCalls: 0,
    totalCalls: 0,
    message: '',
  })
  const error = ref<string | null>(null)
  // NOTICE: background incremental merges must never touch `error`/`progress`
  // (owned by the interactive provisioning modal — see F-06). Manual "Sync
  // Thread Now" surfaces failures through this dedicated ref instead.
  const incrementalError = ref<string | null>(null)

  function getCurrentUserId() {
    return userId.value || 'local'
  }

  function setCachedArtifact(characterId: string, universeId: string, artifact: LifetimeMemoryArtifact | null) {
    const compositeKey = `${characterId}:${universeId}`
    if (artifact) {
      const tagged: LifetimeMemoryArtifact = { ...artifact, universeId }
      artifactsByUniverse.value.set(compositeKey, tagged)
      artifacts.value.set(characterId, tagged)
    }
    else {
      artifactsByUniverse.value.delete(compositeKey)
      const current = artifacts.value.get(characterId)
      if (!current || (current.universeId || 'global') === universeId) {
        artifacts.value.delete(characterId)
      }
    }
  }

  function getArtifact(characterId: string, universeId = 'global'): LifetimeMemoryArtifact | undefined {
    const compositeKey = `${characterId}:${universeId}`
    const exact = artifactsByUniverse.value.get(compositeKey)
    if (exact)
      return exact
    const fallback = artifacts.value.get(characterId)
    if (fallback && (fallback.universeId || 'global') === universeId)
      return fallback
    return undefined
  }

  async function loadForCharacter(characterId: string, universeId = 'global') {
    loading.value = true
    try {
      const [artifact, session] = await Promise.all([
        lifetimeMemoryRepo.getByCharacter(characterId, universeId),
        provisioningSessionRepo.get(characterId, universeId),
      ])
      setCachedArtifact(characterId, universeId, artifact ?? null)
      activeSession.value = session || null
    }
    finally {
      loading.value = false
    }
  }

  async function collectSourceDocs(characterId: string, universeId = 'global'): Promise<SourceDoc[]> {
    const currentUserId = getCurrentUserId()
    const docs: SourceDoc[] = []

    // 1. Raw Sessions
    const index = await chatSessionsRepo.getIndex(currentUserId)
    const characterIndex = index?.characters?.[characterId]
    if (characterIndex) {
      // Get all sessions in the active universe
      const activeSessions: { sessionId: string, title: string, messageCount: number }[] = []
      for (const [sessionId, meta] of Object.entries(characterIndex.sessions)) {
        if ((meta.universeId || 'global') === universeId) {
          activeSessions.push({
            sessionId,
            title: meta.title || 'Untitled Timeline',
            messageCount: meta.messageCount || 0,
          })
        }
      }

      // Sort by messageCount descending so the longest session is treated as the Canonical Timeline
      activeSessions.sort((a, b) => b.messageCount - a.messageCount)

      const seenMessageIds = new Set<string>()
      const seenTrunkTurns = new Set<string>()

      for (let i = 0; i < activeSessions.length; i++) {
        const sessionInfo = activeSessions[i]
        const record = await chatSessionsRepo.getSession(sessionInfo.sessionId)
        if (!record)
          continue

        const isCanonical = i === 0
        const branchLabel = isCanonical
          ? `Canonical Timeline: ${sessionInfo.title}`
          : `Timeline Branch: ${sessionInfo.title} (Alternative Path)`

        record.messages.forEach((msg, idx) => {
          if (msg.role === 'system' || !msg.content)
            return

          if (msg.id && seenMessageIds.has(msg.id))
            return

          let text = ''
          if (typeof msg.content === 'string') {
            text = msg.content
          }
          else if (Array.isArray(msg.content)) {
            // Extract ONLY text parts, ignoring images, tool calls, and binary blobs
            text = msg.content
              .filter(part => part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part)
              .map(part => (part as any).text)
              .join('\n')
          }

          const trimmed = text.trim()
          if (!trimmed)
            return

          const msgTimestampMs = msg.createdAt || record.meta.createdAt || 0
          const dayKey = formatLocalDayKey(msgTimestampMs)
          // Deduplicate cloned fork trunk messages across sessions (same day + role + text)
          const trunkKey = `${dayKey}:${msg.role}:${trimmed}`
          if (seenTrunkTurns.has(trunkKey))
            return

          if (msg.id)
            seenMessageIds.add(msg.id)
          seenTrunkTurns.add(trunkKey)

          docs.push({
            id: `raw:${sessionInfo.sessionId}:${idx}`,
            layer: 'raw',
            timestamp: new Date(msgTimestampMs).toISOString(),
            text: `${msg.role}: ${trimmed}`,
            branchLabel,
          })
        })
      }
    }

    // 2. STMM Blocks (use local end-of-day timestamp so YYYY-MM-DD never shifts to previous day in Western timezones)
    const stmmBlocks = await shortTermMemoryRepo.getAll(currentUserId)
    if (stmmBlocks) {
      stmmBlocks
        .filter(b => b.characterId === characterId && (b.universeId || 'global') === universeId)
        .forEach((block) => {
          const localEndMs = parseLocalDayEnd(block.date)
          docs.push({
            id: `stmm:${block.id}`,
            layer: 'stmm',
            timestamp: localEndMs > 0 ? new Date(localEndMs).toISOString() : block.date,
            text: block.summary,
          })
        })
    }

    // 3. LTMM Entries
    const ltmmEntries = await textJournalRepo.getAll(currentUserId)
    if (ltmmEntries) {
      ltmmEntries
        .filter(e => e.characterId === characterId && (e.universeId || 'global') === universeId)
        .forEach((entry) => {
          docs.push({
            id: `ltmm:${entry.id}`,
            layer: 'ltmm',
            timestamp: new Date(entry.createdAt).toISOString(),
            text: `[Journal: ${entry.title}] ${entry.content}`,
          })
        })
    }

    docs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    // Annotate timeline transitions after chronological sort so branch headers are never orphaned
    let activeBranchLabel = ''
    for (const doc of docs) {
      if (doc.layer === 'raw' && doc.branchLabel && doc.branchLabel !== activeBranchLabel) {
        activeBranchLabel = doc.branchLabel
        doc.text = `# ${activeBranchLabel}\n${doc.text}`
      }
    }

    return docs
  }

  function validateJsonSchema(data: any, schema: any) {
    if (!data || typeof data !== 'object')
      throw new Error('Parsed data is not a valid JSON object.')
    if (Object.keys(data).length === 0)
      throw new Error('Model returned an empty object {}.')

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) {
          throw new Error(`Model response is missing required key: ${key}`)
        }
      }
    }
    return data
  }

  async function callJsonMode<T>(prompt: string, schema: object, provider: ChatProvider, modelId: string, systemExtras: string[] = []): Promise<T> {
    const systemPrompt = [
      'You must return ONLY valid JSON.',
      'Do not return markdown fences.',
      'Do not add commentary.',
      'CRITICAL INSTRUCTIONS:',
      '- NEVER return an empty object {} or null.',
      '- NEVER return the schema definition itself. You must return the ACTUAL extracted data that fits the schema.',
      '- Fill in all required fields with the requested information.',
      'Return JSON matching this schema exactly:',
      JSON.stringify(schema, null, 2),
      ...systemExtras,
    ].join('\n')

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ]

    let lastError: unknown

    // 1. Try original json_object mode
    try {
      const response = await llmStore.generate(modelId, provider, messages, {
        requestOverrides: { response_format: { type: 'json_object' } },
      })
      useLiveSessionStore().recordInferenceUsage(response.usage)
      const text = response.text || (response as any).reasoning || (response as any).reasoning_content || '{}'
      console.log(`[memory-lifetime] [json_object] Response text length: ${text.length}`)
      const parsed = JSON.parse(text)
      return validateJsonSchema(parsed, schema) as T
    }
    catch (err: any) {
      lastError = err
      console.warn('[memory-lifetime] json_object format failed, falling back to json_schema:', err?.message || err)
    }

    // 2. Try json_schema mode (Structured Outputs)
    try {
      const response = await llmStore.generate(modelId, provider, messages, {
        requestOverrides: {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'memory_artifact', schema },
          },
        },
      })
      useLiveSessionStore().recordInferenceUsage(response.usage)
      const text = response.text || (response as any).reasoning || (response as any).reasoning_content || '{}'
      console.log(`[memory-lifetime] [json_schema] Response text length: ${text.length}`)
      const parsed = JSON.parse(text)
      return validateJsonSchema(parsed, schema) as T
    }
    catch (err: any) {
      lastError = err
      console.warn('[memory-lifetime] json_schema format failed, falling back to system prompt enforcement:', err?.message || err)
    }

    // 3. Fallback: No response_format, rely purely on system prompt and try to parse
    try {
      const response = await llmStore.generate(modelId, provider, messages, {})
      useLiveSessionStore().recordInferenceUsage(response.usage)
      let text = response.text || (response as any).reasoning || (response as any).reasoning_content || '{}'

      // Clean potential markdown fences
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim()
      }

      console.log(`[memory-lifetime] [fallback] Response text length: ${text.length}`)
      const parsed = JSON.parse(text)
      return validateJsonSchema(parsed, schema) as T
    }
    catch (err) {
      console.error('[memory-lifetime] Final JSON parse fallback failed:', err)
      lastError = err
      throw lastError
    }
  }

  async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    backoffBase = 2000,
    onRetryMessage?: (msg: string) => void,
  ): Promise<T> {
    let lastError: any
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn()
      }
      catch (err) {
        lastError = err
        if (i < maxRetries) {
          const delay = backoffBase * 2 ** i
          const retryMsg = `API Error, retrying in ${delay / 1000}s... (Attempt ${i + 1}/${maxRetries})`
          if (onRetryMessage)
            onRetryMessage(retryMsg)
          else
            progress.value.message = retryMsg
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    throw lastError
  }

  async function provision(
    characterId: string,
    universeId = 'global',
    resume = false,
    intervalSeconds = 0,
    contextLimitTokens = 64,
    targetTokens = 1000,
    priorIncrementalPack?: DistilledPack,
  ) {
    const card = cards.value.get(characterId)
    if (!card)
      throw new Error('Character not found')

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    const maybeDelay = async () => {
      if (intervalSeconds > 0) {
        progress.value.message = `Cooling down... (${intervalSeconds}s)`
        await sleep(intervalSeconds * 1000)
      }
    }

    const providerId = card.extensions?.airi?.modules?.consciousness?.provider || activeProvider.value
    const modelId = card.extensions?.airi?.modules?.consciousness?.model || activeModel.value
    const provider = await providersStore.getProviderInstance<ChatProvider>(providerId!)
    if (!provider || !modelId)
      throw new Error('Consciousness not configured')

    isProvisioning.value = true
    error.value = null
    const runStart = Date.now()

    try {
      let session!: ProvisioningSession
      let docs: SourceDoc[] = []
      const chunks: SourceDoc[][] = []

      if (resume && activeSession.value) {
        session = activeSession.value
        if (session.universeId) {
          universeId = session.universeId
        }
        if (session.targetTokens) {
          targetTokens = session.targetTokens
        }
        if (session.contextLimitTokens) {
          contextLimitTokens = session.contextLimitTokens
        }
        // Only re-fetch raw source docs if we still need to run chunking
        if (session.phase === 'chunking' || session.phase === 'aggregating' || session.phase === 'idle') {
          docs = await collectSourceDocs(characterId, universeId)
        }
      }
      else {
        progress.value = {
          phase: 'aggregating',
          currentChunk: 0,
          totalChunks: 0,
          completedCalls: 0,
          totalCalls: 0,
          message: 'Collecting relationship history...',
        }
        docs = await collectSourceDocs(characterId, universeId)
      }

      const contextLimitChars = contextLimitTokens * 1024 * 4 // ~4 chars per token

      if (docs.length > 0) {
        // Budgeted Chunking
        let currentChunk: SourceDoc[] = []
        let currentChars = 0
        for (const doc of docs) {
          const docChars = doc.text.length
          if (currentChars + docChars > contextLimitChars && currentChunk.length > 0) {
            chunks.push(currentChunk)
            currentChunk = []
            currentChars = 0
          }
          currentChunk.push(doc)
          currentChars += docChars
        }
        if (currentChunk.length > 0)
          chunks.push(currentChunk)
      }

      const computedManifest = docs.length > 0
        ? {
            rawTurnCount: docs.filter(d => d.layer === 'raw').length,
            stmmBlockCount: docs.filter(d => d.layer === 'stmm').length,
            ltmmEntryCount: docs.filter(d => d.layer === 'ltmm').length,
          }
        : (session?.sourceManifest ?? { rawTurnCount: 0, stmmBlockCount: 0, ltmmEntryCount: 0 })

      const lastDoc = docs[docs.length - 1]
      // NOTICE: Clamp initial watermark to yesterday so any conversations continuing later
      // today are still reviewed once today closes.
      const computedLastConsumedDay = lastDoc
        ? clampToYesterday(parseDocLocalDayKey(lastDoc.timestamp))
        : getYesterdayLocalDayKey()

      if (!resume || !activeSession.value) {
        session = {
          characterId,
          universeId,
          phase: 'chunking',
          chunkSummaries: [],
          sourceDocCount: docs.length,
          sourceManifest: computedManifest,
          lastConsumedDay: computedLastConsumedDay,
          totalChunks: chunks.length,
          completedChunks: 0,
          updatedAt: Date.now(),
          targetTokens,
          contextLimitTokens,
        }
        await provisioningSessionRepo.save(session)
        activeSession.value = session
      }

      // EXPOSE FOR DEBUGGING
      if (typeof window !== 'undefined' && chunks.length > 0) {
        (window as any).__LIFETIME_DEBUG_CHUNKS = chunks
        console.log('[memory-lifetime] Chunks prepared for inspection:', chunks)
      }

      const effectiveTotalChunks = chunks.length > 0 ? chunks.length : (session.totalChunks || session.chunkSummaries.length)
      // N chunks + 1 base synthesis + 2 distillation passes = N + 3
      const totalCalls = effectiveTotalChunks + 3
      progress.value.totalCalls = totalCalls
      progress.value.totalChunks = effectiveTotalChunks

      // Phase 2: Chunking (Durable Fact Extraction)
      if (session.phase === 'chunking') {
        progress.value.phase = 'chunking'
        for (let i = session.completedChunks; i < chunks.length; i++) {
          progress.value.currentChunk = i + 1
          progress.value.completedCalls = i
          progress.value.message = `Analyzing history in chunks... (${i + 1}/${chunks.length})`

          const currentChunkData = chunks[i]
          const chunkPromptBody = currentChunkData.map((doc, index) => `${index + 1}. [${doc.layer.toUpperCase()}] [${doc.timestamp || 'undated'}] ${doc.text}`).join('\n')

          console.log(`[memory-lifetime] Processing Chunk ${i + 1}/${chunks.length}`, {
            docCount: currentChunkData.length,
            charCount: chunkPromptBody.length,
            estimatedTokens: Math.round(chunkPromptBody.length / 4),
            data: currentChunkData,
          })

          const chunkPrompt = [
            `You are building a durable relationship archive for the character "${card.name}".`,
            `This is chunk ${i + 1} of ${chunks.length}.`,
            '',
            'Extract only durable and reusable relationship information from these records.',
            'Do not restate system-prompt personality assumptions.',
            'Focus on what actually happened in the interactions.',
            'Keep outputs short, specific, and reusable.',
            '',
            'Capture things like:',
            '- recurring preferences',
            '- recurring topics',
            '- relationship dynamics',
            '- user mannerisms',
            '- long-horizon meaningful moments',
            '- inside jokes or motifs',
            '',
            'Source records:',
            chunkPromptBody,
          ].join('\n')

          const summary = await withRetry(() => callJsonMode<any>(chunkPrompt, ChunkArchiveJsonSchema, provider, modelId))
          session.chunkSummaries.push(summary)
          session.completedChunks = i + 1
          session.updatedAt = Date.now()
          await provisioningSessionRepo.save(session)
          await maybeDelay()
        }
        session.phase = 'synthesizing'
        await provisioningSessionRepo.save(session)
      }

      const resolvedManifest = session.sourceManifest ?? computedManifest
      const resolvedDocCount = session.sourceDocCount || (resolvedManifest.rawTurnCount + resolvedManifest.stmmBlockCount + resolvedManifest.ltmmEntryCount)

      // Phase 3: Base synthesis using the lab's structured archive contract
      if (session.phase === 'synthesizing') {
        progress.value.phase = 'synthesizing'
        progress.value.completedCalls = effectiveTotalChunks
        progress.value.message = 'Synthesizing base lifetime archive...'

        const synthesisPrompt = buildBaseArchivePrompt(card.name, resolvedManifest, session.chunkSummaries, priorIncrementalPack)
        const synthesisResult = await withRetry(() => callJsonMode<LifetimeArchive>(synthesisPrompt, LifetimeArchiveJsonSchema, provider, modelId))
        session.baseArchive = synthesisResult
        session.baseContent = renderLifetimeArchiveMd(card.name, synthesisResult, resolvedDocCount, effectiveTotalChunks)
        session.phase = 'distill_pass_1'
        session.updatedAt = Date.now()
        await provisioningSessionRepo.save(session)
        await maybeDelay()
      }

      // Phase 4A: Distill pass 1 (dedupe + normalize)
      if (session.phase === 'distill_pass_1') {
        progress.value.phase = 'distill_pass_1'
        progress.value.completedCalls = effectiveTotalChunks + 1
        progress.value.message = 'Distilling relational essence (Pass 1/2)...'

        const ratio = targetTokens / 1000
        const distillPass1Prompt = [
          `Compress this ${card.name} archive into a reload-grade lifetime context pack.`,
          '',
          'Goals:',
          '- dedupe repeated bullets',
          '- keep only the most durable relationship truths',
          '- keep old meaningful moments that still matter',
          '- keep the relationship specific and grounded',
          '- make it lighter, denser, and more stable',
          '- output compressed bullet lists, not an essay',
          '- optimize for model context efficiency, not literary beauty',
          '',
          'Desired shape:',
          `- relationship_core: ${Math.round(6 * ratio)}-${Math.round(12 * ratio)} bullets`,
          `- user_patterns: ${Math.round(6 * ratio)}-${Math.round(12 * ratio)} bullets`,
          `- shared_rituals: ${Math.round(4 * ratio)}-${Math.round(10 * ratio)} bullets`,
          `- stable_topics: ${Math.round(6 * ratio)}-${Math.round(12 * ratio)} bullets`,
          `- meaningful_old_moments: ${Math.round(6 * ratio)}-${Math.round(12 * ratio)} bullets`,
          `- inside_jokes_or_motifs: ${Math.round(6 * ratio)}-${Math.round(12 * ratio)} bullets`,
          '- compression_notes: short notes on what was merged/removed',
          '',
          'Archive to compress:',
          session.baseContent!,
        ].join('\n')

        session.distillPass1Pack = normalizeDistilledPack(await withRetry(() => callJsonMode<DistilledPack>(
          distillPass1Prompt,
          DistillPass1Schema,
          provider,
          modelId,
          [
            'You are compressing an internal semantic archive into a reload-grade lifetime artifact.',
            'Do not use markdown.',
            'Compression rules inspired by caveman-compress:',
            '- remove articles when possible: a, an, the',
            '- remove filler: just, really, basically, actually, simply, essentially, generally',
            '- remove pleasantries and hedging',
            '- remove connective fluff: however, furthermore, additionally, in addition',
            '- remove duplication',
            '- merge near-identical bullets',
            '- use short synonyms',
            '- fragments OK in bullets',
            '- keep technical truth, drop fluff',
            '- preserve grounded specifics',
            '- prefer dense and memorable phrasing',
            `- target a compressed reload pack around ${targetTokens} tokens or less`,
            '- do not write an essay paragraph unless absolutely needed',
            '- prefer dense bullet lists over prose',
            '- do not rewrite based on system prompt fantasy',
            '- do not over-index on one recent day',
            'Section definitions:',
            '- relationship_core: highest-level bond, power dynamic, role framing, long-horizon connection',
            '- user_patterns: what the user repeatedly does or how they behave',
            '- shared_rituals: repeated relational routines or repeated intimacy/domestic acts',
            '- stable_topics: recurring conversation/project subjects',
            '- meaningful_old_moments: concrete past events still worth remembering',
            '- inside_jokes_or_motifs: recurring phrases, symbols, jokes, prompt quirks',
          ],
        )))
        session.phase = 'distill_pass_2'
        session.updatedAt = Date.now()
        await provisioningSessionRepo.save(session)
        await maybeDelay()
      }

      // Phase 4B: Distill pass 2 (dense refinement)
      if (session.phase === 'distill_pass_2') {
        progress.value.phase = 'distill_pass_2'
        progress.value.completedCalls = effectiveTotalChunks + 2
        progress.value.message = 'Performing Caveman Refinement (Pass 2/2)...'

        const pass1Pack = normalizeDistilledPack(session.distillPass1Pack)
        const hasPass1Content = Object.values(pass1Pack).some(section => section.length > 0)
        if (!hasPass1Content) {
          throw new Error('Cannot resume distill pass 2 because the cached pass 1 pack is missing or invalid. Re-run provisioning from the beginning.')
        }

        const distillPass2Prompt = [
          'Refine this lifetime context pack into a cleaner final version.',
          '',
          'Critical rules:',
          '- one concept, one section',
          '- do not repeat the same idea across sections',
          '- if a concept fits multiple sections, choose the single best home',
          '- every bullet must be self-contained enough for reload context',
          '- cryptic bullets are not allowed',
          '- keep enough context for a model to use the bullet later',
          '- preserve grounded specifics but compress hard',
          '- remove near-duplicates aggressively',
          '- prefer one canonical phrasing per recurring concept',
          '- bullets should usually be 4-14 words, but may be longer if needed for clarity',
          '- meaningful old moments and inside jokes may use a short clause to explain why they matter',
          `- keep total output around ${targetTokens} tokens or less`,
          '',
          'Current pack to refine:',
          renderPackForReview(pass1Pack),
        ].join('\n')

        const finalDistilledPack = normalizeDistilledPack(await withRetry(() => callJsonMode<DistilledPack>(
          distillPass2Prompt,
          DistillPass1Schema,
          provider,
          modelId,
          [
            'You are compressing an internal semantic archive into a reload-grade lifetime artifact.',
            'Do not use markdown.',
            'Compression rules inspired by caveman-compress:',
            '- remove articles when possible: a, an, the',
            '- remove filler: just, really, basically, actually, simply, essentially, generally',
            '- remove pleasantries and hedging',
            '- remove connective fluff: however, furthermore, additionally, in addition',
            '- remove duplication',
            '- merge near-identical bullets',
            '- use short synonyms',
            '- fragments OK in bullets',
            '- keep technical truth, drop fluff',
            '- preserve grounded specifics',
            '- prefer dense and memorable phrasing',
            `- target a compressed reload pack around ${targetTokens} tokens or less`,
          ],
        )))

        const existingArtifact = getArtifact(characterId, universeId)
        const resolvedWatermark = session.lastConsumedDay || computedLastConsumedDay
        const initialWatermark = existingArtifact?.metadata?.initialConsumedDay || resolvedWatermark

        const artifact: LifetimeMemoryArtifact = {
          id: existingArtifact?.id ?? nanoid(),
          characterId,
          universeId,
          version: (existingArtifact?.version ?? 0) + 1,
          chunkSummaries: session.chunkSummaries,
          baseArchive: session.baseArchive,
          baseContent: session.baseContent!,
          distillPass1Pack: pass1Pack,
          distilledContent: renderDistilledArtifactMd(card.name, finalDistilledPack),
          finalPack: finalDistilledPack,
          sourceManifest: resolvedManifest,
          createdAt: existingArtifact?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          metadata: {
            model: modelId,
            totalElapsedMs: Date.now() - runStart,
            chunkCount: effectiveTotalChunks,
            targetTokens,
            initialConsumedDay: initialWatermark,
            // Incremental watermark: everything up to (and including) this completed day has been consumed.
            lastConsumedDay: resolvedWatermark,
            lastUpdateType: priorIncrementalPack ? 'reprovision' : 'init',
            mergesSinceRebase: 0,
            updateHistory: existingArtifact?.metadata?.updateHistory ?? [],
          },
        }

        await lifetimeMemoryRepo.save(characterId, universeId, artifact)
        await provisioningSessionRepo.delete(characterId, universeId)
        setCachedArtifact(characterId, universeId, artifact)
        activeSession.value = null
        progress.value.phase = 'success'
        progress.value.completedCalls = totalCalls
        progress.value.message = 'Lifetime history successfully provisioned.'
        broadcastLifetimeSync({ characterId, universeId })
      }
    }
    catch (err) {
      console.error('[memory-lifetime] Provisioning failed:', err)
      error.value = err instanceof Error ? err.message : String(err)
      progress.value.phase = 'error'
      progress.value.message = 'Failed to provision lifetime history.'
    }
    finally {
      isProvisioning.value = false
    }
  }

  // NOTICE: windowed collection mirrors the STMM day-bucketing shape so the lifetime merge
  // consumes only completed 24h local day windows (sinceDay < day <= untilDay), plus
  // any LTMM entries written in that window.
  async function collectWindowedDocs(
    characterId: string,
    universeId = 'global',
    sinceDay = '',
    untilDay = getYesterdayLocalDayKey(),
  ): Promise<SourceDoc[]> {
    if (sinceDay && untilDay && sinceDay >= untilDay)
      return []

    const currentUserId = getCurrentUserId()
    const docs: SourceDoc[] = []

    const index = await chatSessionsRepo.getIndex(currentUserId)
    const characterIndex = index?.characters?.[characterId]
    if (characterIndex) {
      const seenMessageIds = new Set<string>()
      const seenDayTurns = new Set<string>()

      for (const [sessionId, meta] of Object.entries(characterIndex.sessions)) {
        if ((meta.universeId || 'global') !== universeId)
          continue

        const record = await chatSessionsRepo.getSession(sessionId)
        if (!record)
          continue

        record.messages.forEach((msg, idx) => {
          if (msg.role === 'system' || !msg.content || !msg.createdAt)
            return

          const msgDay = formatLocalDayKey(msg.createdAt)
          if (msgDay <= sinceDay || (untilDay && msgDay > untilDay))
            return

          if (msg.id && seenMessageIds.has(msg.id))
            return

          let text = ''
          if (typeof msg.content === 'string') {
            text = msg.content
          }
          else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter(part => part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part)
              .map(part => (part as any).text)
              .join('\n')
          }

          const trimmed = text.trim()
          if (!trimmed)
            return

          // Scope text deduplication to the same day so shared fork trunks are deduped
          // without dropping recurring daily greetings on subsequent days.
          const dedupKey = `${msgDay}:${msg.role}:${trimmed}`
          if (seenDayTurns.has(dedupKey))
            return

          if (msg.id)
            seenMessageIds.add(msg.id)
          seenDayTurns.add(dedupKey)

          docs.push({
            id: `raw:${sessionId}:${idx}`,
            layer: 'raw',
            timestamp: new Date(msg.createdAt).toISOString(),
            text: `${msg.role === 'user' ? 'User' : 'Assistant'}: ${trimmed}`,
          })
        })
      }
    }

    const ltmmEntries = await textJournalRepo.getAll(currentUserId)
    if (ltmmEntries) {
      const sinceCutoff = sinceDay ? parseLocalDayEnd(sinceDay) : 0
      const untilCutoff = untilDay ? parseLocalDayEnd(untilDay) : Number.MAX_SAFE_INTEGER
      ltmmEntries
        .filter(e =>
          e.characterId === characterId
          && (e.universeId || 'global') === universeId
          && e.createdAt > sinceCutoff
          && e.createdAt <= untilCutoff,
        )
        .forEach((entry) => {
          docs.push({
            id: `ltmm:${entry.id}`,
            layer: 'ltmm',
            timestamp: new Date(entry.createdAt).toISOString(),
            text: `[Journal: ${entry.title}] ${entry.content}`,
          })
        })
    }

    return docs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  function groupByDay(docs: SourceDoc[]) {
    const groups = new Map<string, SourceDoc[]>()
    for (const doc of docs) {
      const day = parseDocLocalDayKey(doc.timestamp)
      const group = groups.get(day) ?? []
      group.push(doc)
      groups.set(day, group)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }

  const runningUpdates = new Map<string, Promise<void>>()

  async function applyIncrementalUpdate(characterId: string, universeId = 'global') {
    const runKey = `${characterId}:${universeId}`
    if (runningUpdates.has(runKey)) {
      await runningUpdates.get(runKey)
      return
    }

    // Do not collide with an active or paused interactive provisioning run
    if (isProvisioning.value)
      return

    const promise = (async () => {
      const pendingSession = await provisioningSessionRepo.get(characterId, universeId)
      if (pendingSession) {
        console.info(`[memory-lifetime] Skipping incremental update for ${characterId}:${universeId} while a provisioning session is active.`)
        return
      }

      const card = cards.value.get(characterId)
      if (!card)
        return

      let artifact = getArtifact(characterId, universeId)
      if (!artifact) {
        artifact = (await lifetimeMemoryRepo.getByCharacter(characterId, universeId)) ?? undefined
        if (artifact) {
          setCachedArtifact(characterId, universeId, artifact)
        }
      }

      // Silent no-op: a lifetime artifact is required in this universe before maintenance runs.
      if (!artifact) {
        console.info(`[memory-lifetime] No lifetime artifact for ${characterId}:${universeId} (init required first), skipping incremental update.`)
        return
      }

      const yesterdayKey = getYesterdayLocalDayKey()

      // NOTICE: legacy artifacts (pre-watermark, bare-key migration) get bootstrapped forward:
      // the watermark is set to yesterday so increment never re-consumes history the
      // original full-build already covered.
      const watermark = artifact.metadata?.lastConsumedDay
      if (!watermark) {
        artifact.metadata = {
          ...artifact.metadata,
          initialConsumedDay: yesterdayKey,
          lastConsumedDay: yesterdayKey,
        }
        artifact.updatedAt = Date.now()
        await lifetimeMemoryRepo.save(characterId, universeId, artifact)
        setCachedArtifact(characterId, universeId, artifact)
        broadcastLifetimeSync({ characterId, universeId })
        return
      }

      if (watermark >= yesterdayKey)
        return

      const docs = await collectWindowedDocs(characterId, universeId, watermark, yesterdayKey)
      const days = groupByDay(docs)
      if (days.length === 0)
        return

      const missedDays = days.filter(([day]) => day > watermark && day <= yesterdayKey)
      if (missedDays.length === 0)
        return

      const providerId = card.extensions?.airi?.modules?.consciousness?.provider || activeProvider.value
      const modelId = card.extensions?.airi?.modules?.consciousness?.model || activeModel.value
      const provider = await providersStore.getProviderInstance<ChatProvider>(providerId!)
      if (!provider || !modelId)
        throw new Error('Consciousness not configured')

      const targetTokens = artifact.metadata?.targetTokens ?? 1000
      // Legacy artifacts retain the structured pass-1 pack but no final pack — the pass-1 pack
      // is the best available structured package to start merging from.
      const currentPack: DistilledPack = normalizeDistilledPack(artifact.finalPack ?? artifact.distillPass1Pack)
      if (!Object.values(currentPack).some(section => section.length > 0))
        throw new Error('Lifetime artifact has no structured package to merge from. Re-run provisioning to rebuild the foundation.')

      const updateHistory = Array.isArray(artifact.metadata?.updateHistory) ? [...artifact.metadata.updateHistory!] : []
      const perDayQueue = missedDays.slice(0, MAX_CATCHUP_DAYS_PER_RUN)

      isUpdatingIncremental.value = true
      incrementalError.value = null

      try {
        for (let i = 0; i < perDayQueue.length; i++) {
          const [day, dayDocs] = perDayQueue[i]!

          // 1. Prepare transcript (uses System-1 Winnow compaction on >24k char days when configured)
          const dayTranscript = await buildDayTranscriptWithWinnow(
            dayDocs,
            MAX_SOURCE_CHARS_PER_DAY,
            systemOneStore.configured
              ? windows => systemOneStore.runWinnowTurnCompaction(windows)
              : undefined,
          )

          // 2. System-1 Fast Gate (6 parallel contrastive choice heads with distractor basins)
          let unlockedSections: LifetimePackSection[] | undefined
          let systemOneAuditNote: string | undefined

          if (systemOneStore.configured) {
            try {
              const gateResult = await systemOneStore.runLifetimeDayGate({
                characterName: card.name,
                day,
                currentPack: {
                  relationship_core: currentPack.relationship_core,
                  user_patterns: currentPack.user_patterns,
                  shared_rituals: currentPack.shared_rituals,
                  stable_topics: currentPack.stable_topics,
                  meaningful_old_moments: currentPack.meaningful_old_moments,
                  inside_jokes_or_motifs: currentPack.inside_jokes_or_motifs,
                },
                transcript: dayTranscript,
              })

              systemOneAuditNote = gateResult.auditNote

              if (!gateResult.shouldInvokeSystem2) {
                // Fast-Exit (~120ms): zero System-2 calls, zero risk of accidental rewrite
                updateHistory.push({
                  day,
                  changed: false,
                  updatedAt: Date.now(),
                  notes: [gateResult.auditNote],
                })

                artifact = {
                  ...artifact,
                  universeId,
                  updatedAt: Date.now(),
                  metadata: {
                    ...artifact.metadata,
                    lastConsumedDay: day,
                    lastUpdateType: 'incremental',
                    updateHistory: updateHistory.slice(-MAX_UPDATE_HISTORY_ENTRIES),
                  },
                }

                await lifetimeMemoryRepo.save(characterId, universeId, artifact)
                setCachedArtifact(characterId, universeId, artifact)
                broadcastLifetimeSync({ characterId, universeId })
                continue
              }

              unlockedSections = gateResult.triggeredSections
            }
            catch (gateErr) {
              console.warn(`[memory-lifetime] System-1 day gate failed on ${day}, falling back to full System-2 merge:`, gateErr)
              unlockedSections = undefined
              systemOneAuditNote = undefined
            }
          }

          // 3. System-2 Merge (with Surgical Section Lock if System 1 unlocked specific sections)
          const mergePrompt = buildIncrementalMergePrompt(
            card.name,
            day,
            dayDocs,
            currentPack,
            targetTokens,
            unlockedSections,
            dayTranscript,
          )
          const oldTotalBullets = countPackBullets(currentPack)

          const systemExtras = [
            'You are integrating one new completed day of interactions into an existing lifetime relationship artifact.',
            `You are reviewing day ${day} for the character "${card.name}".`,
            '- no markdown',
            '- do not rewrite based on system prompt fantasy',
            '- do not over-index on this one day',
            '- changed=false means the day was routine; re-emit the pack unmodified',
          ]
          if (unlockedSections && unlockedSections.length > 0) {
            systemExtras.push(
              `SYSTEM-1 AUDIT LOCK: Only modify [${unlockedSections.join(', ')}]. Keep all other sections identical.`,
            )
          }

          const result = await withRetry(
            async () => {
              const res = await callJsonMode<DistilledPack & { changed?: unknown, change_notes?: unknown }>(
                mergePrompt,
                IncrementalMergeSchema,
                provider,
                modelId,
                systemExtras,
              )
              if (res.changed === true && oldTotalBullets >= 10) {
                const lockedCandidate = applySurgicalSectionLock(
                  currentPack,
                  normalizeDistilledPack(res),
                  unlockedSections,
                )
                const newTotalBullets = countPackBullets(lockedCandidate)
                if (newTotalBullets < Math.floor(oldTotalBullets * 0.7)) {
                  throw new Error(`Incremental merge contraction guard triggered (${oldTotalBullets} -> ${newTotalBullets} bullets). Retrying.`)
                }
              }
              return res
            },
            3,
            2000,
            msg => console.warn(`[memory-lifetime] ${msg}`),
          )

          // Programmatically freeze any section not unlocked by System 1
          const candidatePack = applySurgicalSectionLock(
            currentPack,
            normalizeDistilledPack(result),
            unlockedSections,
          )

          // Programmatic true-diff verification: only bump version if pack content actually changed
          const changed = result.changed === true && !arePacksContentEqual(currentPack, candidatePack)
          const rawNotes = asStringArray(result.change_notes)
          const mergedNotes = systemOneAuditNote
            ? [systemOneAuditNote, ...rawNotes].slice(0, 8)
            : rawNotes.slice(0, 8)

          updateHistory.push({
            day,
            changed,
            updatedAt: Date.now(),
            notes: mergedNotes,
          })

          if (changed) {
            Object.assign(currentPack, candidatePack)
            artifact = {
              ...artifact,
              universeId,
              version: (artifact.version ?? 1) + 1,
              finalPack: { ...currentPack },
              distillPass1Pack: { ...currentPack },
              distilledContent: renderDistilledArtifactMd(card.name, currentPack),
              createdAt: artifact.createdAt,
              updatedAt: Date.now(),
              metadata: {
                ...artifact.metadata,
                lastConsumedDay: day,
                lastUpdateType: 'incremental',
                mergesSinceRebase: (artifact.metadata?.mergesSinceRebase ?? 0) + 1,
                updateHistory: updateHistory.slice(-MAX_UPDATE_HISTORY_ENTRIES),
              },
            }
          }
          else {
            artifact = {
              ...artifact,
              universeId,
              updatedAt: Date.now(),
              metadata: {
                ...artifact.metadata,
                lastConsumedDay: day,
                lastUpdateType: 'incremental',
                updateHistory: updateHistory.slice(-MAX_UPDATE_HISTORY_ENTRIES),
              },
            }
          }

          // NOTICE: persist per day so a later failure never loses already-consumed progress;
          // the watermark is the recovery point.
          await lifetimeMemoryRepo.save(characterId, universeId, artifact)
          setCachedArtifact(characterId, universeId, artifact)
          broadcastLifetimeSync({ characterId, universeId })
        }

        // v2 Auto-Rollup: when accumulated changed merges reach threshold and cached chunks
        // exist, fold the evolved finalPack back into a fresh canonical baseArchive + 2-pass
        // distillation so generational drift never compounds unbounded.
        if (
          (artifact.metadata?.mergesSinceRebase ?? 0) >= MAX_MERGES_BEFORE_REBASE
          && artifact.chunkSummaries?.length
          && !isProvisioning.value
        ) {
          console.info(`[memory-lifetime] Auto-rollup threshold reached (${artifact.metadata?.mergesSinceRebase} changed merges) for ${characterId}:${universeId}. Consolidating base archive...`)
          await reprovisionFromChunks(characterId, universeId, 0, artifact.metadata?.targetTokens)
        }
      }
      catch (err) {
        console.error('[memory-lifetime] Incremental update failed:', err)
        incrementalError.value = err instanceof Error ? err.message : String(err)
      }
      finally {
        isUpdatingIncremental.value = false
      }
    })()

    runningUpdates.set(runKey, promise)
    try {
      await promise
    }
    finally {
      runningUpdates.delete(runKey)
    }
  }

  async function reprovisionFromChunks(characterId: string, universeId = 'global', intervalSeconds = 0, targetTokens?: number) {
    let artifact = getArtifact(characterId, universeId)
    if (!artifact) {
      artifact = (await lifetimeMemoryRepo.getByCharacter(characterId, universeId)) ?? undefined
      if (artifact)
        setCachedArtifact(characterId, universeId, artifact)
    }
    if (!artifact || !artifact.chunkSummaries?.length) {
      throw new Error('No cached chunks found for re-synthesis')
    }

    const card = cards.value.get(characterId)
    if (!card)
      throw new Error('Character not found')

    const providerId = card.extensions?.airi?.modules?.consciousness?.provider || activeProvider.value
    const modelId = card.extensions?.airi?.modules?.consciousness?.model || activeModel.value
    const provider = await providersStore.getProviderInstance<ChatProvider>(providerId!)
    if (!provider || !modelId)
      throw new Error('Consciousness not configured')

    const resolvedTarget = targetTokens ?? artifact.metadata?.targetTokens ?? 1000
    // Fold any post-init incremental pack bullets into synthesis so re-distilling with a new
    // token budget does not erase incremental evolution accumulated since initial provisioning.
    const priorIncrementalPack = (artifact.version ?? 1) > 1 && artifact.finalPack
      ? normalizeDistilledPack(artifact.finalPack)
      : undefined

    isProvisioning.value = true
    error.value = null
    progress.value = {
      phase: 'synthesizing',
      currentChunk: artifact.chunkSummaries.length,
      totalChunks: artifact.chunkSummaries.length,
      completedCalls: 0,
      totalCalls: 3, // Synthesis + Distill P1 + Distill P2
      message: 'Re-synthesizing from existing chunks...',
    }

    try {
      const session: ProvisioningSession = {
        characterId,
        universeId,
        phase: 'synthesizing',
        chunkSummaries: artifact.chunkSummaries,
        baseArchive: artifact.baseArchive,
        sourceDocCount: artifact.sourceManifest.rawTurnCount + artifact.sourceManifest.stmmBlockCount + artifact.sourceManifest.ltmmEntryCount,
        sourceManifest: artifact.sourceManifest,
        lastConsumedDay: artifact.metadata?.lastConsumedDay ?? artifact.metadata?.initialConsumedDay ?? getYesterdayLocalDayKey(),
        totalChunks: artifact.chunkSummaries.length,
        completedChunks: artifact.chunkSummaries.length,
        baseContent: artifact.baseContent,
        distillPass1Pack: artifact.distillPass1Pack,
        updatedAt: Date.now(),
        targetTokens: resolvedTarget,
      }
      await provisioningSessionRepo.save(session)
      activeSession.value = session

      await provision(characterId, universeId, true, intervalSeconds, 64, resolvedTarget, priorIncrementalPack)
    }
    finally {
      isProvisioning.value = false
    }
  }

  async function restart(characterId: string, universeId = 'global', contextLimitTokens = 64, targetTokens = 1000) {
    await provisioningSessionRepo.delete(characterId, universeId)
    activeSession.value = null
    await provision(characterId, universeId, false, 0, contextLimitTokens, targetTokens)
  }

  return {
    artifacts,
    artifactsByUniverse,
    activeSession,
    loading,
    isProvisioning,
    isUpdatingIncremental,
    progress,
    error,
    incrementalError,
    getArtifact,
    loadForCharacter,
    provision,
    reprovisionFromChunks,
    restart,
    collectSourceDocs,
    collectWindowedDocs,
    applyIncrementalUpdate,
  }
})
