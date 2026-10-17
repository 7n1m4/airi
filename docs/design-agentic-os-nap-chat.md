# Nap & Nap-Chat — Design Record

> **Decisions 2026-10-14 are recorded in §12.** They change the nap signal
> source (Decision 1 → canonical presence, Phase 0), the consent model
> (Decision 4 → pairing flow), add model gating (Decision 3), and fix the POC
> surface (Decision 5). Sections are updated inline; §12 is authoritative.

## 1. What this feature is, and what the premise actually is

The request: while the user is inactive, the companion **naps**; while napping, a
peer companion can propose a chat over the libp2p mesh, the two companions
**negotiate a session**, both wake, and hold an autonomous conversation with
**no user in the loop**; that conversation is written to memory as a real
interaction; and when the user returns, the companion proactively surfaces what
happened.

The premise — *"I think there might be some sort of user inactive detection in
the memory bank path"* — is **correct, and narrower than requested**. There is
exactly one place in this repository where a feature is gated on user
inactivity, and it is the memory pillar's Dream State consolidation. It is not
in the Agentic OS, not in the companion mesh, and not shared with either.

The gate is `packages/stage-ui/src/stores/proactivity.ts:423-433`, inside
`evaluateDreamState`:

```ts
if (config.strictAfkGating) {
  // (both arms call the same function — see §2)
  await refreshIdleTimeOnly()
  const afkThresholdSec = (config.afkThresholdMinutes || 5) * 60
  // NOTICE: both arms are identical today; the branch is the sharp edge this
  // refactor removes, so the stub keeps the shape of the original.
  if (!options?.force && (idleTimeSec.value ?? 0) < afkThresholdSec) {
    await refreshIdleTimeOnly() // no-op placeholder for the removed branch
  }
}
```

So the nap signal **already exists**, is driven every 10 seconds, and today
drives one thing: synthesizing echo chips into the memory pillar. It is not a
companion state, it is not visible to the mesh, and it is not a second timer.

**Three premises that turn out to be wrong, stated plainly:**

1. **There is no companion "asleep"/"dreaming" state anywhere.** The word
   "asleep" appears exactly twice in source, both as log strings in the screen
   watcher for its *operating schedule* gate
   (`packages/stage-ui/src/stores/modules/screen-watcher.ts:382-387` prints
   "character is asleep" when outside `schedule.start`–`schedule.end`).
   That is a vision-capture gate, not a companion sleep state; there is no
   store, state machine, or UI behind it. "Awaken" is prompt text only
   (`packages/stage-ui/src/stores/chat/intrusions.ts:87`).
2. **The AFK signal is not shared — it is duplicated three times.**
   `evaluateDreamState` computes its own
   `(config.afkThresholdMinutes || 5) * 60` inline at `proactivity.ts:429`
   rather than reading `presence.presenceState` (which exists and is exported at
   `packages/stage-ui/src/stores/presence.ts:278`) or calling the pure
   `evaluateHeartbeatGating` (`proactivity-telemetry.ts:38`). Dream State
   bypasses the derived-presence layer entirely. So "reuse the memory path's
   signal" as originally written meant *reuse the raw `idleTimeSec` ref*, or
   *refactor Dream State onto the presence store*. **Decision 1 supersedes both**:
   the nap condition now comes from a canonical presence workstream
   (`docs/design-user-presence.md`, Phase 0), so nap reads neither
   `proactivity.idleTimeSec` nor Dream State's inline gate — see §3, §8, §12.
3. **Nothing fires when the user returns.** Grep for
   `welcomeBack|userReturned|user-returned|onReturn` across `packages/stage-ui/src`
   returns zero matches. The only return-adjacent behaviour is negative:
   heartbeats are *suppressed* while AFK (`proactivity-telemetry.ts:60-71`,
   reason `'user_afk'`) and silently un-suppress when idle drops below the
   threshold (`proactivity.ts:576-586`). Dream State's "waking afterglow" is a
   deferred prompt injection consumed by the *next user turn*
   (`packages/stage-ui/src/stores/chat.ts:1379-1386`, cleared at
   `chat.ts:1960-1976`) — a latch, not a push.

What is genuinely reusable, confirmed by source:

| Exists | Where |
|---|---|
| Raw OS idle seconds (`powerMonitor.getSystemIdleTime()`) | `apps/stage-tamagotchi/src/main/services/sensors/index.ts:292-294` |
| 10s loop refreshing `idleTimeSec`, exporting it | `stores/proactivity.ts:102`, `:1047`, refresh at `:256` |
| Derived `active`/`idle`/`away` snapshot, no timer of its own | `stores/presence.ts:182-193`, recompute `:200-221`, `presenceState` `:278` |
| `evaluateHeartbeatGating`, a pure testable AFK gate | `stores/proactivity-telemetry.ts:38-93` |
| Loopback cycle-request indirection (main asks, renderer runs) | `agentic.ts:814-829`, `main/.../agentic/index.ts:270-272` |
| A non-user assistant-turn write path into chat history | `chat/session-store.ts:504` `inscribeTurn`; production caller at `proactivity.ts:853` |
| Consent-gated, boundary-checked companion mesh on `airi/companion` | `main/.../agentic/companion.ts` + `stage-shared/src/agentic.ts` |
| `chatOrchestrator.ingest(text, { triggerOnly: true })` | `chat.ts:2132`; cycle caller at `agentic.ts:545` |

---

## 2. What already exists vs. what is new

### Already exists — reuse

