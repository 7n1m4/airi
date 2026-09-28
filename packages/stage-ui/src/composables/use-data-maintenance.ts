import type { DisplayModelFormat } from '../stores/display-models'
import type { ChatSessionsExport } from '../types/chat-session'
import type {
  ArchivePayload,
  BackgroundArchiveItem,
  ExtractedVaultPayload,
} from '../utils/data-vault'

import JSZip from 'jszip'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useLive2d } from '@proj-airi/stage-ui-live2d'
import { nanoid } from 'nanoid'
import { safeParse } from 'valibot'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { echoChipsRepo } from '../database/repos/echo-chips.repo'
import { lifetimeMemoryRepo } from '../database/repos/lifetime-memory.repo'
import { storageState } from '../database/storage'
import { useBackgroundStore } from '../stores/background'
import { useChatOrchestratorStore } from '../stores/chat'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useDisplayModelsStore } from '../stores/display-models'
import { useMcpStore } from '../stores/mcp'
import { useShortTermMemoryStore } from '../stores/memory-short-term'
import { useTextJournalStore } from '../stores/memory-text-journal'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useHearingStore } from '../stores/modules/hearing'
import { useSpeechStore } from '../stores/modules/speech'
import { useTwitterStore } from '../stores/modules/twitter'
import { useOnboardingStore } from '../stores/onboarding'
import { useProvidersStore } from '../stores/providers'
import { useSettings, useSettingsAudioDevice } from '../stores/settings'
import { AiriCardSchema } from '../types/card.schema'
import {
  applyCompanionAlignment,
  createDataVaultArchive,
  inspectImportPayload,
} from '../utils/data-vault'

export interface CardZipImportResult {
  cardId: string
  flavor: 'v1' | 'v2'
  importedModelIds: string[]
  importedBackgroundId?: string
  importedVoiceCount: number
  importedSessionCount: number
  warnings: string[]
}

