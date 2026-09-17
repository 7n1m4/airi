import JSZip from 'jszip'

export interface VaultManifest {
  schemaVersion: number
  app: string
  createdAt: string
  domains: string[]
  stats?: Record<string, any>
}

export interface BackgroundArchiveItem {
  metadata: {
    id: string
    title: string
    type: 'builtin' | 'scene' | 'journal' | 'selfie'
    characterId: string | null
    createdAt: number
    prompt?: string
    remixId?: string
    universeId?: string
    sessionId?: string
    filename?: string
    mimeType?: string
  }
  blob: Blob
}

export interface ArchivePayload {
  characters?: [string, any][]
  chatSessions?: any
  memory?: any
  providers?: Record<string, any>
  settings?: Record<string, any>
  backgrounds?: BackgroundArchiveItem[]
}

export interface ExtractedVaultPayload {
  manifest: VaultManifest
  characters?: [string, any][]
  chatSessions?: any
  memory?: any
  providers?: Record<string, any>
  settings?: Record<string, any>
  backgrounds?: BackgroundArchiveItem[]
}

function getExtensionForMimeType(mimeType?: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/avif':
      return '.avif'
    default:
      return '.bin'
  }
}

/**
 * Creates a standard ZIP archive containing human-readable JSONs per domain
 * and raw binary assets under backgrounds/.
 */
export async function createDataVaultArchive(payload: ArchivePayload): Promise<Blob> {
  const zip = new JSZip()
  const domains: string[] = []
  const stats: Record<string, any> = {}

  if (payload.characters && payload.characters.length > 0) {
    domains.push('characters')
    stats.charactersCount = payload.characters.length
    zip.file('characters.json', JSON.stringify({
      format: 'airi-characters:v1',
      timestamp: Date.now(),
      cards: payload.characters,
    }, null, 2))
  }

  if (payload.chatSessions) {
    domains.push('chat-sessions')
    const sessionCount = Object.keys(payload.chatSessions.sessions || {}).length
    stats.sessionsCount = sessionCount
    zip.file('chat-sessions.json', JSON.stringify(payload.chatSessions, null, 2))
  }

  if (payload.memory) {
    domains.push('memory')
    stats.stmmBlocksCount = payload.memory.shortTermBlocks?.length || 0
    stats.journalEntriesCount = payload.memory.journalEntries?.length || 0
    stats.lifetimeCount = Object.keys(payload.memory.lifetimeArtifacts || {}).length
    stats.echoChipsCount = payload.memory.echoChips?.length || 0
    zip.file('memory.json', JSON.stringify(payload.memory, null, 2))
  }

  if (payload.providers && Object.keys(payload.providers).length > 0) {
    domains.push('providers')
    stats.providersCount = Object.keys(payload.providers).length
    zip.file('providers.json', JSON.stringify(payload.providers, null, 2))
  }

  if (payload.settings && Object.keys(payload.settings).length > 0) {
    domains.push('settings')
    zip.file('settings.json', JSON.stringify(payload.settings, null, 2))
  }

  if (payload.backgrounds && payload.backgrounds.length > 0) {
    domains.push('backgrounds')
    stats.backgroundsCount = payload.backgrounds.length

    const bgMetadataList: any[] = []
    for (const bg of payload.backgrounds) {
      const ext = getExtensionForMimeType(bg.blob.type)
      const filename = `${bg.metadata.id}${ext}`
      bgMetadataList.push({
        ...bg.metadata,
        filename,
        mimeType: bg.blob.type,
      })
      const buffer = await bg.blob.arrayBuffer()
      zip.file(`backgrounds/${filename}`, buffer)
    }

    zip.file('backgrounds/metadata.json', JSON.stringify(bgMetadataList, null, 2))
  }

  const manifest: VaultManifest = {
    schemaVersion: 1,
    app: 'airi',
    createdAt: new Date().toISOString(),
    domains,
    stats,
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
  })
}

/**
 * Extracts a data vault ZIP archive and parses domain JSONs and binary blobs.
 */