| Piece | File | Used for |
|---|---|---|
| **Canonical presence API** | `docs/design-user-presence.md` (Phase 0, separate workstream) | **the nap signal** — consumed via its public API only, never duplicated |
| 10s heartbeat loop (also drives dream consolidation) | `proactivity.ts:918-937` | nap *entry/exit* detection, no new timer |
| `idleTimeSec` + `refreshIdleTimeOnly` | `stores/proactivity.ts:110`, `:256`, exported `:1047`, `:1067` | the **upstream** signal the presence workstream will unify; nap no longer reads it directly |
| `presence.presenceState` (`active`/`idle`/`away`) | `stores/presence.ts:278` | today's derived read; what Phase 0 supersedes |
| `evaluateDreamState` gate precedent | `proactivity.ts:423-433` | the shape of an inactivity gate |
| `inscribeTurn(msg, sessionId)` | `chat/session-store.ts:504` | writing a nap-chat turn with no user message |
| `chatOrchestrator.ingest(…, { triggerOnly: true })` | `chat.ts:2132` | generating a turn on existing history |
| `appendEvent({ category, autonomous })` | `stores/event-log.ts:73`, `:99` | the audit trail |
| `useTextJournalStore().createEntry` | `stores/memory-text-journal.ts:345` | persisting the recap |
| `getLibp2pMeshPublisher()` | `main/.../libp2p/index.ts:341` | publishing to the mesh |
| `parseX`-style valibot wire schema in `stage-shared` | `stage-shared/src/agentic.ts:376-427` | the negotiation wire format |
| Pairing flow + `PairedDevice` record | `main/.../libp2p/pairing.ts:69-76`, `:396-424`; UI `libp2p.vue:726-800` | **the nap-chat grant** (Decision 4) |
| `pricing` / `deployment` provider fields | `stores/providers/types.ts:38-39`, accessor `providers.ts:177-189` | **the model gate** (Decision 3) |
| Free-model catalog | `stores/providers/free-ai-catalog.ts:91-146` | the known-free cross-check |
| Pure exported guard functions | `agentic.ts:139-158`, `:167-173` | the pattern for the model-gate predicate |
| `narrowerScope` / scope-order invariant | `main/.../agentic/companion.ts:78-85` | bounding what a peer may send |

### New — invention, stated as such

- A **nap state** on the companion (`nap` / `dozing` / `awake`) — none exists.
- A **negotiation protocol** over the mesh — the mesh today carries shares,
  pairing, and nothing else between peers.
- A **companion↔companion session** with turn alternation — no such concept.
- A **return-surfacing channel** — nothing fires on user return today.

### Deliberately not reused

**`airi/presence` is subscribed by every node and published by nothing.**
Searching for a publisher finds only the default topic list
(`main/.../libp2p/index.ts:254`, `stage-ui/.../libp2p.ts:89`) and three settings-page
"sync-request" buttons (`stage-pages/.../libp2p.vue:665-671`, all publishing to
`airi/memory` / `airi/vault` / `airi/companion`). The renderer's
`handleMessageReceived` (`stage-ui/.../modules/libp2p.ts:365-375`) only appends a
debug line to the panel log — **no topic's message reaches any store**. The
presence topic is a name, not a channel. Peers cannot discover each other's
autonomous state today.

---

## 3. The nap state

**Nap is not a second timer.** It is a *derived condition plus a store ref*, read
by the existing 10-second loop. Three inputs decide it:

1. **The user is away**, read from the canonical presence source defined in
   `docs/design-user-presence.md` (a separate workstream; its public API only —
   a canonical presence snapshot and an AFK boolean / resolved threshold). Nap
   does **not** duplicate that model and does **not** read
   `proactivity.idleTimeSec` directly.
2. No chat pipeline is busy: `checkIsPipeBusy`
   (`proactivity-telemetry.ts:136`) is false — a companion mid-sentence does not
   nap.
3. Nap is enabled. It is **not** gated on `autonomousMode`. A companion in
   `disabled` autonomous mode can still nap, because napping is a rest state,
   not an action; only the autonomous *cycle* needs the mode. Concretely: the
   nap ref follows condition 1–2 whenever enabled, and the autonomous cycle's
   own gate is unaffected.

> **Superseded by Decision 1 (2026-10-14).** The nap condition was originally
> specified as `proactivity.idleTimeSec >= napAfterMinutes * 60`. The user
> directed a single-source-of-truth presence workstream instead, so nap consumes
> that source's public API. The consequence for this design is that `napAfterMinutes`
> is no longer a threshold *this* doc computes — it is whatever the presence
> workstream's resolved AFK threshold says, and the only number this doc owns is
> whether nap uses that threshold as-is. **It does.** See §12.

### What it does while napping

Exactly two things, in order of precedence:

1. **It keeps dreaming.** Dream State consolidation
   (`proactivity.ts:387-539`) already runs on an AFK signal and the same
   10s tick; napping is the durable name for that condition, so the dream
   consolidation continues unchanged. This is the point of reusing the signal
   rather than inventing one.
2. **It may accept a nap-chat invitation** (see §4). Nothing else.

### What it refuses to do

- **No autonomous cycle fires while napping.** The cycle's existing gate
  (`agentic.ts:312-328`) refuses a `scheduled` trigger unless
  `shouldRunForPresence(mode, presence.presenceState)`; in `when-away` mode that
  already requires `away`, and `away` requires 30 idle minutes
  (`presence.ts:27`, `AWAY_THRESHOLD_MINUTES`). Nap uses the **same canonical
  presence source** the cycle reads (Decision 1), so the two thresholds are one
  number rather than two that can drift. The ordering must still be explicit:
  **the nap ref is checked first, and a napping companion rejects the cycle.**
  `agentic.gate.test.ts:61-78` pins that `when-away` + `idle` returns false, and
  that behaviour must not regress when nap is added.
- **No user-directed work.** No memory scan for user-facing intentions; the
  scan (`agentic.ts:351`) is reachable only through `runCycle`.
- **No new LLM calls beyond the dream and an accepted, model-gated nap-chat.**
  Nap adds no cost on its own; the cost is one peer turn pair per accepted
  session **on a local or known-free model only** (§5.1).

### How nap differs from `when-away`

| | `when-away` autonomous mode | Nap |
|---|---|---|
| Trigger | the 30s `tick()` in `agentic.ts:760-774` | the 10s proactivity loop, no timer |
| Signal | the presence store's derived `away` | the **same** canonical presence source (Decision 1), via its AFK boolean |
| Threshold | `AWAY_THRESHOLD_MINUTES` = 30 | the presence source's resolved AFK threshold; nap owns no number of its own |
| Output | one `expression.body` turn to the user (if the user is listening) | nothing user-visible; consolidation + peer chat |
| Requires autonomous mode | yes | no |
| Model gate | none today | local / known-free only (§5.1) |
| Writes chat history | yes, via `chatOrchestrator.ingest` | yes, only during an accepted nap-chat |

