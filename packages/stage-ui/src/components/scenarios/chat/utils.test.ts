import type { ChatAssistantMessage } from '../../../types/chat'

import { describe, expect, it } from 'vitest'

import { formatToolCallSummary, getChatHistoryItemCopyText } from './utils'

describe('getChatHistoryItemCopyText', () => {
  it('copies actor-aware text slices as clean prose with no orchestration markers', () => {
    const message: ChatAssistantMessage = {
      role: 'assistant',
      content: 'Hi, how are you? I am great, thanks.',
      rawContent: '<|ACTOR:actor_one|>Hi, how are you?<|ACTOR:actor_two|>I am great, thanks.',
      slices: [
        { type: 'text', text: 'Hi, how are you?', actorId: 'actor_one', startsActor: true },
        {
          type: 'tool-call',
          toolCall: {
            args: '{}',
            toolCallId: 'tool-1',
            toolCallType: 'function',
            toolName: 'text_journal',
          },
        },
        { type: 'text', text: 'I am great, thanks.', actorId: 'actor_two', startsActor: true },
      ],
      tool_results: [],
    }

    const copied = getChatHistoryItemCopyText(message)

    expect(copied).toBe('Hi, how are you?\n\nI am great, thanks.')
    expect(copied).not.toContain('<|')
  })
})

describe('formatToolCallSummary', () => {
  it('truncates long bash command safely without bisecting astral-plane emojis', () => {
    // 33 'a's + '😀' (U+1F600) + ' extra'
    // Total code points: 34 before ' extra'. '😀' is at index 33 in code points, but index 33-34 in UTF-16 code units.
    const cmd = `${'a'.repeat(33)}😀 extra arguments`
    const summary = formatToolCallSummary('bash', { command: cmd })

    expect(summary).toBe(`$ ${'a'.repeat(33)}😀...`)
    expect(summary.isWellFormed()).toBe(true)
    expect(() => encodeURIComponent(summary)).not.toThrow()
  })

  it('safely handles text_journal titles with unicode astral-plane characters', () => {
    const content = `${'b'.repeat(23)}✨ rest of journal content`
    const summary = formatToolCallSummary('text_journal', { action: 'create', content })

    expect(summary).toBe(`📓 Created ${'b'.repeat(23)}✨`)
    expect(summary.isWellFormed()).toBe(true)
    expect(() => encodeURIComponent(summary)).not.toThrow()
  })
})
