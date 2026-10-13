import { defineEventa, defineInvokeEventa } from '@moeru/eventa'
import { number, object, optional, picklist, safeParse, string } from 'valibot'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * The presence state derived by the renderer from the signals the sensors
 * service actually exposes today.
 *
 * NOTICE (derivability): only `active`, `idle` and `away` are derived from a
 * real signal in this repository. `screen-locked` and `sleep` exist as
 * discriminated members so callers can distinguish "not observed" from
 * "observed and false"; see `PresenceStateAvailability` below for which of them
 * a running build can actually produce.
 */
export type PresenceState = 'active' | 'idle' | 'away' | 'screen-locked' | 'sleep'

/**
 * Per-state honest availability. A state is `derivable` when a signal that
 * genuinely distinguishes it exists in this repository, and `unavailable` when
 * no such signal exists and the state is therefore never emitted.
 */
export interface PresenceStateAvailability {
  'active': 'derivable'
  'idle': 'derivable'
  'away': 'derivable'
  'screen-locked': 'derivable' | 'unavailable'
  'sleep': 'derivable' | 'unavailable'
}

/** What the presence snapshot exposes about its own derivability. */
export interface PresenceSignalReport {
  /** Idle seconds as last read from `sensorsGetIdleTime`. */
  idleTimeSec: number | null
  /** Whether the idle-time probe has ever returned a value in this session. */
  hasIdleTime: boolean
  /** Whether a screen lock-state signal was observed. */
  hasLockSignal: boolean
  /** Whether a genuine sleep/wake signal was observed. */
  hasSleepSignal: boolean
  /** Which states this build can emit, and which it cannot. */
  availability: PresenceStateAvailability
}

/** The full presence snapshot the Agentic OS cycle gates on. */
export interface PresenceSnapshot {
  state: PresenceState
  /** Epoch ms the snapshot was last recomputed. */
  updatedAt: number
  /** Human-readable reason the state was chosen, for logs and the audit UI. */
  reason: string
  signals: PresenceSignalReport
}

/**
 * Autonomous behaviour mode.
 *
 * - `disabled` — the cycle never runs.
 * - `when-away` — the cycle runs only when presence is `away`.
 * - `always` — the cycle runs whenever the cooldown has elapsed and the
 *   guardrails pass, including while the user is present.
 */
export type AutonomousMode = 'disabled' | 'when-away' | 'always'

/** A candidate intention produced by the memory scan. */
export type IntentionKind
  = | 'continuity-thread'
    | 'pending-promise'
    | 'relationship-grievance'
    | 'relationship-anchor'
    | 'goal-deadline'
    | 'temporal-event'

/**
 * One candidate intention, before scoring.
 *
 * Ranking weights live in `IntentionScoreBreakdown`; the raw fields below are
 * the only inputs the ranker is allowed to read, so the policy stays auditable.
 */
export interface AgenticIntention {
  id: string
  kind: IntentionKind
  /** Which memory pillar the intention was read from. */
  pillar: 'text-journal' | 'echo-chips' | 'lifetime' | 'event-log'
  /** Short label used in the audit log. */
  title: string
  /** The raw text handed to the LLM as the turn's user message. */
  body: string
  /** Epoch ms of the memory the intention was derived from, when known. */
  memoryCreatedAt?: number
  /** Explicit deadline for goal/temporal intentions, when known. */
  deadlineAt?: number
  /**
   * Relationship heat for grievance/anchor intentions, in [0, 1]. Absent for
   * kinds that carry no affect, which the ranker treats as neutral.
   */
  intensity?: number
}

/**
 * The ranking policy, made explicit and serializable so it can be reviewed.
 *
 * Weights are additive points on a 0..1 scale; see
 * `packages/stage-ui/src/stores/agentic-intentions.ts` for the documented
 * rationale and the ordering rules.
 */
export interface IntentionRankingPolicy {
  /** Points for pillar provenance: the pillar the intention was read from. */
  pillarWeights: Record<AgenticIntention['pillar'], number>
  /** Points for the temporal decay of the underlying memory. */
  recency: { fullWeightWithinHours: number, points: number, halfLifeHours: number }
  /** Points for a deadline, scaled by how close it is. */
  deadline: { points: number, withinHours: number }
  /** Points for relationship intensity, in [0, 1]. */
  intensity: number
  /** Multiplier applied to every intention after the additive terms. */
  diversityPenaltyPerDuplicateKind: number
}

/** The score the ranker produced for one intention. */
export interface IntentionScoreBreakdown {
  pillarPoints: number
  recencyPoints: number
  deadlinePoints: number
  intensityPoints: number
  diversityMultiplier: number
  total: number
}

