import type { Libp2pPeerInfo, Libp2pServiceConfig, Libp2pServiceStatus, MeshIdentityInfo } from '@proj-airi/stage-shared/libp2p'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import {
  electronMeshIdentityChanged,
  electronMeshIdentityGenerate,
  electronMeshIdentityGet,
  electronMeshIdentitySetName,
  libp2pMessageReceived,
  libp2pPeerDiscovered,
  libp2pPeerJoined,
  libp2pPeerLeft,
  libp2pServiceApplyConfig,
  libp2pServiceGetConfig,
  libp2pServiceGetStatus,
  libp2pServiceListPeers,
  libp2pServicePublish,
  libp2pServiceStart,
  libp2pServiceStatusChanged,
  libp2pServiceStop,
} from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

// ── BroadcastChannel for cross-window sync ────────────────────────────────────

const { post: postLibp2pEvent } = useBroadcastChannel<{ type: string, payload: any }, { type: string, payload: any }>({
  name: 'airi:libp2p:events',
})

// ── Persisted Config ──────────────────────────────────────────────────────────

const enabled = useLocalStorageManualReset<boolean>('settings/libp2p/enabled', false)
const transports = useLocalStorageManualReset<string[]>('settings/libp2p/transports', ['tcp', 'websockets', 'mdns'])
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

// ── Event Handlers ───────────────────────────────────────────────────────────

function handleStatusChanged(status: Libp2pServiceStatus) {
  serviceStatus.value = status
}

function handlePeerJoined(peer: Libp2pPeerInfo) {
  const idx = peers.value.findIndex(p => p.id === peer.id)
  if (idx >= 0) {
    peers.value[idx] = { ...peers.value[idx], ...peer, connected: true }
  } else {
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
  } else {
    peers.value.push({ ...peer, connected: false })
  }
}

function handleMessageReceived(msg: { topic: string, from: string, data: string }) {
  addEventLog('debug', `Message on ${msg.topic} from ${msg.from.slice(0, 12)}...`)
}

function handleIdentityChanged(newIdentity: MeshIdentityInfo) {
  identity.value = newIdentity
}

function addEventLog(level: string, message: string) {
  eventLog.value.unshift({ level, message, timestamp: Date.now() })
  if (eventLog.value.length > MAX_EVENT_LOG_ENTRIES) {
    eventLog.value = eventLog.value.slice(0, MAX_EVENT_LOG_ENTRIES)
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function refreshStatus() {
  if (!invokeGetStatus) return
  try {
    const status = await invokeGetStatus()
    if (status) serviceStatus.value = status
  } catch {
    // ignore
  }
}

async function refreshPeers() {
  if (!invokeListPeers) return
  try {
    const list = await invokeListPeers()
    if (list) peers.value = list
  } catch {
    // ignore
  }
}

async function refreshIdentity() {
  if (!invokeIdentityGet) return
  try {
    const id = await invokeIdentityGet()
    if (id) identity.value = id
  } catch {
    // ignore
  }
}

async function loadConfig() {
  if (!invokeGetConfig) return
  try {
    const cfg = await invokeGetConfig()
    if (cfg) {
      enabled.value = cfg.enabled
      transports.value = cfg.transports
      bootstrapPeers.value = cfg.bootstrapPeers
      topics.value = cfg.topics
    }
  } catch {
    // ignore
  }
}

async function startService() {
  if (!invokeStart) return

  const cfg: Libp2pServiceConfig = {
    enabled: true,
    transports: transports.value,
    bootstrapPeers: bootstrapPeers.value,
    topics: topics.value,
  }

  enabled.value = true
  try {
    const status = await invokeStart(cfg)
    if (status) serviceStatus.value = status
  } catch (err) {
    console.error('[Libp2pStore] Failed to start service:', err)
    addEventLog('error', `Failed to start: ${err}`)
  }
}

async function stopService() {
  if (!invokeStop) return

  enabled.value = false
  try {
    const status = await invokeStop()
    if (status) serviceStatus.value = status
  } catch (err) {
    console.error('[Libp2pStore] Failed to stop service:', err)
    addEventLog('error', `Failed to stop: ${err}`)
  }
}

async function applyConfig() {
  if (!invokeApplyConfig) return

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
  } catch (err) {
    console.error('[Libp2pStore] Failed to apply config:', err)
    addEventLog('error', `Failed to apply config: ${err}`)
  }
}

async function pingPeer(peerId: string) {
  if (!invokePing) return { latencyMs: 0, error: 'Not available' }
  return invokePing({ peerId })
}

async function publishMessage(topic: string, data: string) {
  if (!invokePublish) return
  try {
    await invokePublish({ topic, data })
    addEventLog('info', `Published to ${topic}`)
  } catch (err) {
    addEventLog('error', `Publish failed: ${err}`)
  }
}

async function generateIdentity() {
  if (!invokeIdentityGenerate) return
  try {
    const id = await invokeIdentityGenerate()
    if (id) identity.value = id
    addEventLog('info', 'Generated new identity')
  } catch (err) {
    addEventLog('error', `Identity generation failed: ${err}`)
  }
}

async function setNodeName(name: string) {
  if (!invokeIdentitySetName) return
  try {
    const id = await invokeIdentitySetName({ name })
    if (id) identity.value = id
  } catch (err) {
    addEventLog('error', `Set name failed: ${err}`)
  }
}

async function copyPeerId() {
  if (!identity.value) return
  await navigator.clipboard.writeText(identity.value.peerId)
}

async function copyNodeName() {
  if (!identity.value) return
  await navigator.clipboard.writeText(identity.value.name)
}

// Watch localStorage changes and apply config
watch([enabled, transports, bootstrapPeers, topics], () => {
  if (isRunning.value) {
    applyConfig()
  }
}, { deep: true })

// ── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  if (!isElectron) return

  // Set up broadcast channel listeners
  const unsubStatus = useBroadcastChannel<Libp2pServiceStatus>({ name: 'airi:libp2p:status-changed' })
  unsubStatus.onmessage = e => handleStatusChanged(e.data)

  const unsubPeerJoined = useBroadcastChannel<Libp2pPeerInfo>({ name: 'airi:libp2p:peer-joined' })
  unsubPeerJoined.onmessage = e => handlePeerJoined(e.data)

  const unsubPeerLeft = useBroadcastChannel<{ id: string }>({ name: 'airi:libp2p:peer-left' })
  unsubPeerLeft.onmessage = e => handlePeerLeft(e.data)

  const unsubPeerDiscovered = useBroadcastChannel<Libp2pPeerInfo>({ name: 'airi:libp2p:peer-discovered' })
  unsubPeerDiscovered.onmessage = e => handlePeerDiscovered(e.data)

  const unsubMessage = useBroadcastChannel<{ topic: string, from: string, data: string }>({ name: 'airi:libp2p:message-received' })
  unsubMessage.onmessage = e => handleMessageReceived(e.data)

  const unsubIdentity = useBroadcastChannel<MeshIdentityInfo>({ name: 'airi:libp2p:identity:changed' })
  unsubIdentity.onmessage = e => handleIdentityChanged(e.data)

  // Initial load
  loadConfig()
  refreshStatus()
  refreshPeers()
  refreshIdentity()
})

onUnmounted(() => {
  // BroadcastChannel cleanup is automatic
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
}))