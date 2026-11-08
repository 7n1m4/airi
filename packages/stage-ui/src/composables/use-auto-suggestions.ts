import type { Ref } from 'vue'

import { useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onUnmounted, ref, watch } from 'vue'

import { useChatOrchestratorStore } from '../stores/chat'
import { useChatSessionStore } from '../stores/chat/session-store'

export interface UseAutoSuggestionsOptions {
  /**
   * Optional function to retrieve current draft input from the composer.
   * This is used purely as guidance and will NOT be cleared (Option A non-destructive draft).
   */
  getGuidance?: () => string

  /**
   * Callback invoked when an assistant turn completes (both LLM streaming and TTS audio have finished).
   */
  onTurnComplete?: (guidance: string) => Promise<void> | void

  /**
   * Optional external override for enabled state. If omitted, uses localStorage key.
   */
  enabled?: Ref<boolean>
}

/**
 * Composable that watches for character turn completion (LLM stream + TTS playback ended)
 * and triggers automated reply suggestions when auto-suggestions mode is enabled.
 */
export function useAutoSuggestions(options?: UseAutoSuggestionsOptions) {
  const isAutoSuggestionsEnabled = options?.enabled ?? useLocalStorage<boolean>('airi:producer:auto-suggestions-enabled', false)
  const chatOrchestrator = useChatOrchestratorStore()
  const chatSession = useChatSessionStore()
  const { canStop } = storeToRefs(chatOrchestrator)

  const wasActive = ref(false)
  let wasStopped = false
  let lastSuggestedMessageId: string | null = null
  let settleTimeout: ReturnType<typeof setTimeout> | null = null

  // If user explicitly pressed Stop, suppress automated suggestion generation for this turn
  const cleanupStopHook = chatOrchestrator.onGenerationStopped?.(async () => {
    wasStopped = true
    if (settleTimeout) {
      clearTimeout(settleTimeout)
      settleTimeout = null
    }
  })

  if (options?.onTurnComplete) {
    watch(canStop, (active) => {
      if (active) {
        wasActive.value = true
        wasStopped = false
        if (settleTimeout) {
          clearTimeout(settleTimeout)
          settleTimeout = null
        }
        return
      }

      // Falling edge: was active, now inactive
      if (wasActive.value && !active) {
        if (settleTimeout) {
          clearTimeout(settleTimeout)
        }

        // Settle micro-gap between LLM stream end and TTS playback start
        settleTimeout = setTimeout(async () => {
          settleTimeout = null
          if (!canStop.value && wasActive.value) {
            wasActive.value = false
            if (wasStopped) {
              wasStopped = false
              return
            }
            if (!isAutoSuggestionsEnabled.value) {
              return
            }

            // Ensure the turn actually ended with an assistant message
            const messages = chatSession.messages || []
            const lastMessage = messages[messages.length - 1]
            if (!lastMessage || lastMessage.role !== 'assistant') {
              return
            }

            // Deduplicate by message identity: prevent duplicate trigger for the same assistant response
            const messageId = (lastMessage as any).id || (lastMessage as any).createdAt?.toString()
            if (messageId && messageId === lastSuggestedMessageId) {
              return
            }
            if (messageId) {
              lastSuggestedMessageId = messageId
            }

            const guidance = options.getGuidance ? options.getGuidance().trim() : ''
            try {
              await options.onTurnComplete?.(guidance)
            }
            catch (err) {
              console.error('[useAutoSuggestions] Error during onTurnComplete:', err)
            }
          }
        }, 300)
      }
    })
  }

  onUnmounted(() => {
    if (settleTimeout) {
      clearTimeout(settleTimeout)
      settleTimeout = null
    }
    if (typeof cleanupStopHook === 'function') {
      cleanupStopHook()
    }
  })

  return {
    isAutoSuggestionsEnabled,
  }
}
