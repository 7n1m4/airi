import { describe, expect, it } from 'vitest'

import { createDataVaultArchive, extractDataVaultArchive } from './archive'

describe('data-vault archive (ZIP bundling & extraction)', () => {
  it('creates a zip bundle with manifest and domain JSONs and extracts them cleanly', async () => {
    const mockPayload = {
      characters: [
        ['default', { name: 'ReLU', nickname: 'ReLU' }],
        ['yuriel-id', { name: 'Yuriel', nickname: 'Yuriel' }],
      ] as [string, any][],
      chatSessions: {
        format: 'chat-sessions-index:v1',
        index: {
          userId: 'local',
          characters: {
            'yuriel-id': {
              activeSessionId: 'sess-1',
              sessions: {
                'sess-1': { messageCount: 63, updatedAt: 1789500000 },
              },
            },
          },
        },
        sessions: {
          'sess-1': {
            meta: { sessionId: 'sess-1', characterId: 'yuriel-id' },
            messages: [{ id: 'm-1', role: 'assistant', content: 'Hello Sorako' }],
          },
        },
      },
      memory: {
        format: 'airi-memory:v2',
        timestamp: 1789500000,
        shortTermBlocks: [
          { id: 'stmm-1', characterId: 'yuriel-id', summary: 'Day 1 recap' },
        ],
        journalEntries: [
          { id: 'ltmm-1', characterId: 'yuriel-id', content: 'Met Sorako' },
        ],
        lifetimeArtifacts: {
          'yuriel-id': { id: 'lt-1', distilledContent: 'Eternal bond' },
        },
        echoChips: [
          { id: 'chip-1', characterId: 'yuriel-id', content: 'warm laughter' },
        ],
      },
      providers: {
        'openai-1': { id: 'openai-1', name: 'OpenAI' },
      },
      settings: {
        theme: 'dark',
      },
    }

    const zipBlob = await createDataVaultArchive(mockPayload)
    expect(zipBlob).toBeInstanceOf(Blob)
    expect(zipBlob.size).toBeGreaterThan(0)

    const extracted = await extractDataVaultArchive(zipBlob)
    expect(extracted.manifest).toBeDefined()
    expect(extracted.manifest.domains).toContain('characters')
    expect(extracted.manifest.domains).toContain('chat-sessions')
    expect(extracted.manifest.domains).toContain('memory')
    expect(extracted.manifest.domains).toContain('providers')
    expect(extracted.manifest.domains).toContain('settings')

    // Domain data preservation
    expect(extracted.characters).toHaveLength(2)
    expect(extracted.characters?.[1][0]).toBe('yuriel-id')
    expect(extracted.chatSessions?.sessions['sess-1'].messages[0].content).toBe('Hello Sorako')
    expect(extracted.memory?.shortTermBlocks).toHaveLength(1)
    expect(extracted.memory?.lifetimeArtifacts?.['yuriel-id']).toBeDefined()
    expect(extracted.providers?.['openai-1'].name).toBe('OpenAI')
    expect(extracted.settings?.theme).toBe('dark')
  })

  it('stores raw binary images in backgrounds/ directory without base64 bloat', async () => {
    // 4-byte mock png blob
    const sampleBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

    const mockPayload = {
      backgrounds: [
        {
          metadata: {
            id: 'bg-cozy-cafe',
            title: 'Cozy Cafe',
            type: 'scene' as const,
            characterId: null,
            createdAt: 1789500000,
          },
          blob: sampleBlob,
        },
      ],
    }

    const zipBlob = await createDataVaultArchive(mockPayload)
    const extracted = await extractDataVaultArchive(zipBlob)

    expect(extracted.backgrounds).toHaveLength(1)
    expect(extracted.backgrounds?.[0].metadata.title).toBe('Cozy Cafe')
    expect(extracted.backgrounds?.[0].blob).toBeInstanceOf(Blob)

    const extractedBytes = new Uint8Array(await extracted.backgrounds![0].blob.arrayBuffer())
    expect(extractedBytes[0]).toBe(137)
    expect(extractedBytes[1]).toBe(80)
    expect(extractedBytes[2]).toBe(78)
    expect(extractedBytes[3]).toBe(71)
  })

  it('allows selective export, omitting domains that are not provided', async () => {
    const mockPayload = {
      chatSessions: {
        format: 'chat-sessions-index:v1',
        index: { userId: 'local', characters: {} },
        sessions: {},
      },
    }

    const zipBlob = await createDataVaultArchive(mockPayload)
    const extracted = await extractDataVaultArchive(zipBlob)

    expect(extracted.manifest.domains).toEqual(['chat-sessions'])
    expect(extracted.chatSessions).toBeDefined()
    expect(extracted.characters).toBeUndefined()
    expect(extracted.backgrounds).toBeUndefined()
  })
})
