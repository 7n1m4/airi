import type { BackgroundArchiveItem, ExtractedVaultPayload, VaultManifest } from './archive'

import { extractDataVaultArchive } from './archive'

export interface UnalignedCompanion {
  characterId: string
  suggestedName: string
  messageCount: number
  sessionCount: number
  memoryCount: number
  previewText?: string
}

export interface VaultInspectionReport {
  domains: string[]
  manifest?: VaultManifest
  cardsFound: Map<string, any>
  sessionsCount: number
  messagesCount: number
  memoryCount: number
  backgroundsCount: number
  unalignedCompanions: UnalignedCompanion[]
  payload: ExtractedVaultPayload
}

export type CompanionAlignmentConfig = Record<string, {
  action: 'recreate' | 'link'
  targetId?: string
  name?: string
}>

function isZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4B
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
}

function base64ToUtf8(input: string) {
  return decodeURIComponent(escape(atob(input)))
}

function tryParsePngChara(buffer: ArrayBuffer): any | null {
  try {
    const bytes = new Uint8Array(buffer)
    for (let offset = 8; offset < bytes.length - 8;) {
      const length = (
        (bytes[offset] << 24)
        | (bytes[offset + 1] << 16)
        | (bytes[offset + 2] << 8)
        | bytes[offset + 3]
      ) >>> 0

      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
      )

      if (type === 'tEXt') {
        const dataStart = offset + 8
        const dataEnd = dataStart + length
        const data = bytes.slice(dataStart, dataEnd)
        const separator = data.indexOf(0)

        if (separator > 0) {
          const keyword = new TextDecoder().decode(data.slice(0, separator))
          if (keyword === 'chara') {
            const text = new TextDecoder().decode(data.slice(separator + 1))
            return JSON.parse(base64ToUtf8(text))
          }
        }
      }
      offset += 12 + length
    }
  }
  catch {
    // Ignore non-chara PNGs
  }
  return null
}

/**
 * Inspects dropped import files in memory before writing to IndexedDB.
 * Detects included domains and any companion IDs that would become orphans.
 */
