import type { Libp2pPeerInfo, Libp2pServiceConfig, Libp2pServiceStatus, Libp2pTransportKind, MeshIdentityInfo, PairedDevice } from '@proj-airi/stage-shared/libp2p'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import {
  electronMeshIdentityChanged,
  electronMeshIdentityGenerate,
  electronMeshIdentityGet,
  electronMeshIdentitySetName,
  isElectronWindow,
  libp2pMessageReceived,
  libp2pPeerDiscovered,
  libp2pPeerJoined,
  libp2pPeerLeft,
  libp2pServiceAcceptPairing,
  libp2pServiceApplyConfig,
  libp2pServiceCreatePairing,
  libp2pServiceEventLog,
  libp2pServiceGetConfig,
  libp2pServiceGetStatus,
  libp2pServiceListPairedDevices,
  libp2pServiceListPeers,
  libp2pServicePairedDevicesChanged,
  libp2pServicePing,
  libp2pServicePublish,
  libp2pServiceRemovePairedDevice,
  libp2pServiceStart,
  libp2pServiceStatusChanged,
  libp2pServiceStop,
  libp2pServiceUpdatePairedDeviceAlias,
} from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, onMounted, onScopeDispose, onUnmounted, ref, watch } from 'vue'

import * as v from 'valibot'

// ── Persisted Config ──────────────────────────────────────────────────────────

const enabled = useLocalStorageManualReset<boolean>('settings/libp2p/enabled', false)

// Mirrors `Libp2pTransportKind`; mDNS is not a transport. A build that persisted
// the untyped ref also persisted `'mdns'` inside this list. mDNS never enabled
// anything - the main service registers it unconditionally through
// `peerDiscovery` - while its config schema is `array(picklist([...]))`.
// Forwarding an invalid member makes `safeParse` reject the whole config file
// and auto-heal it back to defaults, discarding `enabled`, `bootstrapPeers` and
// `topics`, so stale members are dropped on read instead of being sent on.
export const LIBP2P_TRANSPORT_KINDS: readonly Libp2pTransportKind[] = ['tcp', 'websockets', 'webrtc', 'webtransport']

/** Type guard for transport kinds, so narrowing survives without an unchecked cast. */
export function isLibp2pTransportKind(value: unknown): value is Libp2pTransportKind {
  return typeof value === 'string' && (LIBP2P_TRANSPORT_KINDS as readonly string[]).includes(value)
}

/**
 * Append `item` unless it is already present, returning the original array (unchanged
 * identity) when it is a duplicate. Callers holding a persisted array ref use this so
 * a repeated click on "Add" neither duplicates the entry nor churns the ref; the
 * store's own write paths call it too, so a duplicate cannot enter via IPC either.
 */
export function appendUnique<T>(items: readonly T[], item: T): T[] {
  return items.includes(item) ? items.slice() : [...items, item]
}

/**
 * Drop transport kinds the main-process config schema rejects, plus duplicates.
 *
 * Applied on read (below, at module scope), on every write path that reaches main
 * (`startService` / `applyConfig`) and to the config main echoes back, so a stale
 * member can never be forwarded and never survives a round trip.
 */
export function sanitizeTransports(value: readonly string[]): Libp2pTransportKind[] {
  const sanitized: Libp2pTransportKind[] = []
  for (const kind of value) {
    if (!isLibp2pTransportKind(kind) || sanitized.includes(kind))
      continue
    sanitized.push(kind)
  }
  return sanitized
}

const transports = useLocalStorageManualReset<Libp2pTransportKind[]>('settings/libp2p/transports', ['tcp', 'websockets'])

const staleTransports = transports.value.filter(kind => !LIBP2P_TRANSPORT_KINDS.includes(kind))
if (staleTransports.length > 0)
  transports.value = transports.value.filter(kind => LIBP2P_TRANSPORT_KINDS.includes(kind))

