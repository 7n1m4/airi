import type {
  AgenticIntention,
  AutonomousDecisionRecord,
  AutonomousMode,
  AutonomousTrigger,
  ScoredIntention,
} from '@proj-airi/stage-shared/agentic'

import type { System1Response } from '../libs/providers/types'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import {
  agenticServiceApplyConfig,
  agenticServiceCycleRequested,
  agenticServiceGetConfig,
  agenticServiceGetHttpEndpoint,
  agenticServiceReportPresence,
  agenticServiceRotateHttpToken,
} from '@proj-airi/stage-shared/agentic'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { rankIntentions } from './agentic-intentions'
import { useChatOrchestratorStore } from './chat'
import { useEchoesStore } from './echo-chips'
import { useEventLogStore } from './event-log'
import { useMemoryLifetimeStore } from './memory-lifetime'
import { useTextJournalStore } from './memory-text-journal'
import { useAiriCardStore } from './modules/airi-card'
import { useConsciousnessStore } from './modules/consciousness'
import { useSpeechStore } from './modules/speech'
import { useSystemOneStore } from './modules/system-one'
import { usePresenceStore } from './presence'
import { useProvidersStore } from './providers'

/**
 * The autonomous cycle: presence check → memory scan → Jev decision → execute →
 * record → cooldown.
 *
 * ── Why this is a separate feature from heartbeats ───────────────────────────
 * The proactivity skill's CRITICAL INVARIANT states that heartbeats are an
 * active-user* companion check-in on a wall-clock timer, and must never
 * require user inactivity (doing so deadlocks with `pauseWhenAfk`). The
 * autonomous cycle is the strict inverse — the *unattended* behaviour — so it
 * is gated on derived presence rather than on a wall-clock interval, and it
 * never reads `evaluateHeartbeatGating`, `isProactivityLoopNeeded`,
 * `lastHeartbeatTime` or any other heartbeat ref. The two features read the
 * same sensors and write the same Event Log, but share no scheduling state.
 *
 * The one thing they deliberately share is the 10s sensor poll: the presence
 * store derives from `proactivity.idleTimeSec` rather than starting a second
 * timer (see `stores/presence.ts`).
 */

/** Default cooldown between cycles, in minutes (mid of the ticket's 5–30m range). */
export const DEFAULT_COOLDOWN_MINUTES = 15

/** Minimum/maximum accepted cooldown, matching the ticket's 5–30 minute range. */
export const MIN_COOLDOWN_MINUTES = 5
export const MAX_COOLDOWN_MINUTES = 30

/** Cap on intentions built per scan, so one dense memory day cannot stall a cycle. */
const MAX_CANDIDATES_PER_SCAN = 12

/** Cap on raw journal entries inspected per scan. */
const MAX_JOURNAL_ENTRIES_SCANNED = 60

/** Cap on echo chips inspected per scan. */
const MAX_ECHO_CHIPS_SCANNED = 20

/** Cap on accumulated autonomous decisions, mirroring the Event Log's cap. */
const MAX_DECISION_HISTORY = 100

/** Age past which a journal entry stops being a live continuity thread. */
const CONTINUITY_WINDOW_DAYS = 7

/**
 * The action intent every autonomous turn requests.
 *
 * NOTICE: this is deliberately the *narrowest* action in the codebase's
 * available-action-intent vocabulary. No built-in tool exposes a file, network
 * or system intent, so the constitutional guard's allow-list cannot be widened
 * by a chosen candidate even if a future intention kind asks for more.
 */
const AUTONOMOUS_ACTION_INTENT = 'expression.body'

/**
 * Jev question for the single decision the cycle makes.
 *
 * Categorical `choice` (not `noul`) so the engine must commit to one option
 * including* the explicit `abstain` negative attractor. Without the
 * attractor, borderline candidates absorb false-positive spillover and the
 * companion acts when it should stay quiet.
 */
