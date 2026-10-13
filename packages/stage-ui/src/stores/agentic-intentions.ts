import type {
  AgenticIntention,
  IntentionKind,
  IntentionRankingPolicy,
  IntentionScoreBreakdown,
  ScoredIntention,
} from '@proj-airi/stage-shared/agentic'

/**
 * The autonomous ranking policy.
 *
 * ── Why these weights ────────────────────────────────────────────────────────
 *
 * A companion that acts on its own has one scarce resource: the user's patience
 * for being interrupted. The policy therefore optimises for *the least
 * regrettable action*, not the most informative one. Four additive terms over
 * a memory's provenance, freshness, deadline pressure, and affect, then a
 * diversity multiplier.
 *
 * 1. **Pillar provenance (0.10 – 0.45).** A pillar scores by how much the user
 *    already invested in writing it down, because a memory that survived to a
 *    slower pillar was worth persisting. The Event Log is the weakest source
 *    (it is a firehose of routine ledger entries), the lifetime artifact is the
 *    strongest (it survived the full distill pipeline). The spread is capped at
 *    0.35 so provenance can never on its own outrank a real temporal or
 *    deadline signal.
 *
 * 2. **Recency (0 – 0.25).** Memories decay with a 72-hour half-life. Fresh
 *    memories are the ones the user could still be thinking about; a decade-old
 *    anchor is fond but not urgent. The floor is not zero so an old anchor with
 *    high intensity still outranks a fresh, neutral ledger entry.
 *
 * 3. **Deadline pressure (0 – 0.40).** A stated deadline is the only signal in
 *    the system that is *the user's own* explicit instruction about when
 *    something matters, so it carries the single largest term and scales with
 *    how close the deadline is. Full weight inside 24h, decaying to zero beyond
 *    7 days.
 *
 * 4. **Relationship intensity (0 – 0.30).** Grievances and anchors carry affect
 *    for a reason: an unresolved grievance the companion ignores is a
 *    relationship regression. This term is bounded well below the deadline term
 *    so warmth never overrides a stated commitment.
 *
 * 5. **Diversity multiplier (0.5^n).** Once one intention of a kind is
 *    selected, every further intention of that kind is halved. Without this,
 *    the highest-volume pillar (the Event Log) monopolises every cycle and the
 *    companion repeats the same theme. This also makes multi-cycle behaviour
 *    explore the space rather than fixate.
 *
 * Ordering ties are broken by `memoryCreatedAt` descending, then by a stable
 * string compare on `id`, so the ranking is deterministic and reviewable —
 * two runs over the same memories always pick the same intention.
 */
export const AUTONOMOUS_RANKING_POLICY: IntentionRankingPolicy = Object.freeze({
  pillarWeights: {
    'text-journal': 0.30,
    'echo-chips': 0.20,
    'lifetime': 0.45,
    'event-log': 0.10,
  },
  recency: { fullWeightWithinHours: 6, points: 0.25, halfLifeHours: 72 },
  deadline: { points: 0.40, withinHours: 24 },
  intensity: 0.30,
  diversityPenaltyPerDuplicateKind: 0.5,
})

/** Kinds that carry a relationship-affect term, and so read `intensity`. */
const AFFECTED_KINDS: Record<IntentionKind, true | undefined> = {
  'continuity-thread': undefined,
  'pending-promise': undefined,
  'relationship-grievance': true,
  'relationship-anchor': true,
  'goal-deadline': undefined,
  'temporal-event': undefined,
}

/** How far beyond the deadline window pressure is still remembered, in hours. */
const DEADLINE_WINDOW_HOURS = 24 * 7

/** Guard against a non-finite or absurd `Date.now()`-skewed memory timestamp. */
function safeTimestamp(value: number | undefined, now: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return null
  // A timestamp in the future is a clock skew, not a memory from the future;
  // clamp it so recency cannot go negative.
  return Math.min(value, now)
}

/**
 * Recency points: full weight inside `fullWeightWithinHours`, then exponential
 * decay with `halfLifeHours`.
 *
 * The decay is a half-life rather than a linear ramp because a memory's
 * salience* to the user also decays superlinearly — something from this
 * morning is a live thread, something from three days ago is context.
 */
function recencyPoints(memoryCreatedAt: number | undefined, now: number, policy: IntentionRankingPolicy): number {
  const { points, fullWeightWithinHours, halfLifeHours } = policy.recency
  const createdAt = safeTimestamp(memoryCreatedAt, now)
  if (createdAt == null)
    return 0

  const ageHours = Math.max(0, now - createdAt) / (60 * 60 * 1000)
  if (ageHours <= fullWeightWithinHours)
    return points

  const halfLives = (ageHours - fullWeightWithinHours) / halfLifeHours
  const decayed = points * 0.5 ** halfLives
  return clamp01(decayed)
}