const bootstrapPeers = useLocalStorageManualReset<string[]>('settings/libp2p/bootstrapPeers', [])
const topics = useLocalStorageManualReset<string[]>('settings/libp2p/topics', ['airi/presence', 'airi/memory', 'airi/vault', 'airi/companion', 'airi/companion.chat'])
const nodeName = useLocalStorageManualReset<string>('settings/libp2p/nodeName', 'AIRI Node')
const meshSyncEnabled = useLocalStorageManualReset<boolean>('settings/libp2p/meshSyncEnabled', false)
// Deliberately empty, to match main's `Libp2pServiceConfigDefault`: these refs are
// a cache of the config main echoes back, not an independent source. A divergent
// default made a fresh install disagree with main by construction — `loadConfig()`
// then adopted main's empty list and silently unchecked every sync target in the
// UI. Main merges its default over the stored record, so it always answers with a
// defined value and the "absent key" branch below can no longer distinguish a
// fresh install from a configured one.
const meshSyncTargets = useLocalStorageManualReset<string[]>('settings/libp2p/meshSyncTargets', [])

// ── Live Service State ────────────────────────────────────────────────────────

const serviceStatus = ref<Libp2pServiceStatus>({
  running: false,
  listenAddresses: [],
  connections: 0,
})

const identity = ref<MeshIdentityInfo | null>(null)
const peers = ref<Libp2pPeerInfo[]>([])
const eventLog = ref<Array<{ level: string, message: string, timestamp: number }>>([])

const pairedDevices = ref<PairedDevice[]>([])

/** Active pairing invitation; non-null only while the dialog should stay open. */
const pairing = ref<{ qrCode: string, magicCode: string, expiresAt: string } | null>(null)

/** Last failure surfaced by an action or by an implicitly started apply. */
const lastError = ref<string | null>(null)

/**
 * Epoch ms of the last successful refresh, per data domain, so the UI can tell
 * "quiet because nothing happened" apart from "quiet because the call failed".
 */
const lastRefreshedAt = ref<{ status: number, peers: number, identity: number, config: number, pairedDevices: number }>({
  status: 0,
  peers: 0,
  identity: 0,
  config: 0,
  pairedDevices: 0,
})

/** Which user-repeatable actions are in flight, so double-clicks cannot double-apply. */
const pending = ref<Record<string, boolean>>({})

function setPending(action: string, value: boolean) {
  pending.value = { ...pending.value, [action]: value }
}

const MAX_EVENT_LOG_ENTRIES = 200

// ── Derived ──────────────────────────────────────────────────────────────────

/**
 * Capability is re-evaluated per call: the preload script installs `window.electron`
 * before the renderer bundle runs, and a non-Electron window never has it. Deciding
 * once at module scope froze the answer for the whole process lifetime. The typed
 * guard replaces the old `(window as any).electron` probe.
 */
function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && isElectronWindow(window)
}

const isElectron = computed(() => isElectronEnvironment())
const isRunning = computed(() => serviceStatus.value.running)

/**
 * Serialized signature of everything a config write depends on.
 *
 * Vue's `deep` watcher skips the `Object.is` equality guard, and main answers
 * `applyConfig` with a freshly deserialised `{ ...config, ...patch }` whose arrays
 * are structurally identical but have new identities - so watching the refs
 * directly re-fired on every write-back. A signature string is compared with
 * `Object.is`, so an echo with unchanged content cannot re-trigger.
 *
 * `meshSync*` belongs here: those refs are persisted config that the settings page
 * persists through this same `applyConfig` call, so a toggle of them is a genuine
 * config change. Omitting them meant a mesh-sync-only edit produced no signature
 * change, hit the echo-guard's early return, and was never sent to main at all.
 */
const configSignature = computed(() => JSON.stringify([
  enabled.value,
  transports.value,
  bootstrapPeers.value,
  topics.value,
  meshSyncEnabled.value,
  meshSyncTargets.value,
]))

/**
 * Signature of the config main last acknowledged.
 *
 * Kept as a string rather than the echoed objects because main answers
 * `applyConfig` with a freshly deserialised spread whose arrays have new
 * identities but equal content; only a structural signature can tell that echo
 * apart from a real change.
 */
let lastAppliedConfigSignature = ''

/** True while an `applyConfig` invoke is in flight, so a re-entry is a no-op. */
let applyingConfig = false

/** Monotonic id for `refreshPairedDevices`, used to drop superseded responses. */
let pairedDevicesRequestId = 0

/**
 * Write the config main acknowledged back into the refs, per source and only where
 * the content genuinely differs.
 *
 * Main returns a spread (new object and array identities) that crosses IPC as fresh
 * arrays with equal content, so assigning unconditionally is what made the old
 * `deep` watcher re-fire: `Object.is` failed on identity while the values matched.
 *
 * `meshSync*` is included for the same reason: they are echoed back as part of the
 * same config object, so each needs its own content comparison before assignment.
 */
