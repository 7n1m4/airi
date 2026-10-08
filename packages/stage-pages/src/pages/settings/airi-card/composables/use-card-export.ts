import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'
import type { CardCustomSticker } from '@proj-airi/stage-ui/types/card.schema'

import JSZip from 'jszip'
import localforage from 'localforage'

import { exportToJSON } from '@proj-airi/ccc'
import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { getLatestSelfie } from '@proj-airi/stage-ui/libs/character-media-resolver'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { storeToRefs } from 'pinia'
import { toRaw } from 'vue'

import cardExportFrameUrl from '../card-export-frame.png?url'

export const CARD_EXPORT_FRAME = {
  width: 925,
  height: 1436,
  innerX: 65,
  innerY: 79,
  innerWidth: 831,
  innerHeight: 1278,
}

export interface JsonExportOptions {
  pretty?: boolean
  includeMemories?: boolean
}

export interface PngExportOptions {
  framed?: boolean
  omitNotes?: boolean
  imageSourceUrl?: string | null
}

export interface ZipExportOptions {
  flavor?: 'v2' | 'v1'
  includeModels?: boolean
  includeBackground?: boolean
  includeVoiceProfiles?: boolean
  includeCover?: boolean
  includeMemories?: boolean
  generateReadme?: boolean
  coverImageUrl?: string | null
}

// 1 GB — archive readers hit 32-bit size-field issues past this point.
export const ZIP_SIZE_CAP_BYTES = 1024 * 1024 * 1024

const ZIP_MANIFEST_V1_FORMAT = 'airi-character-card'
const ZIP_MANIFEST_V2_FORMAT = 'airi-card-package'

const ZIP_MODEL_EXT: Partial<Record<DisplayModelFormat, string>> = {
  [DisplayModelFormat.VRM]: 'vrm',
  [DisplayModelFormat.Live2dZip]: 'zip',
  [DisplayModelFormat.SpineZip]: 'zip',
}

type ZipModelRef
  = | { file: File, name: string, format: DisplayModelFormat, ext: string }
    | { skipped: 'mmd' | 'unsupported' | 'unavailable' }
    | null

/**
 * Generates a clean fallback avatar data URL for UI preview rendering.
 */
export function generateFallbackAvatarDataUrl(name: string): string {
  if (typeof document === 'undefined')
    return ''

  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return ''

  // Stylized violet-to-pink gradient background
  const grad = ctx.createLinearGradient(0, 0, 512, 512)
  grad.addColorStop(0, '#6366f1')
  grad.addColorStop(1, '#ec4899')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 512)

  // Character Initial
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 220px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText((name[0] || 'A').toUpperCase(), 256, 266)

  return canvas.toDataURL('image/png')
}

