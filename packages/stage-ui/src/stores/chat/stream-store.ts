import type { StreamingAssistantMessage } from '../../types/chat'

import { debug } from '@proj-airi/stage-shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useChatSessionStore } from './session-store'

export const useChatStreamStore = defineStore('chat-stream', () => {
  const chatSession = useChatSessionStore()
  const streamingMessage = ref<StreamingAssistantMessage>({
    role: 'assistant',
    content: '',
    slices: [],
    tool_results: [],
    createdAt: Date.now(),
    categorization: { speech: '', reasoning: '' },
  })

  function beginStream(messageId?: string, createdAt?: number) {
    streamingMessage.value = {
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      createdAt: createdAt ?? Date.now(),
      id: messageId,
      categorization: { speech: '', reasoning: '' },
    }
  }

  function appendStreamLiteral(literal: string) {
    streamingMessage.value.content += literal

    const lastSlice = streamingMessage.value.slices.at(-1)
    if (lastSlice?.type === 'text') {
      lastSlice.text += literal
      streamingMessage.value = { ...streamingMessage.value }
      return
    }

    streamingMessage.value.slices.push({
      type: 'text',
      text: literal,
    })
    streamingMessage.value = { ...streamingMessage.value }
  }

  function appendStreamReasoning(text: string) {
    if (!streamingMessage.value.categorization) {
      streamingMessage.value.categorization = { speech: '', reasoning: '' }
    }
    streamingMessage.value.categorization.reasoning += text
    streamingMessage.value = { ...streamingMessage.value }
  }

  function finalizeStream(sessionId = chatSession.activeSessionId, fullText?: string) {
    const sessionMessagesForSend = chatSession.getSessionMessages(sessionId)
    if (streamingMessage.value.slices.length > 0) {
      const existsById = !!(streamingMessage.value.id && sessionMessagesForSend.some(m => m.id === streamingMessage.value.id))
      const existsByContent = sessionMessagesForSend.some(m => m.role === 'assistant' && m.content === streamingMessage.value.content)
      const exists = existsById || existsByContent

      debug(`[ChatStreamStore] finalizeStream for session ${sessionId}:`, {
        messageId: streamingMessage.value.id,
        existsById,
        existsByContent,
        willPush: !exists,
        contentPreview: typeof streamingMessage.value.content === 'string' ? streamingMessage.value.content.slice(0, 60) : '',
      })

      if (!exists) {
        sessionMessagesForSend.push(streamingMessage.value)
      }
    }
    streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [], categorization: { speech: '', reasoning: '' } }
    if (fullText)
      streamingMessage.value.content = fullText
  }

  function resetStream() {
    streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [], categorization: { speech: '', reasoning: '' } }
  }

  // Single teardown ledger (Strategy E — exactly ONE dispose per module):
  // clears this generation's streaming buffer so a superseded setup cannot
  // leave ghost partial text behind after its stream was epoch-aborted in
  // chat.ts. The successor generation owns a fresh buffer. No-op in production.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      try {
        resetStream()
      }
      catch (err) {
        debug('[ChatStream:HMR] Buffer reset during HMR dispose failed:', err)
      }
    })
  }

  return {
    streamingMessage,
    beginStream,
    appendStreamLiteral,
    appendStreamReasoning,
    finalizeStream,
    resetStream,
  }
})