function writeBackConfig(config: {
  enabled: boolean
  transports: readonly string[]
  bootstrapPeers: readonly string[]
  topics: readonly string[]
  meshSyncEnabled?: boolean
  meshSyncTargets?: readonly string[]
}) {
  if (enabled.value !== config.enabled)
    enabled.value = config.enabled
  if (transports.value.length !== config.transports.length || transports.value.some((kind, i) => kind !== config.transports[i]))
    // The arrays cross IPC as frozen/interleaved-delimited data, so a copy is what
    // the watched refs get rather than a view onto main's own objects.
    transports.value = [...config.transports] as Libp2pTransportKind[]
  if (bootstrapPeers.value.length !== config.bootstrapPeers.length || bootstrapPeers.value.some((peer, i) => peer !== config.bootstrapPeers[i]))
    bootstrapPeers.value = [...config.bootstrapPeers]
  if (topics.value.length !== config.topics.length || topics.value.some((topic, i) => topic !== config.topics[i]))
    topics.value = [...config.topics]
  // `optional` in main's schema, but main merges its default before answering, so
  // an `undefined` here means a main build older than the schema change rather
  // than a reset signal — adopt it, never treat it as "clear the targets".
  if (config.meshSyncEnabled !== undefined && meshSyncEnabled.value !== config.meshSyncEnabled)
    meshSyncEnabled.value = config.meshSyncEnabled
  const echoedTargets = config.meshSyncTargets
  if (echoedTargets !== undefined && (meshSyncTargets.value.length !== echoedTargets.length || meshSyncTargets.value.some((target, i) => target !== echoedTargets[i])))
    meshSyncTargets.value = [...echoedTargets]

  lastAppliedConfigSignature = JSON.stringify([
    enabled.value,
    transports.value,
    bootstrapPeers.value,
    topics.value,
    meshSyncEnabled.value,
    meshSyncTargets.value,
  ])
}

// ── IPC Invokers ──────────────────────────────────────────────────────────────

const invokeStart = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceStart) : null
const invokeStop = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceStop) : null
const invokeGetStatus = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceGetStatus) : null
const invokeListPeers = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceListPeers) : null
const invokeGetConfig = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceGetConfig) : null
const invokeApplyConfig = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceApplyConfig) : null
const invokePing = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServicePing) : null
const invokePublish = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServicePublish) : null
const invokeIdentityGet = isElectronEnvironment() ? useElectronEventaInvoke(electronMeshIdentityGet) : null
const invokeIdentityGenerate = isElectronEnvironment() ? useElectronEventaInvoke(electronMeshIdentityGenerate) : null
const invokeIdentitySetName = isElectronEnvironment() ? useElectronEventaInvoke(electronMeshIdentitySetName) : null
const invokeCreatePairing = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceCreatePairing) : null
const invokeAcceptPairing = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceAcceptPairing) : null
const invokeListPairedDevices = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceListPairedDevices) : null
const invokeRemovePairedDevice = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceRemovePairedDevice) : null
const invokeUpdatePairedDeviceAlias = isElectronEnvironment() ? useElectronEventaInvoke(libp2pServiceUpdatePairedDeviceAlias) : null

const eventaContext = useElectronEventaContext()

// ── Event Handlers ───────────────────────────────────────────────────────────

/**
 * Boundary schemas for the payloads main pushes over IPC.
 *
 * `emitToAllWindows` in main swallows its own emit failures, so a partial body is
 * indistinguishable from a healthy event on this side; the renderer must not trust
 * `event.body`. Main declares the same fields, so the payloads are parsed once at
 * this boundary and consumed as named types afterwards. Anything malformed is dropped
 * rather than assigned into refs, because `serviceStatus` is dereferenced by
 * `isRunning` and by the settings page.
 */
const StatusSchema = v.object({
  running: v.boolean(),
  listenAddresses: v.array(v.string()),
  connections: v.number(),
  peerId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  error: v.optional(v.string()),
})

const PeerSchema = v.object({
  id: v.string(),
  addresses: v.array(v.string()),
  connected: v.optional(v.boolean()),
  name: v.optional(v.string()),
})

const IdentitySchema = v.object({
  peerId: v.string(),
  publicKey: v.string(),
  name: v.string(),
  createdAt: v.number(),
})