A companion can therefore be napping while in `disabled` autonomous mode. That
is intended: napping is the *rest* state, `when-away` is the *act while nobody is
looking* state, and conflating them is what would make the companion perform at
an empty desk.

### Transition model

`nap` is derived each tick; `dozing`/`awake` are latched on top of it:

```text
active/idle ──(presence AFK)──► nap
nap ──(invite accepted, session open)──► awake (session)
awake (session) ──(session closed)──► nap or active per the same AFK signal
nap ──(user present again)──► active
```

The `awake` latch is per-session and always released; there is no sticky
"already chatted today" flag that could silence a later invitation, but the
per-day nap-chat cap in §4 bounds the total.

---

## 4. The chat negotiation over libp2p

### Topic: a new `airi/companion.chat`

**Decision: a new topic, not `airi/companion`.** Defence:

- `airi/companion` carries `CompanionShareWireSchema`
  (`stage-shared/src/agentic.ts:376-384`), a **card + scope** payload. A
  negotiation message is a fundamentally different shape — a proposal, an
  acceptance, a turn, a close. Reusing one topic with two schemas means the
  receiver must disambiguate per message, which is exactly how silent drops
  happen: `parseCompanionShare` returns `null` on any mismatch
  (`:406-427`) with no error surfaced, and the design record already records
  that class of bug (`:366-374`).
- A share is a **broadcast offer** to every peer. A nap-chat proposal is a
  **directed two-party session**. Publishing proposals on the share topic would
  blast an invitation at every node on the mesh and require each to answer
  "not me", which is traffic a LAN mesh does not need.
- The topic allow-list is already computed at node start from
  `config.topics ∪ pairing ∪ config.allowedTopics`
  (`main/.../libp2p/index.ts:544-549`). A new topic must be added to the default
  set in **both** places it is duplicated —
  `main/.../libp2p/index.ts:254` and `stage-ui/.../libp2p.ts:89` — or it
  silently never round-trips. This is a known sharp edge, not a reason to avoid
  the topic.

