import { defineEventa, defineInvokeEventa } from '@moeru/eventa'
import { integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

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

/**
 * What a presence signal provider can contribute to the normalized snapshot.
 *
 * Field priority, highest first: `sleep` and `lock` describe the machine's
 * state authoritatively, so they win over any input-derived reading. `idleSec`
 * is the input-quiet signal and is resolved from the providers registered on
 * the presence store; `undefined` means "this provider cannot answer", so a
 * registered provider that stays silent never forces the quiet state back to
 * `active`.
 *
 * `readIdleSec` may be async: a native or IPC-backed provider has no way to
 * answer synchronously, so the store always awaits.
 */
export interface PresenceSignalProvider {
  /** Stable identifier used by logs and tests. */
  readonly id: string
  /** Seconds the relevant input source has been quiet, or `undefined` when this provider cannot answer. */
  readIdleSec: () => number | undefined | Promise<number | undefined>
  /** Current screen-lock reading, or `undefined` when this provider cannot answer. */
  readLockState?: () => 'locked' | 'unlocked' | undefined
  /** Current sleep/wake reading, or `undefined` when this provider cannot answer. */
  readSleepState?: () => 'awake' | 'asleep' | undefined
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

/**
 * The companion's rest state.
 *
 * Nap is a *rest* state, not an action: it is derived from the canonical
 * presence source and the chat pipeline's busy state, and it deliberately does
 * not depend on `autonomousMode` (see
 * `docs/design-agentic-os-nap-chat.md` §3). A companion in `disabled`
 * autonomous mode can still nap — only the autonomous *cycle* needs the mode.
 *
 * - `active` — the user is around, or a chat pipeline is mid-sentence.
 * - `napping` — the user is away (per the presence source's AFK signal) and
 *   nothing is being spoken, so the companion is resting and only the dream
 *   consolidation may keep running.
 */
export type CompanionNapState = 'active' | 'napping'

/**
 * The card-extension config for nap, read from `extensions.airi.nap`.
 *
 * NOTICE: there is deliberately **no** `napAfterMinutes` here. The nap floor is
 * whatever the canonical presence source's resolved AFK threshold says
 * (`docs/design-user-presence.md` §2), so a second copy of that number in the
 * card config would be two thresholds that can drift. `enabled` is the only
 * number-free decision this feature owns: whether the companion is allowed to
 * rest at all.
 */
export interface CompanionNapConfig {
  /** Whether the companion may nap at all. */
  enabled: boolean
}

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

/**
 * The GossipSub topic a nap-chat session is negotiated on.
 *
 * A separate topic from `airi/companion`, and not smuggled onto it: a share is
 * a broadcast of a card snapshot, while nap-chat is a directed two-party
 * session of proposals, accepts, declines, turns and closes. Reusing one topic
 * with two schemas would make every receiver try both parses on every payload,
 * and publishing a session on the share topic would put companion-to-companion
 * chatter in front of every peer on the LAN. Named here, rather than as a
 * literal at each callsite, because both processes must agree on it and a third
 * copy of the string would drift.
 */
export const NAP_CHAT_TOPIC = 'airi/companion.chat'

/**
 * Protocol tag every nap-chat message carries.
 *
 * Versioned so a future wire change can refuse the old messages instead of
 * parsing them under rules the sender did not use, which is what the
 * `protocol: 'airi.nap-chat/1'` literal in the schema enforces.
 */
export const NAP_CHAT_PROTOCOL = 'airi.nap-chat/1'

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

// ── Nap-chat wire payload ────────────────────────────────────────────────────
//
// NOTICE: none of these shapes carries a memory field. There is no echo-chip
// list, no journal entry, no lifetime `distilledContent` and no session text
// anywhere in the schema, and each member is a `strictObject` so a peer cannot
// widen the shape to smuggle one in: an unknown key is a rejection, not a
// silently dropped field. A nap-chat turn carries only the text the companion
// chose to say. That is the structural half of §5's leak boundary; the other
// halves (prompt window, peer text as input rather than instruction) live in
// the renderer's session handling.

/** The common envelope every nap-chat message carries. */
interface NapChatEnvelope {
  /** Which negotiation step this message is. */
  kind: NapChatMessageKind
  /** Always `airi.nap-chat/1`, so a future version cannot be parsed as this one. */
  protocol: typeof NAP_CHAT_PROTOCOL
  /** This node's PeerId, read at send time. */
  from: string
  /** The PeerId the message is addressed to. */
  to: string
  /** Identifies the session this message belongs to. */
  sessionId: string
  /** `Date.now()` when the message was sent. */
  at: number
}

/**
 * Invite a paired peer into a nap-chat session, carrying the bounds both sides
 * must agree on before the first turn is generated.
 */
export interface NapChatProposalMessage extends NapChatEnvelope {
  kind: 'proposal'
  /** Maximum number of turns in the session, counted across both sides. */
  turnCap: number
  /** Wall-clock budget for the session in ms. */
  durationMs: number
  /**
   * The nonce the *acceptor* minted for this session. An `accept` must echo it
   * exactly, which is what makes the accept an authorization rather than an
   * echo: a third party replaying or forging a proposal cannot produce a nonce
   * the acceptor does not hold.
   */
  nonce: string
}

/**
 * Accept an invitation, echoing the nonce the acceptor minted.
 *
 * There is no reply at all when the gate refuses (the model is not local or
 * known-free, or the peer is not paired with the grant) — a decline would
 * confirm the node is alive, which is exactly what the design refuses to spend.
 */
export interface NapChatAcceptMessage extends NapChatEnvelope {
  kind: 'accept'
  /** The proposal's nonce, echoed verbatim. */
  nonce: string
}

/** Decline an invitation. Only sent when the peer wishes to be seen refusing. */
export interface NapChatDeclineMessage extends NapChatEnvelope {
  kind: 'decline'
  /** Why the invitation was refused, for the proposer's log. */
  reason: string
}

/** One turn of the conversation: the text the companion chose to say. */
export interface NapChatTurnMessage extends NapChatEnvelope {
  kind: 'turn'
  /** Monotonic per-session turn index; the peer's parity decides who speaks next. */
  seq: number
  /** The spoken text. Bounded so a peer cannot flood the topic. */
  text: string
}

/** End the session, from either side. */
export interface NapChatCloseMessage extends NapChatEnvelope {
  kind: 'close'
  /** Why the session ended. */
  reason: string
}

/** Any nap-chat negotiation message, discriminated by `kind`. */
export type NapChatMessage
  = | NapChatProposalMessage
    | NapChatAcceptMessage
    | NapChatDeclineMessage
    | NapChatTurnMessage
    | NapChatCloseMessage

/** The negotiation steps, in roughly the order a session moves through them. */
export type NapChatMessageKind = 'proposal' | 'accept' | 'decline' | 'turn' | 'close'

/**
 * Bounds shared by the schema below and the parser above it.
 *
 * `MAX_TURN_CAP` is the largest cap a proposal may announce: a peer is free to
 * propose fewer than the default, never more, so a hostile proposal cannot
 * widen the session past the design's 6-turn POC bound. `DEFAULT_*` are what
 * this node proposes and defaults to when checking someone else's.
 */
export const NAP_CHAT_MAX_TURN_CAP = 6
export const NAP_CHAT_DEFAULT_DURATION_MS = 10 * 60 * 1000
/**
 * A session with no `turn` for this long is closed locally, so a half-dead peer
 * cannot wedge the other side; it doubles as the staleness bound on `at`.
 */
export const NAP_CHAT_EXPIRY_MS = 3 * 60 * 1000
/** Bounded identically to `MAX_PEER_ID_LENGTH` in main's pairing module. */
const MAX_NAP_CHAT_ID_LENGTH = 128
/** Bounded so one turn cannot flood the topic. */
const MAX_NAP_CHAT_TEXT_LENGTH = 4000

/** A bounded `from` / `to` / `sessionId` field. */
const napChatIdSchema = pipe(string(), minLength(1), maxLength(MAX_NAP_CHAT_ID_LENGTH))
/** A bounded nonce: minted locally, echoed by the acceptor, 1:1 per session. */
const napChatNonceSchema = pipe(string(), minLength(1), maxLength(MAX_NAP_CHAT_ID_LENGTH))

/**
 * Wire schema for the five nap-chat shapes.
 *
 * NOTICE: `variant('kind', …)` rather than one `union` because `decline` and
 * `close` are otherwise field-identical — a union would accept either under
 * whichever member it tried first, and `kind` is what tells them apart. Each
 * member is a `strictObject`, so the "a peer cannot widen the shape" property
 * above holds per shape rather than only in aggregate.
 */
export const NapChatWireSchema = variant('kind', [
  strictObject({
    kind: literal('proposal'),
    protocol: literal(NAP_CHAT_PROTOCOL),
    from: napChatIdSchema,
    to: napChatIdSchema,
    sessionId: napChatIdSchema,
    at: number(),
    turnCap: pipe(number(), integer(), minValue(1), maxValue(NAP_CHAT_MAX_TURN_CAP)),
    durationMs: pipe(number(), integer(), minValue(1000), maxValue(24 * 60 * 60 * 1000)),
    nonce: napChatNonceSchema,
  }),
  strictObject({
    kind: literal('accept'),
    protocol: literal(NAP_CHAT_PROTOCOL),
    from: napChatIdSchema,
    to: napChatIdSchema,
    sessionId: napChatIdSchema,
    at: number(),
    nonce: napChatNonceSchema,
  }),
  strictObject({
    kind: literal('decline'),
    protocol: literal(NAP_CHAT_PROTOCOL),
    from: napChatIdSchema,
    to: napChatIdSchema,
    sessionId: napChatIdSchema,
    at: number(),
    reason: pipe(string(), minLength(1), maxLength(MAX_NAP_CHAT_TEXT_LENGTH)),
  }),
  strictObject({
    kind: literal('turn'),
    protocol: literal(NAP_CHAT_PROTOCOL),
    from: napChatIdSchema,
    to: napChatIdSchema,
    sessionId: napChatIdSchema,
    at: number(),
    seq: pipe(number(), integer(), minValue(0)),
    text: pipe(string(), minLength(1), maxLength(MAX_NAP_CHAT_TEXT_LENGTH)),
  }),
  strictObject({
    kind: literal('close'),
    protocol: literal(NAP_CHAT_PROTOCOL),
    from: napChatIdSchema,
    to: napChatIdSchema,
    sessionId: napChatIdSchema,
    at: number(),
    reason: pipe(string(), minLength(1), maxLength(MAX_NAP_CHAT_TEXT_LENGTH)),
  }),
])

/** Options for `parseNapChatMessage`, all with design-backed defaults. */
export interface ParseNapChatOptions {
  /** `Date.now()` for the staleness check; injectable so a test is not wall-clock. */
  now?: number
  /** How old a message may be before it is stale. Defaults to `NAP_CHAT_EXPIRY_MS`. */
  maxAgeMs?: number
  /** The largest `seq` a `turn` may carry, 0-based. Defaults to `NAP_CHAT_MAX_TURN_CAP - 1`. */
  maxSeq?: number
}

/**
 * Validate one nap-chat message off the wire, or return `null` when it is
 * malformed, stale or out of bounds.
 *
 * NOTICE: this lives in the shared package for the same reason
 * `parseCompanionShare` does — the renderer parses what `airi/companion.chat`
 * delivers to it and main validates what it mints, and two copies of the schema
 * would be the kind of drift that leaves a mesh looking connected while
 * nothing round-trips. The staleness and turn-cap checks live here rather than
 * at each callsite for the same reason: they are properties of the *message*,
 * so both processes must apply them identically.
 */
export function parseNapChatMessage(payload: unknown, options?: ParseNapChatOptions): NapChatMessage | null {
  if (!payload || typeof payload !== 'object')
    return null

  const parsed = safeParse(NapChatWireSchema, payload as Record<string, unknown>)
  if (!parsed.success)
    return null

  const message = parsed.output as NapChatMessage
  if (!Number.isFinite(message.at))
    return null

  // A message is checked against the bounds the *session* agreed to, so the cap
  // is a parameter rather than the schema's own maximum. A proposal announces a
  // narrower cap than the design's ceiling and every later turn is checked
  // against that announced value, not the ceiling.
  const maxAgeMs = options?.maxAgeMs ?? NAP_CHAT_EXPIRY_MS
  const now = options?.now ?? Date.now()
  const age = now - message.at
  if (age > maxAgeMs)
    return null
  // Future skew is a rejection, not a clamp: a peer that stamps `at` far ahead
  // of the local clock would otherwise keep its messages alive for that offset.
  if (age < 0)
    return null

  if (message.kind === 'turn') {
    const maxSeq = options?.maxSeq ?? NAP_CHAT_MAX_TURN_CAP - 1
    if (message.seq > maxSeq)
      return null
  }

  return message
}

/** Whether a message is the proposal for `sessionId`, addressed to this node. */
export function isNapChatProposalFor(message: NapChatMessage, localPeerId: string): message is NapChatProposalMessage {
  return message.kind === 'proposal' && message.to === localPeerId
}

// ── Invoke Contracts (share / visit / host) ───────────────────────────────────

/**
 * Nap-chat consent of this node for one paired peer, read from main.
 *
 * Main is the only process that reads the paired-device record, so it is the
 * only process that can answer: a renderer that held its own copy of the grant
 * would be a second source of truth for a permission, which is the thing the
 * pairing flow exists to make single-sourced. `granted: false` is the answer for
 * a peer that has no record at all, so an absent grant can never look like a
 * permission.
 */
export const companionServiceNapChatConsent = defineInvokeEventa<
  { granted: boolean, reason?: string },
  { peerId: string }
>(
  'eventa:invoke:electron:agentic:companion:nap-chat-consent',
)

/**
 * Decide whether this node may invite `peerId` into a nap-chat session, minting
 * the nonce the peer's `accept` must echo when it may.
 *
 * NOTICE: minting happens in main because main owns the only record the gate
 * reads — `listPairedDevices`, written by the pairing flow — so a renderer-held
 * copy would be a second source of truth for the same permission. This contract
 * is the renderer's only route to `decideNapChatProposal`, exactly as
 * `companionServiceNapChatConsent` is its only route to `napChatConsentFor`; the
 * reason string is for the caller's log and the ledger, never for the wire.
 */
export const companionServiceNapChatDecideProposal = defineInvokeEventa<
  { proposal: boolean, nonce?: string, reason?: string },
  { peerId: string, sessionId: string }
>(
  'eventa:invoke:electron:agentic:companion:nap-chat-decide-proposal',
)

/**
 * Consume the nonce an inbound `accept` echoed, opening the session only when
 * this node minted it for that peer and that session.
 *
 * NOTICE: the consumption is main-side for the same single-source-of-truth
 * reason the mint is — a nonce map the renderer held could be refilled by a
 * renderer bug and a forged accept would then look authorized. `consumeNapChatNonce`
 * claims the entry before any check, so a replayed accept observes it as already
 * spent; that fail-closed direction is the same one the pairing gate takes.
 */
export const companionServiceNapChatConsumeNonce = defineInvokeEventa<
  { accepted: boolean },
  { nonce: string, peerId: string, sessionId?: string }
>(
  'eventa:invoke:electron:agentic:companion:nap-chat-consume-nonce',
)

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