const PairedDeviceSchema = v.object({
  peerId: v.string(),
  alias: v.string(),
  multiaddrs: v.array(v.string()),
  pairedAt: v.number(),
  lastSeen: v.number(),
  trusted: v.boolean(),
})

function dropMalformed(contract: string, body: unknown) {
  console.warn(`[Libp2pStore] Dropping malformed ${contract} payload:`, body)
}

function handleStatusChanged(body: unknown) {
  const parsed = v.safeParse(StatusSchema, body)
  if (!parsed.success)
    return void dropMalformed('status-changed', body)

  serviceStatus.value = parsed.output
}

function handlePeerJoined(body: unknown) {
  const parsed = v.safeParse(PeerSchema, body)
  if (!parsed.success)
    return void dropMalformed('peer-joined', body)

  const peer = parsed.output
  const idx = peers.value.findIndex(p => p.id === peer.id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], ...peer, connected: true }
  }
  else {
    peers.value.push({ ...peer, connected: true })
  }
  addEventLog('info', `Peer joined: ${peer.id.slice(0, 12)}...`)
}

function handlePeerLeft(body: unknown) {
  const parsed = v.safeParse(v.object({ id: v.string() }), body)
  if (!parsed.success)
    return void dropMalformed('peer-left', body)

  const { id } = parsed.output
  const idx = peers.value.findIndex(p => p.id === id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], connected: false }
  }
  addEventLog('info', `Peer left: ${id.slice(0, 12)}...`)
}

function handlePeerDiscovered(body: unknown) {
  const parsed = v.safeParse(PeerSchema, body)
  if (!parsed.success)
    return void dropMalformed('peer-discovered', body)

  const peer = parsed.output
  const idx = peers.value.findIndex(p => p.id === peer.id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], ...peer }
  }
  else {
    peers.value.push({ ...peer, connected: false })
  }
}

function handleMessageReceived(body: unknown) {
  const parsed = v.safeParse(v.object({
    topic: v.string(),
    from: v.string(),
    data: v.string(),
  }), body)
  if (!parsed.success)
    return void dropMalformed('message-received', body)

  addEventLog('debug', `Message on ${parsed.output.topic} from ${parsed.output.from.slice(0, 12)}...`)
}

function handleIdentityChanged(body: unknown) {
  const parsed = v.safeParse(IdentitySchema, body)
  if (!parsed.success)
    return void dropMalformed('identity-changed', body)

  identity.value = parsed.output
  // The identity's name is the source of truth once one exists; the persisted
  // node name is only the pre-identity fallback.
  if (nodeName.value !== parsed.output.name)
    nodeName.value = parsed.output.name
}

function handlePairedDevicesChanged(body: unknown) {
  const parsed = v.safeParse(v.array(PairedDeviceSchema), body)
  if (!parsed.success)
    return void dropMalformed('paired-devices-changed', body)

  pairedDevices.value = parsed.output
}

function handleEventLogEntry(body: unknown) {
  const parsed = v.safeParse(v.object({ level: v.string(), message: v.string() }), body)
  if (!parsed.success)
    return void dropMalformed('event-log', body)

  addEventLog(parsed.output.level, parsed.output.message)
}

function addEventLog(level: string, message: string) {
  eventLog.value.unshift({ level, message, timestamp: Date.now() })
  if (eventLog.value.length > MAX_EVENT_LOG_ENTRIES) {
    eventLog.value = eventLog.value.slice(0, MAX_EVENT_LOG_ENTRIES)
  }
}