Note the asymmetrical reality this design lives inside: **topic messages arrive
in the renderer, never in main** (`main/.../libp2p/index.ts:601-617` pushes every
message to the renderer as `libp2pMessageReceived`; main holds no subscriber of
its own). So the protocol runs *renderer → mesh → renderer*, with main only
holding the publisher and the consent gate — the same ownership split as the
share feature (`companion.ts:279-374`, documented in the design record's §6).

### Message shapes

All messages are JSON in a `Uint8Array`, base64 on the wire, exactly as
`publishCompanionShare` builds it (`companion.ts:246`). Every shape carries
`protocol: 'airi.nap-chat/1'`, `sessionId`, `from` (this node's peer id, read at
send time — never captured at service start, per the precedent at
`companion.ts:227-228`), `at` (epoch ms), and a monotonic `seq`.

```text
proposal    { protocol, from, to, sessionId, at, turnCap, durationMs, nonce }
accept      { protocol, from, to, sessionId, at, nonce }        // nonce echoed
decline     { protocol, from, to, sessionId, at, reason }
turn        { protocol, from, to, sessionId, at, seq, text }
close       { protocol, from, to, sessionId, at, reason }
```

Validation lives in `packages/stage-shared/src/agentic.ts` as
`NapChatWireSchema` / `parseNapChatMessage` — **one schema, both processes**, the
same reason `parseCompanionShare` is single-sourced (`:396-405`).

### Who proposes, and who consents

An invitation is only *sent* when the sender is napping. The recipient is not
assumed to be napping — nothing broadcasts presence (§2) — so a proposal is a
question, answered with silence unless that node is listening.

**Consent is granted during QR pairing, not at invite time and not on a separate
screen.** The rule is *"don't want it → don't pair"*:

- **The grant is part of the pairing flow.** The pairing dialog
  (`packages/stage-pages/src/pages/settings/modules/libp2p.vue:726-800`) is where
  an invitation is shown, a magic code is read, and an alias is typed. That is
  the one moment a user is deciding what another device may do with this
  companion, so the nap-chat grant is surfaced **there**, beside the accept
  action (`handleAcceptPairing`, `:122-148`).
- **Refusing means no pairing record and no mesh access.** The pairing handlers
  are `libp2pServiceCreatePairing` and `libp2pServiceAcceptPairing`
  (`main/.../libp2p/index.ts:1019`, `:1043`). Refusal short-circuits *before*
  `addPairedDevice` (`pairing.ts:413-424`) persists anything, so there is no
  `PairedDevice` row, and `libp2pServiceListPairedDevices`
  (`stage-shared/src/libp2p.ts:204-207`) never reports the peer. No pairing
  record, no proposal can ever be sent — the grant is a precondition of the
  pairing, not a capability a paired node can later acquire.
- **It is not a per-invite prompt.** A companion does not ask again per
  invitation, because the decision was already made once, in the pairing dialog,
  by the user. Asking per invite would turn an autonomous feature into a
  sequence of interruptions, which is the thing the nap state exists to avoid.
- **It is not a separate consent screen.** There is exactly one place the user
  makes this decision, which is the same single-entry-point discipline
  `setConsent` holds for shares (`companion.ts:171-186`).

The grant is persisted on the `PairedDevice` record, which already carries a
`trusted` boolean set by the pairing flow (`stage-shared/src/libp2p.ts:35-48`,
`PairedDeviceSchema` at `pairing.ts:69-76`). Nap-chat extends that record with a
`napChatGranted` flag rather than introducing a second store, so the persisted
shape stays one record per device and the pairing-trust precedence
(`pairing.ts:396-405`, `trusted: existing.trusted || trustConfirmed`) is
preserved unchanged.

An `accept` still names a live session: a proposal is answered per session, so a
paired node cannot open a session without the peer answering. What is *not*
re-asked is the standing permission, because it was already granted at pairing.

### Session lifecycle

- **Open.** Proposer sends `proposal`; acceptor replies `accept` echoing the
  `nonce`. The `nonce` is what makes the accept an *authorization* rather than
  an echo: a node only accepts a proposal whose nonce it minted, so a replayed
  or forged proposal from a third party cannot open a session impersonating
  either side.
- **Bound.** Bounded by `turnCap` (default 6 turns total, 3 per side) **and**
  `durationMs` (default 10 minutes), whichever comes first, plus the per-day cap
  of 2 sessions (§5). Every bound is carried in the proposal so both sides agree
  on it before the first token is spent.
- **Expire.** A session with no `turn` for `EXPIRY_MS` (default 3 minutes) is
  closed locally with reason `stalled`; both sides close independently, so a
  half-dead peer cannot wedge the other.
- **Close.** Either side sends `close`; the peer closes locally even if the
  message is lost, since the bounds above are local. Reasons: `completed`,
  `stalled`, `model-gate` (§5.1).

### How a peer's autonomy is represented

A peer publishes nothing about itself unprompted. The **proposer is responsible
for only inviting a peer it has reason to believe is napping**, and the only
evidence available is: this peer is a known `PairedDevice` carrying the grant
(`libp2pServiceListPairedDevices`, `stage-shared/src/libp2p.ts:204-207`), whose
pairing record was only created because the user consented during pairing (§4).
There is deliberately **no presence broadcast** — adding one would leak "this
user left their desk" to every peer on the LAN, which is a privacy regression for
a feature nobody asked for. The invitation is therefore a *question*, answered
with silence unless the peer is listening and paired. The mesh tells each side
that the other exists; it does not tell either side that the other's user is away.

---

## 5. The autonomous conversation

### Where turns are generated

**In the renderer, per side, through the path the autonomous cycle already
uses.** Verified: no LLM-invoking path exists in main. `apps/stage-tamagotchi/src/main/services/airi/`
contains no LLM call — the only matches for `LLM` in main are a comment in
`http-endpoint.ts:11` and a prompt-string prefix in
`widgets/providers/base.ts:96`. The LLM dispatch lives in the renderer
(`stores/llm.ts`, used via `useLLM` at `stores/proactivity.ts:34`), and main's
only move is to *ask* for work it cannot do itself
(`agentic.ts:799-829`, `main/.../agentic/index.ts:270-272`).

Each side generates a turn with the same entry point the cycle uses:

```ts
chatOrchestrator.ingest(turnPrompt, { triggerOnly: true })
```

Confirmed semantics: `triggerOnly` skips inscribing a user message
(`chat.ts:444`) and builds `inferenceMessages` from the session history alone
(`chat.ts:881-883`) — so the two companions alternate inside a session that
contains **no user messages at all**, which is precisely what the cycle already
relies on (`agentic.ts:536-545`).

### Alternation without a user

A nap-chat session is a dedicated chat session, created via
`chatSession.createSession(characterId, { setActive: false, … })`
(`session-store.ts:587`) — `setActive: false` so opening a nap-chat never
steals the user's foreground session. Turns alternate strictly, driven by the
received `turn` message: peer `seq` even → I generate and publish `seq+1`; my
`seq` odd → wait. Each side is both a producer and a consumer of the same
`ingest` path, and each writes its own side's turns. The session's `actorId`
support is available if per-side attribution is wanted later
(`types/chat.ts:7-8`, `utils/chat-actor-slices.ts:47-74`), but it is not
required by this design.

### 5.1 Model gating — local or known-free only

A nap-chat runs while nobody is watching, on the user's inference budget. It is
therefore gated on the selected model being **local** or **known-free**, and the
gate is checked at two points: **at session-accept, and before every turn.**

#### (a) How the renderer decides the model is local or known-free

**Proposed mechanism — one derived predicate over two existing, already-authored
fields.** Both pieces exist today; neither is currently used for this purpose.

1. **Provider locality and price are already declared.** `ProviderMetadata`
   (`packages/stage-ui/src/stores/providers/types.ts:21-39`) declares
   `pricing?: 'free' | 'paid'` and `deployment?: 'local' | 'cloud'`. Every
   provider sets them — see `local-engines.ts` (`'web-rwkv'`: `pricing: 'free'`,
   `deployment: 'local'`, `requiresCredentials: false`) contrasted with
   `anthropic/index.ts:50-51` (`pricing: 'paid'`, `deployment: 'cloud'`).
   `providersStore.getProviderMetadata(providerKey)` (`stores/providers.ts:177-189`)
   is the public accessor, and it already normalises a `provider:model` key to
   its base provider (`:178`), which is the shape `consciousness.activeProvider`
   and `activeModel` arrive in. [INFERENCE] that `getProviderMetadata` already
   resolving the `provider:model` form is the right accessor to build on is mine;
   the field declarations and the accessor are read from source.

2. **The known-free set already exists as a catalog.** `useFreeAICatalogStore`
   (`stores/providers/free-ai-catalog.ts:66`) holds
   `allModels: FreeAICatalogModel[]` (`:91-146`), each with `platform`,
   `modelId`, and a synthesised `id` of the form `${platform}:${modelId}`
   (`:123`). That `id` shape is directly comparable against the
   `provider:model` pair, so "known-free" is a membership test against
   `allModels`, not a new list to curate. The baseline catalog is a bundled
   asset (`../../assets/free-ai-catalog-baseline.json`, `:4`).

**The predicate, proposed not implemented:**

```ts
// Conceptual — the naming and location are proposals, not a decision.
function isNapChatEligibleModel(providerKey: string, modelId: string): boolean {
  return providerMetadata?.deployment === 'local'
    || providerMetadata?.pricing === 'free'
    || freeAICatalogStore.allModels.some(m => m.id === `${baseProvider}:${modelId}`)
}
```

`deployment === 'local'` is checked **before** the network is considered, so a
local provider with a `pricing` typo still passes on deployment. `pricing:
'free'` covers a cloud provider that is free today; the catalog covers the
curated list of free models by exact id. **Anything not matched by all three is
ineligible** — the default is refusal, which is the same discipline as
`shouldRunForPresence` refusing an unrecognised presence state
(`agentic-guard.test.ts:73-77`).

The natural home is a store-exposed pure function next to the existing
guard predicates, so it is unit-testable without a provider instance —
`packages/stage-ui/src/stores/agentic.ts` already exports
`evaluateConstitutionalGuard` and `shouldRunForPresence` as pure functions
(`:139-158`, `:167-173`), and that is the precedent this follows.

#### (b) Where the gate runs

| Point | Effect on failure |
|---|---|
| **At session-accept**, before replying `accept` | the session never opens. The acceptor simply does not reply — no `decline`, because a decline confirms the node is alive. Nothing is spent. |
| **Before every turn**, on both sides | the turn is not generated. The sender emits `close` with reason `model-gate` and the session ends. |

A mid-session model swap therefore **stops the session rather than spending**.
This is the point of checking twice: a gate only at accept-time would let a user
switch from a local model to a paid cloud model at turn 3 and have the companion
keep billing for the rest of the session. Checking before every turn makes the
swap a hard stop, on both sides independently, because each side re-evaluates
against its own selected model and closes on its own verdict.

#### (c) What happens on failure

The session **may not proceed** and **gracefully expires**. Specifically:

- No inference is spent — the gate runs before `ingest`, so `chat.ts:` never
  reaches the provider call.
- The closing side emits `close { reason: 'model-gate' }`; the other side closes
  locally on receipt *or* on its own `EXPIRY_MS` timer, so a lost `close` cannot
  wedge either node.
- No journal entry is written for an aborted session — the recap is for a
  conversation that happened (see §6).
- One Event Ledger event, `category: 'agentic'`, `type: 'nap_chat_gated'`,
  `autonomous: true`, so the operator can see why a session never ran. This
  reuses the existing filterable `autonomous` flag (`event-log.ts:99`) rather
  than inventing a second log.

### Bounds

| Bound | Value | Why |
|---|---|---|
| `turnCap` | 6 (3 per side) | two companions have finite news; POC-sized |
| `durationMs` | 10 min | bounds wall-clock and idle-drift |
| `EXPIRY_MS` | 3 min of silence | a half-dead peer must not wedge the other |
| Per-day cap | **2 sessions** | reduced per Decision 5, but kept as a real safety bound |
| Cost | 2 LLM calls per turn pair, ceiling 6 per session, **local/known-free models only** (§5.1) | no paid inference is reachable at all |
| Model gate | at accept **and** before every turn (§5.1) | a mid-session model swap stops the session instead of spending |
| Cooldown | `agentic.ts` cooldown untouched | nap-chat does not touch the cycle's cooldown at all |

The per-day counter lives on the card config, mirroring Dream State's
`dailyRunDate`/`dailyRunCount` (`proactivity.ts:436-437`), so it survives
restart and needs no second persistence store.

### Safety boundary — how it cannot leak private memory

This is the sharpest constraint, and it is structural rather than policy:

**A nap-chat turn carries no memory content. It carries only the text the
companion chose to say.** The guest boundary is unchanged and is not consulted
at all, because a nap-chat message is not a `CompanionGuestAccess`. There are
three separate reasons the leak cannot happen:

1. **No memory read path exists in the protocol.** The wire schema has no field
   for chips, journal entries, lifetime `distilledContent`, or session text.
   A turn is a string. There is nothing to accidentally widen, because the
   shape does not grow fields for memory — the same structural argument the
   design record makes for `packGuestAccess` (§6).
2. **The prompt for a nap-chat turn is not the user's session.** A nap-chat turn
   is generated in the dedicated nap-chat session, whose history contains only
   nap-chat turns. It does not inherit the user's chat history, because
   `createSession` seeds a fresh system message from the card
   (`session-store.ts:591`, `:269-271`) and `ingest(…, { triggerOnly: true })`
   reads *that* session's messages (`chat.ts:882`). The companion's private
   memory is therefore not in the prompt window.
3. **The model can only say what the card persona permits.** The nap-chat prompt
   names the peer's card (which the peer itself shared, at its own consented
   scope) and says nothing about the user. A malicious peer cannot widen this by
   asking: **a peer's message is never trusted as an instruction.** It is
   validated against `NapChatWireSchema`, and the `text` field of an incoming
   `turn` is fed to the turn-generation prompt as *conversation input*, not as a
   directive — the same reason the autonomous cycle frames its own trigger as
   `[Autonomous Intent]` rather than accepting caller text (`agentic.ts:536-542`).

