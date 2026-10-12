import type { Libp2pPeerInfo, Libp2pServiceConfig, Libp2pServiceStatus, Libp2pTransportKind, MeshIdentityInfo, PairedDevice } from '@proj-airi/stage-shared/libp2p'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import {
  electronMeshIdentityChanged,
  electronMeshIdentityGenerate,
  electronMeshIdentityGet,
  electronMeshIdentitySetName,
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
import { computed, onMounted, ref, watch } from 'vue'

// ── Persisted Config ──────────────────────────────────────────────────────────

const enabled = useLocalStorageManualReset<boolean>('settings/libp2p/enabled', false)

// Mirrors `Libp2pTransportKind`; mDNS is not a transport. A build that persisted
// the untyped ref also persisted `'mdns'` inside this list. mDNS never enabled
// anything - the main service registers it unconditionally through
// `peerDiscovery` - while its config schema is `array(picklist([...]))`.
// Forwarding an invalid member makes `safeParse` reject the whole config file
// and auto-heal it back to defaults, discarding `enabled`, `bootstrapPeers` and
// `topics`, so stale members are dropped on read instead of being sent on.
const LIBP2P_TRANSPORT_KINDS: readonly string[] = ['tcp', 'websockets', 'webrtc', 'webtransport']

const transports = useLocalStorageManualReset<Libp2pTransportKind[]>('settings/libp2p/transports', ['tcp', 'websockets'])

const staleTransports = transports.value.filter(kind => !LIBP2P_TRANSPORT_KINDS.includes(kind))
if (staleTransports.length > 0)
  transports.value = transports.value.filter(kind => LIBP2P_TRANSPORT_KINDS.includes(kind))

const bootstrapPeers = useLocalStorageManualReset<string[]>('settings/libp2p/bootstrapPeers', [])
const topics = useLocalStorageManualReset<string[]>('settings/libp2p/topics', ['airi/presence', 'airi/memory', 'airi/vault', 'airi/companion'])
const nodeName = useLocalStorageManualReset<string>('settings/libp2p/nodeName', 'AIRI Node')
const meshSyncEnabled = useLocalStorageManualReset<boolean>('settings/libp2p/meshSyncEnabled', false)
const meshSyncTargets = useLocalStorageManualReset<string[]>('settings/libp2p/meshSyncTargets', ['memory', 'vault', 'companions'])

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

const MAX_EVENT_LOG_ENTRIES = 200

// ── Derived ──────────────────────────────────────────────────────────────────

const isElectron = typeof window !== 'undefined' && !!(window as any).electron
const isRunning = computed(() => serviceStatus.value.running)

// ── IPC Invokers ──────────────────────────────────────────────────────────────

const invokeStart = isElectron ? useElectronEventaInvoke(libp2pServiceStart) : null
const invokeStop = isElectron ? useElectronEventaInvoke(libp2pServiceStop) : null
const invokeGetStatus = isElectron ? useElectronEventaInvoke(libp2pServiceGetStatus) : null
const invokeListPeers = isElectron ? useElectronEventaInvoke(libp2pServiceListPeers) : null
const invokeGetConfig = isElectron ? useElectronEventaInvoke(libp2pServiceGetConfig) : null
const invokeApplyConfig = isElectron ? useElectronEventaInvoke(libp2pServiceApplyConfig) : null
const invokePing = isElectron ? useElectronEventaInvoke(libp2pServicePing) : null
const invokePublish = isElectron ? useElectronEventaInvoke(libp2pServicePublish) : null
const invokeIdentityGet = isElectron ? useElectronEventaInvoke(electronMeshIdentityGet) : null
const invokeIdentityGenerate = isElectron ? useElectronEventaInvoke(electronMeshIdentityGenerate) : null
const invokeIdentitySetName = isElectron ? useElectronEventaInvoke(electronMeshIdentitySetName) : null
const invokeCreatePairing = isElectron ? useElectronEventaInvoke(libp2pServiceCreatePairing) : null
const invokeAcceptPairing = isElectron ? useElectronEventaInvoke(libp2pServiceAcceptPairing) : null
const invokeListPairedDevices = isElectron ? useElectronEventaInvoke(libp2pServiceListPairedDevices) : null
const invokeRemovePairedDevice = isElectron ? useElectronEventaInvoke(libp2pServiceRemovePairedDevice) : null
const invokeUpdatePairedDeviceAlias = isElectron ? useElectronEventaInvoke(libp2pServiceUpdatePairedDeviceAlias) : null

const eventaContext = useElectronEventaContext()

// ── Event Handlers ───────────────────────────────────────────────────────────

function handleStatusChanged(status: Libp2pServiceStatus) {
  serviceStatus.value = status
}

function handlePeerJoined(peer: Libp2pPeerInfo) {
  const idx = peers.value.findIndex(p => p.id === peer.id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], ...peer, connected: true }
  }
  else {
    peers.value.push({ ...peer, connected: true })
  }
  addEventLog('info', `Peer joined: ${peer.id.slice(0, 12)}...`)
}