export async function extractDataVaultArchive(zipData: Blob | ArrayBuffer): Promise<ExtractedVaultPayload> {
  let buffer: ArrayBuffer
  if (zipData instanceof ArrayBuffer) {
    buffer = zipData
  }
  else if (typeof (zipData as any)?.arrayBuffer === 'function') {
    buffer = await (zipData as any).arrayBuffer()
  }
  else {
    buffer = zipData as any
  }

  const zip = await JSZip.loadAsync(buffer)

  let manifest: VaultManifest = {
    schemaVersion: 1,
    app: 'airi',
    createdAt: new Date().toISOString(),
    domains: [],
  }

  const manifestFile = zip.file('manifest.json')
  if (manifestFile) {
    try {
      const text = await manifestFile.async('text')
      manifest = JSON.parse(text)
    }
    catch (e) {
      console.warn('Failed to parse manifest.json from ZIP archive', e)
    }
  }

  const result: ExtractedVaultPayload = {
    manifest,
  }

  // 1. Characters
  const charFile = zip.file('characters.json')
  if (charFile) {
    try {
      const text = await charFile.async('text')
      const parsed = JSON.parse(text)
      result.characters = Array.isArray(parsed.cards) ? parsed.cards : parsed
      if (!manifest.domains.includes('characters')) {
        manifest.domains.push('characters')
      }
    }
    catch (e) {
      console.error('Failed to parse characters.json from ZIP', e)
    }
  }

  // 2. Chat Sessions
  const chatFile = zip.file('chat-sessions.json')
  if (chatFile) {
    try {
      const text = await chatFile.async('text')
      result.chatSessions = JSON.parse(text)
      if (!manifest.domains.includes('chat-sessions')) {
        manifest.domains.push('chat-sessions')
      }
    }
    catch (e) {
      console.error('Failed to parse chat-sessions.json from ZIP', e)
    }
  }

  // 3. Memory
  const memFile = zip.file('memory.json')
  if (memFile) {
    try {
      const text = await memFile.async('text')
      result.memory = JSON.parse(text)
      if (!manifest.domains.includes('memory')) {
        manifest.domains.push('memory')
      }
    }
    catch (e) {
      console.error('Failed to parse memory.json from ZIP', e)
    }
  }

  // 4. Providers
  const provFile = zip.file('providers.json')
  if (provFile) {
    try {
      const text = await provFile.async('text')
      result.providers = JSON.parse(text)
      if (!manifest.domains.includes('providers')) {
        manifest.domains.push('providers')
      }
    }
    catch (e) {
      console.error('Failed to parse providers.json from ZIP', e)
    }
  }

  // 5. Settings
  const settFile = zip.file('settings.json')
  if (settFile) {
    try {
      const text = await settFile.async('text')
      result.settings = JSON.parse(text)
      if (!manifest.domains.includes('settings')) {
        manifest.domains.push('settings')
      }
    }
    catch (e) {
      console.error('Failed to parse settings.json from ZIP', e)
    }
  }

  // 6. Backgrounds
  const bgMetaFile = zip.file('backgrounds/metadata.json')
  if (bgMetaFile) {
    try {
      const text = await bgMetaFile.async('text')
      const bgMetas = JSON.parse(text)
      if (Array.isArray(bgMetas)) {
        const bgItems: BackgroundArchiveItem[] = []
        for (const meta of bgMetas) {
          const filename = meta.filename || `${meta.id}.png`
          const imgFile = zip.file(`backgrounds/${filename}`)
          if (imgFile) {
            const rawBytes = await imgFile.async('arraybuffer')
            const blob = new Blob([rawBytes], { type: meta.mimeType || 'image/png' })
            bgItems.push({
              metadata: meta,
              blob,
            })
          }
        }
        result.backgrounds = bgItems
        if (!manifest.domains.includes('backgrounds')) {
          manifest.domains.push('backgrounds')
        }
      }
    }
    catch (e) {
      console.error('Failed to parse backgrounds from ZIP', e)
    }
  }

  return result
}