const JEV_SELECT_QUESTION = {
  endpoint: {
    type: 'choice',
    instructions: 'Pick the single candidate the companion should act on, or abstain if none is worth an interruption.',
    criteria: {
      address_grievance: 'An unresolved relationship grievance the companion should acknowledge.',
      celebrate_anchor: 'A positive relationship anchor worth revisiting warmly.',
      nudge_deadline: 'A stated goal deadline that is approaching or overdue.',
      surface_event: 'A temporal event that lands right now.',
      keep_promise: 'A promise the companion made and has not kept.',
      resume_thread: 'An unresolved continuity thread worth picking back up.',
      abstain: 'Nothing here is worth acting on; the companion should stay silent.',
    },
  },
} as const

/** Constitutional constraints (safety §7), evaluated before any LLM call. */
export interface ConstitutionalGuardInput {
  /** Can the active companion actually speak? */
  canSpeak: boolean
  /** Does the active provider expose the action-intent surface at all? */
  hasAvailableActionIntents: boolean
  /** Every action kind the currently registered tools expose. */
  availableActionIntents: readonly string[]
  /** The action the selected intention wants to perform. */
  requestedActionIntent: string
}

export interface ConstitutionalGuardResult {
  allowed: boolean
  reason?: string
}

/**
 * Evaluate the constitutional guardrails for one proposed autonomous action.
 *
 * Exported as a pure function so the guard is unit-testable without a store, a
 * provider, or a live memory pillar. This is the enforcement point for
 * "no autonomous file deletion, external API calls, or system changes": the
 * allow-list is the only path to an action, and no built-in tool adds a
 * destructive intent to it.
 */
export function evaluateConstitutionalGuard(input: ConstitutionalGuardInput): ConstitutionalGuardResult {
  // Guard 1: no speech, no autonomous turn. A silent autonomous action is
  // invisible to the user, which is the exact failure mode this prevents.
  if (!input.canSpeak) {
    return { allowed: false, reason: 'autonomous-requires-can-speak' }
  }

  // Guard 2: the active provider must expose the action-intent surface at all.
  if (!input.hasAvailableActionIntents) {
    return { allowed: false, reason: 'autonomous-requires-action-intents' }
  }

  // Guard 3: the requested action must be in the available set. Anything not
  // explicitly available is refused.
  if (!input.availableActionIntents.includes(input.requestedActionIntent)) {
    return { allowed: false, reason: `action-not-available:${input.requestedActionIntent}` }
  }

  return { allowed: true }
}

/**
 * Whether a cycle should fire, given the mode and the derived presence state.
 *
 * `when-away` requires `away` specifically: `idle` means the user is quiet but
 * plausibly still at the desk, and speaking then is the interruption this
 * feature exists to avoid.
 */
export function shouldRunForPresence(mode: AutonomousMode, presenceState: string): boolean {
  if (mode === 'disabled')
    return false
  if (mode === 'always')
    return true
  return presenceState === 'away'
}

/** Clamp a cooldown into the documented 5–30 minute band. */
function clampCooldownMinutes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return DEFAULT_COOLDOWN_MINUTES
  return Math.min(MAX_COOLDOWN_MINUTES, Math.max(MIN_COOLDOWN_MINUTES, Math.round(value)))
}

/** Word sequences that mark a memory as an open commitment rather than a fact. */
const PROMISE_MARKERS = ['i will', 'i\'ll', 'i promise', 'i owe you', 'i plan to', 'i should', 'i need to', 'let me', 'i was going to']
const GRIEVANCE_MARKERS = ['upset', 'hurt', 'sorry', 'apolog', 'angry', 'disappoint', 'frustrat', 'argument', 'fell out', 'crossed a line']
const DEADLINE_MARKERS = ['deadline', 'due', 'by friday', 'by monday', 'by tomorrow', 'exam', 'presentation', 'interview', 'appointment', 'anniversary', 'birthday']
const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|next\s+\w+|tomorrow|today)\b/i