function reportError(context: string, err: unknown) {
  lastError.value = `${context}: ${err instanceof Error ? err.message : String(err)}`
  console.error(`[Libp2pStore] ${context}:`, err)
  addEventLog('error', lastError.value)
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function refreshStatus() {
  if (!invokeGetStatus)
    return
  try {
    const status = await invokeGetStatus()
    if (status)
      serviceStatus.value = status
    lastRefreshedAt.value = { ...lastRefreshedAt.value, status: Date.now() }
  }
  catch (err) {
    reportError('Failed to refresh status', err)
  }
}

async function refreshPeers() {
  if (!invokeListPeers)
    return
  try {
    const list = await invokeListPeers()
    if (list)
      peers.value = list
    lastRefreshedAt.value = { ...lastRefreshedAt.value, peers: Date.now() }
  }
  catch (err) {
    reportError('Failed to refresh peers', err)
  }
}

async function refreshIdentity() {
  if (!invokeIdentityGet)
    return
  try {
    const id = await invokeIdentityGet()
    if (id) {
      identity.value = id
      // Identity name is the source of truth once one exists; the persisted
      // node name is only the pre-identity fallback.
      if (nodeName.value !== id.name)
        nodeName.value = id.name
    }
    lastRefreshedAt.value = { ...lastRefreshedAt.value, identity: Date.now() }
  }
  catch (err) {
    reportError('Failed to refresh identity', err)
  }
}

async function loadConfig() {
  if (!invokeGetConfig)
    return
  try {
    const cfg = await invokeGetConfig()
    if (cfg) {
      const sanitizedTransports = sanitizeTransports(cfg.transports)
      enabled.value = cfg.enabled
      transports.value = sanitizedTransports
      bootstrapPeers.value = cfg.bootstrapPeers
      topics.value = cfg.topics
      // Main merges its own default over the stored record, so these are always
      // defined in practice; the guard is belt-and-braces for a main build older
      // than the schema change, where the key really would be missing.
      if (cfg.meshSyncEnabled !== undefined)
        meshSyncEnabled.value = cfg.meshSyncEnabled
      if (cfg.meshSyncTargets !== undefined)
        meshSyncTargets.value = [...cfg.meshSyncTargets]
      // Record the signature main just confirmed, so a subsequent user-initiated
      // write-back of the same content is recognised as an echo rather than a change.
      lastAppliedConfigSignature = JSON.stringify([enabled.value, transports.value, bootstrapPeers.value, topics.value, meshSyncEnabled.value, meshSyncTargets.value])
      lastRefreshedAt.value = { ...lastRefreshedAt.value, config: Date.now() }
    }
  }
  catch (err) {
    reportError('Failed to load config', err)
  }
}

async function startService() {
  if (!invokeStart) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.start)
    return

  setPending('start', true)
  lastError.value = null
  const cfg: Libp2pServiceConfig = {
    enabled: true,
    transports: sanitizeTransports(transports.value),
    bootstrapPeers: bootstrapPeers.value,
    topics: topics.value,
    meshSyncEnabled: meshSyncEnabled.value,
    meshSyncTargets: [...meshSyncTargets.value],
  }

  // `enabled` is the persisted intent, so it is committed only once main has
  // accepted the start; setting it up front left the toggle reading "on" while
  // the body reported the node stopped.
  try {
    const status = await invokeStart(cfg)
    if (status)
      serviceStatus.value = status
    enabled.value = true
    lastAppliedConfigSignature = JSON.stringify([enabled.value, transports.value, bootstrapPeers.value, topics.value, meshSyncEnabled.value, meshSyncTargets.value])
  }
  catch (err) {
    // The settings page invokes this from a checkbox handler with no `await`,
    // so the failure is surfaced through `lastError`/`eventLog` rather than a
    // rejection nobody observes; the toggle is also rolled back, since it had
    // already been flipped optimistically by the caller.
    reportError('Failed to start service', err)
    enabled.value = false
  }
  finally {
    setPending('start', false)
  }
}

async function stopService() {
  if (!invokeStop) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.stop)
    return

  setPending('stop', true)
  lastError.value = null
  try {
    const status = await invokeStop()
    if (status)
      serviceStatus.value = status
    enabled.value = false
    lastAppliedConfigSignature = JSON.stringify([enabled.value, transports.value, bootstrapPeers.value, topics.value, meshSyncEnabled.value, meshSyncTargets.value])
  }
  catch (err) {
    reportError('Failed to stop service', err)
    enabled.value = true
  }
  finally {
    setPending('stop', false)
  }
}

