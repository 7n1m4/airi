<script setup lang="ts">
import { QRCode } from '@proj-airi/ui'
import { Button, FieldCheckbox, FieldInput, FieldSelect, FieldTextarea, Tab, Tabs } from '@proj-airi/ui'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import { useLibp2pStore } from '@proj-airi/stage-ui/stores/modules/libp2p'

const { t } = useI18n()
const router = useRouter()
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
  isRunning,
  isElectron,
} = storeToRefs(libp2pStore)

const activeTab = ref<'node' | 'peers' | 'sync' | 'dev'>('node')
const isPairingDialogOpen = ref(false)
const pairingQrCode = ref('')
const pairingMagicCode = ref('')
const newBootstrapPeer = ref('')
const newTopic = ref('')

const connectedPeers = computed(() => peers.value.filter(p => p.connected))
const discoveredPeers = computed(() => peers.value.filter(p => !p.connected))

function handleStartStop() {
  if (isRunning.value) {
    libp2pStore.stopService()
  } else {
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

  try {
    const { qrCode, magicCode } = await libp2pStore.createPairing?.(
      serviceStatus.value.listenAddresses,
      identity.value.peerId,
      identity.value.name
    ) || { qrCode: '', magicCode: '' }

    if (qrCode && magicCode) {
      pairingQrCode.value = qrCode
      pairingMagicCode.value = magicCode
      isPairingDialogOpen.value = true
    }
  } catch (err) {
    console.error('[Libp2pPage] Failed to create pairing:', err)
    toast.error(`${t('settings.modules.libp2p.pairingFailed')}: ${err}`)
  }
}

async function handleAcceptPairing() {
  // This would be called from the pairing dialog with QR code scan or manual code entry
  // Implementation depends on how the QR code is scanned
}

function handleAddBootstrapPeer() {
  if (!newBootstrapPeer.value.trim()) return
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
  if (!newTopic.value.trim()) return
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
        <h3 class="text-lg font-semibold">{{ t('settings.modules.libp2p.nodeStatus') }}</h3>
        <div class="flex items-center gap-2">
          <span
            class="w-2.5 h-2.5 rounded-full"
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
            <p class="font-medium">{{ t('settings.modules.libp2p.enableMesh') }}</p>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.modules.libp2p.enableMeshDesc') }}
            </p>
          </div>
          <FieldCheckbox v-model="enabled" @update:model-value="handleStartStop" />
        </div>

        <div v-if="isRunning" class="flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <!-- Peer ID -->
          <div v-if="identity" class="flex flex-col gap-2">
            <p class="font-medium">{{ t('settings.modules.libp2p.peerId') }}</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 bg-neutral-200 dark:bg-neutral-800 px-3 py-2 rounded text-sm break-all">
                {{ identity.peerId }}
              </code>
              <Button @click="handleCopyPeerId" variant="ghost" size="sm">
                {{ t('settings.modules.libp2p.copy') }}
              </Button>
            </div>
          </div>

          <!-- Node Name -->
          <div class="flex flex-col gap-2">
            <p class="font-medium">{{ t('settings.modules.libp2p.nodeName') }}</p>
            <div class="flex items-center gap-2">
              <FieldInput v-model="nodeName" :placeholder="t('settings.modules.libp2p.nodeNamePlaceholder')" class="flex-1" />
              <Button @click="handleSetNodeName" variant="secondary" size="sm">
                {{ t('settings.modules.libp2p.save') }}
              </Button>
              <Button @click="handleCopyNodeName" variant="ghost" size="sm">
                {{ t('settings.modules.libp2p.copy') }}
              </Button>
            </div>
          </div>

          <!-- Listen Addresses -->
          <div v-if="serviceStatus.listenAddresses.length" class="flex flex-col gap-2">
            <p class="font-medium">{{ t('settings.modules.libp2p.listenAddresses') }}</p>
            <div class="flex flex-col gap-1 max-h-40 overflow-auto">
              <code
                v-for="addr in serviceStatus.listenAddresses"
                :key="addr"
                class="bg-neutral-200 dark:bg-neutral-800 px-2 py-1 rounded text-xs break-all"
              >
                {{ addr }}
              </code>
            </div>
          </div>

          <!-- Connections -->
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium">{{ t('settings.modules.libp2p.connections') }}</p>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ serviceStatus.connections }} {{ t('settings.modules.libp2p.activeConnections') }}
              </p>
            </div>
            <Button @click="handleRefresh" variant="secondary" size="sm">
              {{ t('settings.modules.libp2p.refresh') }}
            </Button>
          </div>

          <!-- Generate Identity Button -->
          <div v-if="!identity" class="flex items-center gap-2">
            <p class="text-sm text-neutral-600 dark:text-neutral-400 flex-1">
              {{ t('settings.modules.libp2p.noIdentity') }}
            </p>
            <Button @click="handleGenerateIdentity" variant="primary">
              {{ t('settings.modules.libp2p.generateIdentity') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Configuration Tabs -->
    <Tabs v-model="activeTab" class="w-full">
      <TabList class="mb-4">
        <Tab :value="'node'">{{ t('settings.modules.libp2p.tabNode') }}</Tab>
        <Tab :value="'peers'">{{ t('settings.modules.libp2p.tabPeers') }}</Tab>
        <Tab :value="'sync'">{{ t('settings.modules.libp2p.tabSync') }}</Tab>
        <Tab :value="'dev'">{{ t('settings.modules.libp2p.tabDev') }}</Tab>
      </TabList>

      <TabPanels>
        <!-- Node Config Tab -->
        <TabPanel :value="'node'">
          <div class="flex flex-col gap-6">
            <!-- Transports -->
            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <p class="font-medium">{{ t('settings.modules.libp2p.transports') }}</p>
              <div class="flex flex-wrap gap-2">
                <FieldCheckbox
                  v-for="t in ['tcp', 'websockets', 'webrtc', 'webtransport', 'mdns']"
                  :key="t"
                  :id="`transport-${t}`"
                  :model-value="transports.includes(t)"
                  @update:model-value="(val) => {
                    const arr = [...transports.value]
                    if (val) arr.push(t)
                    else arr.splice(arr.indexOf(t), 1)
                    transports.value = arr
                    libp2pStore.applyConfig()
                  }"
                >
                  <template #label>{{ t.toUpperCase() }}</template>
                </FieldCheckbox>
              </div>
            </div>

            <!-- Bootstrap Peers -->
            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <div class="flex items-center justify-between">
                <p class="font-medium">{{ t('settings.modules.libp2p.bootstrapPeers') }}</p>
                <div class="flex items-center gap-2">
                  <FieldInput
                    v-model="newBootstrapPeer"
                    :placeholder="t('settings.modules.libp2p.bootstrapPeerPlaceholder')"
                    class="w-64"
                  />
                  <Button @click="handleAddBootstrapPeer" size="sm">
                    {{ t('settings.modules.libp2p.add') }}
                  </Button>
                </div>
              </div>
              <div v-if="bootstrapPeers.length" class="flex flex-col gap-2">
                <div
                  v-for="(peer, idx) in bootstrapPeers"
                  :key="peer"
                  class="flex items-center justify-between bg-neutral-200 dark:bg-neutral-800 px-3 py-2 rounded"
                >
                  <code class="text-sm break-all flex-1">{{ peer }}</code>
                  <Button @click="handleRemoveBootstrapPeer(idx)" variant="ghost" size="sm" icon="i-solar:trash-bin-minimalistic-bold" />
                </div>
              </div>
              <p v-else class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ t('settings.modules.libp2p.noBootstrapPeers') }}
              </p>
            </div>

            <!-- Topics -->
            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <div class="flex items-center justify-between">
                <p class="font-medium">{{ t('settings.modules.libp2p.topics') }}</p>
                <div class="flex items-center gap-2">
                  <FieldInput
                    v-model="newTopic"
                    :placeholder="t('settings.modules.libp2p.topicPlaceholder')"
                    class="w-64"
                  />
                  <Button @click="handleAddTopic" size="sm">
                    {{ t('settings.modules.libp2p.add') }}
                  </Button>
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <div
                  v-for="(topic, idx) in topics"
                  :key="topic"
                  class="flex items-center justify-between bg-neutral-200 dark:bg-neutral-800 px-3 py-2 rounded"
                >
                  <code class="text-sm">{{ topic }}</code>
                  <Button @click="handleRemoveTopic(idx)" variant="ghost" size="sm" icon="i-solar:trash-bin-minimalistic-bold" />
                </div>
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- Peers Tab -->
        <TabPanel :value="'peers'">
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <div class="flex items-center justify-between">
                <p class="font-medium">{{ t('settings.modules.libp2p.connectedPeers') }} ({{ connectedPeers.length }})</p>
                <Button @click="handleCreatePairing" variant="primary" :disabled="!isRunning || !identity">
                  {{ t('settings.modules.libp2p.pairNewDevice') }}
                </Button>
              </div>

              <div v-if="connectedPeers.length" class="flex flex-col gap-2">
                <div
                  v-for="peer in connectedPeers"
                  :key="peer.id"
                  class="flex items-center justify-between p-3 rounded-lg bg-neutral-200 dark:bg-neutral-800"
                >
                  <div class="flex items-center gap-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <div>
                      <code class="text-sm font-mono">{{ peer.id.slice(0, 20) }}...</code>
                      <p v-if="peer.name" class="text-xs text-neutral-600 dark:text-neutral-400">{{ peer.name }}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button @click="() => libp2pStore.pingPeer(peer.id)" variant="ghost" size="sm">
                      {{ t('settings.modules.libp2p.ping') }}
                    </Button>
                  </div>
                </div>
              </div>

              <p v-else class="text-sm text-neutral-600 dark:text-neutral-400 text-center py-4">
                {{ t('settings.modules.libp2p.noConnectedPeers') }}
              </p>
            </div>

            <div v-if="discoveredPeers.length" class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <p class="font-medium">{{ t('settings.modules.libp2p.discoveredPeers') }} ({{ discoveredPeers.length }})</p>
              <div class="flex flex-col gap-2">
                <div
                  v-for="peer in discoveredPeers"
                  :key="peer.id"
                  class="flex items-center justify-between p-3 rounded-lg bg-neutral-200 dark:bg-neutral-800"
                >
                  <div class="flex items-center gap-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    <div>
                      <code class="text-sm font-mono">{{ peer.id.slice(0, 20) }}...</code>
                      <p v-if="peer.name" class="text-xs text-neutral-600 dark:text-neutral-400">{{ peer.name }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- Sync Tab -->
        <TabPanel :value="'sync'">
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-medium">{{ t('settings.modules.libp2p.meshSync') }}</p>
                  <p class="text-sm text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.modules.libp2p.meshSyncDesc') }}
                  </p>
                </div>
                <FieldCheckbox v-model="meshSyncEnabled" />
              </div>

              <div v-if="meshSyncEnabled" class="flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <div class="flex flex-col gap-2">
                  <p class="font-medium">{{ t('settings.modules.libp2p.syncTargets') }}</p>
                  <div class="flex flex-wrap gap-2">
                    <FieldCheckbox
                      v-for="target in ['memory', 'vault', 'companions']"
                      :key="target"
                      :id="`sync-target-${target}`"
                      :model-value="meshSyncTargets.includes(target)"
                      @update:model-value="(val) => {
                        const arr = [...meshSyncTargets.value]
                        if (val) arr.push(target)
                        else arr.splice(arr.indexOf(target), 1)
                        meshSyncTargets.value = arr
                      }"
                    >
                      <template #label>{{ target }}</template>
                    </FieldCheckbox>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <Button @click="() => libp2pStore.publishMessage('airi/memory', 'sync-request')" variant="secondary" :disabled="!isRunning">
                    {{ t('settings.modules.libp2p.triggerMemorySync') }}
                  </Button>
                  <Button @click="() => libp2pStore.publishMessage('airi/vault', 'sync-request')" variant="secondary" :disabled="!isRunning">
                    {{ t('settings.modules.libp2p.triggerVaultSync') }}
                  </Button>
                  <Button @click="() => libp2pStore.publishMessage('airi/companion', 'sync-request')" variant="secondary" :disabled="!isRunning">
                    {{ t('settings.modules.libp2p.triggerCompanionSync') }}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- Dev Console Tab -->
        <TabPanel :value="'dev'">
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <div class="flex items-center justify-between">
                <p class="font-medium">{{ t('settings.modules.libp2p.eventLog') }}</p>
                <Button @click="() => eventLog.value = []" variant="ghost" size="sm">
                  {{ t('settings.modules.libp2p.clear') }}
                </Button>
              </div>

              <div class="max-h-96 overflow-auto font-mono text-xs bg-neutral-900 dark:bg-neutral-950 rounded p-3">
                <div
                  v-for="(entry, idx) in eventLog"
                  :key="idx"
                  class="flex gap-2 py-1 border-b border-neutral-800 last:border-0"
                  :style="{ color: getLogColor(entry.level) }"
                >
                  <span class="text-neutral-500">{{ formatTimestamp(entry.timestamp) }}</span>
                  <span class="text-neutral-400">[{{ entry.level.toUpperCase() }}]</span>
                  <span>{{ entry.message }}</span>
                </div>
                <p v-if="!eventLog.length" class="text-neutral-500 text-center py-8">
                  {{ t('settings.modules.libp2p.noEvents') }}
                </p>
              </div>
            </div>

            <div class="flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
              <p class="font-medium">{{ t('settings.modules.libp2p.testPublish') }}</p>
              <div class="flex flex-col gap-2">
                <FieldSelect v-model="testPublishTopic" :options="topics" :placeholder="t('settings.modules.libp2p.selectTopic')" />
                <FieldTextarea v-model="testPublishData" :placeholder="t('settings.modules.libp2p.messageData')" rows="3" />
                <Button @click="() => libp2pStore.publishMessage(testPublishTopic, btoa(testPublishData))" variant="primary" :disabled="!isRunning || !testPublishTopic">
                  {{ t('settings.modules.libp2p.publish') }}
                </Button>
              </div>
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <!-- Pairing Dialog -->
    <Teleport to="body">
      <DialogRoot :open="isPairingDialogOpen" @update:open="isPairingDialogOpen = $event">
        <DialogPortal>
          <DialogOverlay class="fixed inset-0 bg-black/50 z-50" />
          <DialogContent class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md z-50 rounded-xl bg-white dark:bg-neutral-900 p-6 shadow-xl">
            <DialogTitle class="text-lg font-semibold mb-4">{{ t('settings.modules.libp2p.pairingInvitation') }}</DialogTitle>
            <DialogDescription class="mb-4">{{ t('settings.modules.libp2p.pairingDesc') }}</DialogDescription>

            <div class="flex flex-col items-center gap-4">
              <div class="bg-white dark:bg-neutral-800 p-4 rounded">
                <QRCode :value="pairingQrCode" :size="200" />
              </div>

              <div class="text-center">
                <p class="font-medium mb-2">{{ t('settings.modules.libp2p.magicCode') }}</p>
                <code class="text-2xl font-mono tracking-widest bg-neutral-100 dark:bg-neutral-800 px-4 py-2 rounded">
                  {{ pairingMagicCode }}
                </code>
                <p class="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
                  {{ t('settings.modules.libp2p.magicCodeDesc') }}
                </p>
              </div>

              <div class="flex items-center justify-between pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <Button @click="isPairingDialogOpen = false" variant="secondary">
                  {{ t('settings.modules.libp2p.close') }}
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