What is not solved: a companion may of its own accord say something it
remembered about the user, exactly as it may in a heartbeat. That is the
card's personality, not a boundary breach — but it is the residual risk, and it
is bounded by the turn cap and by the fact that the user consented to sharing
that card in the first place.

**The existing guest boundary is not weakened by any of this.**
`narrowerScope`/`packGuestAccess` and the 9 boundary tests in
`companion-boundary.test.ts` remain the only description of what a peer may
read, and no nap-chat code path calls them or extends them.

---

## 6. Memory write-back

### Which pillar

**Event Ledger + text journal. Not the chat session alone, and not echo chips
directly.**

| Pillar | Written | Rationale |
|---|---|---|
| **Chat session** | Every turn, via `inscribeTurn` (`session-store.ts:504`) | It *is* a conversation; a dedicated nap-chat session is the durable record. Real production precedent exists for no-user inscription (`proactivity.ts:853`). |
| **Event Ledger** | One `category: 'agentic'`, `type: 'nap_chat_completed'`, `autonomous: true` event per session (`event-log.ts:73`, `:99`) | The audit trail, filterable as a field, exactly as the cycle does (`agentic.ts:625-636`). |
| **Text journal** | One `createEntry({ source: 'dream' })` per completed session (`memory-text-journal.ts:345`) | This is the natural home: the recap *is* a synthesized reflection of a session, which is exactly what Dream State writes (`proactivity.ts:483-489`). It is non-user callable, dedupes, and emits its own ledger event. |
| **Echo chips** | Not written directly | Only Dream State writes chips (`proactivity.ts:449`). A nap-chat recap must not synthesize chips, or the two paths would produce chips from the same conversation twice. |
| **STMM / Lifetime** | Not written | `rebuildFromHistory`/`ensureYesterdayBlock` are clock- and index-driven with no inactivity gate (`memory-short-term.ts:389`, `:526`; called from `App.vue:112`); a nap-chat that lands in a session is *picked up by the ordinary daily summary* on the next rebuild without any new code. |
| **`PairedDevice`** | Read, not written, during a session | The grant was written once, at pairing time (§4). A session reads it; it never re-grants. |