export async function inspectImportPayload(
  files: (Blob | File | { name?: string, data?: any })[],
  installedCards: Map<string, any>,
): Promise<VaultInspectionReport> {
  const mergedPayload: ExtractedVaultPayload = {
    manifest: {
      schemaVersion: 1,
      app: 'airi',
      createdAt: new Date().toISOString(),
      domains: [],
    },
    characters: [],
  }

  for (const item of files) {
    let arrayBuffer: ArrayBuffer
    let fileName = ''
    let mimeType = ''

    if (item instanceof Blob) {
      arrayBuffer = await item.arrayBuffer()
      fileName = (item as File).name || ''
      mimeType = item.type || ''
    }
    else if ('data' in item && item.data instanceof Blob) {
      arrayBuffer = await item.data.arrayBuffer()
      fileName = item.name || ''
      mimeType = item.data.type || ''
    }
    else {
      continue
    }

    const uint8 = new Uint8Array(arrayBuffer)

    // Check if it's a ZIP archive
    if (isZipMagic(uint8) || fileName.endsWith('.zip') || mimeType === 'application/zip') {
      try {
        const extracted = await extractDataVaultArchive(arrayBuffer)
        if (extracted.manifest) {
          mergedPayload.manifest = extracted.manifest
        }
        if (extracted.characters) {
          mergedPayload.characters = [...(mergedPayload.characters || []), ...extracted.characters]
        }
        if (extracted.chatSessions) {
          mergedPayload.chatSessions = extracted.chatSessions
        }
        if (extracted.memory) {
          mergedPayload.memory = extracted.memory
        }
        if (extracted.providers) {
          mergedPayload.providers = { ...mergedPayload.providers, ...extracted.providers }
        }
        if (extracted.settings) {
          mergedPayload.settings = { ...mergedPayload.settings, ...extracted.settings }
        }
        if (extracted.backgrounds) {
          mergedPayload.backgrounds = [...(mergedPayload.backgrounds || []), ...extracted.backgrounds]
        }
        continue
      }
      catch (e) {
        console.warn('Failed to parse file as ZIP archive', e)
      }
    }

    // Check if PNG chara card
    if (fileName.endsWith('.png') || mimeType === 'image/png') {
      const chara = tryParsePngChara(arrayBuffer)
      if (chara) {
        const cardData = chara.data || chara
        const cardId = chara.id || `card_${Date.now()}`
        mergedPayload.characters = [...(mergedPayload.characters || []), [cardId, cardData]]
        continue
      }
    }

    // Try parsing as JSON
    try {
      const text = new TextDecoder('utf-8').decode(arrayBuffer)
      const parsed = JSON.parse(text)

      if (parsed && typeof parsed === 'object') {
        if (parsed.format === 'chat-sessions-index:v1') {
          mergedPayload.chatSessions = parsed
        }
        else if (parsed.format === 'airi-characters:v1' && Array.isArray(parsed.cards)) {
          mergedPayload.characters = [...(mergedPayload.characters || []), ...parsed.cards]
        }
        else if (parsed.format === 'airi-memory:v1' || parsed.format === 'airi-memory:v2') {
          mergedPayload.memory = parsed
        }
        else if (parsed.format === 'airi-backgrounds:v1' && Array.isArray(parsed.entries)) {
          const bgItems: BackgroundArchiveItem[] = []
          for (const entry of parsed.entries) {
            if (entry.base64) {
              const res = await fetch(entry.base64)
              const blob = await res.blob()
              bgItems.push({
                metadata: entry.metadata,
                blob,
              })
            }
          }
          mergedPayload.backgrounds = [...(mergedPayload.backgrounds || []), ...bgItems]
        }
        else if ('spec' in parsed || ('name' in parsed && 'extensions' in parsed)) {
          // Single character card JSON
          const cardData = parsed.data || parsed
          const cardId = parsed.id || `card_${Date.now()}`
          mergedPayload.characters = [...(mergedPayload.characters || []), [cardId, cardData]]
        }
      }
    }
    catch {
      // Not a valid JSON, ignore
    }
  }

  // Deduplicate characters
  const cardsFound = new Map<string, any>()
  if (mergedPayload.characters) {
    for (const [id, card] of mergedPayload.characters) {
      if (!cardsFound.has(id)) {
        cardsFound.set(id, card)
      }
    }
    mergedPayload.characters = Array.from(cardsFound.entries())
  }

  // Determine active domains
  const domains: string[] = []
  if (cardsFound.size > 0)
    domains.push('characters')
  if (mergedPayload.chatSessions)
    domains.push('chat-sessions')
  if (mergedPayload.memory)
    domains.push('memory')
  if (mergedPayload.providers && Object.keys(mergedPayload.providers).length > 0)
    domains.push('providers')
  if (mergedPayload.settings && Object.keys(mergedPayload.settings).length > 0)
    domains.push('settings')
  if (mergedPayload.backgrounds && mergedPayload.backgrounds.length > 0)
    domains.push('backgrounds')

  mergedPayload.manifest.domains = domains

  // Combined candidate pool: cards installed in AIRI + cards present in dropped files
  const candidateCards = new Map<string, any>(installedCards)
  for (const [id, card] of cardsFound.entries()) {
    candidateCards.set(id, card)
  }

  // Scan for unaligned companions
  const characterStats = new Map<string, {
    messageCount: number
    sessionCount: number
    memoryCount: number
    suggestedName?: string
    previewText?: string
  }>()

  function getOrInitStats(charId: string) {
    let s = characterStats.get(charId)
    if (!s) {
      s = { messageCount: 0, sessionCount: 0, memoryCount: 0 }
      characterStats.set(charId, s)
    }
    return s
  }

  // 1. Scan chat sessions
  if (mergedPayload.chatSessions?.index?.characters) {
    for (const [charId, charIndex] of Object.entries(mergedPayload.chatSessions.index.characters) as [string, any][]) {
      if (!candidateCards.has(charId)) {
        const stats = getOrInitStats(charId)
        if (charIndex.name) {
          stats.suggestedName = charIndex.name
        }
        if (charIndex.sessions) {
          for (const [sid, smeta] of Object.entries(charIndex.sessions) as [string, any][]) {
            stats.sessionCount++
            stats.messageCount += (smeta.messageCount ?? 0)

            if (!stats.previewText && sid === charIndex.activeSessionId) {
              const sRecord = mergedPayload.chatSessions.sessions?.[sid]
              const msgs = sRecord?.messages || []
              const last = msgs[msgs.length - 1]
              if (last && typeof last.content === 'string') {
                stats.previewText = last.content
              }
            }
          }
        }
      }
    }
  }

  // 2. Scan memory
  if (mergedPayload.memory) {
    if (Array.isArray(mergedPayload.memory.shortTermBlocks)) {
      for (const block of mergedPayload.memory.shortTermBlocks) {
        if (block.characterId && !candidateCards.has(block.characterId)) {
          const stats = getOrInitStats(block.characterId)
          stats.memoryCount++
          if (!stats.suggestedName && block.characterName) {
            stats.suggestedName = block.characterName
          }
        }
      }
    }

    if (Array.isArray(mergedPayload.memory.journalEntries)) {
      for (const entry of mergedPayload.memory.journalEntries) {
        if (entry.characterId && !candidateCards.has(entry.characterId)) {
          const stats = getOrInitStats(entry.characterId)
          stats.memoryCount++
          if (!stats.suggestedName && entry.characterName) {
            stats.suggestedName = entry.characterName
          }
        }
      }
    }

    if (mergedPayload.memory.lifetimeArtifacts) {
      for (const charId of Object.keys(mergedPayload.memory.lifetimeArtifacts)) {
        if (!candidateCards.has(charId)) {
          const stats = getOrInitStats(charId)
          stats.memoryCount++
        }
      }
    }

    if (Array.isArray(mergedPayload.memory.echoChips)) {
      for (const chip of mergedPayload.memory.echoChips) {
        if (chip.characterId && !candidateCards.has(chip.characterId)) {
          const stats = getOrInitStats(chip.characterId)
          stats.memoryCount++
        }
      }
    }
  }

  const unalignedCompanions: UnalignedCompanion[] = []
  for (const [characterId, stats] of characterStats.entries()) {
    unalignedCompanions.push({
      characterId,
      suggestedName: stats.suggestedName || characterId,
      messageCount: stats.messageCount,
      sessionCount: stats.sessionCount,
      memoryCount: stats.memoryCount,
      previewText: stats.previewText,
    })
  }

  // Stats summaries
  let sessionsCount = 0
  let messagesCount = 0
  if (mergedPayload.chatSessions?.index?.characters) {
    for (const charIndex of Object.values(mergedPayload.chatSessions.index.characters) as any[]) {
      if (charIndex.sessions) {
        for (const s of Object.values(charIndex.sessions) as any[]) {
          sessionsCount++
          messagesCount += (s.messageCount ?? 0)
        }
      }
    }
  }

  const memoryCount = (mergedPayload.memory?.shortTermBlocks?.length || 0)
    + (mergedPayload.memory?.journalEntries?.length || 0)
    + Object.keys(mergedPayload.memory?.lifetimeArtifacts || {}).length
    + (mergedPayload.memory?.echoChips?.length || 0)

  const backgroundsCount = mergedPayload.backgrounds?.length || 0

  return {
    domains,
    manifest: mergedPayload.manifest,
    cardsFound,
    sessionsCount,
    messagesCount,
    memoryCount,
    backgroundsCount,
    unalignedCompanions,
    payload: mergedPayload,
  }
}

