import localforage from 'localforage'

import { useBackgroundStore } from '../stores/background'
import { DisplayModelFormat, useDisplayModelsStore } from '../stores/display-models'

// Global memory caches to avoid duplicate zip parsing or canvas computation.
//
// HMR survival: module-scope Maps are wiped on every Vite re-evaluation,
// forcing a full re-parse of every model zip + re-decode of every image across
// the card grid (GB-scale transient ArrayBuffers per reload — the card-hub
// reboot signature). The underlying Map OBJECTS live in import.meta.hot.data
// so fresh generations adopt them; each evaluation still exports its own
// binding (same object). No-op in production (import.meta.hot is undefined).
interface MediaResolverHotData {
  iconCache?: Map<string, string>
  colorCache?: Map<string, { light: string, dark: string }>
  iconPending?: Map<string, Promise<string | null>>
}

function getHotMaps(): {
  iconCache: Map<string, string>
  colorCache: Map<string, { light: string, dark: string }>
  iconPending: Map<string, Promise<string | null>>
} {
  const hotData = import.meta.hot?.data as { mediaResolver?: MediaResolverHotData } | undefined
  if (hotData) {
    hotData.mediaResolver ??= {}
    const shared = hotData.mediaResolver
    shared.iconCache ??= new Map<string, string>()
    shared.colorCache ??= new Map<string, { light: string, dark: string }>()
    shared.iconPending ??= new Map<string, Promise<string | null>>()
    return shared as Required<MediaResolverHotData>
  }
  return {
    iconCache: new Map<string, string>(),
    colorCache: new Map<string, { light: string, dark: string }>(),
    iconPending: new Map<string, Promise<string | null>>(),
  }
}

const sharedMaps = getHotMaps()
export const iconCache = sharedMaps.iconCache
export const colorCache = sharedMaps.colorCache
const iconPending = sharedMaps.iconPending

// Strict global concurrency cap for zip icon extraction. Each extraction holds
// the FULL model binary + an inflated JSZip copy + a base64 icon in RAM, so
// unbounded parallel extraction across a card grid is a multi-GB spike.
const ICON_EXTRACTION_CONCURRENCY = 2
let iconInFlight = 0
const iconWaiters: Array<() => void> = []

function pumpIconQueue(): void {
  while (iconInFlight < ICON_EXTRACTION_CONCURRENCY && iconWaiters.length > 0) {
    const release = iconWaiters.shift()
    if (release) {
      iconInFlight++
      release()
    }
  }
}

function acquireIconSlot(): Promise<void> {
  if (iconInFlight < ICON_EXTRACTION_CONCURRENCY) {
    iconInFlight++
    return Promise.resolve()
  }
  // NOTE: pumpIconQueue() owns the in-flight increment on dispatch — the
  // waiter only resolves (counting here too would leak slots and stall).
  return new Promise<void>((resolve) => {
    iconWaiters.push(resolve)
  })
}

function releaseIconSlot(): void {
  iconInFlight = Math.max(0, iconInFlight - 1)
  pumpIconQueue()
}

// Lazy avatar loads must never inflate warehouse-scale zips: above this size
// the parse cost (full binary + JSZip copy in RAM) outweighs a grid thumbnail.
const ICON_ZIP_MAX_BYTES = 15 * 1024 * 1024

export function getLatestSelfie(cardId: string): string | null {
  try {
    const backgroundStore = useBackgroundStore()
    const entries = backgroundStore.getCharacterJournalEntries(cardId)
    const selfies = entries.filter(e => e.type === 'selfie')
    if (selfies.length === 0)
      return null
    const sorted = [...selfies].sort((a, b) => b.createdAt - a.createdAt)
    return backgroundStore.getBackgroundUrl(sorted[0].id)
  }
  catch {
    return null
  }
}