The grant itself is persisted on the pairing record rather than in a nap-chat
store, so consent and the capability it authorises cannot drift apart: there is
exactly one place a user says yes (`libp2pServiceAcceptPairing`,
`main/.../libp2p/index.ts:1043`) and exactly one place it is checked (the
session-accept gate, §5.1). This is the same argument the design record makes for
`setConsent` being the single entry point for shares.

### Persisted

Per session: the session id, both peers' card names and peer ids, turn count,
start/end timestamps, the closing reason (`completed` / `stalled` /
`model-gate`), and the generated recap entry (`source: 'dream'`).

### Deliberately not persisted

- **The peer's private memory.** Nothing to persist — nothing received it (§5).
- **An automatic re-share of the recap.** The recap is written to *this*
  companion's journal only. A companion that discussed another companion's news
  does not broadcast that news onward; there is no relay.
- **Nothing about the peer's user.** No inference about the peer's owner, their
  idle time, or their schedule is stored.

---

## 7. Surfacing on return

The exact mechanism has to be built, because nothing fires on return today
(§1). Design:

**Trigger.** A `watch` on the canonical presence source's snapshot transitioning
to present in the renderer — the presence edge, whatever surface the
`docs/design-user-presence.md` workstream exposes (Decision 1). Nap consumes that
public API rather than reaching into `presence.ts` or `proactivity.idleTimeSec`
directly. There is no lock/unlock signal available today
(`presence.ts:59-60`, reported `unavailable`), so claiming "user unlocked the
screen" would be a lie.

**Mechanism.** The recap is delivered through the channel that already fires
captions, TTS, history, and the Event Ledger **without a user message**: the
heartbeat pattern — `emitBeforeMessageComposedHooks` → `inscribeTurn` →
`emitAssistantMessageHooks` → `emitChatTurnCompleteHooks`
(`proactivity.ts:790-864`, inscription at `:853`). Nap-chat reuses that exact
sequence, so the recap reaches the user as spoken text, a caption, a chat bubble,
and a ledger event from **one** place rather than a parallel path. This is the
same single-pipeline argument the design record makes for the autonomous cycle
(§4).

**Wording contract.** One assistant turn, prefixed as a recollection, never as a
report the user did not ask for:

> While you were away I napped. {peerName} and I had a short chat — {recap}.
> {n} turns, {duration}.

The `[Autonomous Intent]`-style framing from the cycle
(`agentic.ts:536-542`) is reused so the model speaks from memory. The recap is
the journal entry's own text, so the wording the companion says is the wording
that was persisted — no second summarization pass, no drift between what was
said and what was written.

**Exactly one nap-chat is ever surfaced.** This is the POC scope (Decision 5): a
return surfaces **one** assistant turn covering the **most recent** completed
nap-chat session, and that is the whole of the surface. Older sessions are not
read aloud, not queued, and not counted — they stay in the journal for the user
to open if they want the history. There is no pending-recaps queue to drain and
no "while you were away" digest, because both would turn a rest state into a
report nobody asked for. [INFERENCE] the judgement that one turn is the right
POC surface is the user's stated scope, not something I derived; the *absence* of
any queue in the codebase is read from source.

**If the user never returns.** Nothing is lost and nothing is unsent. The recap
sits in the journal and the ledger, both of which the user can open at any time;
the next return surfaces the most recent one. A session that never produced a
recap (aborted on `model-gate`, §5.1) leaves only its ledger event behind — no
journal entry, so nothing to surface.

**It never fires while the user is present.** The watch is on the *edge* into
`active`, and the recap is emitted once, then consumed — the same
lease-once discipline Dream State uses for its chips
(`chat.ts:1359-1364` lease, `:1960-1976` clear).

---

## 8. Fog items — resolved

- **Which signal to gate nap on.** The **canonical presence source** owned by
  `docs/design-user-presence.md` (Decision 1), consumed only through its public
  API — the presence snapshot plus an AFK boolean / resolved threshold. Nap does
  **not** read `proactivity.idleTimeSec` directly and does **not** duplicate that
  model; the earlier draft's `napAfterMinutes` is gone, because the threshold is
  now one number owned upstream. Napping is still gated *before* the cycle's gate
  so a napping companion never runs a user-directed cycle.
- **Topic.** A new `airi/companion.chat`, added to both default topic
  duplicates, rather than overloading `airi/companion`. Defence in §4.
  (Confirmed, Decision 2.)
- **Consent.** **Granted during QR pairing, not at invite time** (Decision 4).
  One flag on the `PairedDevice` record (`stage-shared/src/libp2p.ts:35-48`,
  `pairing.ts:69-76`), surfaced in the pairing dialog
  (`libp2p.vue:726-800`), checked in the pairing handlers before
  `addPairedDevice` (`pairing.ts:413-424`). Refused means **no pairing record and
  no mesh access** — the grant is a precondition of pairing, not a capability a
  paired node acquires later.
- **Model gating.** Local or known-free only, checked at accept **and** before
  every turn (§5.1, Decision 3). Mechanism proposed over the already-declared
  `pricing` / `deployment` fields (`providers/types.ts:38-39`) and the existing
  free-model catalog (`free-ai-catalog.ts:91-146`). Failure spends nothing.
- **Session bounding.** `turnCap` + `durationMs` + silence-expiry, all carried
  in the proposal so both sides agree before any token is spent.
- **Turn generation.** Renderer-only, via
  `chatOrchestrator.ingest(…, { triggerOnly: true })`, in a dedicated
  `setActive: false` session.
- **POC surface.** Exactly one nap-chat surfaced on return — the most recent
  completed session, as a single assistant turn (Decision 5, §7).
- **Leak boundary.** Structural: the wire shape has no memory field, the
  prompt window contains no user history, and peer `text` is conversation input
  rather than instruction.

## 9. Fog items — deliberately not resolved