function handlePeerLeft(payload: { id: string }) {
  const idx = peers.value.findIndex(p => p.id === payload.id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], connected: false }
  }
  addEventLog('info', `Peer left: ${payload.id.slice(0, 12)}...`)
}

function handlePeerDiscovered(peer: Libp2pPeerInfo) {
  const idx = peers.value.findIndex(p => p.id === peer.id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], ...peer }
  }
  else {
    peers.value.push({ ...peer, connected: false })
  }
}

function handleMessageReceived(msg: { topic: string, from: string, data: string }) {
  addEventLog('debug', `Message on ${msg.topic} from ${msg.from.slice(0, 12)}...`)
}

function handleIdentityChanged(newIdentity: MeshIdentityInfo) {
  identity.value = newIdentity
}

function handlePairedDevicesChanged(devices: PairedDevice[]) {
  pairedDevices.value = devices ?? []
}

function addEventLog(level: string, message: string) {
  eventLog.value.unshift({ level, message, timestamp: Date.now() })
  if (eventLog.value.length > MAX_EVENT_LOG_ENTRIES) {
    eventLog.value = eventLog.value.slice(0, MAX_EVENT_LOG_ENTRIES)
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function refreshStatus() {
  if (!invokeGetStatus)
    return
  try {
    const status = await invokeGetStatus()
    if (status)
      serviceStatus.value = status
  }
  catch {
    // ignore
  }
}

async function refreshPeers() {
  if (!invokeListPeers)
    return
  try {
    const list = await invokeListPeers()
    if (list)
      peers.value = list
  }
  catch {
    // ignore
  }
}

async function refreshIdentity() {
  if (!invokeIdentityGet)
    return
  try {
    const id = await invokeIdentityGet()
    if (id)
      identity.value = id
  }
  catch {
    // ignore
  }
}

async function loadConfig() {
  if (!invokeGetConfig)
    return
  try {
    const cfg = await invokeGetConfig()
    if (cfg) {
      enabled.value = cfg.enabled
      transports.value = cfg.transports
      bootstrapPeers.value = cfg.bootstrapPeers
      topics.value = cfg.topics
    }
  }
  catch {
    // ignore
  }
}

async function startService() {
  if (!invokeStart)
    return

  const cfg: Libp2pServiceConfig = {
    enabled: true,
    transports: transports.value,
    bootstrapPeers: bootstrapPeers.value,
    topics: topics.value,
  }

  enabled.value = true
  try {
    const status = await invokeStart(cfg)
    if (status)
      serviceStatus.value = status
  }
  catch (err) {
    console.error('[Libp2pStore] Failed to start service:', err)
    addEventLog('error', `Failed to start: ${err}`)
  }
}

async function stopService() {
  if (!invokeStop)
    return

  enabled.value = false
  try {
    const status = await invokeStop()
    if (status)
      serviceStatus.value = status
  }
  catch (err) {
    console.error('[Libp2pStore] Failed to stop service:', err)
    addEventLog('error', `Failed to stop: ${err}`)
  }
}

async function applyConfig() {
  if (!invokeApplyConfig)
    return

  const patch: Partial<Libp2pServiceConfig> = {
    enabled: enabled.value,
    transports: transports.value,
    bootstrapPeers: bootstrapPeers.value,
    topics: topics.value,
  }

  try {
    const newConfig = await invokeApplyConfig(patch)
    if (newConfig) {
      transports.value = newConfig.transports
      bootstrapPeers.value = newConfig.bootstrapPeers
      topics.value = newConfig.topics
      enabled.value = newConfig.enabled
    }
  }
  catch (err) {
    console.error('[Libp2pStore] Failed to apply config:', err)
    addEventLog('error', `Failed to apply config: ${err}`)
  }
}

async function pingPeer(peerId: string) {
  if (!invokePing)
    return { latencyMs: 0, error: 'Not available' }
  return invokePing({ peerId })
}

async function publishMessage(topic: string, data: string) {
  if (!invokePublish)
    return
  try {
    await invokePublish({ topic, data })
    addEventLog('info', `Published to ${topic}`)
  }
  catch (err) {
    addEventLog('error', `Publish failed: ${err}`)
  }
}

async function generateIdentity() {
  if (!invokeIdentityGenerate)
    return
  try {
    const id = await invokeIdentityGenerate()
    if (id)
      identity.value = id
    addEventLog('info', 'Generated new identity')
  }
  catch (err) {
    addEventLog('error', `Identity generation failed: ${err}`)
  }
}

async function setNodeName(name: string) {
  if (!invokeIdentitySetName)
    return
  try {
    const id = await invokeIdentitySetName({ name })
    if (id)
      identity.value = id
  }
  catch (err) {
    addEventLog('error', `Set name failed: ${err}`)
  }
}

async function copyPeerId() {
  if (!identity.value)
    return
  await navigator.clipboard.writeText(identity.value.peerId)
}

async function copyNodeName() {
  if (!identity.value)
    return
  await navigator.clipboard.writeText(identity.value.name)
}

async function createPairing(ttlMinutes?: number, name?: string) {
  if (!invokeCreatePairing)
    throw new Error('Local Mesh requires the AIRI desktop app')
  try {
    const invitation = await invokeCreatePairing({ ttlMinutes, name })
    // The invitation is what keeps the pairing dialog open; the main process
    // clears the underlying secret once the TTL elapses.
    pairing.value = invitation
    return invitation
  }
  catch (err) {
    console.error('[Libp2pStore] Failed to create pairing:', err)
    addEventLog('error', `Pairing failed: ${err}`)
    throw err
  }
}

function clearPairing() {
  pairing.value = null
}

async function acceptPairing(input: string, alias?: string) {
  if (!invokeAcceptPairing)
    throw new Error('Local Mesh requires the AIRI desktop app')
  try {
    const result = await invokeAcceptPairing({ input, alias })
    // The main process discriminates success from failure in-band via an
    // `error` discriminant, because it cannot reject a failed pairing without
    // also losing the senders' context.
    if (result && 'error' in result) {
      addEventLog('warn', `Pairing rejected: ${result.error}`)
      return { error: result.error } as { error: string }
    }

    if (!result)
      throw new Error('Pairing failed')
    await refreshPairedDevices()
    addEventLog('info', `Paired with ${result.alias}`)

    return result
  }
  catch (err) {
    console.error('[Libp2pStore] Failed to accept pairing:', err)
    addEventLog('error', `Accept pairing failed: ${err}`)
    throw err
  }
}

async function refreshPairedDevices() {
  if (!invokeListPairedDevices)
    return
  try {
    const devices = await invokeListPairedDevices()
    if (devices)
      pairedDevices.value = devices
  }
  catch {
    // ignore
  }
}

async function removePairedDevice(peerId: string) {
  if (!invokeRemovePairedDevice)
    throw new Error('Local Mesh requires the AIRI desktop app')
  const removed = await invokeRemovePairedDevice(peerId)
  if (!removed)
    throw new Error('Paired device not found')
  await refreshPairedDevices()
  addEventLog('info', `Removed paired device ${peerId.slice(0, 12)}...`)
}

async function updatePairedDeviceAlias(peerId: string, alias: string) {
  if (!invokeUpdatePairedDeviceAlias)
    throw new Error('Local Mesh requires the AIRI desktop app')
  const updated = await invokeUpdatePairedDeviceAlias([peerId, alias])
  if (!updated)
    throw new Error('Paired device not found')
  await refreshPairedDevices()
}

// Watch localStorage changes and apply config
watch([enabled, transports, bootstrapPeers, topics], () => {
  if (isRunning.value) {
    applyConfig()
  }
}, { deep: true })

// ── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  if (!isElectron)
    return

  // The libp2p main service pushes events through transient per-window eventa
  // contexts, so the subscription set is identical whether the context already
  // resolved or arrives after mount.
  const bindEvents = (ctx: typeof eventaContext.value) => {
    if (!ctx)
      return
    ctx.on(libp2pServiceStatusChanged, event => handleStatusChanged(event.body!))
    ctx.on(libp2pPeerJoined, event => handlePeerJoined(event.body!))
    ctx.on(libp2pPeerLeft, event => handlePeerLeft(event.body!))
    ctx.on(libp2pPeerDiscovered, event => handlePeerDiscovered(event.body!))
    ctx.on(libp2pMessageReceived, event => handleMessageReceived(event.body!))
    ctx.on(electronMeshIdentityChanged, event => handleIdentityChanged(event.body!))
    ctx.on(libp2pServiceEventLog, event => addEventLog(event.body!.level, event.body!.message))
    ctx.on(libp2pServicePairedDevicesChanged, event => handlePairedDevicesChanged(event.body ?? []))
  }

  bindEvents(eventaContext.value)
  watch(eventaContext, bindEvents)

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
