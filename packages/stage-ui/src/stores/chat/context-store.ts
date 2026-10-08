import type { ContextMessage } from '../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { defineStore } from 'pinia'
import { readonly, ref, toRaw } from 'vue'

import { getEventSourceKey } from '../../utils/event-source'

interface ChatContextHotData {
  activeContextsMap?: Map<string, ContextMessage[]>
}

function getHotData(): ChatContextHotData | undefined {
  if (!import.meta.hot)
    return undefined
  const data = import.meta.hot.data as { chatContext?: ChatContextHotData }
  data.chatContext ??= {}
  return data.chatContext
}

export const useChatContextStore = defineStore('chat-context', () => {
  // hot.data preservation: this closure-local Map is the authoritative
  // registry but is NOT part of Pinia $state, so stock HMR patching would
  // drop it while keeping the stale reactive mirror. Adopt the preserved Map
  // (mutated in place, so the stash stays live) or start fresh.
  const hotData = getHotData()
  let currentActiveContexts = hotData?.activeContextsMap ?? new Map<string, ContextMessage[]>()
  if (hotData)
    hotData.activeContextsMap = currentActiveContexts

  const activeContextsMirror = ref<Record<string, ContextMessage[]>>({})
  const activeContexts = readonly(activeContextsMirror)

  function syncRegistrySnapshot() {
    activeContextsMirror.value = Object.fromEntries(
      Array.from(currentActiveContexts, ([sourceKey, messages]) => [
        sourceKey,
        structuredClone(messages),
      ]),
    )
  }

  function ingestContextMessage(envelope: ContextMessage) {
    try {
      const sourceKey = getEventSourceKey(envelope)
      const safeEnvelopeToStore = structuredClone(toRaw(envelope))

      if (!currentActiveContexts.has(sourceKey)) {
        currentActiveContexts.set(sourceKey, [])
      }

      if (envelope.strategy === ContextUpdateStrategy.ReplaceSelf) {
        currentActiveContexts.set(sourceKey, [safeEnvelopeToStore])
      }
      else if (envelope.strategy === ContextUpdateStrategy.AppendSelf) {
        currentActiveContexts.get(sourceKey)?.push(safeEnvelopeToStore)
      }

      syncRegistrySnapshot()
    }
    catch (error) {
      console.error('[Context Store] Failed to ingest context message:', error)
      throw error // Escapes to bridge error handler
    }
  }

  function resetContexts() {
    currentActiveContexts = new Map<string, ContextMessage[]>()
    // Re-point the stash: resetContexts reassigns (not mutates) the registry.
    if (hotData)
      hotData.activeContextsMap = currentActiveContexts
    syncRegistrySnapshot()
  }

  function getContextsSnapshot() {
    return Object.fromEntries(
      Array.from(currentActiveContexts, ([sourceKey, messages]) => [
        sourceKey,
        structuredClone(messages),
      ]),
    )
  }

  return {
    activeContexts,
    ingestContextMessage,
    resetContexts,
    getContextsSnapshot,
  }
})