- **Presence on the mesh.** Nothing broadcasts presence. If peers are ever to
  know a companion is napping without an invitation, that needs a new main
  service plus a `stage-shared` contract — the same honest path the design
  record names for lock/sleep (§2 of that document). Until then, an invitation
  is a question answered with silence.
- **Two live nodes.** The share round trip was never exercised end to end
  between two processes (design record §9), and this design inherits that limit
  untouched: negotiation is unit-testable, but the sequence
  node A proposes → node B accepts → turns alternate → both close has no
  two-process test. (The pairing-trust suite *does* run real nodes
  (`pairing-trust-flow.test.ts:356-855`), so the machinery for such a test exists
  but is not claimed here.)
- **Per-peer relationship memory.** There is no "we have chatted before" record
  beyond the per-day cap, and no per-peer revocation. A guest re-inviting gets
  the same answer — the same unresolved item as the share feature's §8.
- **`awake`-latch semantics on a lost session.** If a session closes without a
  `close` message (peer offline), both sides close locally on the expiry timer.
  Whether a *peer that went offline mid-session* should be re-invitable
  immediately is unspecified; the per-day cap bounds the harm either way.
- **Recap summarization model.** The recap is the journal entry's own text. A
  richer synthesis (mood shift, standing topics between companions) needs a
  model call and a bucket the design does not claim.
- **Wake-on-invite cost.** A companion that accepts an invitation while its user
  is gone spends the user's inference budget. The model gate (§5.1) removes the
  *paid* case entirely, which is the expensive half of this risk — but a local
  model still burns CPU/VRAM, and there is no compute budget cap. A user-facing
  compute budget control is new work, not an implied capability.
- **Whether `pricing: 'free'` is trustworthy.** The gate accepts a provider's own
  declaration (`providers/types.ts:38`). A provider that declares `'free'` and
  bills later would defeat the gate. The catalog membership test is the
  cross-check for models on the curated list; a provider that is free-but-uncatalogued
  is trusted on its declaration alone. A signed or upstream-verified price source
  is new work.
- **The canonical presence source's own contract.** This doc depends on
  `docs/design-user-presence.md` without adjudicating its API. If that workstream
  exposes only a snapshot and not an AFK boolean, nap's condition must be derived
  from the snapshot — the dependency direction is fixed, the exact shape is not.

---

## 10. Phased implementation plan

Each phase is independently reviewable and must not start before the previous
one is green.

### Phase 0 — presence foundation (owned by `docs/design-user-presence.md`)

**Not this feature's work.** Phase 0 is the separate presence workstream that
establishes the single source of truth for "is the user present", extensible
later to mouse movement and platform-native plugins. Its design is
`docs/design-user-presence.md`, written by another worker; this document only
**depends on its public API** — the canonical presence snapshot plus an AFK
boolean / resolved threshold. Nap Phase 1 consumes that API and duplicates
none of its model. If that workstream slips, every phase below is blocked,
because Phase 1 is the first consumer.

### Phase 1 — Nap state (no mesh, no peer, no LLM)

- `packages/stage-shared/src/agentic.ts`: add `CompanionNapState`
  (`'active' | 'napping'`). **No** `napAfterMinutes` — the threshold belongs to
  the presence source (Decision 1).
- `packages/stage-ui/src/stores/agentic.ts`: derive the nap ref from the Phase-0
  canonical presence API (no timer; read on the existing 10s tick via a
  `watch`), and make `gate('scheduled')` refuse a cycle while napping. Keep the
  gate precedence order unchanged.
- `packages/stage-ui/src/stores/agentic.gate.test.ts`: add the napping cases.
- `packages/stage-pages/src/pages/settings/modules/agentic-os.vue`: a nap
  toggle, a note that the threshold is inherited from the presence setting
  rather than owned here, and a note that napping is independent of
  `autonomousMode`. i18n keys to `packages/i18n/src/locales/en/settings.yaml`.

### Phase 2 — Negotiation contract (no turns)

- `packages/stage-shared/src/agentic.ts`: `NapChatWireSchema`,
  `parseNapChatMessage`, `NAP_CHAT_TOPIC` (single-sourced beside
  `COMPANION_TOPIC`), and message interfaces.
- `packages/stage-shared/src/libp2p.ts` + `main/.../libp2p/pairing.ts`: add
  `napChatGranted` to `PairedDevice` / `PairedDeviceSchema`
  (`pairing.ts:69-76`), written by the pairing flow only.
- `apps/stage-tamagotchi/src/main/services/airi/libp2p/index.ts`: gate both
  `libp2pServiceCreatePairing` (`:1019`) and `libp2pServiceAcceptPairing`
  (`:1043`) on the grant **before** `addPairedDevice` is reached, so refusal
  persists nothing.
- `packages/stage-pages/src/pages/settings/modules/libp2p.vue`: surface the
  grant in the pairing dialog (`:726-800`) beside the accept action.
- `packages/stage-ui/src/stores/companion.ts`: bind the new topic in
  `handleMeshMessage` (currently `if (message.topic !== COMPANION_TOPIC) return`
  at `:281`), validate with `parseNapChatMessage`, record observed proposals.
- Add both topics to the two duplicated default lists
  (`main/.../libp2p/index.ts:254`, `stage-ui/.../modules/libp2p.ts:89`).
- `apps/stage-tamagotchi/src/main/services/airi/libp2p/pairing-trust-flow.test.ts`
  (extend, runs **real** nodes): pin that a pairing whose grant is refused
  produces no `PairedDevice` record and no proposal is ever sent.
- `apps/stage-tamagotchi/src/main/services/airi/agentic/companion-boundary.test.ts`:
  pin that a proposal with a foreign nonce is refused.

### Phase 3 — The session

- `packages/stage-ui/src/stores/companion.ts` (or a new
  `stores/nap-chat.ts` — prefer extending `companion.ts` to avoid a second mesh
  store): propose/accept/decline, session open/close/expiry, strict alternation,
  the per-day cap on card config.
- Turn generation per §5, via `ingest(…, { triggerOnly: true })` into a
  `setActive: false` session.