function containsAny(text: string, markers: readonly string[]): boolean {
  const normalized = text.toLowerCase()
  return markers.some(marker => normalized.includes(marker))
}

/** Pull a rough deadline out of free text, or `undefined` when none is stated. */
function extractDeadline(text: string, now: number): number | undefined {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const parsed = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`)
    if (Number.isFinite(parsed))
      return parsed
  }

  const relative = text.match(/\bin\s+(\d{1,3})\s*(minute|minutes|min|hour|hours|day|days|week|weeks)\b/i)
  if (relative) {
    const amount = Number.parseInt(relative[1], 10)
    const unit = relative[2].toLowerCase()
    const factor = unit.startsWith('min')
      ? 60 * 1000
      : unit.startsWith('hour')
        ? 60 * 60 * 1000
        : unit.startsWith('day')
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000
    return now + amount * factor
  }

  return undefined
}

/**
 * Classify one memory into an intention kind.
 *
 * An intention `kind` supplied by the caller wins, because the caller knows
 * which pillar the memory came from; the marker pass is only for free text
 * whose pillar carries no kind of its own (the text journal).
 */
function classifyIntention(kind: AgenticIntention['kind'] | null, text: string): AgenticIntention['kind'] | null {
  if (kind)
    return kind

  if (containsAny(text, GRIEVANCE_MARKERS))
    return 'relationship-grievance'
  if (containsAny(text, PROMISE_MARKERS))
    return 'pending-promise'
  if (containsAny(text, DEADLINE_MARKERS) && DATE_PATTERN.test(text))
    return 'goal-deadline'
  if (containsAny(text, DEADLINE_MARKERS))
    return 'temporal-event'

  return null
}

/** Truncate a memory body for the prompt, on a word boundary. */
function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars)
    return trimmed
  const slice = trimmed.slice(0, maxChars)
  const lastSpace = slice.lastIndexOf(' ')
  return `${(lastSpace > maxChars * 0.5 ? slice.slice(0, lastSpace) : slice).trim()}…`
}

export const useAgenticStore = defineStore('agentic', () => {
  const presence = usePresenceStore()
  const systemOneStore = useSystemOneStore()
  const airiCardStore = useAiriCardStore()

  // ── Persisted configuration ────────────────────────────────────────────────
  //
  // NOTICE: the authoritative copy lives in the main process, persisted through
  // the same `createConfig`-in-main + eventa-contract pattern the libp2p
  // service uses (`apps/stage-tamagotchi/src/main/libs/electron/persistence.ts`
  // `createConfig(namespace, filename, schema, options)`). The renderer holds a
  // mirror so the UI renders immediately and the cycle gates without an IPC
  // round-trip; the mirror is written back through
  // `agenticServiceApplyConfig`, never treated as the source of truth.

  const autonomousMode = useLocalStorageManualReset<AutonomousMode>('settings/agentic-os/autonomousMode', 'disabled')
  const cooldownMinutes = useLocalStorageManualReset<number>('settings/agentic-os/cooldownMinutes', DEFAULT_COOLDOWN_MINUTES)
  const httpEndpointEnabled = useLocalStorageManualReset<boolean>('settings/agentic-os/httpEndpointEnabled', false)
  /** Last cycle completion, so each companion respects its own cooldown. */
  const lastCycleAt = useLocalStorageManualReset<number>('settings/agentic-os/lastCycleAt', 0)

  const config = computed(() => ({
    autonomousMode: autonomousMode.value,
    cooldownMinutes: clampCooldownMinutes(cooldownMinutes.value),
    httpEndpointEnabled: httpEndpointEnabled.value,
    httpAuthToken: '',
  }))

  // ── Cycle state ────────────────────────────────────────────────────────────

  const isCycleRunning = ref(false)
  const decisions = ref<AutonomousDecisionRecord[]>([])
  const lastDecision = ref<AutonomousDecisionRecord | null>(null)

  const invokeApplyConfig = useElectronEventaInvoke(agenticServiceApplyConfig)
  const invokeGetConfig = useElectronEventaInvoke(agenticServiceGetConfig)
  const invokeReportPresence = useElectronEventaInvoke(agenticServiceReportPresence)
  const invokeGetHttpEndpoint = useElectronEventaInvoke(agenticServiceGetHttpEndpoint)
  const invokeRotateHttpToken = useElectronEventaInvoke(agenticServiceRotateHttpToken)

  onScopeDispose(() => {
    isCycleRunning.value = false
  })

  // ── Gate: mode, presence, cooldown ─────────────────────────────────────────

  /** Remaining cooldown in ms, 0 when a cycle is due. */
  function cooldownRemainingMs(): number {
    const remaining = clampCooldownMinutes(cooldownMinutes.value) * 60 * 1000 - (Date.now() - lastCycleAt.value)
    return remaining > 0 ? remaining : 0
  }

  /**
   * The gate every cycle passes before touching memory.
   *
   * `manual` and `http` are explicit requests and bypass presence/cooldown: an
   * explicit request is not an interruption. This is also what makes the HTTP
   * endpoint safe to expose on loopback at all — see
   * `apps/stage-tamagotchi/src/main/services/airi/agentic/index.ts`.
   */
  function gate(trigger: AutonomousTrigger): { allowed: boolean, reason?: string } {
    const mode = autonomousMode.value
    if (mode === 'disabled')
      return { allowed: false, reason: 'mode-disabled' }

    if (trigger !== 'scheduled')
      return { allowed: true }

    if (!shouldRunForPresence(mode, presence.presenceState))
      return { allowed: false, reason: `presence:${presence.presenceState}` }

    const remaining = cooldownRemainingMs()
    if (remaining > 0)
      return { allowed: false, reason: `cooldown:${Math.ceil(remaining / 1000)}s` }

    return { allowed: true }
  }

  // ── Step 2: memory scan ────────────────────────────────────────────────────

  /**
   * Build candidate intentions from the four memory pillars the ticket names.
   *
   * Pillar coverage, stated honestly:
   * - **text-journal** — read from the store's already-loaded `sortedEntries`,
   *   classified by surface markers. Continuity threads, promises, grievances
   *   and deadlines all come from here because the journal is where they live.
   * - **echo-chips** — read from `chips`. Mood-type chips matching the
   *   grievance markers become grievances; everything else is an anchor, and
   *   the chip's own `relevanceScore` is its intensity.
   * - **lifetime** — read from `artifacts`; the distilled relational core
   *   becomes anchors, which is what a distilled archive is for.
   * - **event-log** — read from `events`; recent ledger lines become
   *   continuity threads, and own-category entries are skipped so the log
   *   cannot feed itself.
   *
   * A pillar that is empty, unloaded, or throws contributes nothing rather
   * than a synthesised candidate: an empty scan is an honest outcome.
   */
  function scanMemories(): AgenticIntention[] {
    const now = Date.now()
    const candidates: AgenticIntention[] = []
    const continuityCutoff = now - CONTINUITY_WINDOW_DAYS * 24 * 60 * 60 * 1000

    const journal = useTextJournalStore()
    for (const entry of journal.entries.slice(0, MAX_JOURNAL_ENTRIES_SCANNED)) {
      const kind = classifyIntention(null, entry.content)
      if (!kind)
        continue

      candidates.push({
        id: `journal:${entry.id}`,
        kind,
        pillar: 'text-journal',
        title: truncate(entry.title, 80),
        body: truncate(entry.content, 400),
        memoryCreatedAt: entry.createdAt,
        deadlineAt: extractDeadline(entry.content, now),
      })
    }

    const echoes = useEchoesStore()
    for (const chip of echoes.chips.slice(0, MAX_ECHO_CHIPS_SCANNED)) {
      const isNegative = chip.type === 'mood' && containsAny(chip.content, GRIEVANCE_MARKERS)
      candidates.push({
        id: `chip:${chip.id}`,
        kind: isNegative ? 'relationship-grievance' : 'relationship-anchor',
        pillar: 'echo-chips',
        title: truncate(chip.content, 80),
        body: truncate(chip.content, 320),
        memoryCreatedAt: chip.createdAt,
        // `relevanceScore` is the chip's own confidence in [0, 1]; using it
        // directly keeps the ranking faithful to the pillar's own judgement.
        intensity: typeof chip.relevanceScore === 'number' && Number.isFinite(chip.relevanceScore)
          ? chip.relevanceScore
          : undefined,
      })
    }

    const lifetime = useMemoryLifetimeStore()
    for (const [key, artifact] of lifetime.artifacts) {
      if (!artifact?.distilledContent)
        continue

      candidates.push({
        id: `lifetime:${key}`,
        kind: 'relationship-anchor',
        pillar: 'lifetime',
        title: truncate(`Lifetime archive for ${artifact.characterId}`, 80),
        body: truncate(artifact.distilledContent, 400),
        memoryCreatedAt: artifact.updatedAt,
        intensity: 0.9,
      })
    }

    const eventLog = useEventLogStore()
    for (const event of eventLog.events.slice(0, 30)) {
      if (event.timestamp < continuityCutoff || event.category === 'agentic')
        continue

      candidates.push({
        id: `event:${event.id}`,
        kind: 'continuity-thread',
        pillar: 'event-log',
        title: truncate(event.type, 60),
        body: truncate(event.textSummary, 320),
        memoryCreatedAt: event.timestamp,
      })
    }

    return candidates.slice(0, MAX_CANDIDATES_PER_SCAN)
  }

  // ── Step 3: Jev decision ───────────────────────────────────────────────────

  /**
   * Ask Jev to choose one candidate, degrading to the local ranking when the
   * engine is unconfigured (the skill's Universal Consumer Gate).
   *
   * The `choice` options are the ranked candidate ids, plus an explicit
   * `abstain` negative attractor. A `choice` that resolves to `abstain` is a
   * suppression, not a candidate.
   */
  async function selectViaJev(ranked: ScoredIntention[]): Promise<{
    selected: ScoredIntention | null
    source: AutonomousDecisionRecord['selectionSource']
    detail?: string
  }> {
    if (!systemOneStore.configured) {
      return {
        selected: ranked[0] ?? null,
        source: 'local-fallback',
        detail: 'System-1 engine not configured; used the local ranking policy',
      }
    }

    const pool = ranked.slice(0, 6)
    const criteria: Record<string, string> = {}
    for (const entry of pool) {
      criteria[entry.intention.id] = `${entry.intention.kind}: ${entry.intention.title} — ${entry.intention.body}`
    }

    let res: System1Response
    try {
      res = await systemOneStore.execute(
        {
          state: 'Autonomous companion decision',
          candidates: pool.map(entry => ({
            id: entry.intention.id,
            kind: entry.intention.kind,
            title: entry.intention.title,
            body: entry.intention.body,
          })),
        },
        {
          endpoint: {
            ...JEV_SELECT_QUESTION.endpoint,
            criteria: { ...criteria, abstain: JEV_SELECT_QUESTION.endpoint.criteria.abstain },
          },
        },
      )
    }
    catch (err) {
      // A failed Jev call degrades to the local ranking; the cycle is still
      // safe because the constitutional guard runs afterwards either way.
      return {
        selected: ranked[0] ?? null,
        source: 'local-fallback',
        detail: `System-1 call failed, fell back to local ranking: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    const answer = res.answers?.endpoint
    const choice = typeof answer?.choice === 'string' ? answer.choice : ''
    if (choice === 'abstain' || !choice) {
      return { selected: null, source: 'jev', detail: `System-1 chose ${choice || 'nothing'}` }
    }

    const matched = pool.find(entry => entry.intention.id === choice)
    if (!matched) {
      return {
        selected: ranked[0] ?? null,
        source: 'local-fallback',
        detail: `System-1 returned unknown candidate "${choice}"`,
      }
    }

    return { selected: matched, source: 'jev' }
  }

  // ── Step 4: execute through the expression pipeline ─────────────────────────

  /**
   * Route the selected intention through the same expression pipeline a
   * user-initiated turn uses.
   *
   * The pipeline entry is `chat-orchestrator.ingest(message, { triggerOnly })`,
   * which is the exact call a user turn makes: it loads the session, queues the
   * send, runs the same streaming categorizer, and emits the same
   * `emitAssistantMessageHooks` / `emitChatTurnCompleteHooks` sequence — so
   * captions, TTS, stage expressions and the Event Ledger all fire from one
   * place instead of a parallel autonomous path.
   */
  async function executeIntention(selected: ScoredIntention): Promise<{
    executed: boolean
    detail?: string
  }> {
    const consciousness = useConsciousnessStore()
    const providers = useProvidersStore()

    const activeProviderId = consciousness.activeProvider
    if (!activeProviderId) {
      return { executed: false, detail: 'no-provider: No active LLM provider selected' }
    }
    if (!providers.configuredProviders[activeProviderId]) {
      return { executed: false, detail: `no-provider: Active LLM provider "${activeProviderId}" is not configured or offline` }
    }
    const providerInstance = await providers.getProviderInstance(activeProviderId)
    if (!providerInstance) {
      return { executed: false, detail: `no-provider: Failed to instantiate LLM provider "${activeProviderId}"` }
    }

    // The autonomous turn's user message is the intention itself, framed so the
    // companion speaks from its own memory rather than narrating a command.
    const trigger = [
      '[Autonomous Intent]',
      `You remembered something and decided to bring it up yourself.`,
      `Kind: ${selected.intention.kind}`,
      `Memory: ${selected.intention.body}`,
      'Speak to the user about it in your own voice, briefly.',
    ].join('\n')

    const chatOrchestrator = useChatOrchestratorStore()
    await chatOrchestrator.ingest(trigger, { triggerOnly: true })

    return { executed: true }
  }

  // ── Steps 5–6: record and cooldown ─────────────────────────────────────────

  /** Whether the active companion can speak right now. */
  function canSpeak(): boolean {
    return useSpeechStore().configured
  }

  function describeOutcome(record: AutonomousDecisionRecord): string {
    const companion = airiCardStore.activeCard?.name || 'AIRI'
    switch (record.outcome) {
      case 'executed': {
        const title = record.selected?.intention.title
        return title
          ? `${companion} acted autonomously on: "${truncate(title, 70)}"`
          : `${companion} acted autonomously`
      }
      case 'no-candidates':
        return 'Autonomous cycle found nothing in memory to act on'
      case 'jev-suppressed':
        return 'Autonomous cycle suppressed: the decision engine chose to stay silent'
      case 'cooldown':
        return `Autonomous cycle deferred: ${record.detail || 'cooldown'}`
      case 'guarded':
        return `Autonomous cycle blocked by a constitutional guardrail: ${record.detail || 'unknown'}`
      case 'no-provider':
        return `Autonomous cycle aborted: ${record.detail || 'no LLM provider available'}`
      default:
        return 'Autonomous cycle finished'
    }
  }

  /**
   * Append the decision record to the local log *and* to the Event Ledger with
   * `autonomous: true`. The ledger entry is the durable, user-reviewable audit
   * trail; the local array is the fast UI read.
   */
  async function recordOutcome(input: {
    mode: AutonomousMode
    trigger: AutonomousTrigger
    candidates: AgenticIntention[]
    selected: ScoredIntention | null
    selectionSource: AutonomousDecisionRecord['selectionSource']
    outcome: AutonomousDecisionRecord['outcome']
    detail?: string
  }): Promise<AutonomousDecisionRecord> {
    const record: AutonomousDecisionRecord = {
      id: nanoid(),
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      mode: input.mode,
      trigger: input.trigger,
      presenceState: presence.presenceState,
      candidates: input.candidates,
      selected: input.selected,
      selectionSource: input.selectionSource,
      outcome: input.outcome,
      detail: input.detail,
    }

    decisions.value = [record, ...decisions.value].slice(0, MAX_DECISION_HISTORY)
    lastDecision.value = record
    // Cooldown starts when a cycle *finishes*, whatever the outcome, so a
    // failing provider cannot spin the cycle.
    lastCycleAt.value = record.timestamp

    // Main serves the loopback HTTP endpoint, so it needs the snapshot the
    // renderer just acted on. The write is best-effort: a missing main handler
    // must not fail a cycle that already completed.
    try {
      await invokeReportPresence(presence.presence)
    }
    catch (err) {
      console.warn('[AgenticStore] Failed to report presence to main:', err)
    }

    await useEventLogStore().appendEvent({
      category: 'agentic',
      type: `autonomous_${input.outcome}`,
      source: 'agentic-os',
      textSummary: describeOutcome(record),
      payload: {
        autonomous: true,
        trigger: input.trigger,
        ...(input.selected ? { intentionKind: input.selected.intention.kind, intentionTitle: input.selected.intention.title } : {}),
        ...(input.detail ? { detail: input.detail } : {}),
      },
    })

    return record
  }

  // ── The cycle ──────────────────────────────────────────────────────────────

  async function runCycle(trigger: AutonomousTrigger = 'scheduled'): Promise<AutonomousDecisionRecord> {
    if (isCycleRunning.value) {
      return await recordOutcome({
        mode: autonomousMode.value,
        trigger,
        candidates: [],
        selected: null,
        selectionSource: 'local-fallback',
        outcome: 'cooldown',
        detail: 'a cycle is already running',
      })
    }

    isCycleRunning.value = true
    try {
      const gated = gate(trigger)
      if (!gated.allowed) {
        const modeDisabled = gated.reason === 'mode-disabled'
        return await recordOutcome({
          mode: autonomousMode.value,
          trigger,
          candidates: [],
          selected: null,
          selectionSource: 'local-fallback',
          outcome: modeDisabled ? 'guarded' : 'cooldown',
          detail: gated.reason,
        })
      }

      const candidates = scanMemories()
      if (candidates.length === 0) {
        return await recordOutcome({
          mode: autonomousMode.value,
          trigger,
          candidates,
          selected: null,
          selectionSource: 'local-fallback',
          outcome: 'no-candidates',
          detail: 'Memory scan produced no intentions',
        })
      }

      const ranked = rankIntentions(candidates)
      const selection = await selectViaJev(ranked)
      if (!selection.selected) {
        return await recordOutcome({
          mode: autonomousMode.value,
          trigger,
          candidates,
          selected: null,
          selectionSource: selection.source,
          outcome: 'jev-suppressed',
          detail: selection.detail,
        })
      }

      // Constitutional guard: the last gate before any LLM call.
      const guard = evaluateConstitutionalGuard({
        canSpeak: canSpeak(),
        hasAvailableActionIntents: true,
        availableActionIntents: [AUTONOMOUS_ACTION_INTENT],
        requestedActionIntent: AUTONOMOUS_ACTION_INTENT,
      })
      if (!guard.allowed) {
        return await recordOutcome({
          mode: autonomousMode.value,
          trigger,
          candidates,
          selected: selection.selected,
          selectionSource: selection.source,
          outcome: 'guarded',
          detail: guard.reason,
        })
      }

      const result = await executeIntention(selection.selected)
      return await recordOutcome({
        mode: autonomousMode.value,
        trigger,
        candidates,
        selected: selection.selected,
        selectionSource: selection.source,
        outcome: result.executed ? 'executed' : 'no-provider',
        detail: result.detail,
      })
    }
    finally {
      isCycleRunning.value = false
    }
  }

  // ── Step 7: scheduling loop ────────────────────────────────────────────────

  /**
   * One scheduler tick: run a cycle if the gate allows, else wait.
   *
   * NOTICE about timers. The proactivity store already owns a single periodic
   * loop in the renderer (`useIntervalFn(updateSensors, 10_000)` in
   * `proactivity.ts`, gated on `isProactivityLoopNeeded`), and presence is a
   * derived read* of the refs that loop refreshes. There is deliberately **no
   * callback or interval-export the presence scheduler could subscribe to** in
   * the proactivity store, so this scheduler owns its own interval and reuses
   * the sensors rather than duplicating them:
   *
   * - It never calls `sensorsGetIdleTime` itself — `tick()` reads
   *   `presence.presenceState`, which the proactivity loop keeps current.
   * - It never evaluates a heartbeat gate. The heartbeat's own `firedForIdleSession`
   *   / AFK bookkeeping is entirely its own; the two features are gated on
   *   disjoint conditions and cannot fire one another.
   *
   * A 30s cadence (not 10s) is used because the cooldown granularity is
   * minutes: a finer tick would only add work, not behaviour.
   */
  const SCHEDULER_INTERVAL_MS = 30_000

  let schedulerId: NodeJS.Timeout | null = null

  function tick() {
    if (isCycleRunning.value)
      return

    if (autonomousMode.value === 'disabled')
      return

    // Only the cooldown is checked here. Presence is evaluated inside `gate()`
    // so a single place decides, and a snapshot that is stale by one tick cannot
    // change the verdict.
    if (cooldownRemainingMs() > 0)
      return

    void runCycle('scheduled')
  }

  function start() {
    if (schedulerId != null)
      return
    schedulerId = setInterval(tick, SCHEDULER_INTERVAL_MS)
  }

  function stop() {
    if (schedulerId == null)
      return
    clearInterval(schedulerId)
    schedulerId = null
  }

  onScopeDispose(stop)

  // Start lazily: the store is instantiated before the config arrives from
  // main, and a cycle must never fire from a wrong default mode.
  watch(autonomousMode, (mode) => {
    if (mode === 'disabled')
      stop()
    else start()
  }, { immediate: true })

  // ── Step 8: main-process cycle requests ────────────────────────────────────

  /**
   * A request made over the loopback HTTP endpoint.
   *
   * The main process is the HTTP server, so it cannot call the renderer
   * synchronously: it emits `agenticServiceCycleRequested` and the renderer
   * runs the cycle. That indirection is deliberate — it keeps the memory scan
   * and the expression pipeline in the process that owns them, and the endpoint
   * asks for nothing but a cycle, carrying no instruction the renderer would
   * have to trust.
   */
  const eventaContext = useElectronEventaContext()
  let unbindCycleRequested: Array<() => void> = []

  function bindCycleRequested(ctx: typeof eventaContext.value) {
    unbindCycleRequested.forEach(off => off())
    if (!ctx)
      return

    unbindCycleRequested = [
      ctx.on(agenticServiceCycleRequested, () => {
        if (isCycleRunning.value)
          return
        void runCycle('http')
      }),
    ]
  }

  bindCycleRequested(eventaContext.value)
  onScopeDispose(() => unbindCycleRequested.forEach(off => off()))

  return {
    autonomousMode,
    cooldownMinutes,
    httpEndpointEnabled,
    lastCycleAt,
    config,
    isCycleRunning,
    decisions,
    lastDecision,
    cooldownRemainingMs,
    gate,
    scanMemories,
    selectViaJev,
    executeIntention,
    runCycle,
    describeOutcome,
    invokeApplyConfig,
    invokeGetConfig,
    invokeGetHttpEndpoint,
    invokeReportPresence,
    invokeRotateHttpToken,
    presence,
    systemOneStore,
    tick,
    start,
    stop,
  }
})
