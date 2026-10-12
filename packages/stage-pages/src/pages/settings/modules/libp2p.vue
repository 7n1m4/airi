<script setup lang="ts">
import { useLibp2pStore } from '@proj-airi/stage-ui/stores/modules/libp2p'
import { Button, DoubleCheckButton, FieldCheckbox, FieldInput, FieldSelect, FieldTextArea, QRCode } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from 'reka-ui'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const libp2pStore = useLibp2pStore()

const {
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
} = storeToRefs(libp2pStore)

const activeTab = ref<'node' | 'peers' | 'sync' | 'dev'>('node')
const isPairingDialogOpen = ref(false)
const newBootstrapPeer = ref('')
const newTopic = ref('')

// ── Pairing dialog state ──────────────────────────────────────────────────────

/** Raw user input: a scanned/pasted `airi-pair://` payload, or a magic code. */
const pairingInput = ref('')
const pairingAlias = ref('')
const isAcceptingPairing = ref(false)
const isCreatingPairing = ref(false)

/** In-progress alias edits, keyed by peerId; absent key means "unchanged". */
const aliasDrafts = reactive<Record<string, string>>({})

const connectedPeers = computed(() => peers.value.filter(p => p.connected))
const discoveredPeers = computed(() => peers.value.filter(p => !p.connected))

function handleStartStop() {
  if (isRunning.value) {
    libp2pStore.stopService()
  }
  else {
    libp2pStore.startService()
  }
}

async function handleGenerateIdentity() {
  await libp2pStore.generateIdentity()
  toast.success(t('settings.modules.libp2p.identityGenerated'))
}

async function handleSetNodeName() {
  await libp2pStore.setNodeName(nodeName.value)
  toast.success(t('settings.modules.libp2p.nameUpdated'))
}

async function handleCopyPeerId() {
  await libp2pStore.copyPeerId()
  toast.success(t('settings.modules.libp2p.copiedPeerId'))
}

async function handleCopyNodeName() {
  await libp2pStore.copyNodeName()
  toast.success(t('settings.modules.libp2p.copiedName'))
}

async function handleCreatePairing() {
  if (!identity.value || !serviceStatus.value.listenAddresses.length) {
    toast.error(t('settings.modules.libp2p.noIdentityOrAddresses'))
    return
  }

  isCreatingPairing.value = true
  try {
    await libp2pStore.createPairing(30, identity.value.name)
    isPairingDialogOpen.value = true
  }
  catch (err) {
    console.error('[Libp2pPage] Failed to create pairing:', err)
    toast.error(`${t('settings.modules.libp2p.pairingFailed')}: ${err}`)
  }
  finally {
    isCreatingPairing.value = false
  }
}

async function handleAcceptPairing() {
  const input = pairingInput.value.trim()
  if (!input) {
    toast.error(t('settings.modules.libp2p.pairingInputRequired'))
    return
  }

  isAcceptingPairing.value = true
  try {
    const result = await libp2pStore.acceptPairing(input, pairingAlias.value.trim() || undefined)
    if ('error' in result) {
      toast.error(`${t('settings.modules.libp2p.pairingFailed')}: ${result.error}`)
      return
    }

    toast.success(t('settings.modules.libp2p.pairingAccepted'))
    pairingInput.value = ''
    pairingAlias.value = ''
  }
  catch (err) {
    console.error('[Libp2pPage] Failed to accept pairing:', err)
    toast.error(`${t('settings.modules.libp2p.pairingFailed')}: ${err}`)
  }
  finally {
    isAcceptingPairing.value = false
  }
}

/** Dismiss the invitation, invalidating it for the dialog's purposes. */
function handleClosePairing() {
  libp2pStore.clearPairing()
  isPairingDialogOpen.value = false
}

/** Discard the expired/used invitation and mint a fresh one. */
async function handleRegeneratePairing() {
  libp2pStore.clearPairing()
  await handleCreatePairing()
}

async function handleCopyPairingCode() {
  if (!pairing.value?.magicCode)
    return
  await navigator.clipboard.writeText(pairing.value.magicCode)
  toast.success(t('settings.modules.libp2p.pairingCodeCopied'))
}