export async function extractModelIcon(displayModelId: string): Promise<string | null> {
  if (iconCache.has(displayModelId)) {
    return iconCache.get(displayModelId) || null
  }

  // Dedupe: several cards (and HMR generations) can request the same model at
  // once — share one parse instead of inflating the zip N times.
  const pending = iconPending.get(displayModelId)
  if (pending)
    return pending

  const task = (async (): Promise<string | null> => {
    const displayModelsStore = useDisplayModelsStore()
    const model = displayModelsStore.displayModels.find(m => m.id === displayModelId)
    if (!model)
      return null

    // If the model already has authorIcon in metadata, return it directly
    if (model.authorIcon) {
      iconCache.set(displayModelId, model.authorIcon)
      return model.authorIcon
    }

    // Fast skip for non-zip models (VRM, PMD, etc.) which never contain zip icon.png
    if (model.format !== DisplayModelFormat.Live2dZip && model.format !== DisplayModelFormat.SpineZip && model.format !== DisplayModelFormat.PMXZip) {
      iconCache.set(displayModelId, '')
      return null
    }

    await acquireIconSlot()
    // Locals are explicitly released in finally: zipData holds the full binary,
    // zip the inflated copy, fileData the base64 — none may linger per tick.
    let zipData: Blob | File | null = null
    let zip: any = null
    let fileData: string | null = null
    try {
      const fullModel = await displayModelsStore.getDisplayModel(displayModelId)
      if (!fullModel) {
        iconCache.set(displayModelId, '')
        return null
      }

      if (fullModel.type === 'file') {
        zipData = fullModel.file || null
      }
      else if (fullModel.type === 'url') {
        const res = await fetch(fullModel.url)
        zipData = await res.blob()
      }

      // Size guard: never inflate warehouse-scale zips for a grid thumbnail.
      if (zipData && typeof zipData.size === 'number' && zipData.size > ICON_ZIP_MAX_BYTES) {
        console.debug(`[CharacterMediaResolver] Skipping icon extraction for oversized model (${Math.round(zipData.size / 1024 / 1024)}MB > 15MB):`, displayModelId)
        iconCache.set(displayModelId, '')
        return null
      }

      if (zipData) {
        const JSZip = (await import('jszip')).default
        zip = await JSZip.loadAsync(zipData)
        const iconFileName = Object.keys(zip.files).find((name) => {
          const lower = name.toLowerCase()
          return lower.endsWith('icon.png') || lower.endsWith('icon.jpg')
        })
        if (iconFileName) {
          fileData = await zip.files[iconFileName].async('base64')
          const mime = iconFileName.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png'
          const rawDataUrl = `data:${mime};base64,${fileData}`

          // Cache in memory, localforage, and model metadata so this tax is never paid again
          iconCache.set(displayModelId, rawDataUrl)
          model.authorIcon = rawDataUrl
          void displayModelsStore.syncMetadataCacheFromMemory()
          if (fullModel.type === 'file' && displayModelId.startsWith('display-model-')) {
            void localforage.getItem<any>(displayModelId).then((stored) => {
              if (stored && !stored.authorIcon) {
                stored.authorIcon = rawDataUrl
                return localforage.setItem(displayModelId, stored)
              }
            }).catch((err) => {
              console.error('[CharacterMediaResolver] Failed to persist authorIcon to localforage:', err)
            })
          }
          return rawDataUrl
        }
      }
      iconCache.set(displayModelId, '')
      return null
    }
    catch (e) {
      console.error('[CharacterMediaResolver] Failed to extract icon:', e)
      iconCache.set(displayModelId, '')
      return null
    }
    finally {
      zipData = null
      zip = null
      fileData = null
      releaseIconSlot()
    }
  })()

  iconPending.set(displayModelId, task)
  try {
    return await task
  }
  finally {
    if (iconPending.get(displayModelId) === task)
      iconPending.delete(displayModelId)
  }
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const v = max

  const d = max - min
  s = max === 0 ? 0 : d / max

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return [h, s, v]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

export function getContrastingComplementaryColor(
  r: number,
  g: number,
  b: number,
  _threshold = 0.5,
  darkValue = 0.15, // 15% brightness for dark mode
  brightValue = 0.94, // 94% brightness for light mode
  saturation = 0.18, // Moderate saturation (18%) for soft but colored pastel cards
): { light: string, dark: string } {
  const [h] = rgbToHsv(r, g, b)
  const compH = (h + 0.5) % 1.0

  const lightRgb = hsvToRgb(compH, saturation, brightValue)
  const lightHex = `#${lightRgb.map(x => x.toString(16).padStart(2, '0')).join('')}`

  const darkRgb = hsvToRgb(compH, saturation, darkValue)
  const darkHex = `#${darkRgb.map(x => x.toString(16).padStart(2, '0')).join('')}`

  return {
    light: lightHex,
    dark: darkHex,
  }
}

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0 // Convert to 32bit integer
  }
  return hash.toString(36)
}

export async function extractComplementaryColors(imageUrl: string): Promise<{ light: string, dark: string } | null> {
  if (colorCache.has(imageUrl)) {
    return colorCache.get(imageUrl) || null
  }

  // Check localStorage first
  const cacheKey = `airi_cc_${hashString(imageUrl)}`
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(cacheKey) : null
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      colorCache.set(imageUrl, parsed)
      return parsed
    }
    catch {}
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = imageUrl
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 32 // small size is extremely fast
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, size, size)
        const imgData = ctx.getImageData(0, 0, size, size)

        let sumR = 0
        let sumG = 0
        let sumB = 0
        let count = 0
        for (let i = 0; i < imgData.data.length; i += 4) {
          const r = imgData.data[i]
          const g = imgData.data[i + 1]
          const b = imgData.data[i + 2]
          const a = imgData.data[i + 3]

          // Only average non-transparent, non-white, non-black pixels
          if (a > 50 && (r <= 245 || g <= 245 || b <= 245) && (r >= 15 || g >= 15 || b >= 15)) {
            sumR += r
            sumG += g
            sumB += b
            count++
          }
        }

        if (count === 0) {
          resolve(null)
          return
        }

        const avgR = Math.round(sumR / count)
        const avgG = Math.round(sumG / count)
        const avgB = Math.round(sumB / count)

        const colors = getContrastingComplementaryColor(avgR, avgG, avgB)

        colorCache.set(imageUrl, colors)
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(cacheKey, JSON.stringify(colors))
        }
        resolve(colors)
      }
      catch (e) {
        console.error('[CharacterMediaResolver] Canvas extraction failed:', e)
        resolve(null)
      }
    }
    img.onerror = () => {
      resolve(null)
    }
  })
}
