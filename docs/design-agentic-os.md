# Agentic OS Integration — Design Record

## 1. What this feature is

Autonomous companion behaviour driven by derived presence, memory, and the Jev
System-1 decision engine, on top of the existing proactivity ("heartbeats")
system and the libp2p local mesh.

The single most important framing: **heartbeats and the autonomous cycle are
inverses.** A heartbeat is an *attended* check-in, gated by
`pauseWhenAfk` / `evaluateHeartbeatGating` so it fires while the user is at the
desk. The autonomous cycle is *unattended* behaviour, gated on derived presence
so it fires only when it believes nobody is watching. Neither consults the
other's gate — they share the sensor loop and nothing else.

| | Heartbeat | Autonomous cycle |
|---|---|---|
| Fires when | user is present and quiet | presence is derived as `away` (or `always` mode) |
| Gate source | `evaluateHeartbeatGating` (`fireGate` in `evaluateHeartbeat`) | `useAgenticStore().gate()` |
| Reads heartbeat state | — | **never** |
| Decision provider | the full chat model | Jev System-1, with an explicit `abstain` |
| Logged as | `category: 'proactivity'` | `category: 'agentic'`, `autonomous: true` |

---

## 2. Presence derivability — what is real and what is not

Implemented in `packages/stage-ui/src/stores/presence.ts`.

### Derivable today

| State | Derivation |
|---|---|
| `active` | `idleTimeSec` below the 2-minute quiet-input floor |
| `idle` | `idleTimeSec` at or beyond 2 minutes, below the away threshold |
| `away` | `idleTimeSec` at or beyond the 30-minute unattended threshold |

The idle time itself comes from the existing `sensorsGetIdleTime` probe that the
proactivity store already runs on its 10-second interval. **The presence store
adds no timer of its own** — it is a derived read of the refs that proactivity
already refreshes. A second interval would duplicate the IPC probes and let the
two loops disagree about when the user left, so the presence store subscribes to
the same data instead.