/**
 * Applies companion alignments in memory before committing to IndexedDB.
 * - 'recreate': Creates a companion card with matching ID so it links natively.
 * - 'link': Rewrites foreign keys across chat sessions and all memory pillars.
 */
export function applyCompanionAlignment(
  payload: ExtractedVaultPayload,
  alignments: CompanionAlignmentConfig,
): ExtractedVaultPayload {
  const result: ExtractedVaultPayload = JSON.parse(JSON.stringify(payload))
  if (payload.backgrounds) {
    // Preserve background Blobs which don't survive JSON stringify
    result.backgrounds = payload.backgrounds
  }

  for (const [unalignedId, config] of Object.entries(alignments)) {
    if (config.action === 'recreate') {
      const companionName = config.name || unalignedId
      result.characters = result.characters || []
      result.characters.push([unalignedId, {
        name: companionName,
        nickname: companionName,
        version: '1.0.0',
        description: 'Restored from archive',
        personality: '',
        scenario: '',
        greetings: [],
        greetingsGroupOnly: [],
        systemPrompt: '',
        postHistoryInstructions: '',
        messageExample: [],
        tags: [],
        extensions: {
          airi: {
            modules: {
              consciousness: { provider: '', model: '' },
              speech: { provider: '', model: '', voice_id: '' },
              displayModelId: 'preset-live2d-1',
              activeBackgroundId: 'none',
            },
            agents: {},
            groundingEnabled: false,
          },
        },
      } as any])
    }
    else if (config.action === 'link' && config.targetId) {
      const targetId = config.targetId

      // 1. Chat Sessions Index
      if (result.chatSessions?.index?.characters) {
        const orphanIndex = result.chatSessions.index.characters[unalignedId]
        if (orphanIndex) {
          if (!result.chatSessions.index.characters[targetId]) {
            result.chatSessions.index.characters[targetId] = {
              activeSessionId: '',
              sessions: {},
            }
          }
          const targetIndex = result.chatSessions.index.characters[targetId]
          if (orphanIndex.sessions) {
            for (const [sid, smeta] of Object.entries(orphanIndex.sessions) as [string, any][]) {
              smeta.characterId = targetId
              targetIndex.sessions[sid] = smeta
            }
          }
          if (!targetIndex.activeSessionId && orphanIndex.activeSessionId) {
            targetIndex.activeSessionId = orphanIndex.activeSessionId
          }
          delete result.chatSessions.index.characters[unalignedId]
        }
      }

      // 2. Chat Sessions Records
      if (result.chatSessions?.sessions) {
        for (const sRecord of Object.values(result.chatSessions.sessions) as any[]) {
          if (sRecord.meta?.characterId === unalignedId) {
            sRecord.meta.characterId = targetId
          }
        }
      }

      // 3. Memory
      if (result.memory) {
        if (Array.isArray(result.memory.shortTermBlocks)) {
          for (const block of result.memory.shortTermBlocks) {
            if (block.characterId === unalignedId) {
              block.characterId = targetId
            }
          }
        }

        if (Array.isArray(result.memory.journalEntries)) {
          for (const entry of result.memory.journalEntries) {
            if (entry.characterId === unalignedId) {
              entry.characterId = targetId
            }
          }
        }

        if (result.memory.lifetimeArtifacts?.[unalignedId]) {
          result.memory.lifetimeArtifacts[targetId] = result.memory.lifetimeArtifacts[unalignedId]
          result.memory.lifetimeArtifacts[targetId].characterId = targetId
          delete result.memory.lifetimeArtifacts[unalignedId]
        }

        if (Array.isArray(result.memory.echoChips)) {
          for (const chip of result.memory.echoChips) {
            if (chip.characterId === unalignedId) {
              chip.characterId = targetId
            }
          }
        }
      }

      // 4. Backgrounds
      if (result.backgrounds) {
        for (const bg of result.backgrounds) {
          if (bg.metadata.characterId === unalignedId) {
            bg.metadata.characterId = targetId
          }
        }
      }
    }
  }

  return result
}