export function useCardExport() {
  const cardStore = useAiriCardStore()
  const displayModelsStore = useDisplayModelsStore()
  const backgroundStore = useBackgroundStore()
  const speechStore = useSpeechStore()
  const stageModelStore = useSettingsStageModel()
  const dataMaintenance = useDataMaintenance()
  const { stageModelSelected } = storeToRefs(stageModelStore)

  /**
   * Collects virtual-audio-studio voice IDs referenced by the card's speech
   * module and visual-asset manifestations.
   */
  function collectVirtualVoiceIds(card: AiriCard): Set<string> {
    const voiceIds = new Set<string>()
    const speechConfig = (card as any).extensions?.airi?.modules?.speech
    if (speechConfig && speechConfig.provider === 'virtual-audio-studio' && speechConfig.voice_id) {
      voiceIds.add(speechConfig.voice_id)
    }
    const assets = (card as any).extensions?.airi?.visual_assets
    if (assets) {
      for (const key of Object.keys(assets)) {
        const concept = assets[key] as any
        if (concept.speech && concept.speech.provider === 'virtual-audio-studio' && concept.speech.voice_id) {
          voiceIds.add(concept.speech.voice_id)
        }
      }
    }
    return voiceIds
  }

  /**
   * Enriches card metadata with preferred background Data URL and virtual voice profiles.
   */
  async function getCardWithExportedBackground(cardId: string): Promise<AiriCard | undefined> {
    const originalCard = cardStore.getCard(cardId)
    if (!originalCard)
      return undefined

    const card = JSON.parse(JSON.stringify(originalCard)) as AiriCard

    // Collect and append voice profiles referencing virtual-audio-studio
    const voiceIds = collectVirtualVoiceIds(card)

    const profiles: any[] = []
    for (const id of voiceIds) {
      const profile = speechStore.savedVoiceProfiles.find(p => p.id === id)
      if (profile) {
        profiles.push(JSON.parse(JSON.stringify(profile)))
      }
    }

    if (profiles.length > 0) {
      if (!card.extensions.airi) {
        card.extensions.airi = {} as any
      }
      card.extensions.airi.voice_profiles = profiles
    }

    // Pack custom stickers localforage blobs into dataUrls for export portability
    const stickers = card.extensions?.airi?.stickers
    if (stickers && Object.keys(stickers).length > 0) {
      const enrichedStickers: Record<string, CardCustomSticker> = {}
      for (const [id, meta] of Object.entries(stickers)) {
        enrichedStickers[id] = { ...meta }
        try {
          const blob = await localforage.getItem<Blob>(`sticker-data-${id}`)
          if (blob) {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = reject
              reader.readAsDataURL(blob)
            })
            enrichedStickers[id].dataUrl = dataUrl
          }
        }
        catch (err) {
          console.warn(`[useCardExport] Failed to serialize sticker blob for "${id}":`, err)
        }
      }
      if (!card.extensions.airi) {
        card.extensions.airi = {} as any
      }
      card.extensions.airi.stickers = enrichedStickers
    }

    const activeBackgroundId = card.extensions?.airi?.modules?.activeBackgroundId
    if (!activeBackgroundId || activeBackgroundId === 'none')
      return card

    const exportBackground = backgroundStore.entries.get(activeBackgroundId)
    if (!exportBackground)
      return card

    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        resolve({
          ...card,
          extensions: {
            ...card.extensions,
            airi: {
              ...card.extensions?.airi,
              modules: {
                ...card.extensions?.airi?.modules,
                activeBackgroundId,
                preferredBackgroundId: activeBackgroundId,
                preferredBackgroundName: exportBackground.title || exportBackground.id,
                preferredBackgroundDataUrl: e.target?.result as string,
              },
            },
          },
        } as any)
      }
      reader.onerror = () => resolve(card)
      reader.readAsDataURL(exportBackground.blob)
    })
  }

  /**
   * Builds SillyTavern / CCv2 compatible data structure with AIRI probe.
   */
  function buildCharaCardV2(card: AiriCard, options?: PngExportOptions) {
    const exportedExtensions = {
      ...card.extensions,
      airi: {
        ...card.extensions?.airi,
        sillytavernCompatibilityProbe: {
          exportedBy: 'Project AIRI',
          probe: 'extensions-airi-ok',
          version: 1,
        },
      },
    }

    return {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: card.name || '',
        description: card.description || '',
        personality: card.personality || '',
        scenario: card.scenario || '',
        first_mes: card.greetings?.[0] || '',
        mes_example: Array.isArray(card.messageExample)
          ? card.messageExample
              .map(example => Array.isArray(example) ? example.join('\n') : String(example))
              .join('\n<START>\n')
          : '',
        creator_notes: options?.omitNotes ? '' : (card.notes || ''),
        system_prompt: card.systemPrompt || '',
        post_history_instructions: card.postHistoryInstructions || '',
        alternate_greetings: card.greetings?.slice(1) || [],
        tags: card.tags || [],
        creator: card.creator || '',
        character_version: card.version || '',
        extensions: exportedExtensions,
        x_airi_probe: 'top-level-data-ok',
      },
    }
  }

  /**
   * Helper to trigger native browser file download.
   */
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  function utf8ToBase64(input: string) {
    return btoa(unescape(encodeURIComponent(input)))
  }

  const crc32Table = (() => {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let c = i
      for (let j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      }
      table[i] = c >>> 0
    }
    return table
  })()

  function crc32(data: Uint8Array) {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < data.length; i += 1) {
      crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  function concatUint8Arrays(parts: Uint8Array[]) {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const output = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      output.set(part, offset)
      offset += part.length
    }
    return output
  }

  function uint32ToBytes(value: number) {
    return new Uint8Array([
      (value >>> 24) & 0xFF,
      (value >>> 16) & 0xFF,
      (value >>> 8) & 0xFF,
      value & 0xFF,
    ])
  }

  function createPngTextChunk(keyword: string, text: string) {
    const typeBytes = new TextEncoder().encode('tEXt')
    const dataBytes = new TextEncoder().encode(`${keyword}\0${text}`)
    const crcBytes = uint32ToBytes(crc32(concatUint8Arrays([typeBytes, dataBytes])))

    return concatUint8Arrays([
      uint32ToBytes(dataBytes.length),
      typeBytes,
      dataBytes,
      crcBytes,
    ])
  }

  function injectPngTextChunk(pngBytes: Uint8Array, keyword: string, text: string) {
    const iendOffset = pngBytes.lastIndexOf(73) // 'I'
    if (iendOffset < 12)
      throw new Error('Invalid PNG payload')

    let insertOffset = -1
    for (let offset = 8; offset < pngBytes.length - 8;) {
      const length = (
        (pngBytes[offset] << 24)
        | (pngBytes[offset + 1] << 16)
        | (pngBytes[offset + 2] << 8)
        | pngBytes[offset + 3]
      ) >>> 0
      const type = String.fromCharCode(
        pngBytes[offset + 4],
        pngBytes[offset + 5],
        pngBytes[offset + 6],
        pngBytes[offset + 7],
      )
      if (type === 'IEND') {
        insertOffset = offset
        break
      }
      offset += 12 + length
    }

    if (insertOffset === -1)
      throw new Error('PNG is missing IEND chunk')

    const chunk = createPngTextChunk(keyword, text)
    return concatUint8Arrays([
      pngBytes.slice(0, insertOffset),
      chunk,
      pngBytes.slice(insertOffset),
    ])
  }

  function loadImageElement(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`))
      image.src = src
    })
  }

  /**
   * Composites an image preview onto the standard AIRI Glass Frame (925x1436).
   */
  async function composeCardExportPng(previewImage: string) {
    const [preview, frame] = await Promise.all([
      loadImageElement(previewImage),
      loadImageElement(cardExportFrameUrl),
    ])

    const canvas = document.createElement('canvas')
    canvas.width = CARD_EXPORT_FRAME.width
    canvas.height = CARD_EXPORT_FRAME.height

    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('Failed to create export canvas')

    // Fit preview to portrait window height and crop horizontal sides centered
    const scale = Math.max(
      CARD_EXPORT_FRAME.innerWidth / preview.naturalWidth,
      CARD_EXPORT_FRAME.innerHeight / preview.naturalHeight,
    )
    const drawWidth = preview.naturalWidth * scale
    const drawHeight = preview.naturalHeight * scale
    const drawX = CARD_EXPORT_FRAME.innerX + (CARD_EXPORT_FRAME.innerWidth - drawWidth) / 2
    const drawY = CARD_EXPORT_FRAME.innerY + (CARD_EXPORT_FRAME.innerHeight - drawHeight) / 2

    context.save()
    context.beginPath()
    context.rect(
      CARD_EXPORT_FRAME.innerX,
      CARD_EXPORT_FRAME.innerY,
      CARD_EXPORT_FRAME.innerWidth,
      CARD_EXPORT_FRAME.innerHeight,
    )
    context.clip()
    context.drawImage(
      preview,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    )
    context.restore()

    context.drawImage(frame, 0, 0, CARD_EXPORT_FRAME.width, CARD_EXPORT_FRAME.height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value)
          resolve(value)
        else
          reject(new Error('Failed to encode composed PNG'))
      }, 'image/png')
    })

    return new Uint8Array(await blob.arrayBuffer())
  }

  /**
   * Generates a clean fallback avatar canvas if no image or preview model is available.
   */
  async function generateFallbackAvatarPng(name: string): Promise<Uint8Array> {
    const dataUrl = generateFallbackAvatarDataUrl(name)
    const res = await fetch(dataUrl)
    return new Uint8Array(await res.arrayBuffer())
  }

  /**
   * Exports an AIRI card as JSON (.json) honoring pretty-print and episodic memories.
   */
  async function exportCardJson(cardId: string, options: JsonExportOptions = {}) {
    const card = await getCardWithExportedBackground(cardId)
    if (!card)
      throw new Error(`Card with id ${cardId} not found`)

    // Resolve episodic memories if requested — full records via the shared
    // vault helper (index metas alone carry no transcript content).
    let sessions: any[] | undefined
    if (options.includeMemories) {
      const sessionsExport = await dataMaintenance.exportSessionsForCharacter(cardId)
      const records = Object.values(sessionsExport.sessions || {})
      if (records.length > 0)
        sessions = records
    }

    const payload: Record<string, any> = {
      format: 'airi-card',
      version: 1,
      exportedAt: new Date().toISOString(),
      card,
      ...(sessions && sessions.length > 0 ? { sessions } : {}),
    }

    const indent = options.pretty ? 2 : 0
    const blob = new Blob([`${JSON.stringify(payload, null, indent)}\n`], { type: 'application/json' })
    const safeName = (card.name || 'airi-card').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    downloadBlob(blob, `${safeName}.json`)
  }

  /**
   * Exports an AIRI card embedded in a portable PNG with SillyTavern chara chunk.
   */
  async function exportCardPng(cardId: string, options: PngExportOptions = {}) {
    const card = await getCardWithExportedBackground(cardId)
    if (!card)
      throw new Error(`Card with id ${cardId} not found`)

    const displayModelId = cardStore.getCardDisplayModelId(cardId)
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    const previewModel = displayModelId ? await displayModelsStore.getDisplayModel(displayModelId) : null

    let previewImage: string | null = options.imageSourceUrl ?? null

    // If no specific imageSourceUrl was selected, resolve dynamically
    if (previewImage === null) {
      previewImage = previewModel?.previewImage || (cardId ? getLatestSelfie(cardId) : null)

      // If active on stage, take a live snapshot reflecting current outfits/expressions
      if (previewModel && displayModelId === stageModelSelected.value) {
        try {
          const modelInput = previewModel.type === 'file' ? previewModel.file : (previewModel as any).url
          if (previewModel.format === DisplayModelFormat.VRM) {
            const [{ loadVrmModelPreview }, { useModelStore }] = await Promise.all([
              import('@proj-airi/stage-ui-three/utils/vrm-preview'),
              import('@proj-airi/stage-ui-three'),
            ])
            const modelStore = useModelStore()
            const liveSnapshot = await loadVrmModelPreview(modelInput, modelStore.activeExpressions)
            if (liveSnapshot)
              previewImage = liveSnapshot
          }
          else if (previewModel.format === DisplayModelFormat.Live2dZip) {
            const [{ loadLive2DModelPreview }, { useModelStore }] = await Promise.all([
              import('@proj-airi/stage-ui-live2d/utils/live2d-preview'),
              import('@proj-airi/stage-ui-three'),
            ])
            const modelStore = useModelStore()
            const liveSnapshot = await loadLive2DModelPreview(modelInput, modelStore.activeExpressions)
            if (liveSnapshot)
              previewImage = liveSnapshot
          }
        }
        catch (err) {
          console.warn('[useCardExport] Failed to take live snapshot, using static preview:', err)
        }
      }
    }

    // Determine raw image bytes
    let rawPngBytes: Uint8Array
    if (previewImage) {
      if (options.framed !== false) {
        rawPngBytes = await composeCardExportPng(previewImage)
      }
      else {
        // Unframed: fetch the preview image bytes directly
        const res = await fetch(previewImage)
        rawPngBytes = new Uint8Array(await res.arrayBuffer())
      }
    }
    else {
      // Fallback: generate high-contrast avatar image
      rawPngBytes = await generateFallbackAvatarPng(card.name || 'A')
      if (options.framed !== false) {
        const fallbackBlob = new Blob([rawPngBytes.buffer as ArrayBuffer], { type: 'image/png' })
        const fallbackUrl = URL.createObjectURL(fallbackBlob)
        try {
          rawPngBytes = await composeCardExportPng(fallbackUrl)
        }
        finally {
          URL.revokeObjectURL(fallbackUrl)
        }
      }
    }

    // Inject SillyTavern chara chunk
    const metadata = utf8ToBase64(JSON.stringify(buildCharaCardV2(card, options)))
    const encodedPng = injectPngTextChunk(rawPngBytes, 'chara', metadata)

    const blob = new Blob([encodedPng.buffer as ArrayBuffer], { type: 'image/png' })
    const safeName = (card.name || 'airi-card').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    downloadBlob(blob, `${safeName}.png`)
  }

  /**
   * Upstream-equivalent whitelist for v1: provider/model strings only.
   * Acting, agents, outfits, voice profiles, visual assets, and background
   * bindings never ship in v1.
   */
  function sanitizeAiriForV1(airi: any) {
    const modules = airi?.modules || {}
    return {
      modules: {
        ...(modules.consciousness ? { consciousness: { provider: modules.consciousness.provider, model: modules.consciousness.model } } : {}),
        ...(modules.speech ? { speech: { provider: modules.speech.provider, model: modules.speech.model, voice_id: modules.speech.voice_id } } : {}),
      },
    }
  }

  /**
   * Resolves the card's display model binary for ZIP bundling.
   * MMD split-storage (pmx + separate `${id}-textures`) can't be rebuilt into
   * a valid archive, so MMD exports metadata only.
   */
  async function resolveModelForZip(modelId: string | null | undefined): Promise<ZipModelRef> {
    if (!modelId || modelId === 'none')
      return null

    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    const model = await displayModelsStore.getDisplayModel(modelId) as any
    if (!model)
      return null

    if (model.format === DisplayModelFormat.PMXZip
      || model.format === DisplayModelFormat.PMXDirectory
      || model.format === DisplayModelFormat.PMD) {
      return { skipped: 'mmd' }
    }

    const ext = ZIP_MODEL_EXT[model.format as DisplayModelFormat]
    if (!ext) {
      return { skipped: 'unsupported' }
    }

    if (model.type === 'file' && model.file) {
      // NOTICE: unwrap the Vue reactive proxy or the stored blob corrupts on read.
      const file = toRaw(model.file) as File
      return { file, name: model.name || 'model', format: model.format as DisplayModelFormat, ext }
    }

    if (model.type === 'url' && model.url) {
      const res = await fetch(model.url)
      const blob = await res.blob()
      const name = model.name || 'model'
      return { file: new File([blob], name), name, format: model.format as DisplayModelFormat, ext }
    }

    return { skipped: 'unavailable' }
  }

  /**
   * Resolves the card's active scene background blob (builtin URLs are fetched to blob).
   */
  async function resolveBackgroundForZip(card: AiriCard): Promise<{ blob: Blob, title: string } | null> {
    const bgId = (card as any).extensions?.airi?.modules?.activeBackgroundId
    if (!bgId || bgId === 'none')
      return null

    const entry = backgroundStore.entries.get(bgId)
    if (!entry)
      return null

    const title = entry.title || entry.id
    if (entry.blob)
      return { blob: entry.blob, title }

    const url = (entry as any).url
    if (!url)
      return null

    const res = await fetch(url)
    return { blob: await res.blob(), title }
  }

  function buildZipReadme(input: {
    name: string
    flavor: 'v2' | 'v1'
    modelName?: string
    modelPath?: string
    backgroundTitle?: string
    voiceCount: number
    sessionCount: number
    messageCount: number
  }) {
    const lines = [
      `# Character: ${input.name}`,
      '',
      `This character card package was created using AIRI (${input.flavor === 'v2' ? 'Extended v2' : 'Upstream-compatible v1'}).`,
      '',
      '## Compatibility',
      `- **AIRI Fork (dasilva333)**: ${input.flavor === 'v2' ? 'Full support for multi-model loading, custom acting prompts, voice profiles, visual manifestations, and memories.' : 'Core CCv3 persona fields and primary display model.'}`,
      `- **AIRI Upstream (moeru-ai/airi)**: ${input.flavor === 'v1' ? 'Compatible (primary display model and core CCv3 persona fields imported).' : 'v2 packages are fork-only; import `card.json` directly for the base persona.'}`,
      '- **SillyTavern / CCv3 Readers**: Import `card.json` directly.',
      '',
      '## Assets & Credits',
    ]
    if (input.modelPath) {
      lines.push(`- **Primary Model**: \`${input.modelPath}\`${input.modelName && input.modelName !== input.modelPath ? ` (${input.modelName})` : ''} — only share if the model license permits redistribution.`)
    }
    if (input.backgroundTitle)
      lines.push(`- **Background**: \`background.png\` (${input.backgroundTitle})`)
    if (input.voiceCount > 0)
      lines.push(`- **Voice Profiles**: ${input.voiceCount} embedded virtual-audio-studio profile(s) under \`voices/\``)
    if (input.sessionCount > 0)
      lines.push(`- **Memories**: ${input.sessionCount} chat session(s), ${input.messageCount} message(s) under \`memories/\``)
    return `${lines.join('\n')}\n`
  }

  /**
   * Exports an AIRI card as a ZIP package (v2 Extended or v1 Upstream-compatible).
   * Binaries ship as files — card.json stays free of inline base64 bloat.
   */
  async function exportCardZip(cardId: string, options: ZipExportOptions = {}) {
    const {
      flavor = 'v2',
      includeModels = true,
      includeBackground = true,
      includeVoiceProfiles = true,
      includeCover = true,
      includeMemories = false,
      generateReadme = true,
      coverImageUrl = null,
    } = options
    const isV2 = flavor === 'v2'

    const enriched = await getCardWithExportedBackground(cardId)
    if (!enriched)
      throw new Error(`Card with id ${cardId} not found`)
    const safeName = (enriched.name || 'airi-card').toLowerCase().replace(/[^a-z0-9_-]/g, '_')

    // Clean card.json: background Data URLs and inline voice profiles ship as
    // separate files instead (v1 additionally drops all non-whitelisted airi blocks).
    const clean: any = JSON.parse(JSON.stringify(enriched))
    const preferredBackgroundName = clean.extensions?.airi?.modules?.preferredBackgroundName
    if (clean.extensions?.airi?.modules)
      delete clean.extensions.airi.modules.preferredBackgroundDataUrl
    if (clean.extensions?.airi)
      delete clean.extensions.airi.voice_profiles

    let cardJson: any
    if (isV2) {
      cardJson = exportToJSON(clean)
    }
    else {
      const { airi, ...restExtensions } = clean.extensions || {}
      cardJson = exportToJSON({ ...clean, extensions: { ...restExtensions, airi: sanitizeAiriForV1(airi) } })
    }

    // --- Gather assets (sizes first for the 1 GB pre-flight estimate) ---
    const model = includeModels
      ? await resolveModelForZip(cardStore.getCardDisplayModelId(cardId))
      : null
    if (model && 'skipped' in model && model.skipped === 'mmd') {
      console.warn('[useCardExport] MMD model bundling is unsupported, exporting metadata only')
    }

    let background: { blob: Blob, title: string } | null = null
    if (isV2 && includeBackground) {
      try {
        background = await resolveBackgroundForZip(enriched)
      }
      catch (err) {
        console.warn('[useCardExport] Background resolution failed, skipping background.png:', err)
      }
    }

    const voiceProfiles: any[] = []
    if (isV2 && includeVoiceProfiles) {
      for (const id of collectVirtualVoiceIds(enriched)) {
        const profile = speechStore.savedVoiceProfiles.find(p => p.id === id)
        if (profile)
          voiceProfiles.push(JSON.parse(JSON.stringify(profile)))
      }
    }

    let coverBytes: Uint8Array | null = null
    if (isV2 && includeCover && coverImageUrl) {
      try {
        coverBytes = await composeCardExportPng(coverImageUrl)
      }
      catch (err) {
        console.warn('[useCardExport] Cover composition failed, skipping cover.png:', err)
      }
    }

    let sessionsExport: any = null
    let memoryExport: any = null
    if (isV2 && includeMemories) {
      sessionsExport = await dataMaintenance.exportSessionsForCharacter(cardId)
      memoryExport = await dataMaintenance.exportMemoryForCharacter(cardId)
    }

    const cardJsonText = JSON.stringify(cardJson, null, 2)
    const voicesTexts = voiceProfiles.map((p, i) => ({
      filename: `${((p.id || `voice-${i + 1}`) as string).toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`,
      text: JSON.stringify(p, null, 2),
    }))
    const sessionsText = sessionsExport ? JSON.stringify(sessionsExport, null, 2) : null
    const memoryText = memoryExport ? JSON.stringify(memoryExport, null, 2) : null

    const encoder = new TextEncoder()
    const estimated = (model && 'file' in model ? model.file.size : 0)
      + (background?.blob.size ?? 0)
      + (coverBytes?.length ?? 0)
      + encoder.encode(cardJsonText).length
      + voicesTexts.reduce((sum, v) => sum + encoder.encode(v.text).length, 0)
      + (sessionsText ? encoder.encode(sessionsText).length : 0)
      + (memoryText ? encoder.encode(memoryText).length : 0)
    if (estimated > ZIP_SIZE_CAP_BYTES) {
      throw new Error(`Package would be ~${(estimated / 1024 ** 3).toFixed(2)} GB, over the 1 GB archive cap — deselect assets to proceed`)
    }

    // --- Manifest ---
    const createdAt = new Date().toISOString()
    const modelFileName = model && 'file' in model
      ? `${(model.name || 'model').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'model'}.${model.ext}`
      : null
    let manifest: any
    if (!isV2) {
      manifest = {
        format: ZIP_MANIFEST_V1_FORMAT,
        version: 1,
        createdAt,
        card: { path: 'card.json', spec: 'chara_card_v3' },
      }
      if (model && 'file' in model) {
        manifest.resources = {
          displayModel: { path: `models/body-model.${model.ext}`, format: model.format, name: model.file.name },
        }
      }
    }
    else {
      manifest = {
        format: ZIP_MANIFEST_V2_FORMAT,
        version: 2,
        generator: 'AIRI Fork (dasilva333)',
        createdAt,
        card: { path: 'card.json', spec: 'chara_card_v3' },
        resources: {
          ...(coverBytes ? { cardImage: { path: 'cover.png' } } : {}),
          ...(background ? { backgroundImage: { path: 'background.png', title: background.title } } : {}),
          displayModels: model && 'file' in model && modelFileName
            ? [{ id: 'primary', format: model.format, name: model.file.name, path: `models/${modelFileName}`, role: 'base' }]
            : [],
          voiceProfiles: voicesTexts.map((v, i) => ({ id: voiceProfiles[i].id || `voice-${i + 1}`, path: `voices/${v.filename}` })),
          ...(sessionsExport ? { memories: { chatSessions: { path: 'memories/chat_sessions.json' }, memory: { path: 'memories/memory.json' } } } : {}),
        },
      }
    }

    // --- Assemble ---
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))
    zip.file('card.json', cardJsonText)
    if (model && 'file' in model) {
      const modelPath = !isV2 ? `models/body-model.${model.ext}` : `models/${modelFileName}`
      zip.file(modelPath, await model.file.arrayBuffer())
    }
    if (background)
      zip.file('background.png', await background.blob.arrayBuffer())
    if (coverBytes)
      zip.file('cover.png', coverBytes)
    for (const v of voicesTexts)
      zip.file(`voices/${v.filename}`, v.text)
    if (sessionsText)
      zip.file('memories/chat_sessions.json', sessionsText)
    if (memoryText)
      zip.file('memories/memory.json', memoryText)
    if (isV2 && generateReadme) {
      const records = sessionsExport ? Object.values(sessionsExport.sessions || {}) as any[] : []
      const messageCount = records.reduce((sum, r) => sum + (r.messages?.length ?? 0), 0)
      zip.file('README.md', buildZipReadme({
        name: enriched.name || 'airi-card',
        flavor,
        modelName: model && 'file' in model ? model.name : undefined,
        modelPath: model && 'file' in model ? `models/${!isV2 ? `body-model.${model.ext}` : modelFileName}` : undefined,
        backgroundTitle: background?.title ?? preferredBackgroundName,
        voiceCount: voiceProfiles.length,
        sessionCount: records.length,
        messageCount,
      }))
    }

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })
    downloadBlob(blob, `${safeName}_card.zip`)
  }

  return {
    getCardWithExportedBackground,
    buildCharaCardV2,
    composeCardExportPng,
    generateFallbackAvatarDataUrl,
    exportCardJson,
    exportCardPng,
    exportCardZip,
  }
}
