import { acceptHMRUpdate, defineStore } from 'pinia'

import { useChatOrchestratorStore } from '../chat'
import { useAutonomousArtistryStore } from '../modules/artistry-autonomous'
import { useChatContextStore } from './context-store'
import { useChatSessionStore } from './session-store'
import { useChatStreamStore } from './stream-store'

export const useChatMaintenanceStore = defineStore('chat-maintenance', () => {
  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const autonomousArtistry = useAutonomousArtistryStore()

  function cleanupMessages(sessionId = chatSession.activeSessionId) {
    chatSession.cleanupMessages(sessionId)
    chatContext.resetContexts()
    chatOrchestrator.cancelPendingSends(sessionId)
    chatStream.resetStream()
    void autonomousArtistry.archiveSessionNotes(sessionId)
  }

  return {
    cleanupMessages,
  }
})

// Pinia HMR accept boundary. Deliberately NO dispose ledger: this module owns
// no timers, channels, or workers (verified — no setInterval/BroadcastChannel;
// the only timeout in chat/ is input-bridge's self-clearing ack timer), so
// there is no prune interval to drain despite the briefing. Pure delegation
// transfers cleanly. No-op in production (import.meta.hot is undefined).
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChatMaintenanceStore, import.meta.hot))
}