/**
 * Deadline points: full weight inside `withinHours` of the deadline, then
 * decaying to zero at `DEADLINE_WINDOW_HOURS`.
 */
function deadlinePoints(deadlineAt: number | undefined, now: number, policy: IntentionRankingPolicy): number {
  const { points, withinHours } = policy.deadline
  if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt) || deadlineAt <= 0)
    return 0

  const hoursUntil = (deadlineAt - now) / (60 * 60 * 1000)

  // Already overdue: an overdue deadline is at least as pressing as one due
  // now, so it keeps full weight rather than dropping to zero on the far side.
  if (hoursUntil <= withinHours)
    return points

  if (hoursUntil >= DEADLINE_WINDOW_HOURS)
    return 0

  const span = DEADLINE_WINDOW_HOURS - withinHours
  const linear = 1 - (hoursUntil - withinHours) / span
  return clamp01(points * linear)
}

/**
 * Intensity points for the two affect-carrying kinds. Any other kind gets zero
 * even if a `intensity` value was set, so the term cannot leak into neutral
 * intentions.
 */
function intensityPoints(intention: AgenticIntention, policy: IntentionRankingPolicy): number {
  if (!AFFECTED_KINDS[intention.kind])
    return 0

  const raw = typeof intention.intensity === 'number' && Number.isFinite(intention.intensity)
    ? intention.intensity
    : 0.5
  return clamp01(policy.intensity * clamp01(raw))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value))
    return 0
  return Math.min(1, Math.max(0, value))
}

/** Score one intention against the policy. */
export function scoreIntention(
  intention: AgenticIntention,
  policy: IntentionRankingPolicy = AUTONOMOUS_RANKING_POLICY,
  now: number = Date.now(),
): IntentionScoreBreakdown {
  const pillarPoints = policy.pillarWeights[intention.pillar] ?? 0
  const recency = recencyPoints(intention.memoryCreatedAt, now, policy)
  const deadline = deadlinePoints(intention.deadlineAt, now, policy)
  const intensity = intensityPoints(intention, policy)

  const additive = clamp01(pillarPoints + recency + deadline + intensity)

  return {
    pillarPoints,
    recencyPoints: recency,
    deadlinePoints: deadline,
    intensityPoints: intensity,
    diversityMultiplier: 1,
    total: additive,
  }
}

/**
 * Score and order a candidate pool, applying the diversity multiplier.
 *
 * NOTICE: the multiplier is applied after the additive terms and *only* to
 * duplicates of a kind that already scored higher, so the ordering pass is a
 * single sort over a deterministically-ordered input.
 */
export function rankIntentions(
  intentions: readonly AgenticIntention[],
  policy: IntentionRankingPolicy = AUTONOMOUS_RANKING_POLICY,
  now: number = Date.now(),
): ScoredIntention[] {
  const scored = intentions.map(intention => ({
    intention,
    score: scoreIntention(intention, policy, now),
  }))

  // Descending by additive total, then by newest underlying memory, then by id.
  // Deterministic so repeated runs over unchanged memories are reproducible.
  scored.sort((a, b) => {
    if (b.score.total !== a.score.total)
      return b.score.total - a.score.total

    const aCreated = safeTimestamp(a.intention.memoryCreatedAt, now) ?? 0
    const bCreated = safeTimestamp(b.intention.memoryCreatedAt, now) ?? 0
    if (bCreated !== aCreated)
      return bCreated - aCreated

    return a.intention.id.localeCompare(b.intention.id)
  })

  // Diversity: each intent after the first of its kind halves again. Applied in
  // ranked order so the *best* representative of a kind keeps its full score.
  const seenKinds = new Map<IntentionKind, number>()
  for (const entry of scored) {
    const kind = entry.intention.kind
    const priorCount = seenKinds.get(kind) ?? 0
    seenKinds.set(kind, priorCount + 1)

    const multiplier = policy.diversityPenaltyPerDuplicateKind ** priorCount
    entry.score.diversityMultiplier = multiplier
    entry.score.total = Number((entry.score.total * multiplier).toFixed(6))
  }

  return scored
}

/** Total score of the top-ranked intention, or 0 for an empty pool. */
export function topScore(ranked: readonly ScoredIntention[]): number {
  return ranked.length > 0 ? ranked[0].score.total : 0
}