/** A scored intention, ready for selection. */
export interface ScoredIntention {
  intention: AgenticIntention
  score: IntentionScoreBreakdown
}

/** How the single intention was chosen for the cycle. */
export type IntentionSelectionSource = 'jev' | 'local-fallback'

/**
 * What asked for an autonomous cycle.
 *
 * `scheduled` is the mode/presence/cooldown-gated path; `manual` is the user
 * pressing "run now"; `http` is a local OS-automation caller. The latter two
 * bypass the presence and cooldown gates because an explicit request is not an
 * interruption.
 */
export type AutonomousTrigger = 'scheduled' | 'manual' | 'http'

/** The decision record for one autonomous cycle. */
export interface AutonomousDecisionRecord {
  id: string
  timestamp: number
  isoTime: string
  mode: AutonomousMode
  /** What asked for this cycle: the schedule, the user, or a local HTTP caller. */
  trigger: AutonomousTrigger
  presenceState: PresenceState
  /** Candidates considered, before scoring. */
  candidates: AgenticIntention[]
  /** The candidate that won, or null when the cycle produced no action. */
  selected: ScoredIntention | null
  selectionSource: IntentionSelectionSource
  /** Why the cycle stopped, when it produced no action. */
  outcome: 'executed' | 'no-candidates' | 'jev-suppressed' | 'cooldown' | 'guarded' | 'no-provider'
  detail?: string
}

/** Persisted autonomous-mode configuration. */
export interface AgenticOsConfig {
  /** Rendered autonomous mode for the active companion. */
  autonomousMode: AutonomousMode
  /** Cooldown between autonomous cycles, in minutes. */
  cooldownMinutes: number
  /** Whether the local HTTP endpoint for OS automation is enabled. */
  httpEndpointEnabled: boolean
  /** Bearer token for the HTTP endpoint; empty means the endpoint refuses all calls. */
  httpAuthToken: string
  /** Loopback port the HTTP endpoint binds. */
  httpPort: number
}

/**
 * Local HTTP endpoint payload shape, shared between the main-process handler
 * and any OS automation client.
 */
export interface AgenticHttpStatusResponse {
  present: boolean
  presenceState: PresenceState
  autonomousMode: AutonomousMode
  /** Epoch ms of the last cycle the renderer reported, or 0 when none has run. */
  lastCycleAt: number
}

export interface AgenticHttpCycleResponse {
  accepted: boolean
  reason?: string
}

// ── Invoke Contracts (Renderer → Main) ─────────────────────────────────────────

/** Read the persisted autonomous-mode configuration. */
export const agenticServiceGetConfig = defineInvokeEventa<AgenticOsConfig>(
  'eventa:invoke:electron:agentic:get-config',
)

/** Persist a patch of the autonomous-mode configuration. */
export const agenticServiceApplyConfig = defineInvokeEventa<AgenticOsConfig, Partial<AgenticOsConfig>>(
  'eventa:invoke:electron:agentic:apply-config',
)

/**
 * Report the presence snapshot the renderer derived, so main can answer HTTP
 * `/status` without an IPC round-trip. The renderer's snapshot is echoed back
 * so the caller can confirm what main stored.
 */
export const agenticServiceReportPresence = defineInvokeEventa<PresenceSnapshot, PresenceSnapshot>(
  'eventa:invoke:electron:agentic:report-presence',
)

/**
 * Result of asking main to run a cycle. `accepted` is main's decision that a
 * cycle *should* run; the renderer owns whether it actually does.
 */
export interface AgenticCycleRequestResult {
  accepted: boolean
  reason?: string
}

export const agenticServiceTriggerCycle = defineInvokeEventa<AgenticCycleRequestResult, { force?: boolean }>(
  'eventa:invoke:electron:agentic:trigger-cycle',
)

/**
 * Current status of the local HTTP endpoint: `null` when the endpoint is
 * disabled or bound to nothing.
 */
export const agenticServiceGetHttpEndpoint = defineInvokeEventa<{ host: string, port: number } | null>(
  'eventa:invoke:electron:agentic:get-http-endpoint',
)

/** Rotate the HTTP endpoint bearer token, returning the new configuration. */
export const agenticServiceRotateHttpToken = defineInvokeEventa<AgenticOsConfig>(
  'eventa:invoke:electron:agentic:rotate-http-token',
)

// ── Event Contracts (Main → Renderer, push-based) ─────────────────────────────

/** Emitted when the autonomous-mode configuration changes. */
export const agenticServiceConfigChanged = defineEventa<AgenticOsConfig>(
  'eventa:event:electron:agentic:config-changed',
)

/** Emitted when a new autonomous decision record is appended. */
export const agenticServiceDecisionRecorded = defineEventa<AutonomousDecisionRecord>(
  'eventa:event:electron:agentic:decision-recorded',
)