export function useDataMaintenance() {
  const chatStore = useChatSessionStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const displayModelsStore = useDisplayModelsStore()
  const providersStore = useProvidersStore()
  const settingsStore = useSettings()
  const audioSettingsStore = useSettingsAudioDevice()
  const live2dStore = useLive2d()
  const hearingStore = useHearingStore()
  const speechStore = useSpeechStore()
  const consciousnessStore = useConsciousnessStore()
  const twitterStore = useTwitterStore()
  const discordStore = useDiscordStore()
  const factorioStore = useFactorioStore()
  const mcpStore = useMcpStore()
  const onboardingStore = useOnboardingStore()
  const airiCardStore = useAiriCardStore()
  const shortTermMemoryStore = useShortTermMemoryStore()
  const textJournalStore = useTextJournalStore()
  const backgroundStore = useBackgroundStore()

  async function deleteAllModels() {
    await displayModelsStore.resetDisplayModels()
    settingsStore.stageModelSelected = 'preset-live2d-1'
    await settingsStore.updateStageModel()
  }

  async function resetProvidersSettings() {
    await providersStore.resetProviderSettings()
  }

  function resetModulesSettings() {
    hearingStore.resetState()
    speechStore.resetState()
    consciousnessStore.resetState()
    twitterStore.resetState()
    discordStore.resetState()
    factorioStore.resetState()
  }

  function deleteAllChatSessions() {
    chatOrchestrator.cancelPendingSends()
    chatStore.resetAllSessions()
  }

  async function exportChatSessions() {
    const data = await chatStore.exportSessions()
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }

  function isChatSessionsPayload(payload: unknown): payload is ChatSessionsExport {
    if (!payload || typeof payload !== 'object')
      return false
    return (payload as { format?: string }).format === 'chat-sessions-index:v1'
  }

  async function importChatSessions(payload: Record<string, unknown>) {
    if (!isChatSessionsPayload(payload))
      throw new Error('Invalid chat session export format')
    await chatStore.importSessions(payload)
  }

  // --- Per-Character (single-card ZIP) ---

  /**
   * Scoped variant of `exportSessions` for single-card ZIP `memories/chat_sessions.json`.
   * Returns full `{ meta, messages }` records for one character — never metas-only.
   */
  async function exportSessionsForCharacter(characterId: string): Promise<ChatSessionsExport> {
    const chatStoreAny = chatStore as any
    if (!chatStoreAny.ready) {
      await chatStoreAny.initialize()
    }

    const empty = {
      format: 'chat-sessions-index:v1',
      index: { userId: chatStoreAny.index?.userId ?? '', characters: {} },
      sessions: {},
    } as ChatSessionsExport

    const charIndex = chatStore.getCharacterIndex(characterId)
    if (!charIndex?.sessions) {
      return empty
    }

    const sessions: Record<string, any> = {}
    for (const sessionId of Object.keys(charIndex.sessions)) {
      // NOTICE: messages are lazy — ensure the session is loaded before reading.
      await chatStore.loadSession(sessionId)
      const stored = await chatSessionsRepo.getSession(sessionId)
      if (stored) {
        sessions[sessionId] = stored
        continue
      }
      const meta = chatStoreAny.sessionMetas[sessionId]
      const messages = chatStore.getSessionMessages(sessionId)
      if (meta && messages) {
        sessions[sessionId] = { meta, messages }
      }
    }

    return {
      format: 'chat-sessions-index:v1',
      index: {
        userId: chatStoreAny.index?.userId ?? '',
        characters: { [characterId]: charIndex },
      },
      sessions,
    } as ChatSessionsExport
  }

  /**
   * Scoped variant of the vault `memory.json` payload for single-card ZIP `memories/memory.json`.
   * Covers one character across all five memory sources: chat-adjacent STMM blocks, LTMM journal
   * entries, lifetime artifacts (enumerated per universe — a global-only read would drop the rest),
   * and echo chips.
   */
  async function exportMemoryForCharacter(characterId: string) {
    await Promise.all([shortTermMemoryStore.load(), textJournalStore.load()])

    const shortTermBlocks = shortTermMemoryStore.blocks.filter((b: any) => b.characterId === characterId)
    const journalEntries = textJournalStore.entries.filter((e: any) => e.characterId === characterId)

    // Lifetime artifacts are universe-keyed — collect universes from this character's
    // sessions, always including 'global'.
    const universeIds = new Set<string>(['global'])
    try {
      const chatStoreAny = chatStore as any
      if (!chatStoreAny.ready) {
        await chatStoreAny.initialize()
      }
      const charIndex = chatStore.getCharacterIndex(characterId)
      if (charIndex?.sessions) {
        for (const meta of Object.values(charIndex.sessions) as any[]) {
          universeIds.add(meta?.universeId || 'global')
        }
      }
    }
    catch (e) {
      console.error(`Failed to enumerate universes for ${characterId}`, e)
    }

    const lifetimeArtifacts: Record<string, any> = {}
    for (const universeId of universeIds) {
      try {
        const art = await lifetimeMemoryRepo.getByCharacter(characterId, universeId)
        if (art) {
          lifetimeArtifacts[universeId] = art
        }
      }
      catch (e) {
        console.error(`Failed to export lifetime artifact for ${characterId}:${universeId}`, e)
      }
    }

    let echoChips: any[] = []
    try {
      const all = (await echoChipsRepo.getAll('local')) || []
      echoChips = all.filter((c: any) => c.characterId === characterId)
    }
    catch (e) {
      console.error('Failed to export echo chips', e)
    }

    return {
      format: 'airi-memory:v2',
      timestamp: Date.now(),
      characterId,
      shortTermBlocks,
      journalEntries,
      lifetimeArtifacts,
      echoChips,
    }
  }

  // --- Characters ---

  async function exportAllCharacters() {
    const cards = Array.from(airiCardStore.cards.entries())
    const data = {
      format: 'airi-characters:v1',
      timestamp: Date.now(),
      cards,
    }
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }

  async function importAllCharacters(payload: any) {
    if (payload.format !== 'airi-characters:v1' || !Array.isArray(payload.cards))
      throw new Error('Invalid characters export format')

    for (const [id, card] of payload.cards) {
      // Simple merge: skip if already exists to prevent overwriting user-modified cards
      if (!airiCardStore.cards.has(id)) {
        airiCardStore.cards.set(id, card)
      }
    }
    // Trigger persistence if the store has a persist method or just relies on reactivity
    // useLocalStorageManualReset should handle the save if we are mutating the map reference properly
    // or if we call a save method if it exists. Based on airi-card.ts, it's reactive.
  }

  // --- Memory ---

  async function exportMemory() {
    await Promise.all([shortTermMemoryStore.load(), textJournalStore.load()])
    const data = {
      format: 'airi-memory:v1',
      timestamp: Date.now(),
      shortTermBlocks: shortTermMemoryStore.blocks,
      journalEntries: textJournalStore.entries,
    }
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }

  async function importMemory(payload: any) {
    if (payload.format !== 'airi-memory:v1')
      throw new Error('Invalid memory export format')

    if (Array.isArray(payload.shortTermBlocks)) {
      await shortTermMemoryStore.load()
      const existingIds = new Set(shortTermMemoryStore.blocks.map(b => b.id))
      const newBlocks = payload.shortTermBlocks.filter((b: any) => !existingIds.has(b.id))
      if (newBlocks.length > 0) {
        const merged = [...shortTermMemoryStore.blocks, ...newBlocks]
        await shortTermMemoryStore.persist(merged)
      }
    }

    if (Array.isArray(payload.journalEntries)) {
      await textJournalStore.load()
      const existingIds = new Set(textJournalStore.entries.map(e => e.id))
      const newEntries = payload.journalEntries.filter((e: any) => !existingIds.has(e.id))
      if (newEntries.length > 0) {
        const merged = [...textJournalStore.entries, ...newEntries]
        await textJournalStore.persist(merged)
      }
    }
  }

  // --- Single-Card ZIP Import (moeru v1 + dasilva333 v2) ---

  const ZIP_IMPORT_MODEL_FORMATS = ['vrm', 'live2d-zip', 'spine-zip'] as const

  function getUniqueCardName(baseName: string): string {
    const existingNames = new Set(
      Array.from(airiCardStore.cards.values()).map(card => ((card as any).name || '').trim().toLowerCase()).filter(Boolean),
    )
    const trimmedBase = (baseName || '').trim() || 'Imported Card'
    if (!existingNames.has(trimmedBase.toLowerCase()))
      return trimmedBase

    let counter = 2
    while (existingNames.has(`${trimmedBase} (${counter})`.toLowerCase()))
      counter += 1
    return `${trimmedBase} (${counter})`
  }

  function removeNullValuesDeep(obj: any): any {
    // Mirrors removeNullValues in airi-card/index.vue — Valibot rejects explicit nulls.
    if (obj === null)
      return undefined
    if (Array.isArray(obj))
      return obj.map(removeNullValuesDeep)
    if (obj !== null && typeof obj === 'object') {
      const clean: any = {}
      for (const key of Object.keys(obj)) {
        const val = removeNullValuesDeep(obj[key])
        if (val !== undefined)
          clean[key] = val
      }
      return clean
    }
    return obj
  }

  function parseZipMessageExamples(exampleStr: string): string[][] {
    // Mirrors parseStMessageExamples in airi-card/index.vue — <START>-separated
    // transcript blocks filtered to {{user}}/{{char}} lines.
    if (!exampleStr || typeof exampleStr !== 'string')
      return []
    return exampleStr
      .split(/<START>/i)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => block
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map((line) => {
          let normalized = line
          if (/^user:/i.test(normalized))
            normalized = `{{user}}:${normalized.slice(5)}`
          else if (/^char:/i.test(normalized))
            normalized = `{{char}}:${normalized.slice(5)}`
          if (/^\{\{(?:user|char)\}\}:\S/.test(normalized))
            normalized = normalized.replace(/^(\{\{(?:user|char)\}\}:)/, '$1 ')
          return normalized
        })
        .filter(line => /^\{\{(?:user|char)\}\}: /.test(line)))
      .filter(block => block.length > 0)
  }

  /**
   * Normalizes a ZIP `card.json` (CCv3 envelope) into an AIRI card shape.
   * v1 carries upstream-sanitized airi, v2 carries the full fork airi —
   * both are preserved as-is.
   */
  function normalizeZipCard(cardJson: any): any {
    const data = cardJson?.data || cardJson
    return removeNullValuesDeep({
      name: data.name || 'Imported Card',
      nickname: data.nickname || '',
      version: data.character_version || '1.0.0',
      description: data.description ?? '',
      notes: data.creator_notes ?? '',
      personality: data.personality ?? '',
      scenario: data.scenario ?? '',
      systemPrompt: data.system_prompt ?? '',
      postHistoryInstructions: data.post_history_instructions ?? '',
      greetings: [data.first_mes, ...(data.alternate_greetings ?? [])].filter(Boolean),
      messageExample: parseZipMessageExamples(data.mes_example || ''),
      tags: data.tags ?? [],
      creator: data.creator ?? '',
      extensions: {
        ...data.extensions,
        airi: data.extensions?.airi ?? {},
      },
    })
  }

  function importEmbeddedVoiceProfiles(card: any): number {
    let count = 0
    const embedded = card?.extensions?.airi?.voice_profiles
    if (Array.isArray(embedded)) {
      for (const profile of embedded) {
        if (profile?.id && !speechStore.savedVoiceProfiles.some((p: any) => p.id === profile.id)) {
          speechStore.saveVoiceProfile(profile)
          count += 1
        }
      }
    }
    return count
  }

  /**
   * Merges imported chat sessions under a new card id — merge-only, never
   * replaces live state. Colliding session ids are re-keyed, never overwritten.
   */
  async function mergeImportedSessions(payload: any, newCardId: string, warnings: string[]): Promise<number> {
    const records = payload?.sessions
    if (!records || typeof records !== 'object')
      return 0

    const chatStoreAny = chatStore as any
    if (!chatStoreAny.ready)
      await chatStoreAny.initialize()
    const index = chatStoreAny.index
    if (!index) {
      warnings.push('Skipped chat sessions (session index unavailable)')
      return 0
    }
    if (!index.characters[newCardId])
      index.characters[newCardId] = { activeSessionId: '', sessions: {} }
    const target = index.characters[newCardId]

    let count = 0
    for (const [sessionId, record] of Object.entries(records) as [string, any][]) {
      if (!record?.messages || !Array.isArray(record.messages))
        continue
      let targetId = sessionId
      const exists = await chatSessionsRepo.getSession(sessionId).catch(() => null)
      if (exists || chatStoreAny.sessionMetas[sessionId]) {
        targetId = nanoid()
        warnings.push(`Session ${sessionId.slice(0, 8)} re-keyed on import to avoid overwriting local history`)
      }
      const meta = {
        ...record.meta,
        sessionId: targetId,
        characterId: newCardId,
        messageCount: record.messages.length,
        updatedAt: Date.now(),
      }
      const next = { meta, messages: record.messages }
      await chatSessionsRepo.saveSession(targetId, next)
      chatStoreAny.sessionMetas[targetId] = meta
      chatStoreAny.sessionMessages[targetId] = record.messages
      target.sessions[targetId] = meta
      if (!target.activeSessionId)
        target.activeSessionId = targetId
      count += 1
    }
    await chatStoreAny.persistIndex()
    return count
  }

  /**
   * Merges imported memory pillars under a new card id. STMM/journal/echo merge
   * by id (append-only Sacred rule respected — nothing rewritten); lifetime
   * saves per universe.
   */
  async function mergeImportedMemory(payload: any, newCardId: string, warnings: string[]) {
    if (!payload || typeof payload !== 'object')
      return

    if (Array.isArray(payload.shortTermBlocks)) {
      await shortTermMemoryStore.load()
      const existingIds = new Set(shortTermMemoryStore.blocks.map((b: any) => b.id))
      const fresh = payload.shortTermBlocks
        .filter((b: any) => b && !existingIds.has(b.id))
        .map((b: any) => ({ ...b, characterId: newCardId }))
      if (fresh.length > 0)
        await shortTermMemoryStore.persist([...shortTermMemoryStore.blocks, ...fresh])
    }

    if (Array.isArray(payload.journalEntries)) {
      await textJournalStore.load()
      const existingIds = new Set(textJournalStore.entries.map((e: any) => e.id))
      const fresh = payload.journalEntries
        .filter((e: any) => e && !existingIds.has(e.id))
        .map((e: any) => ({ ...e, characterId: newCardId }))
      if (fresh.length > 0)
        await textJournalStore.persist([...textJournalStore.entries, ...fresh])
    }

    if (payload.lifetimeArtifacts && typeof payload.lifetimeArtifacts === 'object') {
      for (const [universeId, art] of Object.entries(payload.lifetimeArtifacts) as [string, any][]) {
        if (!art)
          continue
        try {
          await lifetimeMemoryRepo.save(newCardId, universeId || 'global', { ...art, characterId: newCardId })
        }
        catch {
          warnings.push(`Skipped lifetime artifact for universe ${universeId}`)
        }
      }
    }

    if (Array.isArray(payload.echoChips)) {
      try {
        const existing = (await echoChipsRepo.getAll('local')) || []
        const existingIds = new Set(existing.map((c: any) => c.id))
        const fresh = payload.echoChips
          .filter((c: any) => c && c.id && !existingIds.has(c.id))
          .map((c: any) => ({ ...c, characterId: newCardId }))
        if (fresh.length > 0)
          await echoChipsRepo.saveAll('local', [...existing, ...fresh])
      }
      catch {
        warnings.push('Skipped echo chips')
      }
    }
  }

  /**
   * Imports a single-card ZIP package — moeru v1 (`airi-character-card`) or
   * dasilva333 v2 (`airi-card-package`). Card, display models, background,
   * voice profiles, and (v2) memories are all merged under a fresh card id;
   * live state is never overwritten. `cover.png` is display-only and skipped.
   */
  async function importCardZipPackage(file: File): Promise<CardZipImportResult> {
    const warnings: string[] = []

    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer())
    }
    catch {
      throw new Error('Invalid zip file')
    }

    // --- Manifest (tolerant: bare card.json falls back to v1) ---
    let manifest: any = null
    const manifestFile = zip.file('manifest.json')
    if (manifestFile) {
      try {
        manifest = JSON.parse(await manifestFile.async('text'))
      }
      catch {
        throw new Error('Invalid manifest.json')
      }
    }

    let flavor: 'v1' | 'v2'
    if (!manifest) {
      warnings.push('No manifest.json found, assuming upstream-compatible package')
      flavor = 'v1'
    }
    else if (manifest.format === 'airi-card-package') {
      flavor = 'v2'
    }
    else if (manifest.format === 'airi-character-card') {
      flavor = 'v1'
    }
    else {
      throw new Error(`Unsupported package format: ${manifest.format}`)
    }

    const cardPath = manifest?.card?.path || 'card.json'
    if (manifest?.card?.spec && manifest.card.spec !== 'chara_card_v3')
      warnings.push(`Unexpected card spec ${manifest.card.spec}, attempting import anyway`)
    const cardFile = zip.file(cardPath)
    if (!cardFile)
      throw new Error(`Missing ${cardPath}`)

    let cardJson: any
    try {
      cardJson = JSON.parse(await cardFile.async('text'))
    }
    catch {
      throw new Error(`Invalid ${cardPath}`)
    }
    if (cardJson.spec && cardJson.spec !== 'chara_card_v3')
      warnings.push(`Unexpected card spec ${cardJson.spec}, attempting import anyway`)

    // --- Card ---
    const normalized = normalizeZipCard(cardJson)
    const validation = safeParse(AiriCardSchema, normalized)
    if (!validation.success) {
      const details = validation.issues
        .map((i: any) => `${i.path?.map((p: any) => p.key).filter(Boolean).join('.') || 'root'}: ${i.message}`)
        .join(', ')
      throw new Error(`Card validation failed: ${details}`)
    }
    normalized.name = getUniqueCardName(normalized.name)

    // --- Display models ---
    const modelResources: { path: string, format: string, name?: string, role?: string }[] = []
    if (flavor === 'v1' && manifest?.resources?.displayModel) {
      modelResources.push(manifest.resources.displayModel)
    }
    else if (flavor === 'v2' && Array.isArray(manifest?.resources?.displayModels)) {
      modelResources.push(...manifest.resources.displayModels)
    }

    const imported: { resource: (typeof modelResources)[number], id: string }[] = []
    for (const [i, resource] of modelResources.entries()) {
      if (!(ZIP_IMPORT_MODEL_FORMATS as readonly string[]).includes(resource.format)) {
        warnings.push(`Skipped model ${resource.name || resource.path} (unsupported format ${resource.format})`)
        continue
      }
      const binFile = zip.file(resource.path)
      if (!binFile) {
        warnings.push(`Skipped model ${resource.name || resource.path} (missing from archive)`)
        continue
      }
      try {
        const data = await binFile.async('arraybuffer')
        // NOTICE: this fork's addDisplayModel returns void (unlike upstream),
        // so resolve the fresh id by diffing the in-memory catalog.
        const knownIds = new Set(displayModelsStore.displayModels.map(m => m.id))
        await displayModelsStore.addDisplayModel(
          resource.format as DisplayModelFormat,
          new File([data], resource.name || `model-${i}`),
        )
        const added = displayModelsStore.displayModels.find(m => !knownIds.has(m.id))
        if (!added)
          throw new Error('Model import left no catalog entry')
        imported.push({ resource, id: added.id })
      }
      catch {
        warnings.push(`Skipped model ${resource.name || resource.path} (failed to import)`)
      }
    }
    const primary = imported.find(entry => entry.resource.role === 'base') ?? imported[0]
    if (primary) {
      normalized.extensions = normalized.extensions || {}
      normalized.extensions.airi = normalized.extensions.airi || {}
      normalized.extensions.airi.modules = { ...normalized.extensions.airi.modules, displayModelId: primary.id }
    }
    const importedModelIds = imported.map(entry => entry.id)

    // Tolerant path: older zips may still carry inline voice profiles.
    let importedVoiceCount = importEmbeddedVoiceProfiles(normalized)

    const newCardId = await airiCardStore.addCard(normalized)

    // --- Background (v2) ---
    let importedBackgroundId: string | undefined
    const bgPath = flavor === 'v2' ? manifest?.resources?.backgroundImage?.path : undefined
    if (bgPath) {
      const bgFile = zip.file(bgPath)
      if (bgFile) {
        try {
          const bytes = await bgFile.async('arraybuffer')
          const title = manifest.resources.backgroundImage.title || `${normalized.name} backdrop`
          importedBackgroundId = await backgroundStore.addBackground('journal', new Blob([bytes], { type: 'image/png' }), title, undefined, newCardId)
          await airiCardStore.updateCard(newCardId, {
            extensions: {
              ...normalized.extensions,
              airi: {
                ...normalized.extensions?.airi,
                modules: { ...normalized.extensions?.airi?.modules, activeBackgroundId: importedBackgroundId },
              },
            },
          } as any)
        }
        catch {
          warnings.push('Skipped background image (failed to import)')
        }
      }
    }

    // --- Voice profiles (v2 manifest) ---
    if (flavor === 'v2' && Array.isArray(manifest?.resources?.voiceProfiles)) {
      for (const vp of manifest.resources.voiceProfiles) {
        if (!vp?.path)
          continue
        const vf = zip.file(vp.path)
        if (!vf) {
          warnings.push(`Skipped voice profile ${vp.path} (missing from archive)`)
          continue
        }
        try {
          const profile = JSON.parse(await vf.async('text'))
          if (profile?.id && !speechStore.savedVoiceProfiles.some((p: any) => p.id === profile.id)) {
            speechStore.saveVoiceProfile(profile)
            importedVoiceCount += 1
          }
        }
        catch {
          warnings.push(`Skipped voice profile ${vp.path} (invalid JSON)`)
        }
      }
    }

    // --- Memories (v2, merge-only) ---
    let importedSessionCount = 0
    const memPaths = flavor === 'v2' ? manifest?.resources?.memories : undefined
    if (memPaths && typeof memPaths === 'object') {
      storageState.isImportingRemoteData = true
      try {
        if (memPaths.chatSessions?.path) {
          const sf = zip.file(memPaths.chatSessions.path)
          if (sf) {
            try {
              importedSessionCount = await mergeImportedSessions(JSON.parse(await sf.async('text')), newCardId, warnings)
            }
            catch {
              warnings.push('Skipped chat sessions (invalid memories payload)')
            }
          }
        }
        if (memPaths.memory?.path) {
          const mf = zip.file(memPaths.memory.path)
          if (mf) {
            try {
              await mergeImportedMemory(JSON.parse(await mf.async('text')), newCardId, warnings)
            }
            catch {
              warnings.push('Skipped memory pillars (invalid memories payload)')
            }
          }
        }
      }
      finally {
        storageState.isImportingRemoteData = false
      }
    }

    return {
      cardId: newCardId,
      flavor,
      importedModelIds,
      importedBackgroundId,
      importedVoiceCount,
      importedSessionCount,
      warnings,
    }
  }

  // --- Backgrounds ---

  async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  async function base64ToBlob(base64: string): Promise<Blob> {
    const res = await fetch(base64)
    return await res.blob()
  }

  async function exportBackgrounds() {
    const entries = Array.from(backgroundStore.entries.entries())
    const serializedEntries = await Promise.all(entries.map(async ([id, entry]) => {
      return {
        id,
        metadata: { ...entry, blob: undefined },
        base64: await blobToBase64(entry.blob),
      }
    }))

    const data = {
      format: 'airi-backgrounds:v1',
      timestamp: Date.now(),
      entries: serializedEntries,
    }
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }

  async function importBackgrounds(payload: any) {
    if (payload.format !== 'airi-backgrounds:v1' || !Array.isArray(payload.entries))
      throw new Error('Invalid backgrounds export format')

    for (const item of payload.entries) {
      if (!backgroundStore.entries.has(item.id)) {
        const blob = await base64ToBlob(item.base64)
        await backgroundStore.addBackground(
          item.metadata.type,
          blob,
          item.metadata.title,
          item.metadata.prompt,
          item.metadata.characterId,
          item.metadata.remixId,
        )
      }
    }
  }

  async function resetSettingsState() {
    await settingsStore.resetState()
    audioSettingsStore.resetState()
    live2dStore.resetState()
    mcpStore.resetState()
    onboardingStore.resetSetupState()
    airiCardStore.resetState()
  }

  async function deleteAllData() {
    await deleteAllModels()
    await resetProvidersSettings()
    resetModulesSettings()
    deleteAllChatSessions()
    await resetSettingsState()
  }

  async function resetDesktopApplicationState() {
    if (!isStageTamagotchi())
      return

    await resetSettingsState()
    resetModulesSettings()
  }

  // --- Orphaned Sessions Maintenance ---

  async function getOrphanedGroups() {
    const chatStoreAny = chatStore as any
    if (!chatStoreAny.ready) {
      await chatStoreAny.initialize()
    }
    const index = chatStoreAny.index
    if (!index)
      return []

    const cards = airiCardStore.cards
    const orphans = []

    for (const [characterId, charIndex] of Object.entries(index.characters) as [string, any][]) {
      if (!cards.has(characterId)) {
        let messageCount = 0
        let lastActive = 0
        for (const [sid, s] of Object.entries(charIndex.sessions) as [string, any][]) {
          if (s) {
            let sessionMsgCount = s.messageCount ?? 0
            if (sessionMsgCount === 0) {
              try {
                const sessionRecord = await chatSessionsRepo.getSession(sid)
                sessionMsgCount = sessionRecord?.messages?.length ?? 0
              }
              catch (e) {
                console.error(`Failed to fetch session record to count messages for ${sid}`, e)
              }
            }
            messageCount += sessionMsgCount
            if (s.updatedAt > lastActive) {
              lastActive = s.updatedAt
            }
          }
        }

        const activeSessionId = charIndex.activeSessionId
        let preview = ''
        if (activeSessionId) {
          try {
            const sessionRecord = await chatSessionsRepo.getSession(activeSessionId)
            const messages = sessionRecord?.messages ?? []
            const lastMsg = messages[messages.length - 1]
            if (lastMsg) {
              let text = ''
              if (typeof lastMsg.content === 'string') {
                text = lastMsg.content
              }
              else if (Array.isArray(lastMsg.content)) {
                text = lastMsg.content.map((part: any) => {
                  if (typeof part === 'string')
                    return part
                  if (part && typeof part === 'object' && 'text' in part)
                    return String(part.text ?? '')
                  return ''
                }).join('')
              }
              preview = text.length > 300 ? `...${text.slice(-300)}` : text
            }
          }
          catch (e) {
            console.error(`Failed to load session preview for ${activeSessionId}`, e)
          }
        }

        orphans.push({
          characterId,
          messageCount,
          lastActive,
          preview,
        })
      }
    }

    // Sort by lastActive descending (newest activity first)
    orphans.sort((a, b) => b.lastActive - a.lastActive)

    return orphans
  }

  async function nukeOrphanedGroups(characterIds: string[]) {
    const chatStoreAny = chatStore as any
    if (!chatStoreAny.ready) {
      await chatStoreAny.initialize()
    }
    const index = chatStoreAny.index
    if (!index)
      return

    for (const characterId of characterIds) {
      const charIndex = index.characters[characterId] as any
      if (charIndex) {
        const sessionIds = Object.keys(charIndex.sessions)
        for (const sessionId of sessionIds) {
          await chatSessionsRepo.deleteSession(sessionId)
          delete chatStoreAny.sessionMessages[sessionId]
          delete chatStoreAny.sessionMetas[sessionId]
          delete chatStoreAny.sessionGenerations[sessionId]
        }
        delete index.characters[characterId]
      }
    }
    await chatStoreAny.persistIndex()

    // Clean up memory across pillars for nuked characters
    try {
      await shortTermMemoryStore.load()
      const initialStmmLen = shortTermMemoryStore.blocks.length
      const nextBlocks = shortTermMemoryStore.blocks.filter(b => !characterIds.includes(b.characterId))
      if (nextBlocks.length !== initialStmmLen) {
        await shortTermMemoryStore.persist(nextBlocks)
      }
    }
    catch (e) {
      console.error('Failed to clean up short-term memory during orphan nuke', e)
    }

    try {
      await textJournalStore.load()
      const initialLtmmLen = textJournalStore.entries.length
      const nextEntries = textJournalStore.entries.filter(e => !characterIds.includes(e.characterId))
      if (nextEntries.length !== initialLtmmLen) {
        await textJournalStore.persist(nextEntries)
      }
    }
    catch (e) {
      console.error('Failed to clean up text journal during orphan nuke', e)
    }

    for (const charId of characterIds) {
      try {
        await lifetimeMemoryRepo.delete(charId, 'global')
      }
      catch (e) {
        console.error(`Failed to delete lifetime memory for ${charId}`, e)
      }
    }

    try {
      const chips = await echoChipsRepo.getAll('local')
      if (Array.isArray(chips)) {
        const nextChips = chips.filter((c: any) => !characterIds.includes(c.characterId))
        if (nextChips.length !== chips.length) {
          await echoChipsRepo.saveAll('local', nextChips)
        }
      }
    }
    catch (e) {
      console.error('Failed to clean up echo chips during orphan nuke', e)
    }
  }

  async function restoreOrphanedGroups(mappings: string[] | Record<string, string>) {
    const chatStoreAny = chatStore as any
    if (!chatStoreAny.ready) {
      await chatStoreAny.initialize()
    }
    const index = chatStoreAny.index

    const nextCards = new Map(airiCardStore.cards)
    const mappingObj: Record<string, string> = {}

    if (Array.isArray(mappings)) {
      for (const id of mappings) {
        mappingObj[id] = 'new'
      }
    }
    else {
      Object.assign(mappingObj, mappings)
    }

    for (const [orphanId, targetId] of Object.entries(mappingObj)) {
      const effectiveTargetId = targetId === 'new' ? orphanId : targetId
      const orphanCharIndex = index?.characters[orphanId] as any

      // Find the session with the highest message count in the orphaned group
      let bestSessionId = orphanCharIndex?.activeSessionId || ''
      let maxMsgCount = -1
      if (orphanCharIndex?.sessions) {
        for (const [sid, smeta] of Object.entries(orphanCharIndex.sessions) as [string, any][]) {
          const count = smeta.messageCount ?? 0
          if (count > maxMsgCount) {
            maxMsgCount = count
            bestSessionId = sid
          }
        }
      }

      if (targetId === 'new') {
        nextCards.set(orphanId, {
          name: orphanId,
          nickname: '',
          version: '1.0.0',
          description: 'Restored from orphaned sessions',
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
        } as any)

        if (orphanCharIndex && bestSessionId) {
          orphanCharIndex.activeSessionId = bestSessionId
        }
      }
      else {
        if (index && index.characters[orphanId]) {
          if (!index.characters[targetId]) {
            index.characters[targetId] = {
              activeSessionId: '',
              sessions: {},
            }
          }
          const targetCharIndex = index.characters[targetId] as any

          for (const [sessionId, meta] of Object.entries(orphanCharIndex.sessions) as [string, any][]) {
            meta.characterId = targetId
            targetCharIndex.sessions[sessionId] = meta

            try {
              const sessionRecord = await chatSessionsRepo.getSession(sessionId)
              if (sessionRecord) {
                sessionRecord.meta.characterId = targetId
                await chatSessionsRepo.saveSession(sessionId, sessionRecord)
              }
            }
            catch (e) {
              console.error(`Failed to update session record ${sessionId} during merge`, e)
            }
          }

          // Point active session to the populated session if current is empty or missing
          const currentTargetActive = targetCharIndex.activeSessionId
          const currentTargetCount = currentTargetActive ? (targetCharIndex.sessions[currentTargetActive]?.messageCount ?? 0) : 0
          if (!currentTargetActive || (maxMsgCount > currentTargetCount && currentTargetCount <= 1)) {
            targetCharIndex.activeSessionId = bestSessionId || orphanCharIndex.activeSessionId
          }

          delete index.characters[orphanId]
        }
      }

      // Re-key multi-pillar memory records to effective target companion
      if (orphanId !== effectiveTargetId) {
        try {
          await shortTermMemoryStore.load()
          let stmmChanged = false
          for (const block of shortTermMemoryStore.blocks) {
            if (block.characterId === orphanId) {
              block.characterId = effectiveTargetId
              stmmChanged = true
            }
          }
          if (stmmChanged) {
            await shortTermMemoryStore.persist(shortTermMemoryStore.blocks)
          }
        }
        catch (e) {
          console.error(`Failed to migrate short-term memory for orphan ${orphanId}`, e)
        }

        try {
          await textJournalStore.load()
          let ltmmChanged = false
          for (const entry of textJournalStore.entries) {
            if (entry.characterId === orphanId) {
              entry.characterId = effectiveTargetId
              ltmmChanged = true
            }
          }
          if (ltmmChanged) {
            await textJournalStore.persist(textJournalStore.entries)
          }
        }
        catch (e) {
          console.error(`Failed to migrate text journal for orphan ${orphanId}`, e)
        }

        try {
          const artifact = await lifetimeMemoryRepo.getByCharacter(orphanId)
          if (artifact) {
            artifact.characterId = effectiveTargetId
            await lifetimeMemoryRepo.save(effectiveTargetId, 'global', artifact)
            await lifetimeMemoryRepo.delete(orphanId, 'global')
          }
        }
        catch (e) {
          console.error(`Failed to migrate lifetime memory for orphan ${orphanId}`, e)
        }

        try {
          const chips = await echoChipsRepo.getAll('local')
          if (Array.isArray(chips)) {
            let chipsChanged = false
            for (const chip of chips) {
              if (chip.characterId === orphanId) {
                chip.characterId = effectiveTargetId
                chipsChanged = true
              }
            }
            if (chipsChanged) {
              await echoChipsRepo.saveAll('local', chips)
            }
          }
        }
        catch (e) {
          console.error(`Failed to migrate echo chips for orphan ${orphanId}`, e)
        }
      }
    }

    if (index) {
      await chatStoreAny.persistIndex()
    }

    airiCardStore.cards = nextCards
  }

  async function getVaultStats() {
    await Promise.all([
      shortTermMemoryStore.load(),
      textJournalStore.load(),
    ])

    const charactersCount = airiCardStore.cards.size
    const charactersEstimatedBytes = JSON.stringify(Array.from(airiCardStore.cards.entries())).length

    const chatStoreAny = chatStore as any
    if (!chatStoreAny.ready) {
      await chatStoreAny.initialize()
    }
    const index = chatStoreAny.index
    let sessionsCount = 0
    let messagesCount = 0
    if (index?.characters) {
      for (const char of Object.values(index.characters) as any[]) {
        if (char.sessions) {
          for (const s of Object.values(char.sessions) as any[]) {
            sessionsCount++
            messagesCount += (s.messageCount ?? 0)
          }
        }
      }
    }
    const chatSessionsEstimatedBytes = messagesCount * 400 + sessionsCount * 200

    const stmmCount = shortTermMemoryStore.blocks.length
    const ltmmCount = textJournalStore.entries.length
    const memoryEstimatedBytes = JSON.stringify(shortTermMemoryStore.blocks).length + JSON.stringify(textJournalStore.entries).length

    let backgroundsCount = 0
    let backgroundsBytes = 0
    for (const entry of backgroundStore.entries.values()) {
      backgroundsCount++
      if (entry.blob?.size) {
        backgroundsBytes += entry.blob.size
      }
    }

    const providersCount = Object.keys(providersStore.providers || {}).length

    return {
      characters: { count: charactersCount, estimatedBytes: charactersEstimatedBytes },
      chatSessions: { sessionsCount, messagesCount, estimatedBytes: chatSessionsEstimatedBytes },
      memory: { stmmCount, ltmmCount, estimatedBytes: memoryEstimatedBytes },
      backgrounds: { count: backgroundsCount, totalBytes: backgroundsBytes },
      providers: { count: providersCount, estimatedBytes: 2048 },
    }
  }

  async function exportDataVaultArchive(selection: {
    characters?: boolean
    chatSessions?: boolean
    memory?: boolean
    providers?: boolean
    settings?: boolean
    backgrounds?: boolean
  }): Promise<Blob> {
    const payload: ArchivePayload = {}

    if (selection.characters) {
      payload.characters = Array.from(airiCardStore.cards.entries())
    }

    if (selection.chatSessions) {
      payload.chatSessions = await chatStore.exportSessions()
    }

    if (selection.memory) {
      await Promise.all([shortTermMemoryStore.load(), textJournalStore.load()])

      const lifetimeArtifacts: Record<string, any> = {}
      for (const charId of airiCardStore.cards.keys()) {
        try {
          const art = await lifetimeMemoryRepo.getByCharacter(charId)
          if (art) {
            lifetimeArtifacts[charId] = art
          }
        }
        catch (e) {
          console.error(`Failed to export lifetime artifact for ${charId}`, e)
        }
      }

      let echoChips: any[] = []
      try {
        echoChips = (await echoChipsRepo.getAll('local')) || []
      }
      catch (e) {
        console.error('Failed to export echo chips', e)
      }

      payload.memory = {
        format: 'airi-memory:v2',
        timestamp: Date.now(),
        shortTermBlocks: shortTermMemoryStore.blocks,
        journalEntries: textJournalStore.entries,
        lifetimeArtifacts,
        echoChips,
      }
    }

    if (selection.providers) {
      payload.providers = providersStore.providers || {}
    }

    if (selection.settings) {
      payload.settings = {
        stageModelSelected: settingsStore.stageModelSelected,
      }
    }

    if (selection.backgrounds) {
      const bgList: BackgroundArchiveItem[] = []
      for (const [id, entry] of backgroundStore.entries.entries()) {
        if (entry.blob) {
          bgList.push({
            metadata: {
              id,
              title: entry.title,
              type: entry.type,
              characterId: entry.characterId,
              createdAt: entry.createdAt,
              prompt: entry.prompt,
              remixId: entry.remixId,
              universeId: entry.universeId,
              sessionId: entry.sessionId,
            },
            blob: entry.blob,
          })
        }
      }
      payload.backgrounds = bgList
    }

    return await createDataVaultArchive(payload)
  }

  async function inspectVaultImport(files: (Blob | File | { name?: string, data?: any })[]) {
    return await inspectImportPayload(files, airiCardStore.cards)
  }

  async function commitVaultImport(payload: ExtractedVaultPayload) {
    // 1. Characters
    if (payload.characters && payload.characters.length > 0) {
      for (const [id, card] of payload.characters) {
        if (!airiCardStore.cards.has(id)) {
          airiCardStore.cards.set(id, card)
        }
      }
    }

    // 2. Chat Sessions
    if (payload.chatSessions) {
      await chatStore.importSessions(payload.chatSessions)
    }

    // 3. Memory
    if (payload.memory) {
      await importMemory(payload.memory)

      if (payload.memory.lifetimeArtifacts) {
        for (const [charId, art] of Object.entries(payload.memory.lifetimeArtifacts) as [string, any][]) {
          try {
            await lifetimeMemoryRepo.save(charId, 'global', art)
          }
          catch (e) {
            console.error(`Failed to import lifetime memory for ${charId}`, e)
          }
        }
      }

      if (Array.isArray(payload.memory.echoChips) && payload.memory.echoChips.length > 0) {
        try {
          const existing = (await echoChipsRepo.getAll('local')) || []
          const existingIds = new Set(existing.map((c: any) => c.id))
          const newChips = payload.memory.echoChips.filter((c: any) => !existingIds.has(c.id))
          if (newChips.length > 0) {
            await echoChipsRepo.saveAll('local', [...existing, ...newChips])
          }
        }
        catch (e) {
          console.error('Failed to import echo chips', e)
        }
      }
    }

    // 4. Backgrounds
    if (payload.backgrounds && payload.backgrounds.length > 0) {
      for (const bg of payload.backgrounds) {
        if (!backgroundStore.entries.has(bg.metadata.id) && bg.metadata.type !== 'builtin') {
          await backgroundStore.addBackground(
            bg.metadata.type,
            bg.blob,
            bg.metadata.title,
            bg.metadata.prompt,
            bg.metadata.characterId,
            bg.metadata.remixId,
            bg.metadata.universeId,
            bg.metadata.sessionId,
          )
        }
      }
    }
  }

  return {
    deleteAllModels,
    resetProvidersSettings,
    resetModulesSettings,
    deleteAllChatSessions,
    exportChatSessions,
    importChatSessions,
    exportSessionsForCharacter,
    exportMemoryForCharacter,
    exportAllCharacters,
    importAllCharacters,
    exportMemory,
    importMemory,
    exportBackgrounds,
    importBackgrounds,
    deleteAllData,
    resetDesktopApplicationState,
    getOrphanedGroups,
    nukeOrphanedGroups,
    restoreOrphanedGroups,
    getVaultStats,
    exportDataVaultArchive,
    importCardZipPackage,
    inspectVaultImport,
    applyCompanionAlignment,
    commitVaultImport,
  }
}