// ── Paired devices ────────────────────────────────────────────────────────────

async function handleSaveAlias(device: { peerId: string, alias: string }) {
  const next = (aliasDrafts[device.peerId] ?? device.alias).trim()
  if (!next || next === device.alias)
    return
  await libp2pStore.updatePairedDeviceAlias(device.peerId, next)
  delete aliasDrafts[device.peerId]
  toast.success(t('settings.modules.libp2p.pairingAliasUpdated'))
}

async function handleRemovePairedDevice(peerId: string) {
  try {
    await libp2pStore.removePairedDevice(peerId)
    toast.success(t('settings.modules.libp2p.pairingDeviceRemoved'))
  }
  catch (err) {
    console.error('[Libp2pPage] Failed to remove paired device:', err)
    toast.error(`${t('settings.modules.libp2p.pairingFailed')}: ${err}`)
  }
}

function handleAddBootstrapPeer() {
  if (!newBootstrapPeer.value.trim())
    return
  const peers = [...bootstrapPeers.value, newBootstrapPeer.value.trim()]
  bootstrapPeers.value = peers
  newBootstrapPeer.value = ''
  libp2pStore.applyConfig()
}

function handleRemoveBootstrapPeer(index: number) {
  const peers = [...bootstrapPeers.value]
  peers.splice(index, 1)
  bootstrapPeers.value = peers
  libp2pStore.applyConfig()
}

function handleAddTopic() {
  if (!newTopic.value.trim())
    return
  const topicsList = [...topics.value, newTopic.value.trim()]
  topics.value = topicsList
  newTopic.value = ''
  libp2pStore.applyConfig()
}

function handleRemoveTopic(index: number) {
  const topicsList = [...topics.value]
  topicsList.splice(index, 1)
  topics.value = topicsList
  libp2pStore.applyConfig()
}