/** Emitted when an OS-automation caller drives a cycle over the HTTP endpoint. */
export const agenticServiceCycleRequested = defineEventa<{ source: 'http', at: number }>(
  'eventa:event:electron:agentic:cycle-requested',
)

// ── Friendship Mesh: Character Card + Memory Snapshot Sharing ─────────────────

/**
 * What a visiting companion may read.
 *
 * The guest boundary is enforced structurally rather than by convention: a
 * share carries exactly one of these levels, and the *host* decides which
 * memories it packs. A guest therefore never holds a capability it was not
 * given — there is no "read more" request to grant or refuse.
 */
export type CompanionShareScope
  = | 'card-only'
    | 'card-and-echo-chips'
    | 'card-and-lifetime'

/** The consent record a host must have set before it will share at all. */
export interface CompanionConsent {
  /** Whether the operator has agreed to share this companion off-device. */
  granted: boolean
  /** When consent was granted, epoch ms. */
  grantedAt?: number
  /** The share level the operator consented to. */
  scope: CompanionShareScope
}

/** A character card offered to, or discovered from, the mesh. */
export interface CompanionShareCard {
  /** Stable id of the shared card. */
  cardId: string
  name: string
  description?: string
  /** Base64 card image, if the operator chose to include one. */
  portraitBase64?: string
  /** The peer id that authored the share. */
  hostPeerId: string
  /** Epoch ms the share was published. */
  publishedAt: number
  /** Scope the host consented to; the guest cannot read beyond it. */
  scope: CompanionShareScope
}

/**
 * Card fields the renderer supplies when sharing.
 *
 * The renderer is the only process that can read the active character card, so
 * it sends the fields the guest should see and main publishes exactly those.
 * This is a view, not a capability: main still gates on its own consent.
 */
export interface CompanionShareInput {
  cardId: string
  name: string
  description?: string
  /**
   * Base64 card image. Bounded by the renderer before it is sent, so topic
   * traffic cannot be blown out by a large portrait.
   */
  portraitBase64?: string
  /** The widest scope the renderer believes the host consented to. */
  scope: CompanionShareScope
}

/**
 * Memory snapshots the renderer supplies when a share scope permits them.
 *
 * Supplied per guest rather than per topic, because a share is a broadcast but
 * a guest's memory must not be: main calls this back into the renderer for the
 * guest that asked, and packs only what this returns.
 */
export interface CompanionGuestSnapshot {
  echoChips: { id: string, content: string, type: string, relevanceScore: number }[]
  lifetimeDistilled?: string
}

/** A guest's view of a visited companion, bounded by the share scope. */
export interface CompanionGuestAccess {
  card: CompanionShareCard
  /**
   * Echo chips the host packed under the granted scope. Empty for
   * `card-only`, which is the default and the safe default.
   */
  echoChips: { id: string, content: string, type: string, relevanceScore: number }[]
  /** The distilled lifetime text, present only for `card-and-lifetime`. */
  lifetimeSummary?: string
}

/**
 * The GossipSub topic a share is published on.
 *
 * `airi/companion` is already in the libp2p service's default topic set
 * (`airi/presence`, `airi/memory`, `airi/vault`, `airi/companion`) and in its
 * computed allow-list, so publishing needs no new subscription — only a
 * publisher. Named here because both processes must agree on it and a third
 * copy of the literal would drift.
 */
export const COMPANION_TOPIC = 'airi/companion'

// ── Wire payload ──────────────────────────────────────────────────────────────
//
// NOTICE: a share carries the card and the consented *scope*, never the memory
// itself. Memory travels only as a direct response from a host to the guest
// that asked, so a broadcast cannot carry another companion's private history
// to every peer on the mesh.

/**
 * Wire schema for one share.
 *
 * `publishedAt` is a **number** epoch on both sides: `CompanionShareCard`
 * declares it a number and the publisher sends `Date.now()`. Declaring it
 * `string()` here would make `parseCompanionShare` reject every share the
 * publisher emits, and the rejection is silent — `safeParse` returns
 * `{ success: false }` with no error surfaced, so the share would look
 * published while every receiver dropped it.
 */
export const CompanionShareWireSchema = object({
  cardId: string(),
  name: string(),
  description: optional(string()),
  portraitBase64: optional(string()),
  hostPeerId: string(),
  publishedAt: number(),
  scope: picklist(['card-only', 'card-and-echo-chips', 'card-and-lifetime']),
})

/** Parsed wire shape, named so consumers need not infer it from the schema. */
export interface CompanionShareWire {
  cardId: string
  name: string
  description?: string
  portraitBase64?: string
  hostPeerId: string
  publishedAt: number
  scope: CompanionShareScope
}

