import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'

import { getLatestSelfie } from '@proj-airi/stage-ui/libs/character-media-resolver'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { storeToRefs } from 'pinia'

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

export function useCardExport() {
  const cardStore = useAiriCardStore()
  const displayModelsStore = useDisplayModelsStore()
  const backgroundStore = useBackgroundStore()
  const speechStore = useSpeechStore()
  const chatSessionStore = useChatSessionStore()
  const stageModelStore = useSettingsStageModel()
  const { stageModelSelected } = storeToRefs(stageModelStore)

  /**
   * Enriches card metadata with preferred background Data URL and virtual voice profiles.
   */
  async function getCardWithExportedBackground(cardId: string): Promise<AiriCard | undefined> {
    const originalCard = cardStore.getCard(cardId)
    if (!originalCard)
      return undefined

    const card = JSON.parse(JSON.stringify(originalCard)) as AiriCard

    // Collect and append voice profiles referencing virtual-audio-studio
    const voiceIds = new Set<string>()
    const speechConfig = card.extensions?.airi?.modules?.speech
    if (speechConfig && speechConfig.provider === 'virtual-audio-studio' && speechConfig.voice_id) {
      voiceIds.add(speechConfig.voice_id)
    }
    const assets = card.extensions?.airi?.visual_assets
    if (assets) {
      for (const key of Object.keys(assets)) {
        const concept = assets[key] as any
        if (concept.speech && concept.speech.provider === 'virtual-audio-studio' && concept.speech.voice_id) {
          voiceIds.add(concept.speech.voice_id)
        }
      }
    }

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

    // Fit preview to portrait window width, anchor top, crop bottom
    const scale = CARD_EXPORT_FRAME.innerWidth / preview.naturalWidth
    const drawWidth = CARD_EXPORT_FRAME.innerWidth
    const drawHeight = preview.naturalHeight * scale

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
      CARD_EXPORT_FRAME.innerX,
      CARD_EXPORT_FRAME.innerY,
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
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (!ctx)
      throw new Error('Failed to create fallback canvas')

    // Gradient background
    const grad = ctx.createLinearGradient(0, 0, 512, 512)
    grad.addColorStop(0, '#6366f1')
    grad.addColorStop(1, '#ec4899')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 512, 512)

    // Character Initial
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 200px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((name[0] || 'A').toUpperCase(), 256, 256)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Fallback canvas export failed')), 'image/png')
    })
    return new Uint8Array(await blob.arrayBuffer())
  }

  /**
   * Exports an AIRI card as JSON (.json) honoring pretty-print and episodic memories.
   */
  async function exportCardJson(cardId: string, options: JsonExportOptions = {}) {
    const card = await getCardWithExportedBackground(cardId)
    if (!card)
      throw new Error(`Card with id ${cardId} not found`)

    // Resolve episodic memories if requested
    let sessions: any[] | undefined
    if (options.includeMemories) {
      const charIndex = chatSessionStore.getCharacterIndex(cardId)
      if (charIndex?.sessions) {
        sessions = Object.values(charIndex.sessions)
      }
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

  return {
    getCardWithExportedBackground,
    buildCharaCardV2,
    composeCardExportPng,
    exportCardJson,
    exportCardPng,
  }
}
