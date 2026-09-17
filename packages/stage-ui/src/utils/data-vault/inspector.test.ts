import { describe, expect, it } from 'vitest'

import { createDataVaultArchive } from './archive'
import { applyCompanionAlignment, inspectImportPayload } from './inspector'

describe('data-vault inspector (Pre-Import Inspection & Inline Alignment)', () => {
  it('detects unaligned character IDs before writing to DB (Sorako scenario)', async () => {
    // An archive with chat sessions for 'default' (installed) and 'orphan-yuriel' (not installed)
    const mockPayload = {
      chatSessions: {
        format: 'chat-sessions-index:v1',
        index: {
          userId: 'local',
          characters: {
            'default': {
              activeSessionId: 'sess-def',
              sessions: { 'sess-def': { messageCount: 165, updatedAt: 1000 } },
            },
            'orphan-yuriel': {
              activeSessionId: 'sess-yur-1',
              sessions: {
                'sess-yur-1': { messageCount: 63, updatedAt: 2000 },
                'sess-yur-2': { messageCount: 2, updatedAt: 3000 },
              },
            },
          },
        },
        sessions: {
          'sess-yur-1': {
            meta: { sessionId: 'sess-yur-1', characterId: 'orphan-yuriel' },
            messages: [{ id: 'm-1', role: 'assistant', content: 'Hi Sorako, I am Yuriel!' }],
          },
        },
      },
      memory: {
        format: 'airi-memory:v2',
        shortTermBlocks: [
          { id: 'stmm-1', characterId: 'orphan-yuriel', characterName: 'Yuriel', summary: 'Day 1' },
        ],
        journalEntries: [
          { id: 'ltmm-1', characterId: 'orphan-yuriel', characterName: 'Yuriel', content: 'Journal' },
        ],
      },
    }

    const zipBlob = await createDataVaultArchive(mockPayload)

    // User only has 'default' (ReLU) installed
    const installedCards = new Map<string, any>([
      ['default', { name: 'ReLU', nickname: 'ReLU' }],
    ])

    const report = await inspectImportPayload([zipBlob], installedCards)

    expect(report.domains).toContain('chat-sessions')
    expect(report.domains).toContain('memory')
    expect(report.unalignedCompanions).toHaveLength(1)

    const unaligned = report.unalignedCompanions[0]
    expect(unaligned.characterId).toBe('orphan-yuriel')
    expect(unaligned.suggestedName).toBe('Yuriel')
    expect(unaligned.messageCount).toBe(65) // 63 + 2
    expect(unaligned.sessionCount).toBe(2)
    expect(unaligned.memoryCount).toBe(2) // 1 STMM + 1 LTMM
    expect(unaligned.previewText).toBe('Hi Sorako, I am Yuriel!')
  })

  it('auto-aligns companion if a matching card is dropped in the same batch', async () => {
    const sessionsJson = JSON.stringify({
      format: 'chat-sessions-index:v1',
      index: {
        userId: 'local',
        characters: {
          'orphan-yuriel': {
            activeSessionId: 'sess-1',
            sessions: { 'sess-1': { messageCount: 10 } },
          },
        },
      },
      sessions: {},
    })

    const charactersJson = JSON.stringify({
      format: 'airi-characters:v1',
      cards: [
        ['orphan-yuriel', { name: 'Yuriel' }],
      ],
    })

    const files = [
      new Blob([sessionsJson], { type: 'application/json' }),
      new Blob([charactersJson], { type: 'application/json' }),
    ]

    const installedCards = new Map<string, any>()

    const report = await inspectImportPayload(files, installedCards)

    // Both domains detected
    expect(report.domains).toContain('chat-sessions')
    expect(report.domains).toContain('characters')

    // Since 'orphan-yuriel' was included in the characters file, it is NOT unaligned!
    expect(report.unalignedCompanions).toHaveLength(0)
  })

  it('re-keys data when user chooses "link" to an existing companion', () => {
    const rawPayload: any = {
      manifest: { schemaVersion: 1, app: 'airi', createdAt: '', domains: ['chat-sessions', 'memory'] },
      chatSessions: {
        format: 'chat-sessions-index:v1',
        index: {
          userId: 'local',
          characters: {
            'orphan-yuriel': {
              activeSessionId: 'sess-yur-1',
              sessions: {
                'sess-yur-1': { messageCount: 63, characterId: 'orphan-yuriel' },
              },
            },
            'default': {
              activeSessionId: 'sess-def',
              sessions: {
                'sess-def': { messageCount: 5, characterId: 'default' },
              },
            },
          },
        },
        sessions: {
          'sess-yur-1': {
            meta: { sessionId: 'sess-yur-1', characterId: 'orphan-yuriel' },
            messages: [],
          },
        },
      },
      memory: {
        format: 'airi-memory:v2',
        shortTermBlocks: [
          { id: 'stmm-1', characterId: 'orphan-yuriel' },
        ],
        journalEntries: [
          { id: 'ltmm-1', characterId: 'orphan-yuriel' },
        ],
        lifetimeArtifacts: {
          'orphan-yuriel': { id: 'lt-1' },
        },
      },
    }

    const aligned = applyCompanionAlignment(rawPayload, {
      'orphan-yuriel': { action: 'link', targetId: 'default' },
    })

    // Orphan character is deleted from chat index
    expect(aligned.chatSessions.index.characters['orphan-yuriel']).toBeUndefined()

    // Sessions moved into 'default'
    expect(aligned.chatSessions.index.characters.default.sessions['sess-yur-1']).toBeDefined()
    expect(aligned.chatSessions.index.characters.default.sessions['sess-yur-1'].characterId).toBe('default')
    expect(aligned.chatSessions.sessions['sess-yur-1'].meta.characterId).toBe('default')

    // Memory re-keyed
    expect(aligned.memory.shortTermBlocks[0].characterId).toBe('default')
    expect(aligned.memory.journalEntries[0].characterId).toBe('default')
    expect(aligned.memory.lifetimeArtifacts.default).toBeDefined()
    expect(aligned.memory.lifetimeArtifacts['orphan-yuriel']).toBeUndefined()
  })

  it('synthesizes new companion card when user chooses "recreate"', () => {
    const rawPayload: any = {
      manifest: { schemaVersion: 1, app: 'airi', createdAt: '', domains: ['chat-sessions'] },
      characters: [],
      chatSessions: {
        format: 'chat-sessions-index:v1',
        index: {
          userId: 'local',
          characters: {
            'orphan-yuriel': {
              activeSessionId: 'sess-yur-1',
              sessions: {
                'sess-yur-1': { messageCount: 63, characterId: 'orphan-yuriel' },
              },
            },
          },
        },
        sessions: {},
      },
    }

    const aligned = applyCompanionAlignment(rawPayload, {
      'orphan-yuriel': { action: 'recreate', name: 'Yuriel Restored' },
    })

    expect(aligned.characters).toHaveLength(1)
    expect(aligned.characters![0][0]).toBe('orphan-yuriel')
    expect(aligned.characters![0][1].name).toBe('Yuriel Restored')
  })
})