/**
 * Validate one share off the wire, or return `null` when it is malformed.
 *
 * NOTICE: this lives in the shared package because both processes need the same
 * rules — the renderer parses what `airi/companion` delivers to it, and main
 * validates what it records from the renderer. Two copies of this schema would
 * drift, and a drift here is exactly the class of silent drop that makes a mesh
 * look connected while nothing round-trips.
 */
export function parseCompanionShare(payload: unknown): CompanionShareCard | null {
  if (!payload || typeof payload !== 'object')
    return null

  const parsed = safeParse(CompanionShareWireSchema, payload as Record<string, unknown>)
  if (!parsed.success)
    return null

  const share = parsed.output as CompanionShareWire
  if (!Number.isFinite(share.publishedAt))
    return null

  return {
    cardId: share.cardId,
    name: share.name,
    ...(share.description !== undefined ? { description: share.description } : {}),
    ...(share.portraitBase64 !== undefined ? { portraitBase64: share.portraitBase64 } : {}),
    hostPeerId: share.hostPeerId,
    publishedAt: share.publishedAt,
    scope: share.scope,
  }
}

// ── Invoke Contracts (share / visit / host) ───────────────────────────────────

/**
 * Share this companion with the mesh; the host must have granted consent.
 *
 * The card snapshot is supplied by the renderer because main does not read the
 * character card — the card lives in IndexedDB behind the renderer's store, and
 * duplicating that read in main would create two sources of truth for the same
 * card. Main still decides *whether* to publish and *at which scope*, so
 * consent cannot be bypassed by an optimistic renderer.
 */
export const companionServiceShare = defineInvokeEventa<
  { shared: boolean, scope: CompanionShareScope, reason?: string },
  CompanionShareInput
>(
  'eventa:invoke:electron:agentic:companion:share',
)

/** Read a visited companion's guest-visible data by host peer id. */
export const companionServiceVisit = defineInvokeEventa<
  CompanionGuestAccess | { error: string },
  { hostPeerId: string }
>(
  'eventa:invoke:electron:agentic:companion:visit',
)

/** Host a visiting companion for one session, returning what the guest may see. */
export const companionServiceHost = defineInvokeEventa<
  CompanionGuestAccess | { error: string },
  { guestPeerId: string, scope?: CompanionShareScope }
>(
  'eventa:invoke:electron:agentic:companion:host',
)

/**
 * Read this node's current sharing consent.
 *
 * Consent lives in the main process because that is where the publisher is and
 * therefore where a share can be refused; the renderer reads it through here so
 * the settings page never shows a consent state it did not actually read.
 */
export const companionServiceGetConsent = defineInvokeEventa<
  CompanionConsent,
  void
>(
  'eventa:invoke:electron:agentic:companion:get-consent',
)

/** Grant or revoke consent, choosing the share scope when granting. */
export const companionServiceSetConsent = defineInvokeEventa<
  CompanionConsent,
  { granted: boolean, scope: CompanionShareScope }
>(
  'eventa:invoke:electron:agentic:companion:set-consent',
)

/**
 * Renderer → main: the memory snapshot a hosted guest may read.
 *
 * The renderer owns the memory pillars (IndexedDB + Pinia), so it is the only
 * process that can read them. It reports the snapshot here and
 * `companionServiceHost` packs exactly what this reports, so the host side
 * never fabricates memory and never reaches into the renderer's stores.
 */
export const companionServiceReportGuestSnapshot = defineInvokeEventa<
  { reported: boolean },
  CompanionGuestSnapshot
>(
  'eventa:invoke:electron:agentic:companion:report-guest-snapshot',
)

/**
 * Report a share the renderer observed on `airi/companion` to main.
 *
 * The renderer is the only process that sees topic messages (they are pushed to
 * it as `libp2pMessageReceived`), but a *visit* must be answerable by main, which
 * owns the publisher. Reporting the observed share here is what makes
 * `companionServiceVisit` real: main keeps what it observed and hands the guest
 * back, refusing when it never saw a share from that peer — so a visit cannot
 * probe a peer that never shared.
 */
export const companionServiceRecordObservedShare = defineInvokeEventa<
  { recorded: boolean },
  CompanionShareCard
>(
  'eventa:invoke:electron:agentic:companion:record-observed-share',
)

// ── Event Contracts (Main → Renderer) ─────────────────────────────────────────

/** Emitted when a companion share arrives on `airi/companion`. */
export const companionShareReceived = defineEventa<CompanionShareCard>(
  'eventa:event:electron:agentic:companion:share-received',
)

/** Emitted when this node's consent for sharing changes. */
export const companionConsentChanged = defineEventa<CompanionConsent>(
  'eventa:event:electron:agentic:companion:consent-changed',
)