async function applyConfig() {
  if (!invokeApplyConfig) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }

  const patch: Partial<Libp2pServiceConfig> = {
    enabled: enabled.value,
    transports: sanitizeTransports(transports.value),
    bootstrapPeers: bootstrapPeers.value,
    topics: topics.value,
    // Mesh sync is persisted through the same write path, so a toggle of either
    // ref is a config change main has to be told about.
    meshSyncEnabled: meshSyncEnabled.value,
    meshSyncTargets: [...meshSyncTargets.value],
  }

  // A second apply while one is in flight would double-restart the node: main
  // stops and recreates the node per call, and two racing invokes leave the
  // node running the loser's config.
  if (applyingConfig)
    return
  if (lastAppliedConfigSignature === configSignature.value)
    return

  applyingConfig = true
  setPending('applyConfig', true)
  lastError.value = null
  try {
    const newConfig = await invokeApplyConfig(patch)
    if (newConfig) {
      const nextTransports = sanitizeTransports(newConfig.transports)
      writeBackConfig({
        enabled: newConfig.enabled,
        transports: nextTransports,
        bootstrapPeers: newConfig.bootstrapPeers,
        topics: newConfig.topics,
        meshSyncEnabled: newConfig.meshSyncEnabled,
        meshSyncTargets: newConfig.meshSyncTargets,
      })
      lastRefreshedAt.value = { ...lastRefreshedAt.value, config: Date.now() }
    }
  }
  catch (err) {
    // The refs still hold the user's intent, so a later retry re-sends it rather
    // than silently leaving main on the old config. The failure is reported
    // through `lastError`/`eventLog` because every page call site is fire-and-forget
    // (a bare `applyConfig()` with no `await`/`void`).
    reportError('Failed to apply config', err)
  }
  finally {
    applyingConfig = false
    setPending('applyConfig', false)
  }
}

async function pingPeer(peerId: string) {
  if (!invokePing)
    return { latencyMs: 0, error: 'Local Mesh requires the AIRI desktop app' }
  if (pending.value.ping)
    return { latencyMs: 0, error: 'A ping is already in flight' }

  setPending('ping', true)
  try {
    return await invokePing({ peerId })
  }
  catch (err) {
    // Main can only report a failed ping by throwing, so surface it in-band
    // too rather than leaving the caller with an unhandled rejection.
    reportError(`Failed to ping ${peerId.slice(0, 12)}...`, err)
    return { latencyMs: 0, error: err instanceof Error ? err.message : String(err) }
  }
  finally {
    setPending('ping', false)
  }
}

async function publishMessage(topic: string, data: string) {
  if (!invokePublish) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }

  try {
    await invokePublish({ topic, data })
    addEventLog('info', `Published to ${topic}`)
  }
  catch (err) {
    reportError(`Failed to publish to ${topic}`, err)
  }
}

async function generateIdentity() {
  if (!invokeIdentityGenerate) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  // Minting is destructive: two racing calls would each write a keypair, and the
  // loser would overwrite the winner's identity.
  if (pending.value.generateIdentity)
    return

  setPending('generateIdentity', true)
  lastError.value = null
  try {
    const id = await invokeIdentityGenerate()
    if (id) {
      identity.value = id
      nodeName.value = id.name
    }
    addEventLog('info', 'Generated new identity')
  }
  catch (err) {
    reportError('Identity generation failed', err)
  }
  finally {
    setPending('generateIdentity', false)
  }
}

async function setNodeName(name: string) {
  if (!invokeIdentitySetName) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.setNodeName)
    return

  setPending('setNodeName', true)
  lastError.value = null
  try {
    const id = await invokeIdentitySetName({ name })
    if (id)
      identity.value = id
    nodeName.value = name
  }
  catch (err) {
    reportError('Failed to set node name', err)
  }
  finally {
    setPending('setNodeName', false)
  }
}

async function copyPeerId() {
  const peerId = identity.value?.peerId
  if (!peerId)
    throw new Error('No identity to copy')

  try {
    await navigator.clipboard.writeText(peerId)
  }
  catch (err) {
    // A clipboard rejection is a user-permission problem, not a store bug: report
    // it in-band instead of letting it become an unhandled rejection.
    reportError('Failed to copy Peer ID', err)
  }
}

async function copyNodeName() {
  const name = identity.value?.name ?? nodeName.value
  if (!name)
    throw new Error('No node name to copy')

  try {
    await navigator.clipboard.writeText(name)
  }
  catch (err) {
    reportError('Failed to copy node name', err)
  }
}

/**
 * Create a pairing invitation.
 *
 * NOTICE: `napChatGranted` is the user's nap-chat decision for the device being
 * paired with, and it is *this node's* own half of the consent — the other half
 * is the accepter's. It travels appended as an optional param so every existing
 * caller pairs exactly as before; an explicit `false` makes main refuse the
 * pairing outright, and omitting it records no grant, which the consent gate
 * reads as a refusal anyway. Main, not this store, is the process that decides
 * what the grant means, because the paired-device record is the thing the
 * consent read consults and only main writes it.
 */