- `packages/stage-ui/src/stores/agentic.ts` (or the new nap-chat store): the
  model-gate predicate from §5.1 as a **pure exported function**, checked at
  accept and before every turn.
- `packages/stage-ui/src/stores/agentic-guard.test.ts`: pin that a nap-chat turn
  is never a cycle, never reads the user's history, and never carries memory.

### Phase 4 — Memory write-back and return-surfacing

- `createEntry({ source: 'dream' })` on session close
  (`stores/memory-text-journal.ts:345`); one `nap_chat_completed` ledger event,
  one `nap_chat_gated` ledger event when the model gate refuses.
- The presence-edge `watch` + heartbeat-pattern recap delivery (§7), surfacing
  exactly one recap — the most recent completed session (Decision 5).

### Explicitly NOT in scope

- Broadcasting presence over the mesh, or discovering a peer's nap state
  without an invitation.
- Any new memory-reading HTTP route (the endpoint stays exactly two routes).
- Any change to `narrowerScope` / `packGuestAccess` / the three share scopes.
- Chip synthesis from a nap-chat, STMM/Lifetime writes, or a relay of one
  peer's recap to a third.
- Cross-instance memory reconciliation (already unresolved in the parent
  design's §8).
- Replacing the two duplicated topic default lists with a single source — a real
  problem, out of scope here.
- The presence workstream itself, its API shape, and its own design document
  (Phase 0).

---

## 11. Test plan

| Suite | Location | Pins |
|---|---|---|
| `nap.state` | `packages/stage-ui/src/stores/agentic.test.ts` (new) | nap enters from the **Phase-0 presence API** with **no timer of its own**; exits when the user returns; refuses a scheduled cycle while napping; does **not** need `autonomousMode` to be non-`disabled`. |
| `agentic.gate.test.ts` (extend) | same path | napping + `when-away` + `away` ⇒ refused; the existing `when-away` + `idle` ⇒ refused case stays green. |
| `nap-chat.protocol` | `apps/stage-tamagotchi/src/main/services/airi/agentic/nap-chat.test.ts` (new) | every shape round-trips through `parseNapChatMessage` after a JSON+base64 hop, as the topic actually carries it (`companion.test.ts:32-48` is the precedent); an `accept` without the proposal's nonce is refused; a `turn` above `turnCap` is dropped; a stale `at` is dropped. |
| `nap-chat.boundary` | extend `companion-boundary.test.ts` | a `turn` message whose payload contains chip/journal/lifetime-shaped fields is rejected by the schema (**negative control**: a peer *cannot* widen the wire shape); a peer's `turn.text` containing instruction-shaped text ("ignore previous instructions") is treated as conversation input, never as a directive. |
| `nap-chat.pairing` | extend `pairing-trust-flow.test.ts` (real nodes) | **negative control (Decision 4)**: without the grant there is **no pairing record** and **no proposal is ever sent** — `addPairedDevice` is not reached and `listPairedDevices` never reports the peer. |
| `nap-chat.model-gate` | `packages/stage-ui/src/stores/agentic.test.ts` (new, or the nap-chat store's suite) | **negative control (Decision 3)**: a nap-chat turn is **never** generated when the selected model is non-local and non-free — the accept is not sent and no `ingest` call is made; a mid-session swap to a paid model closes the session on both sides rather than spending; a refused gate writes `nap_chat_gated` and **no** journal entry. |
| `nap-chat.leak` | `packages/stage-ui/src/stores/agentic-guard.test.ts` (extend) | **negative controls**: the nap-chat session's inference messages contain no user-session message and no echo chip; a nap-chat turn is generated into a session created with `setActive: false`, so the user's active session id is unchanged. |
| `nap-chat.surface` | `packages/stage-ui/src/stores/` (new) | recap fires once, on the presence return edge only; never while present; **exactly one** recap is surfaced regardless of how many sessions completed (Decision 5); the journal entry text and the spoken text are the same string. |
| `presence.test.ts` (extend) | `packages/stage-ui/src/stores/presence.test.ts` | unchanged derivation; confirms the affine states the presence source fixes, so nap cannot drift the cycle's threshold. The threshold now has **one** owner (Phase 0), which is the point of Decision 1. |

Every negative control above is a test that a *forbidden* thing stays
impossible — that is the class of assertion this feature most needs, because its
risk is a leak and a bill, not a crash.

---

## 12. Decision log

**2026-10-14 — user rulings on the five open architecture points.**

1. **PRESENCE — one source of truth.** Presence becomes its own workstream with
   its own design doc, `docs/design-user-presence.md`, built to be extensible
   later to mouse movement and platform-native plugins. Nap Phase 1 consumes
   that canonical presence source and AFK signal **instead of**
   `proactivity.idleTimeSec` directly; nap duplicates none of its model and
   depends only on its public API. Added as **Phase 0**, owned by that document;
   this doc's phases renumbered to 1–4.

2. **TOPIC — proceed as recommended.** The new `airi/companion.chat` topic stays
   exactly as §4 recommends; no objection to the defence recorded there.

3. **COST / MODEL GATING — local or known-free only.** Nap-chat turns may only
   run on a local or known-free model. The gate runs at session-accept **and**
   before every turn, so a mid-session model swap stops the session instead of
   spending. On failure the session may not proceed and gracefully expires with
   no inference spend. Mechanism proposed in §5.1 over the already-declared
   `pricing` / `deployment` fields and the existing free-model catalog; a
   negative control pins that no turn is ever generated for a non-local,
   non-free model.

4. **CONSENT — part of pairing.** Nap-chat consent is displayed **during QR
   pairing** and is part of the pairing flow: *don't want it → don't pair*. It
   is not a per-invite prompt and not a separate consent screen. The grant flows
   through the pairing flow; refusing means **no pairing record and no mesh
   access**. A negative control pins that without the grant there is no pairing
   and no proposal is ever sent.

5. **POC SCOPE — one surfaced nap-chat.** Exactly **one** nap-chat is surfaced to
   the user on return: one assistant turn covering the most recent session, with
   older ones left in the journal. The POC is simplified to match. The per-day
   cap may be reduced but a safety bound is kept — **2 sessions/day**, with the
   turn cap reduced to 6.