`idle` is a *pre-AFK* state and is checked independently of the card's
`afkThresholdMinutes` (the heartbeat's threshold). The reason is asymmetric:
`afkThresholdMinutes` is a per-companion tuning knob for when the user "stepped
away", while `away` is a fixed 30-minute floor, so a card configured with a long
AFK threshold cannot widen the window in which the companion thinks the desk is
unattended. `resolveAfkThresholdMinutes` reads the same card extension the
heartbeat gate reads, so the two features cannot disagree about the threshold
they *do* share.

### Not derivable — stated, not faked

| State | Why not |
|---|---|
| `screen-locked` | The desktop main process receives `powerMonitor` `lock-screen`, but converts **both** `lock-screen` and `suspend` to `reason: 'suspend'` on `electronWindowLifecycleChanged` and uses it only to hide windows. No contract forwards a lock state to the renderer. The renderer-side lifecycle store that does hold it lives in `apps/stage-tamagotchi/src/renderer/`, which `packages/stage-ui` cannot import. |
| `sleep` | A genuine suspend freezes renderer timers, and no contract forwards a resume event back. There is no reliable "I am asleep now" signal reachable from the shared UI package. |

`detectSignalAvailability()` returns `'unavailable'` for both, and
`derivePresenceState` structurally cannot return them (`lockSignal` and
`sleepSignal` are only ever set from an OS signal that does not exist today).

**This is deliberate honesty, not a gap to be papered over.** The interface
`PresenceStateAvailability` declares `active`/`idle`/`away` as `'derivable'`
unconditionally and the other two as `'derivable' | 'unavailable'`, so a
consumer is forced to confront which build it is on. Proximity sensors, camera
detection, Bluetooth presence, and keyboard/mouse hooks are all *aspirational*:
none exists in this repository, and none is referenced here as though it did.

If lock/sleep telemetry is added later, it requires a new main-process service
plus a `packages/stage-shared` contract, because that is the only honest path to
a renderer-visible signal. Nothing in the current code will need to change
except filling in `lockSignal`/`sleepSignal`.

### Gate precedence

`gate(trigger)` checks, in order:

1. `mode === 'disabled'` → refuse, every trigger
2. explicit trigger (`manual`, `http`) → allow, bypassing everything below
3. `shouldRunForPresence(mode, presenceState)` → refuse, reason `presence:<state>`
4. cooldown → refuse, reason `cooldown:<seconds>`

`manual` and `http` bypass presence and cooldown because an explicit request is
not an interruption. Mode still gates them, because `disabled` means disabled.
The precedence order matters more than any single branch: checking cooldown
before presence would report the wrong reason and hide a misconfigured presence
signal, which is exactly the kind of bug that lets an autonomous feature start
interrupting a user at their desk. Pinned in
`packages/stage-ui/src/stores/agentic.gate.test.ts`.

---

## 3. The ranking policy

Memory intentions are ranked by `packages/stage-ui/src/stores/agentic-intentions.ts`
(`AUTONOMOUS_RANKING_POLICY`, `rankIntentions`, `scoreIntention`). The ranked list
is then handed to Jev System-1, which picks one or abstains; the ranking is what
Jev sees, so its ordering is a real constraint.

| Term | Weight | Rationale |
|---|---|---|
| pillar provenance | lifetime `0.45` > text-journal `0.30` > echo-chips `0.20` > event-log `0.10` | Provenance is confidence in relevance. The lifetime archive exists *because* it distils what matters about the relationship, so it is the strongest claim. The ledger is the weakest, being a record of *events*, not of meaning. |
| recency | `0.25`, flat inside 6h then 72h half-life | Salience decays superlinearly, so a half-life rather than a ramp: something from this morning is a live thread, something from three days ago is context. |
| deadline pressure | `0.40` (full inside 24h, decaying to zero) | A stated commitment is the one thing a user most wants honoured, and it is the only term that can outrank provenance. Deadlines that have already passed stay at full weight — overdue is not resolved. |
| relationship intensity | `0.30`, bounded below `0.40` | Warmth and grievance matter, but must **never** beat a commitment. `0.30 < 0.40` enforces that structurally. |
| diversity | `0.5^n` per duplicate kind | Stops one theme monopolising every cycle. The best representative of a kind keeps full score; each further duplicate halves again. |

Ties break by newest memory, then by `id`, so the order is deterministic across
runs and a re-run cannot reorder the pool.

Total is clamped to `[0, 1]`. A missing timestamp scores `0` rather than
negative; a clock-skewed *future* timestamp is clamped to now.

This policy was chosen rather than, say, a pure semantic-similarity score
because the pillars are small and heterogeneous, and every term is one an
operator can reason about and tune: the weights are a single frozen constant, no
behavior is hidden in a model's embedding space.

The Jev selection pool is capped at 6 candidates, with an explicit `abstain`
choice. If System-1 is unconfigured or the call throws, the ranking's top entry
is taken and `selectionSource: 'local-fallback'`, so autonomy degrades rather
than going silent.

---

## 4. Constitutional guardrails

`evaluateConstitutionalGuard` (`packages/stage-ui/src/stores/agentic.ts`) is the
last gate before any LLM call. Three guards, all of which must pass:

1. `canSpeak` — the provider must be able to speak. A **silent** autonomous
   action is invisible to the user, which is the exact failure mode this prevents.
2. the provider must expose an action-intent surface at all
3. the requested intent must be in the available set. Anything not explicitly
   allowed is refused; an unset intent string is not treated as allowed
   (`[].includes('')` is `true`, so the empty string is a real hazard).

Autonomous execution emits exactly one intent: `expression.body` — speech and
body expression only. No file access, no external API, no system change, no
tool with a side effect is reachable from an autonomous cycle, because the guard
refuses any intent the provider did not explicitly list. This is structural, not
policy: the autonomous path has no code that could request anything else.

Execution routes through `chatOrchestrator.ingest(trigger, { triggerOnly: true })`
— **the same pipeline a user-initiated turn uses**, so captions, TTS, stage
expressions and the Event Ledger all fire from one place rather than from a
parallel autonomous path that could drift from the real one.

Every cycle records an `AutonomousDecisionRecord` and appends to the Event Ledger
with `category: 'agentic'`, `autonomous: true` (hoisted onto the event, not buried
in `payload`, so it is filterable as a field). The settings page's Autonomous
log section reads `eventLogStore.autonomousEvents` so a user can review what
AIRI did. **No undo is offered**, because none exists: an autonomous turn's
effects (a recording, a message in history) are not reversible, and offering a
button that does nothing would be a lie.

---

## 5. The HTTP endpoint security model

`apps/stage-tamagotchi/src/main/services/airi/agentic/http-endpoint.ts`

**Bind: `127.0.0.1`.** Loopback only, never the LAN. An automation tool can only
be on the same machine, so binding a routable address would expose the
companion to every host on the network for no benefit.

**Auth: bearer token, always.** This is the sharp decision, and the reasoning
matters: *loopback alone is not authorization.* Every process on the machine,
including any local privilege boundary, would otherwise hold silent authority to
ask the companion to act. Treating `127.0.0.1` as "trusted" is how tools like
Chrome DevTools and Docker's socket have been exploited. The bearer token is the
capability: only a process the operator explicitly configured, with the token,
may ask.

**Routes: exactly two, neither reads memory.**

| Route | Method | Effect |
|---|---|---|
| `/status` | GET | `{ present, presenceState, autonomousMode, lastCycleAt }` |
| `/cycle` | POST | queue one `manual` cycle |

No route reads the journal, chips, lifetime, or ledger. A local automation tool
gets presence and the ability to ask for a cycle; it cannot read the companion's
memory, because reading the memory is what it does not need and what would make
a compromise of a Home Assistant container a compromise of the relationship.

**Token handling:**
- empty token → `401 endpoint-disabled`. An endpoint with no token is *disabled*,
  not open; this is the fresh-install state.
- `randomBytes(32).toString('hex')`, generated on first enable, rotatable from
  the settings page; never logged after generation.
- constant-time compare (`timingSafeEqual`, since Node's `timingSafeEqual`
  requires equal-length buffers and throws otherwise — the length is checked
  first and the compare then runs over the expected length so the length does
  not leak).
- header bounded at `MAX_TOKEN_LENGTH` before comparison, so an unbounded header
  cannot force a long compare.
- request body capped at 8 KiB.

The renderer also subscribes to `agenticServiceCycleRequested` and runs
`runCycle('http')`. That indirection is deliberate: main is the HTTP server but
the memory scan and the expression pipeline live in the renderer, so the
endpoint *asks for* a cycle rather than carrying an instruction the renderer
would have to trust.

---

## 6. The guest boundary (companion mesh)

`packages/stage-shared/src/agentic.ts` + `apps/stage-tamagotchi/src/main/services/airi/agentic/companion.ts`

Two topics: `airi/companion` (card shares) and `airi/presence`. Share contracts
`companionServiceShare` / `Visit` / `Host`, plus consent contracts.

Both topics are already in the libp2p service's default topic set
(`['airi/presence', 'airi/memory', 'airi/vault', 'airi/companion']`) and its
computed allow-list, so a share needs no new subscription on any side — only a
publisher, which `getLibp2pMeshPublisher()` provides. The mesh itself starts
under its default `['tcp', 'websockets']` transport set; see §9 for the precise
status of webrtc and for what has *not* been exercised end to end.

### The rule

**A share carries the card and the consented scope — never the memory.** Memory
travels only as a direct response from a host to the specific guest that asked,
so a broadcast cannot carry one companion's private history to every peer on the
mesh.

Scopes, narrowest first: `card-only` → `card-and-echo-chips` →
`card-and-lifetime`.

### How it is enforced

Structurally, in one place. `packGuestAccess` is the only function that decides
what a guest may read, and the rule is a structural consequence of the scope, not
a policy a caller can override: below `card-and-echo-chips` there is no code path
that attaches chips, and only `card-and-lifetime` gets lifetime text.

A guest can never hold a capability it was not given because **`narrowerScope`
always returns the minimum** of the host's published scope and what the guest
asked for. There is no "read more" request to grant or refuse — a guest asks, the
host clamps, the host packs what the clamp permits. Tests pin this for every
pairing of host scope × guest ask
(`companion-boundary.test.ts`).

### The lifetime text is the distillation, not the archive

`card-and-lifetime` exposes the artifact's own `distilledContent` — the distilled
relational essence — bounded to 4000 characters. It never exposes `baseArchive`,
`chunkSummaries`, or the source documents, which would leak the full
conversation history that the distillation exists to abstract away. The slice is
a bound, not a transformation, so a dense archive cannot become an unbounded
share.

### Consent is one entry point

`setConsent` (main) is the single place consent is written. It persists via
`createConfig`, then broadcasts `companionConsentChanged`. Every consent change
in the whole product goes through that one function, so the settings page cannot
show a state the service does not hold, and the share handler reads
`currentConsent` rather than trusting a renderer claim. A refused share publishes
**nothing** — not a narrowed share — because consent is the gate; a narrowed
publish would still broadcast a card the operator never agreed to share.

The settings page (`agentic-os.vue`) shows the granted/revoked state, the grant
time, picks the scope with an explicit description of what each scope lets a
guest read, and can grant/revoke/share. Consent with no UI would be a silent
trust decision, which is precisely what the feature must not have.

### Ownership split

Main owns the *publisher* and the *consent gate*, because a share must be
refuseable in the process that can actually publish. The renderer owns the
*card* and the *memory pillars*, because those live in IndexedDB and Pinia.

Topic messages arrive in the **renderer**, because the libp2p service pushes
every message to the renderer as `libp2pMessageReceived` and main holds no
subscriber of its own. So the round trip is:

1. renderer reads the active card → `companionServiceShare`
2. main gates on consent, clamps the scope, publishes to `airi/companion`
3. peers receive; each receiving renderer parses (with the *shared* schema) and
   reports to its own main via `companionServiceRecordObservedShare`
4. a guest's `companionServiceVisit` is answered from that record — refusing when
   no share was observed, and refusing again when the share is older than
   30 minutes

Neither side reads the other's stores, so there is one source of truth per
concern. A guest's memory snapshot for `companionServiceHost` is reported by the
renderer via `companionServiceReportGuestSnapshot` and packed by main, so the
host side never fabricates memory.

`parseCompanionShare` and its schema live in the shared package because **both**
processes validate with identical rules. A copy in each would drift, and drift
here is exactly the class of silent drop that makes a mesh look connected while
nothing round-trips.

---

## 7. Fog items — resolved

- **Jev question templates.** `JEV_SELECT_QUESTION` is a choice question over
  candidate titles plus an explicit `abstain` option, so System-1 either commits
  to one ranked candidate or declines. Pool capped at 6. Unconfigured provider or
  a thrown call falls back to `rankIntentions(...)[0]` with
  `selectionSource: 'local-fallback'`.
- **Ranking.** The five-term policy in §3, documented above with per-term
  rationale and the invariant that intensity cannot outrank a deadline.
- **External API shape.** The loopback HTTP endpoint's shape is `GET /status`,
  `POST /cycle` (§5). Deliberately no memory-reading route.
- **Scheduling.** A 30-second interval reading derived state, gated on
  `autonomousMode`, starting lazily so a cycle can never fire from a wrong
  default mode before the config arrives from main. It does **not** call
  `sensorsGetIdleTime` itself and does **not** evaluate a heartbeat gate. It is
  not the 10-second proactivity loop and does not reuse it, because there is no
  callback or interval-export in the proactivity store to subscribe to and
  inventing one would couple two features that must stay independent.
- **Guest memory isolation beyond the three scopes.** Solved by the scopes
  themselves: there is no per-field negotiation, no "read more" request, and no
  way for a guest to widen its own grant.

## 8. Fog items — deliberately not resolved

- **Conflict resolution across instances.** `airi/memory` and `airi/vault`
  topics exist with `meshSyncEnabled: false`. How two AIRI instances should
  reconcile the same memory is unspecified, and no merge policy is claimed here.
  The companion feature does not use sync: a share is a read-only offer, so
  there is nothing to reconcile.
- **Guest memory isolation beyond the three scopes.** There is no per-chip or
  per-entry consent, no per-guest relationship memory, and no "this guest has
  already read this" tracking. A guest re-requesting a share gets the same pack.
  If finer-grained revocation is needed it is new work, not an implied capability.
- **Lock/sleep presence.** Requires a new main-process service and a shared
  contract before it can be reported (§2).

---

## 9. Known limits

- **The mesh is implemented and starts; it is simply off until enabled.** The
  era-2 dependency graph is pinned in `pnpm-workspace.yaml`, `libp2p` core and
  its transport packages resolve, and `apps/stage-tamagotchi/src/main/services/airi/libp2p/transports.test.ts`
  (8 tests, green) builds **real in-process nodes exactly as the service builds
  them** — `createLibp2p(...)` with noise, yamux, identify and gossipsub — calls
  `node.start()`, and asserts real listen multiaddrs for a tcp-only node
  (`/tcp/`) and a websockets-only node (`/ws`). `createLibp2p` does not throw.
  `enabled` defaults to `false` and `transports` defaults to
  `['tcp', 'websockets']`, so the node starts fine today with no native addon.
- **webrtc is selectable but its native addon is not built here.** `@libp2p/webrtc`
  re-exports `@ipshipyard/node-datachannel/polyfill`, whose module scope needs
  the `node_datachannel.node` addon produced by a post-install script. Under
  `--ignore-scripts` that addon is absent, so the import is deliberately a
  dynamic one inside the `webrtc` branch rather than a static import. The
  consequence is narrower than a boot crash: a **selected** webrtc transport
  degrades to a caught, reported node-start failure instead of killing the app
  during main-process module resolution. The default transport set never
  reaches that path.
- **`mesh-not-running` therefore means the mesh is genuinely off**, not that it
  cannot run. `getLibp2pMeshPublisher()` returns `null` only when
  `libp2pNode` is unset — i.e. when the service has not started a node — so
  `publishCompanionShare` returning `null` and the share handler answering
  `mesh-not-running` is the truthful answer for "the operator has not enabled
  the mesh", not a workaround for a broken dependency.
- **The companion round trip has not been exercised against two live nodes.**
  Every wire-format, consent, and boundary rule above is unit-tested against
  real guards (`parseCompanionShare`, `narrowerScope`, `packGuestAccess`, and the
  consent gate), and the mesh is proven to start, but the sequence
  node A publishes → node B observes → node B reports to its main → node A's
  guest visits has not been run end to end between two processes.
- `companionServiceVisit` is only answerable for shares this renderer has
  observed and reported. A peer that shared while this node was offline is not
  in the record.
- The autonomous log has no undo (§4).