async function createPairing(ttlMinutes?: number, name?: string, napChatGranted?: boolean) {
  if (!invokeCreatePairing) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.createPairing)
    return

  setPending('createPairing', true)
  lastError.value = null
  try {
    const invitation = await invokeCreatePairing({ ttlMinutes, name, napChatGranted })
    // The same in-band `error` discriminant the accept path uses: a declined
    // nap-chat grant refuses the pairing from main, and the dialog has to say so
    // rather than leaving the operator watching an invitation that will not
    // open. Main cannot reject instead, because a throw would also drop the
    // context the log line carries.
    if (invitation && typeof invitation === 'object' && 'error' in invitation && typeof invitation.error === 'string') {
      const rejected: { error: string } = { error: invitation.error }
      addEventLog('warn', `Pairing rejected: ${rejected.error}`)
      return rejected
    }

    // The invitation is what keeps the pairing dialog open; the main process
    // clears the underlying secret once the TTL elapses.
    pairing.value = invitation
    return invitation
  }
  catch (err) {
    reportError('Pairing failed', err)
  }
  finally {
    setPending('createPairing', false)
  }
}

function clearPairing() {
  pairing.value = null
}

/**
 * Accept a pairing.
 *
 * NOTICE: `napChatGranted` is this node's own nap-chat decision for the inviter,
 * chosen beside the alias in the pairing dialog. It is appended as an optional
 * param so existing callers pair exactly as before; an explicit `false` stops
 * the pairing in main before any dial or record is written, per the design's
 * "don't want it → don't pair". The store forwards it and nothing more — the
 * decision's meaning lives on the record only main writes, so a renderer that
 * interpreted it locally would be a second source of truth for a permission.
 */
async function acceptPairing(input: string, alias?: string, napChatGranted?: boolean) {
  if (!invokeAcceptPairing) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.acceptPairing)
    return { error: 'A pairing is already being accepted' }

  setPending('acceptPairing', true)
  lastError.value = null
  try {
    const result = await invokeAcceptPairing({ input, alias, napChatGranted })
    // The main process discriminates success from failure in-band via an
    // `error` discriminant, because it cannot reject a failed pairing without
    // also losing the senders' context.
    if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') {
      const rejected: { error: string } = { error: result.error }
      addEventLog('warn', `Pairing rejected: ${rejected.error}`)
      return rejected
    }

    if (!result)
      throw new Error('Pairing failed')
    await refreshPairedDevices()
    addEventLog('info', `Paired with ${result.alias}`)

    return result
  }
  catch (err) {
    reportError('Accept pairing failed', err)
  }
  finally {
    setPending('acceptPairing', false)
  }
}

async function refreshPairedDevices() {
  if (!invokeListPairedDevices)
    return

  // Two overlapping refreshes can resolve out of order, which would clobber a
  // fresh list with a stale one; a monotonic id drops the superseded response.
  const requestId = ++pairedDevicesRequestId
  try {
    const devices = await invokeListPairedDevices()
    if (requestId !== pairedDevicesRequestId)
      return
    if (devices)
      pairedDevices.value = devices
    lastRefreshedAt.value = { ...lastRefreshedAt.value, pairedDevices: Date.now() }
  }
  catch (err) {
    reportError('Failed to refresh paired devices', err)
  }
}

async function removePairedDevice(peerId: string) {
  if (!invokeRemovePairedDevice) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.removePairedDevice)
    return

  setPending('removePairedDevice', true)
  lastError.value = null
  try {
    const removed = await invokeRemovePairedDevice(peerId)
    if (!removed)
      throw new Error('Paired device not found')
    await refreshPairedDevices()
    addEventLog('info', `Removed paired device ${peerId.slice(0, 12)}...`)
  }
  catch (err) {
    reportError('Failed to remove paired device', err)
  }
  finally {
    setPending('removePairedDevice', false)
  }
}

async function updatePairedDeviceAlias(peerId: string, alias: string) {
  if (!invokeUpdatePairedDeviceAlias) {
    reportError('Local Mesh requires the AIRI desktop app', new Error('invoke unavailable outside the AIRI desktop app'))
    return
  }
  if (pending.value.updatePairedDeviceAlias)
    return

  setPending('updatePairedDeviceAlias', true)
  lastError.value = null
  try {
    const updated = await invokeUpdatePairedDeviceAlias([peerId, alias])
    if (!updated)
      throw new Error('Paired device not found')
    await refreshPairedDevices()
  }
  catch (err) {
    reportError('Failed to update paired device alias', err)
  }
  finally {
    setPending('updatePairedDeviceAlias', false)
  }
}