function handleRefresh() {
  libp2pStore.refreshStatus()
  libp2pStore.refreshPeers()
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function getStatusColor(state: boolean): string {
  return state ? '#22c55e' : '#6b7280'
}

function formatPairedAt(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getLogColor(level: string): string {
  switch (level) {
    case 'error': return '#ef4444'
    case 'warn': return '#f59e0b'
    case 'debug': return '#3b82f6'
    default: return '#22c55e'
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Node Status Card -->
    <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">
          {{ t('settings.modules.libp2p.nodeStatus') }}
        </h3>
        <div class="flex items-center gap-2">
          <span
            class="h-2.5 w-2.5 rounded-full"
            :style="{ backgroundColor: getStatusColor(isRunning) }"
          />
          <span class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ isRunning ? t('settings.modules.libp2p.running') : t('settings.modules.libp2p.stopped') }}
          </span>
        </div>
      </div>

      <div class="flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <!-- Enable Toggle -->
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">
              {{ t('settings.modules.libp2p.enableMesh') }}
            </p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.modules.libp2p.enableMeshDesc') }}
            </p>
          </div>
          <FieldCheckbox v-model="enabled" @update:model-value="handleStartStop" />
        </div>

        <div v-if="isRunning" class="flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <!-- Peer ID -->
          <div v-if="identity" class="flex flex-col gap-2">
            <p class="font-medium">
              {{ t('settings.modules.libp2p.peerId') }}
            </p>
            <div class="flex items-center gap-2">
              <code class="flex-1 break-all rounded bg-neutral-200 px-3 py-2 text-sm dark:bg-neutral-800">
                {{ identity.peerId }}
              </code>
              <Button variant="ghost" size="sm" @click="handleCopyPeerId">
                {{ t('settings.modules.libp2p.copy') }}
              </Button>
            </div>
          </div>

          <!-- Node Name -->
          <div class="flex flex-col gap-2">
            <p class="font-medium">
              {{ t('settings.modules.libp2p.nodeName') }}
            </p>
            <div class="flex items-center gap-2">
              <FieldInput v-model="nodeName" :placeholder="t('settings.modules.libp2p.nodeNamePlaceholder')" class="flex-1" />
              <Button variant="secondary" size="sm" @click="handleSetNodeName">
                {{ t('settings.modules.libp2p.save') }}
              </Button>
              <Button variant="ghost" size="sm" @click="handleCopyNodeName">
                {{ t('settings.modules.libp2p.copy') }}
              </Button>
            </div>
          </div>

          <!-- Listen Addresses -->
          <div v-if="serviceStatus.listenAddresses.length" class="flex flex-col gap-2">
            <p class="font-medium">
              {{ t('settings.modules.libp2p.listenAddresses') }}
            </p>
            <div class="max-h-40 flex flex-col gap-1 overflow-auto">
              <code
                v-for="addr in serviceStatus.listenAddresses"
                :key="addr"
                class="break-all rounded bg-neutral-200 px-2 py-1 text-xs dark:bg-neutral-800"
              >
                {{ addr }}
              </code>
            </div>
          </div>

          <!-- Connections -->
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium">
                {{ t('settings.modules.libp2p.connections') }}
              </p>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ serviceStatus.connections }} {{ t('settings.modules.libp2p.activeConnections') }}
              </p>
            </div>
            <Button variant="secondary" size="sm" @click="handleRefresh">
              {{ t('settings.modules.libp2p.refresh') }}
            </Button>
          </div>

          <!-- Generate Identity Button -->
          <div v-if="!identity" class="flex items-center gap-2">
            <p class="flex-1 text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.modules.libp2p.noIdentity') }}
            </p>
            <Button variant="primary" @click="handleGenerateIdentity">
              {{ t('settings.modules.libp2p.generateIdentity') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Configuration Tabs -->
    <TabsRoot v-model="activeTab" class="w-full">
      <TabsList class="mb-4">
        <TabsTrigger value="node">
          {{ t('settings.modules.libp2p.tabNode') }}
        </TabsTrigger>
        <TabsTrigger value="peers">
          {{ t('settings.modules.libp2p.tabPeers') }}
        </TabsTrigger>
        <TabsTrigger value="sync">
          {{ t('settings.modules.libp2p.tabSync') }}
        </TabsTrigger>
        <TabsTrigger value="dev">
          {{ t('settings.modules.libp2p.tabDev') }}
        </TabsTrigger>
      </TabsList>

      <!-- Node Config Tab -->
      <TabsContent value="node">
        <div class="flex flex-col gap-6">
          <!-- Transports -->
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <p class="font-medium">
              {{ t('settings.modules.libp2p.transports') }}
            </p>
            <div class="flex flex-wrap gap-2">
              <FieldCheckbox
                v-for="t in ['tcp', 'websockets', 'webrtc', 'webtransport', 'mdns']"
                :id="`transport-${t}`"
                :key="t"
                :model-value="transports.includes(t)"
                @update:model-value="(val) => {
                  const arr = [...transports.value]
                  if (val) arr.push(t)
                  else arr.splice(arr.indexOf(t), 1)
                  transports.value = arr
                  libp2pStore.applyConfig()
                }"
              >
                <template #label>
                  {{ t.toUpperCase() }}
                </template>
              </FieldCheckbox>
            </div>
          </div>

          <!-- Bootstrap Peers -->
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <div class="flex items-center justify-between">
              <p class="font-medium">
                {{ t('settings.modules.libp2p.bootstrapPeers') }}
              </p>
              <div class="flex items-center gap-2">
                <FieldInput
                  v-model="newBootstrapPeer"
                  :placeholder="t('settings.modules.libp2p.bootstrapPeerPlaceholder')"
                  class="w-64"
                />
                <Button size="sm" @click="handleAddBootstrapPeer">
                  {{ t('settings.modules.libp2p.add') }}
                </Button>
              </div>
            </div>
            <div v-if="bootstrapPeers.length" class="flex flex-col gap-2">
              <div
                v-for="(peer, idx) in bootstrapPeers"
                :key="peer"
                class="flex items-center justify-between rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
              >
                <code class="flex-1 break-all text-sm">{{ peer }}</code>
                <Button variant="ghost" size="sm" icon="i-solar:trash-bin-minimalistic-bold" @click="handleRemoveBootstrapPeer(idx)" />
              </div>
            </div>
            <p v-else class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.modules.libp2p.noBootstrapPeers') }}
            </p>
          </div>

          <!-- Topics -->
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <div class="flex items-center justify-between">
              <p class="font-medium">
                {{ t('settings.modules.libp2p.topics') }}
              </p>
              <div class="flex items-center gap-2">
                <FieldInput
                  v-model="newTopic"
                  :placeholder="t('settings.modules.libp2p.topicPlaceholder')"
                  class="w-64"
                />
                <Button size="sm" @click="handleAddTopic">
                  {{ t('settings.modules.libp2p.add') }}
                </Button>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <div
                v-for="(topic, idx) in topics"
                :key="topic"
                class="flex items-center justify-between rounded bg-neutral-200 px-3 py-2 dark:bg-neutral-800"
              >
                <code class="text-sm">{{ topic }}</code>
                <Button variant="ghost" size="sm" icon="i-solar:trash-bin-minimalistic-bold" @click="handleRemoveTopic(idx)" />
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Peers Tab -->
      <TabsContent value="peers">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <div class="flex items-center justify-between">
              <p class="font-medium">
                {{ t('settings.modules.libp2p.connectedPeers') }} ({{ connectedPeers.length }})
              </p>
              <Button variant="primary" :disabled="!isRunning || !identity" @click="handleCreatePairing">
                {{ t('settings.modules.libp2p.pairNewDevice') }}
              </Button>
            </div>

            <div v-if="connectedPeers.length" class="flex flex-col gap-2">
              <div
                v-for="peer in connectedPeers"
                :key="peer.id"
                class="flex items-center justify-between rounded-lg bg-neutral-200 p-3 dark:bg-neutral-800"
              >
                <div class="flex items-center gap-3">
                  <span class="h-2.5 w-2.5 rounded-full bg-green-500" />
                  <div>
                    <code class="text-sm font-mono">{{ peer.id.slice(0, 20) }}...</code>
                    <p v-if="peer.name" class="text-xs text-neutral-600 dark:text-neutral-400">
                      {{ peer.name }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <Button variant="ghost" size="sm" @click="() => libp2pStore.pingPeer(peer.id)">
                    {{ t('settings.modules.libp2p.ping') }}
                  </Button>
                </div>
              </div>
            </div>

            <p v-else class="py-4 text-center text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.modules.libp2p.noConnectedPeers') }}
            </p>
          </div>

          <div v-if="discoveredPeers.length" class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <p class="font-medium">
              {{ t('settings.modules.libp2p.discoveredPeers') }} ({{ discoveredPeers.length }})
            </p>
            <div class="flex flex-col gap-2">
              <div
                v-for="peer in discoveredPeers"
                :key="peer.id"
                class="flex items-center justify-between rounded-lg bg-neutral-200 p-3 dark:bg-neutral-800"
              >
                <div class="flex items-center gap-3">
                  <span class="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                  <div>
                    <code class="text-sm font-mono">{{ peer.id.slice(0, 20) }}...</code>
                    <p v-if="peer.name" class="text-xs text-neutral-600 dark:text-neutral-400">
                      {{ peer.name }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Paired Devices -->
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <div class="flex items-center justify-between">
              <p class="font-medium">
                {{ t('settings.modules.libp2p.pairedDevices') }} ({{ pairedDevices.length }})
              </p>
              <Button variant="secondary" size="sm" :loading="isCreatingPairing" :disabled="!isRunning || !identity" @click="handleCreatePairing">
                {{ t('settings.modules.libp2p.pairNewDevice') }}
              </Button>
            </div>

            <div v-if="pairedDevices.length" class="flex flex-col gap-2">
              <div
                v-for="device in pairedDevices"
                :key="device.peerId"
                class="flex flex-col gap-3 rounded-lg bg-neutral-200 p-3 dark:bg-neutral-800"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <code class="block break-all text-sm font-mono">{{ device.peerId }}</code>
                    <p class="text-xs text-neutral-600 dark:text-neutral-400">
                      {{ t('settings.modules.libp2p.pairedAt') }}: {{ formatPairedAt(device.pairedAt) }}
                    </p>
                  </div>
                  <div class="shrink-0">
                    <DoubleCheckButton
                      variant="danger"
                      size="sm"
                      @confirm="handleRemovePairedDevice(device.peerId)"
                    >
                      <span class="i-solar:trash-bin-minimalistic-bold h-4 w-4" />
                      <template #confirm>
                        {{ t('settings.modules.libp2p.confirmRemove') }}
                      </template>
                      <template #cancel>
                        {{ t('settings.modules.libp2p.cancel') }}
                      </template>
                    </DoubleCheckButton>
                  </div>
                </div>

                <!-- Inline alias editing -->
                <div class="flex items-center gap-2">
                  <FieldInput
                    v-model="aliasDrafts[device.peerId]"
                    :placeholder="device.alias || t('settings.modules.libp2p.aliasPlaceholder')"
                    class="flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    :disabled="!((aliasDrafts[device.peerId] ?? '').trim()) || (aliasDrafts[device.peerId] ?? '').trim() === device.alias"
                    @click="handleSaveAlias(device)"
                  >
                    {{ t('settings.modules.libp2p.save') }}
                  </Button>
                </div>
              </div>
            </div>

            <div v-else class="py-4 text-center text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.modules.libp2p.noPairedDevices') }}
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Sync Tab -->
      <TabsContent value="sync">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">
                  {{ t('settings.modules.libp2p.meshSync') }}
                </p>
                <p class="text-sm text-neutral-600 dark:text-neutral-400">
                  {{ t('settings.modules.libp2p.meshSyncDesc') }}
                </p>
              </div>
              <FieldCheckbox v-model="meshSyncEnabled" />
            </div>

            <div v-if="meshSyncEnabled" class="flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <div class="flex flex-col gap-2">
                <p class="font-medium">
                  {{ t('settings.modules.libp2p.syncTargets') }}
                </p>
                <div class="flex flex-wrap gap-2">
                  <FieldCheckbox
                    v-for="target in ['memory', 'vault', 'companions']"
                    :id="`sync-target-${target}`"
                    :key="target"
                    :model-value="meshSyncTargets.includes(target)"
                    @update:model-value="(val) => {
                      const arr = [...meshSyncTargets.value]
                      if (val) arr.push(target)
                      else arr.splice(arr.indexOf(target), 1)
                      meshSyncTargets.value = arr
                    }"
                  >
                    <template #label>
                      {{ target }}
                    </template>
                  </FieldCheckbox>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <Button variant="secondary" :disabled="!isRunning" @click="() => libp2pStore.publishMessage('airi/memory', 'sync-request')">
                  {{ t('settings.modules.libp2p.triggerMemorySync') }}
                </Button>
                <Button variant="secondary" :disabled="!isRunning" @click="() => libp2pStore.publishMessage('airi/vault', 'sync-request')">
                  {{ t('settings.modules.libp2p.triggerVaultSync') }}
                </Button>
                <Button variant="secondary" :disabled="!isRunning" @click="() => libp2pStore.publishMessage('airi/companion', 'sync-request')">
                  {{ t('settings.modules.libp2p.triggerCompanionSync') }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Dev Console Tab -->
      <TabsContent value="dev">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <div class="flex items-center justify-between">
              <p class="font-medium">
                {{ t('settings.modules.libp2p.eventLog') }}
              </p>
              <Button variant="ghost" size="sm" @click="() => eventLog.value = []">
                {{ t('settings.modules.libp2p.clear') }}
              </Button>
            </div>

            <div class="max-h-96 overflow-auto rounded bg-neutral-900 p-3 text-xs font-mono dark:bg-neutral-950">
              <div
                v-for="(entry, idx) in eventLog"
                :key="idx"
                class="flex gap-2 border-b border-neutral-800 py-1 last:border-0"
                :style="{ color: getLogColor(entry.level) }"
              >
                <span class="text-neutral-500">{{ formatTimestamp(entry.timestamp) }}</span>
                <span class="text-neutral-400">[{{ entry.level.toUpperCase() }}]</span>
                <span>{{ entry.message }}</span>
              </div>
              <p v-if="!eventLog.length" class="py-8 text-center text-neutral-500">
                {{ t('settings.modules.libp2p.noEvents') }}
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
            <p class="font-medium">
              {{ t('settings.modules.libp2p.testPublish') }}
            </p>
            <div class="flex flex-col gap-2">
              <FieldSelect v-model="testPublishTopic" :options="topics" :placeholder="t('settings.modules.libp2p.selectTopic')" />
              <FieldTextArea v-model="testPublishData" :placeholder="t('settings.modules.libp2p.messageData')" rows="3" />
              <Button variant="primary" :disabled="!isRunning || !testPublishTopic" @click="() => libp2pStore.publishMessage(testPublishTopic, btoa(testPublishData))">
                {{ t('settings.modules.libp2p.publish') }}
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
    </TabsRoot>

    <!-- Pairing Dialog -->
    <Teleport to="body">
      <DialogRoot :open="isPairingDialogOpen" @update:open="isPairingDialogOpen = $event">
        <DialogPortal>
          <DialogOverlay class="fixed inset-0 z-50 bg-black/50" />
          <DialogContent class="fixed left-1/2 top-1/2 z-50 max-h-[90vh] max-w-md w-[90%] overflow-auto rounded-xl bg-white p-6 shadow-xl -translate-x-1/2 -translate-y-1/2 dark:bg-neutral-900">
            <DialogTitle class="mb-4 text-lg font-semibold">
              {{ t('settings.modules.libp2p.pairingInvitation') }}
            </DialogTitle>
            <DialogDescription class="mb-4">
              {{ t('settings.modules.libp2p.pairingDesc') }}
            </DialogDescription>

            <div class="flex flex-col items-center gap-4">
              <div v-if="pairing" class="flex flex-col items-center gap-4">
                <div class="rounded bg-white p-4 dark:bg-neutral-800">
                  <QRCode :value="pairing.qrCode" :size="200" />
                </div>

                <div class="text-center">
                  <p class="mb-2 font-medium">
                    {{ t('settings.modules.libp2p.magicCode') }}
                  </p>
                  <div class="flex items-center justify-center gap-2">
                    <code class="rounded bg-neutral-100 px-4 py-2 text-2xl tracking-widest font-mono dark:bg-neutral-800">
                      {{ pairing.magicCode }}
                    </code>
                    <Button variant="ghost" size="sm" @click="handleCopyPairingCode">
                      {{ t('settings.modules.libp2p.copy') }}
                    </Button>
                  </div>
                  <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.modules.libp2p.magicCodeDesc') }}
                  </p>
                  <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.modules.libp2p.expiresAt') }}: {{ formatPairedAt(new Date(pairing.expiresAt).getTime()) }}
                  </p>
                </div>
              </div>

              <!-- Accept a pairing initiated by another device -->
              <div class="w-full flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <p class="font-medium">
                  {{ t('settings.modules.libp2p.acceptPairing') }}
                </p>
                <FieldInput
                  v-model="pairingInput"
                  :placeholder="t('settings.modules.libp2p.pairingInputPlaceholder')"
                />
                <FieldInput
                  v-model="pairingAlias"
                  :placeholder="t('settings.modules.libp2p.pairingAliasPlaceholder')"
                />
                <Button
                  variant="primary"
                  :disabled="isAcceptingPairing || !pairingInput.trim()"
                  @click="handleAcceptPairing"
                >
                  {{ isAcceptingPairing ? t('settings.modules.libp2p.accepting') : t('settings.modules.libp2p.acceptPairing') }}
                </Button>
              </div>

              <div class="w-full flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <Button variant="secondary" @click="handleClosePairing">
                  {{ t('settings.modules.libp2p.close') }}
                </Button>
                <Button variant="ghost" :loading="isCreatingPairing" @click="handleRegeneratePairing">
                  {{ t('settings.modules.libp2p.regeneratePairing') }}
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>
    </Teleport>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.libp2p.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