// Watch the config, not the four refs: the signature is compared with `Object.is`,
// so an echo from main (new array identities, equal content) does not re-fire while
// a genuine user edit still does. `deep: true` on the ref array skipped that guard.
watch(configSignature, () => {
  if (!isRunning.value)
    return
  if (configSignature.value === lastAppliedConfigSignature)
    return

  // The settings page also calls `applyConfig()` explicitly, so a user action can
  // arrive twice; the in-flight guard plus the signature check make the second
  // arrival a no-op instead of a second node restart.
  void applyConfig().catch(() => {
    // `applyConfig` already reports through `lastError`, `eventLog` and console.
  })
})

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Unlisten handles for the currently bound eventa context. */
let unbindEvents: Array<() => void> = []
/** Context the current handles belong to, so re-binding cannot double-register. */
let boundContext: unknown = null

/**
 * Subscribe the handlers to one eventa context.
 *
 * `useElectronEventaContext()` hands back a `ref` whose value is a module-level
 * memo inside `@proj-airi/electron-vueuse`, so it is stable once resolved - but it
 * starts `undefined` and the libp2p main service pushes through transient
 * per-window contexts. The subscription set is therefore identical whether the
 * context already resolved or arrives after mount, and a context already bound is
 * never bound twice.
 */
function bindEvents(ctx: typeof eventaContext.value) {
  if (!ctx || ctx === boundContext)
    return

  disposeEvents()

  // `@moeru/eventa`'s context `on()` returns the unlisten function
  // (`dist/context-CimstVCt.d.mts`: `on: (...) => () => void`; the implementation
  // returns `() => listeners.get(event.id)?.delete(handler)`), so the handles are
  // kept instead of being dropped.
  unbindEvents = [
    ctx.on(libp2pServiceStatusChanged, event => handleStatusChanged(event.body)),
    ctx.on(libp2pPeerJoined, event => handlePeerJoined(event.body)),
    ctx.on(libp2pPeerLeft, event => handlePeerLeft(event.body)),
    ctx.on(libp2pPeerDiscovered, event => handlePeerDiscovered(event.body)),
    ctx.on(libp2pMessageReceived, event => handleMessageReceived(event.body)),
    ctx.on(electronMeshIdentityChanged, event => handleIdentityChanged(event.body)),
    ctx.on(libp2pServiceEventLog, event => handleEventLogEntry(event.body)),
    ctx.on(libp2pServicePairedDevicesChanged, event => handlePairedDevicesChanged(event.body)),
  ]
  boundContext = ctx
}

/** Unsubscribe every handler bound by `bindEvents`. */
function disposeEvents() {
  const handles = unbindEvents
  unbindEvents = []
  boundContext = null
  for (const off of handles)
    off()
}

onMounted(() => {
  if (!isElectron.value)
    return

  bindEvents(eventaContext.value)

  // The store is a module-level singleton created by whichever component calls
  // `useLibp2pStore()` first, so both teardown hooks are registered: `onUnmounted`
  // covers that component unmounting, and `onScopeDispose` covers the store's own
  // effect scope. Without them every settings-page visit accumulated another set
  // of handlers all writing into the same refs.
  onUnmounted(disposeEvents)
  onScopeDispose(disposeEvents)

  // Initial load
  loadConfig()
  refreshStatus()
  refreshPeers()
  refreshIdentity()
  refreshPairedDevices()
})

export const useLibp2pStore = defineStore('libp2p', () => ({
  // State
  enabled,
  transports,
  bootstrapPeers,
  topics,
  nodeName,
  meshSyncEnabled,
  meshSyncTargets,
  serviceStatus,
  identity,
  peers,
  eventLog,
  pairedDevices,
  pairing,
  isRunning,
  isElectron,
  lastError,
  lastRefreshedAt,
  pending,

  // Actions
  startService,
  stopService,
  applyConfig,
  refreshStatus,
  refreshPeers,
  refreshIdentity,
  pingPeer,
  publishMessage,
  generateIdentity,
  setNodeName,
  copyPeerId,
  copyNodeName,
  createPairing,
  clearPairing,
  acceptPairing,
  refreshPairedDevices,
  removePairedDevice,
  updatePairedDeviceAlias,
}))
