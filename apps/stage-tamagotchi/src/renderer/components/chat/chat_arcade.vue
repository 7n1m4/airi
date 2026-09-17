<script setup lang="ts">
import type { GameAdapter, TurnPlan } from '@proj-airi/stage-ui/types'

import type { CatalogGame } from './ArcadeCatalogModal.vue'

import JSZip from 'jszip'
import localforage from 'localforage'

import { ArcadeGhostCursor } from '@proj-airi/stage-ui/components'
import { useArcadeAgent } from '@proj-airi/stage-ui/composables'
import { useCharacterStore } from '@proj-airi/stage-ui/stores/character'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import ArcadeCatalogModal from './ArcadeCatalogModal.vue'

const emit = defineEmits<{
  (e: 'ready'): void
}>()

const airiCardStore = useAiriCardStore()
const characterStore = useCharacterStore()
const arcadeAgent = useArcadeAgent()
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const chatStream = useChatStreamStore()
const consciousnessStore = useConsciousnessStore()
const providersStore = useProvidersStore()
const { activeCard } = storeToRefs(airiCardStore)

// --- Engine State ---
const activeEngine = ref<'canvas-2048' | 'jsdos'>('canvas-2048')
const currentGameTitle = ref('2048 Retro Canvas')
const currentGameIdentifier = ref('2048')
const currentSplashUrl = ref<string | null>(null)
const isGameReady = ref(false)
const isDosEngineLoading = ref(false)
const dosLoadingProgress = ref('')
const isCatalogOpen = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// --- IndexedDB Stores ---
const arcadeCacheStore = localforage.createInstance({
  name: 'airi-arcade-cache',
  storeName: 'games',
})

const arcadeSavestatesStore = localforage.createInstance({
  name: 'airi-arcade-savestates',
  storeName: 'states',
})

// --- Game Presets ---
interface GamePreset {
  id: string
  title: string
  engine: 'canvas-2048' | 'jsdos'
  bundleUrl?: string
}

const GAME_PRESETS: GamePreset[] = [
  { id: '2048', title: '2048 Retro Canvas', engine: 'canvas-2048' },
  { id: 'msdos_Doom_1993', title: 'Doom (Shareware 1993)', engine: 'jsdos', bundleUrl: 'https://v8.js-dos.com/bundles/doom.jsdos' },
  { id: 'digger_1983', title: 'Digger (1983)', engine: 'jsdos', bundleUrl: 'https://v8.js-dos.com/bundles/digger.jsdos' },
  { id: 'msdos_Prince_of_Persia_1990', title: 'Prince of Persia (1990)', engine: 'jsdos' },
  { id: 'msdos_Oregon_Trail_The_1990', title: 'The Oregon Trail (1990)', engine: 'jsdos' },
  { id: 'msdos_Wolfenstein_3D_1992', title: 'Wolfenstein 3D (1992)', engine: 'jsdos' },
  { id: 'CIVILIZATION_201902', title: 'Civilization (1991)', engine: 'jsdos' },
  { id: 'msdos_SimCity_1989', title: 'SimCity (1989)', engine: 'jsdos' },
]

// --- JS-DOS WebAssembly Engine State ---
const dosContainerRef = ref<HTMLDivElement | null>(null)
let dosPlayerInstance: any = null
let currentCommandInterface: any = null
let isJsDosLoaded = false

async function ensureJsDosLoaded(): Promise<any> {
  if (typeof (window as any).Dos === 'function') {
    return (window as any).Dos
  }
  if (isJsDosLoaded) {
    return (window as any).Dos
  }

  // Inject CSS
  if (!document.querySelector('link[href*="js-dos.css"]')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdn.jsdelivr.net/npm/js-dos@8.4.1/dist/js-dos.css'
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  }

  // Inject JS
  if (!document.querySelector('script[src*="js-dos.js"]')) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/js-dos@8.4.1/dist/js-dos.js'
      script.crossOrigin = 'anonymous'
      script.onload = () => {
        isJsDosLoaded = true
        resolve()
      }
      script.onerror = () => reject(new Error('Failed to load JS-DOS runtime from CDN'))
      document.head.appendChild(script)
    })
  }

  return (window as any).Dos
}

// Download stream with percentage reporting
async function fetchWithProgress(url: string, onProgress?: (pct: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`HTTP ${response.status} fetching ${url}`)

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? Number.parseInt(contentLength, 10) : 0

  if (!response.body || total === 0) {
    return await response.arrayBuffer()
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    if (value) {
      chunks.push(value)
      received += value.length
      if (total > 0 && onProgress) {
        onProgress(Math.min(99, Math.round((received / total) * 100)))
      }
    }
  }

  const result = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}

// Resolve Archive.org ZIP bundle URL & splash screenshot
interface ArchiveOrgResolvedGame {
  bundleUrl: string
  splashUrl?: string
  zipName: string
  emulatorStart?: string
}

async function resolveArchiveOrgBundle(identifier: string): Promise<ArchiveOrgResolvedGame> {
  const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`
  console.info(`[Arcade] Fetching metadata from ${metaUrl}`)
  const res = await fetch(metaUrl)
  if (!res.ok)
    throw new Error(`Failed to fetch metadata for ${identifier} (HTTP ${res.status})`)
  const data = await res.json()
  const manifest: any[] = data?.files || data?.result || []
  const emulatorStart: string | undefined = data?.metadata?.emulator_start

  console.info(`[Arcade] Archive manifest has ${manifest.length} files. emulator_start:`, emulatorStart)

  if (!manifest.length) {
    throw new Error(`Item ${identifier} not found or empty manifest`)
  }

  // 1. Locate the game archive (format === 'ZIP' or .zip extension)
  const zipFile = manifest.find(f => f.format === 'ZIP')
    || manifest.find(f => f.name?.toLowerCase().endsWith('.zip') && f.format !== 'Metadata')
    || manifest.find(f => f.name?.toLowerCase().endsWith('.zip'))

  if (!zipFile)
    throw new Error(`No ZIP archive found in item ${identifier}`)

  // 2. Locate the best splash / screenshot preview
  const splashFile = manifest.find(f => f.name === '00_coverscreenshot.jpg')
    || manifest.find(f => f.format === 'Emulator Screenshot')
    || manifest.find(f => f.name?.startsWith('screenshot_') && !f.name.includes('_thumb') && f.format === 'JPEG')
    || manifest.find(f => f.name === '__ia_thumb.jpg')

  const bundleUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(zipFile.name)}`
  const splashUrl = splashFile
    ? `https://archive.org/download/${identifier}/${encodeURIComponent(splashFile.name)}`
    : `https://archive.org/services/img/${identifier}`

  return {
    bundleUrl,
    splashUrl,
    zipName: zipFile.name,
    emulatorStart,
  }
}

async function mountDosGame(buffer: ArrayBuffer | ArrayBufferLike, gameTitle: string, emulatorStart?: string): Promise<ArrayBuffer | ArrayBufferLike> {
  const Dos = await ensureJsDosLoaded()

  if (currentCommandInterface) {
    try {
      await currentCommandInterface.exit()
    }
    catch {}
    currentCommandInterface = null
  }

  if (dosPlayerInstance) {
    try {
      dosPlayerInstance.stop()
    }
    catch {}
    dosPlayerInstance = null
  }

  await nextTick()
  if (!dosContainerRef.value)
    return buffer

  dosContainerRef.value.innerHTML = ''

  console.info(`[Arcade] Preparing bundle for "${gameTitle}". Input buffer size: ${buffer.byteLength} bytes`)

  let effectiveBuffer = buffer
  try {
    const zip = await JSZip.loadAsync(buffer as ArrayBuffer)
    const fileList = Object.keys(zip.files)
    console.info(`[Arcade] Bundle contains ${fileList.length} files:`, fileList.slice(0, 15))

    if (!zip.file('.jsdos/dosbox.conf')) {
      console.warn('[Arcade] .jsdos/dosbox.conf missing in bundle. Synthesizing config...')

      // Determine startup executable
      let execCmd = emulatorStart?.trim()
      if (!execCmd) {
        // Scan for .exe / .com / .bat in zip
        const executables = fileList.filter((f) => {
          if (f.endsWith('/') || f.endsWith('\\'))
            return false
          if (!/\.(?:exe|com|bat)$/i.test(f))
            return false

          // Arbitrarily filter out choice.exe (.com / .bat) from being a candidate ever
          const filename = f.split(/[/\\]/).pop()?.toLowerCase() || ''
          if (/^choice\.(?:exe|com|bat)$/i.test(filename))
            return false

          return true
        })
        console.info('[Arcade] Candidate executables found:', executables)

        // Exclude DOS utility & configuration binaries
        const IGNORED_BINS = ['setup', 'install', 'config', 'settings', 'sound', 'setsound', 'choice', 'readme', 'help', 'terrain', 'dos4gw', 'cwspd']
        const validCandidates = executables.filter((e) => {
          const filename = e.split(/[/\\]/).pop()?.toLowerCase() || ''
          const base = filename.replace(/\.(?:exe|com|bat)$/i, '')
          return !IGNORED_BINS.includes(base)
        })

        // Best match: contains game title tokens, or primary launchers (main, game, play, start, run, go)
        const titleTokens = (gameTitle || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2)
        const titleMatch = validCandidates.find((e) => {
          const filename = e.split(/[/\\]/).pop()?.toLowerCase() || ''
          const base = filename.replace(/\.(?:exe|com|bat)$/i, '')
          return titleTokens.some(tok => base.includes(tok))
        })

        const commonLauncher = validCandidates.find((e) => {
          const filename = e.split(/[/\\]/).pop()?.toLowerCase() || ''
          return /^(?:main|game|play|start|run|go)\.(?:exe|com|bat)$/i.test(filename)
        })

        execCmd = titleMatch || commonLauncher || validCandidates[0] || executables[0] || 'dir /w'
      }

      console.info(`[Arcade] Using startup target: "${execCmd}"`)

      // Format DOS autoexec commands
      const trimmedCmd = execCmd.trim()
      const firstSpaceIdx = trimmedCmd.indexOf(' ')
      const binaryPart = firstSpaceIdx !== -1 ? trimmedCmd.slice(0, firstSpaceIdx) : trimmedCmd
      const argsPart = firstSpaceIdx !== -1 ? trimmedCmd.slice(firstSpaceIdx) : ''

      const cleanBinary = binaryPart.replace(/\//g, '\\')
      const lastSlashIdx = cleanBinary.lastIndexOf('\\')
      let autoexecLines = ''
      if (lastSlashIdx !== -1) {
        const dir = cleanBinary.slice(0, lastSlashIdx)
        const exe = cleanBinary.slice(lastSlashIdx + 1)
        autoexecLines = `cd ${dir}\r\n${exe}${argsPart}`
      }
      else {
        autoexecLines = `${cleanBinary}${argsPart}`
      }

      const dosboxConf = `[sdl]
autolock=false
fullscreen=false
fulldouble=false
output=surface
sensitivity=100
waitonerror=true
priority=higher,normal
vsync=false

[dosbox]
machine=svga_s3
memsize=32

[cpu]
core=auto
cputype=auto
cycles=max

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
sbmixer=true
oplmode=auto
oplrate=44100

[autoexec]
mount c .
c:
${autoexecLines}
`
      zip.file('.jsdos/dosbox.conf', dosboxConf)
      effectiveBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })
      console.info(`[Arcade] Synthesized .jsdos/dosbox.conf successfully! Ready bundle size: ${effectiveBuffer.byteLength} bytes`)
    }
    else {
      console.info('[Arcade] Bundle already contains .jsdos/dosbox.conf.')
    }
  }
  catch (err) {
    console.error('[Arcade] Error checking/synthesizing bundle:', err)
  }

  const blob = new Blob([effectiveBuffer as BlobPart], { type: 'application/zip' })
  const bundleUrl = URL.createObjectURL(blob)

  dosPlayerInstance = Dos(dosContainerRef.value, {
    url: bundleUrl,
    pathPrefix: 'https://cdn.jsdelivr.net/npm/js-dos@8.4.1/dist/emulators/',
    theme: 'dark',
    autoStart: true,
    kiosk: true,
    renderAspect: '4/3',
    fsChanges: {
      local: true,
      urlToKey: async () => currentGameIdentifier.value,
    },
    onEvent: (event: string, ci: any) => {
      if (event === 'ci-ready') {
        currentCommandInterface = ci
        isGameReady.value = true
        isDosEngineLoading.value = false
        triggerReactiveReaction(`DOSBox loaded ${gameTitle}! Ready when you are!`, 'cheering')
      }
    },
  })

  return effectiveBuffer
}

async function launchDosGame(game: { identifier: string, title: string, bundleUrl?: string, thumbnailUrl?: string }) {
  isDosEngineLoading.value = true
  isGameReady.value = false
  dosLoadingProgress.value = 'Preparing emulator...'

  // Pre-seed splash with thumbnail if available
  currentSplashUrl.value = game.thumbnailUrl || `https://archive.org/services/img/${game.identifier}`

  try {
    currentGameTitle.value = game.title
    currentGameIdentifier.value = game.identifier
    activeEngine.value = 'jsdos'

    // Greet dynamically
    const greeting = getGameGreeting(game.title)
    triggerReactiveReaction(greeting.text, greeting.emotion)

    // 1. Check local IndexedDB cache first
    let gameBuffer = await arcadeCacheStore.getItem<ArrayBuffer>(game.identifier)
    let emulatorStart: string | undefined

    if (gameBuffer) {
      dosLoadingProgress.value = 'Loading from local cache...'
    }
    else {
      // 2. Resolve URL & splash from manifest
      let targetUrl = game.bundleUrl
      if (!targetUrl) {
        dosLoadingProgress.value = 'Resolving game bundle...'
        const resolved = await resolveArchiveOrgBundle(game.identifier)
        targetUrl = resolved.bundleUrl
        emulatorStart = resolved.emulatorStart
        if (resolved.splashUrl) {
          currentSplashUrl.value = resolved.splashUrl
        }
      }

      dosLoadingProgress.value = 'Downloading game 0%...'
      gameBuffer = await fetchWithProgress(targetUrl, (pct) => {
        dosLoadingProgress.value = `Downloading game ${pct}%...`
      })
    }

    dosLoadingProgress.value = 'Booting DOSBox WASM...'
    const readyBuffer = await mountDosGame(gameBuffer, game.title, emulatorStart)

    // Store ready-to-run bundle in IndexedDB for 100% offline instant replay
    await arcadeCacheStore.setItem(game.identifier, readyBuffer)
  }
  catch (err: any) {
    console.error('[Arcade] Failed to launch game:', err)
    triggerReactiveReaction(`Oops, failed to boot ${game.title}: ${err.message || err}`, 'panicked')
    isDosEngineLoading.value = false
    dosLoadingProgress.value = ''
  }
}

async function launchCustomFile(file: File) {
  isDosEngineLoading.value = true
  isGameReady.value = false
  currentSplashUrl.value = null
  dosLoadingProgress.value = `Reading ${file.name}...`

  try {
    const buffer = await file.arrayBuffer()
    const customId = `custom_${file.name.replace(/\W/g, '_')}`
    currentGameTitle.value = file.name.replace(/\.(zip|jsdos)$/i, '')
    currentGameIdentifier.value = customId
    activeEngine.value = 'jsdos'

    const greeting = getGameGreeting(currentGameTitle.value)
    triggerReactiveReaction(greeting.text, greeting.emotion)

    dosLoadingProgress.value = 'Mounting custom bundle...'
    const readyBuffer = await mountDosGame(buffer, currentGameTitle.value)

    // Cache ready custom upload
    await arcadeCacheStore.setItem(customId, readyBuffer)
  }
  catch (err: any) {
    console.error('[Arcade] Failed to launch custom file:', err)
    triggerReactiveReaction(`Could not launch ${file.name}: ${err.message || err}`, 'panicked')
    isDosEngineLoading.value = false
    dosLoadingProgress.value = ''
  }
}

function handleFileDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0)
    return
  const file = files[0]
  if (!file.name.toLowerCase().endsWith('.zip') && !file.name.toLowerCase().endsWith('.jsdos')) {
    triggerReactiveReaction('Please drop a valid DOS .zip or .jsdos game bundle!', 'thinking')
    return
  }
  void launchCustomFile(file)
}

function handleFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    void launchCustomFile(file)
  }
  target.value = ''
}

function handleSelectPreset(presetId: string) {
  if (presetId === '2048') {
    if (dosPlayerInstance) {
      try {
        dosPlayerInstance.stop()
      }
      catch {}
      dosPlayerInstance = null
      currentCommandInterface = null
    }
    activeEngine.value = 'canvas-2048'
    currentGameTitle.value = '2048 Retro Canvas'
    currentGameIdentifier.value = '2048'
    currentSplashUrl.value = null
    isGameReady.value = false
    initGame()
    triggerReactiveReaction('Switched back to 2048! Let\'s get that high score!', 'smug')
    return
  }

  const preset = GAME_PRESETS.find(p => p.id === presetId)
  if (preset) {
    void launchDosGame({
      identifier: preset.id,
      title: preset.title,
      bundleUrl: preset.bundleUrl,
    })
  }
}

function handleCatalogLaunch(game: CatalogGame) {
  isCatalogOpen.value = false
  void launchDosGame({
    identifier: game.identifier,
    title: game.title,
    bundleUrl: game.bundleUrl,
    thumbnailUrl: game.thumbnailUrl,
  })
}

// Savestates
async function handleQuickSave() {
  if (activeEngine.value !== 'jsdos' || !currentCommandInterface) {
    triggerReactiveReaction('Savestates are currently supported for active DOS games!', 'thinking')
    return
  }

  try {
    const state = await currentCommandInterface.persist()
    if (state) {
      await arcadeSavestatesStore.setItem(currentGameIdentifier.value, state)
      triggerReactiveReaction(`💾 QuickSave snapshot stored for ${currentGameTitle.value}!`, 'smug')
    }
  }
  catch (err: any) {
    console.error('[Arcade] QuickSave error:', err)
    triggerReactiveReaction(`Failed to create savestate: ${err.message || err}`, 'panicked')
  }
}

async function handleQuickLoad() {
  if (activeEngine.value !== 'jsdos')
    return

  try {
    const state = await arcadeSavestatesStore.getItem<Uint8Array | Blob | ArrayBuffer>(currentGameIdentifier.value)
    if (!state) {
      triggerReactiveReaction(`No saved snapshot found for ${currentGameTitle.value}!`, 'panicked')
      return
    }

    triggerReactiveReaction(`📂 Restoring savestate for ${currentGameTitle.value}...`, 'cheering')
    isDosEngineLoading.value = true
    dosLoadingProgress.value = 'Preparing savestate...'

    // 1. Retrieve the base game bundle from local cache
    let baseBuffer = await arcadeCacheStore.getItem<ArrayBuffer | Blob>(currentGameIdentifier.value)
    let emulatorStart: string | undefined

    if (!baseBuffer) {
      // Fallback: If not in cache, resolve preset bundle
      const preset = GAME_PRESETS.find(p => p.id === currentGameIdentifier.value)
      if (preset) {
        dosLoadingProgress.value = 'Resolving base game bundle...'
        let targetUrl = preset.bundleUrl
        if (!targetUrl) {
          const resolved = await resolveArchiveOrgBundle(preset.id)
          targetUrl = resolved.bundleUrl
          emulatorStart = resolved.emulatorStart
        }
        baseBuffer = await fetchWithProgress(targetUrl, (pct) => {
          dosLoadingProgress.value = `Downloading base game ${pct}%...`
        })
      }
    }

    if (!baseBuffer) {
      throw new Error(`Base game bundle not found in cache for ${currentGameTitle.value}`)
    }

    let rawBaseBuffer: ArrayBuffer
    if (baseBuffer instanceof Blob) {
      rawBaseBuffer = await (baseBuffer as Blob).arrayBuffer()
    }
    else if ((baseBuffer as any) instanceof ArrayBuffer) {
      rawBaseBuffer = baseBuffer as ArrayBuffer
    }
    else if ((baseBuffer as any).buffer instanceof ArrayBuffer) {
      rawBaseBuffer = (baseBuffer as any).buffer
    }
    else {
      rawBaseBuffer = baseBuffer as any
    }

    let stateBytes: Uint8Array | ArrayBuffer
    if (state instanceof Blob) {
      stateBytes = await (state as Blob).arrayBuffer()
    }
    else if ((state as any) instanceof Uint8Array) {
      stateBytes = state as Uint8Array
    }
    else if ((state as any).buffer instanceof ArrayBuffer) {
      stateBytes = new Uint8Array((state as any).buffer)
    }
    else {
      stateBytes = state as any
    }

    // 2. Merge delta savegame files into base bundle
    dosLoadingProgress.value = 'Merging savestate...'
    const baseZip = await JSZip.loadAsync(rawBaseBuffer.slice(0))
    const deltaZip = await JSZip.loadAsync(stateBytes)

    let mergedCount = 0
    for (const [relativePath, entry] of Object.entries(deltaZip.files)) {
      if (!entry.dir) {
        // Preserve base config if delta doesn't contain a valid dosbox.conf
        if (relativePath === '.jsdos/dosbox.conf' && baseZip.file('.jsdos/dosbox.conf')) {
          continue
        }
        const fileData = await entry.async('uint8array')
        baseZip.file(relativePath, fileData)
        mergedCount++
      }
    }

    console.info(`[Arcade] Merged ${mergedCount} savestate files into base bundle for ${currentGameTitle.value}`)
    const mergedBuffer = await baseZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })

    dosLoadingProgress.value = 'Booting DOSBox with savestate...'
    await mountDosGame(mergedBuffer, currentGameTitle.value, emulatorStart)
  }
  catch (err: any) {
    console.error('[Arcade] QuickLoad error:', err)
    triggerReactiveReaction(`Failed to load savestate: ${err.message || err}`, 'panicked')
    isDosEngineLoading.value = false
    dosLoadingProgress.value = ''
  }
}

// --- Game Engine State (2048 Retro Canvas) ---
const canvasRef = ref<HTMLCanvasElement | null>(null)
const isCanvasFocused = ref(false)
const score = ref(0)
const bestScore = ref(0)
const isGameOver = ref(false)
const isGameWon = ref(false)
const isPaused = ref(false)
const isMuted = ref(false)

// Grid: 4x4 array of numbers (0 = empty)
let board: number[][] = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
]

// WebAudio Sound Synthesis
let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
    audioCtx = new AudioCtxClass()
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume()
  }
  return audioCtx
}

function playBeep(freq = 440, durationMs = 80, type: OscillatorType = 'sine') {
  if (isMuted.value)
    return
  try {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + durationMs / 1000)
  }
  catch {
    // Audio context may be restricted before user gesture
  }
}

// Retro Color Palette
const TILE_COLORS: Record<number, { bg: string, text: string }> = {
  0: { bg: '#1c1c24', text: 'transparent' },
  2: { bg: '#2b2d42', text: '#edf2f4' },
  4: { bg: '#3a3d5c', text: '#edf2f4' },
  8: { bg: '#e07a5f', text: '#ffffff' },
  16: { bg: '#d65a31', text: '#ffffff' },
  32: { bg: '#e63946', text: '#ffffff' },
  64: { bg: '#ff0054', text: '#ffffff' },
  128: { bg: '#f4a261', text: '#ffffff' },
  256: { bg: '#e76f51', text: '#ffffff' },
  512: { bg: '#9b5de5', text: '#ffffff' },
  1024: { bg: '#00bbf9', text: '#ffffff' },
  2048: { bg: '#00f5d4', text: '#111111' },
}

function spawnRandomTile() {
  const emptyCoords: [number, number][] = []
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0)
        emptyCoords.push([r, c])
    }
  }
  if (emptyCoords.length === 0)
    return
  const [r, c] = emptyCoords[Math.floor(Math.random() * emptyCoords.length)]
  board[r][c] = Math.random() < 0.9 ? 2 : 4
}

function initGame() {
  board = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  score.value = 0
  isGameOver.value = false
  isGameWon.value = false
  isPaused.value = false
  spawnRandomTile()
  spawnRandomTile()
  drawBoard()
}

function drawBoard() {
  if (!canvasRef.value)
    return
  const ctx = canvasRef.value.getContext('2d')
  if (!ctx)
    return

  const w = canvasRef.value.width
  const h = canvasRef.value.height
  const pad = 12
  const tileSize = (w - pad * 5) / 4

  // Background
  ctx.fillStyle = '#121218'
  ctx.fillRect(0, 0, w, h)

  // Border & Grid
  ctx.strokeStyle = '#282836'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const val = board[r][c]
      const x = pad + c * (tileSize + pad)
      const y = pad + r * (tileSize + pad)

      const tileStyle = TILE_COLORS[val] || { bg: '#3a0ca3', text: '#ffffff' }

      // Tile background
      ctx.fillStyle = tileStyle.bg
      ctx.beginPath()
      ctx.roundRect(x, y, tileSize, tileSize, 8)
      ctx.fill()

      // Value text
      if (val > 0) {
        ctx.fillStyle = tileStyle.text
        ctx.font = `bold ${val >= 1024 ? 22 : val >= 128 ? 26 : 30}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(val.toString(), x + tileSize / 2, y + tileSize / 2)
      }
    }
  }

  // Overlay states
  if (isGameOver.value || isGameWon.value || isPaused.value) {
    ctx.fillStyle = 'rgba(10, 10, 15, 0.82)'
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = isGameWon.value ? '#00f5d4' : isGameOver.value ? '#ff0054' : '#edf2f4'
    ctx.font = 'bold 32px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const title = isGameWon.value ? 'VICTORY 2048!' : isGameOver.value ? 'GAME OVER' : 'PAUSED'
    ctx.fillText(title, w / 2, h / 2 - 18)

    ctx.fillStyle = '#a0a0b0'
    ctx.font = '14px monospace'
    const subtitle = isPaused.value ? 'Press P to Resume' : 'Press R to Play Again'
    ctx.fillText(subtitle, w / 2, h / 2 + 20)
  }
}

function slide(row: number[]): { newRow: number[], points: number } {
  const filtered = row.filter(x => x !== 0)
  let points = 0
  const result: number[] = []

  for (let i = 0; i < filtered.length; i++) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2
      result.push(merged)
      points += merged
      if (merged === 2048 && !isGameWon.value) {
        isGameWon.value = true
        playBeep(880, 200, 'triangle')
      }
      i++
    }
    else {
      result.push(filtered[i])
    }
  }
  while (result.length < 4) {
    result.push(0)
  }
  return { newRow: result, points }
}

function rotateBoardClockwise() {
  const newBoard: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      newBoard[c][3 - r] = board[r][c]
    }
  }
  board = newBoard
}

function move(direction: 'left' | 'right' | 'up' | 'down'): boolean {
  if (isGameOver.value || isPaused.value)
    return false

  let rotations = 0
  if (direction === 'up')
    rotations = 3
  else if (direction === 'right')
    rotations = 2
  else if (direction === 'down')
    rotations = 1

  for (let i = 0; i < rotations; i++) {
    rotateBoardClockwise()
  }

  let moved = false
  let turnPoints = 0

  for (let r = 0; r < 4; r++) {
    const { newRow, points } = slide(board[r])
    turnPoints += points
    for (let c = 0; c < 4; c++) {
      if (board[r][c] !== newRow[c]) {
        moved = true
      }
      board[r][c] = newRow[c]
    }
  }

  for (let i = 0; i < (4 - rotations) % 4; i++) {
    rotateBoardClockwise()
  }

  if (moved) {
    score.value += turnPoints
    if (score.value > bestScore.value) {
      bestScore.value = score.value
    }
    playBeep(turnPoints > 0 ? 580 : 340, turnPoints > 0 ? 100 : 50)
    spawnRandomTile()
    checkGameState()
    drawBoard()
  }

  return moved
}

function checkGameState() {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0)
        return
      if (c + 1 < 4 && board[r][c] === board[r][c + 1])
        return
      if (r + 1 < 4 && board[r][c] === board[r + 1][c])
        return
    }
  }
  isGameOver.value = true
  playBeep(180, 400, 'sawtooth')
  triggerReactiveReaction('Oh no, we ran out of moves! That was a valiant effort though!', 'panicked')
}

function handleCanvasKeyDown(e: KeyboardEvent) {
  if (activeEngine.value !== 'canvas-2048')
    return

  let handled = false
  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      handled = move('left')
      break
    case 'ArrowRight':
    case 'd':
    case 'D':
      handled = move('right')
      break
    case 'ArrowUp':
    case 'w':
    case 'W':
      handled = move('up')
      break
    case 'ArrowDown':
    case 's':
    case 'S':
      handled = move('down')
      break
    case 'r':
    case 'R':
      initGame()
      handled = true
      break
    case 'p':
    case 'P':
      isPaused.value = !isPaused.value
      drawBoard()
      handled = true
      break
  }
  if (handled) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function focusCanvas() {
  canvasRef.value?.focus()
  isCanvasFocused.value = true
}

// --- Backseat Chat & Banter Stream ---
interface BackseatMessage {
  id: string
  sender: 'character' | 'user'
  authorName: string
  text: string
  timestamp: string
  emotion?: 'neutral' | 'smug' | 'panicked' | 'cheering' | 'thinking'
  isAdvice?: boolean
  imageAttachment?: string
  turnPlan?: TurnPlan
}

const chatTranscript = ref<BackseatMessage[]>([
  {
    id: 'msg-1',
    sender: 'character',
    authorName: activeCard.value?.name || 'AIRI',
    text: 'Welcome to the Arcade Room! Pick your game from the presets or browse 8,000+ preservation classics!',
    timestamp: 'Just now',
    emotion: 'smug',
  },
])

const userInputText = ref('')
const transcriptContainerRef = ref<HTMLDivElement | null>(null)

// --- Frame Capture & Backseat Interaction ---
const isCapturing = ref(false)
const attachedFrame = ref<{ dataUrl: string, base64: string, mimeType: string } | null>(null)
const activeLlmReplyId = ref<string | null>(null)

// Live-sync AI streaming response into transcript
watch(() => chatStream.streamingMessage.content, (newContent) => {
  if (activeLlmReplyId.value && newContent) {
    const target = chatTranscript.value.find(m => m.id === activeLlmReplyId.value)
    if (target) {
      target.text = typeof newContent === 'string'
        ? newContent
        : Array.isArray(newContent)
          ? newContent.map(part => 'text' in part ? part.text : '').join('')
          : String(newContent || '')
      target.emotion = 'smug'
      scrollToBottom()
    }
  }
})

watch(() => chatOrchestrator.sending, (isSending, wasSending) => {
  if (wasSending && !isSending && activeLlmReplyId.value) {
    activeLlmReplyId.value = null
  }
})

function scrollToBottom() {
  void nextTick(() => {
    if (transcriptContainerRef.value) {
      transcriptContainerRef.value.scrollTop = transcriptContainerRef.value.scrollHeight
    }
  })
}

function triggerReactiveReaction(text: string, emotion: BackseatMessage['emotion'] = 'neutral') {
  chatTranscript.value.push({
    id: `react-${Date.now()}`,
    sender: 'character',
    authorName: activeCard.value?.name || 'AIRI',
    text,
    timestamp: 'Just now',
    emotion,
  })
  scrollToBottom()
}

function getGameGreeting(title: string): { text: string, emotion: BackseatMessage['emotion'] } {
  const t = title.toLowerCase()
  if (t.includes('doom'))
    return { text: 'Doom?! Grab the shotgun! Let\'s rip and tear, but watch your six!', emotion: 'smug' }
  if (t.includes('prince of persia'))
    return { text: 'Prince of Persia! One wrong jump and we\'re skewered on spikes... careful on the ledges!', emotion: 'panicked' }
  if (t.includes('oregon'))
    return { text: 'The Oregon Trail! Please tell me we won\'t starve or drown crossing the river...', emotion: 'thinking' }
  if (t.includes('wolfenstein'))
    return { text: 'Wolfenstein 3D! Check the walls for hidden passages and don\'t run out of ammo!', emotion: 'cheering' }
  if (t.includes('civilization'))
    return { text: 'Civilization! Let\'s build the greatest empire history has ever witnessed!', emotion: 'smug' }
  if (t.includes('simcity'))
    return { text: 'SimCity! Mayor on deck. Watch out for earthquakes and keep taxes reasonable!', emotion: 'cheering' }
  if (t.includes('pac-man'))
    return { text: 'Pac-Man! Eat the power pellets before the ghosts corner us!', emotion: 'panicked' }
  if (t.includes('digger'))
    return { text: 'Digger! Drop the bags of gold on those Nobbins!', emotion: 'cheering' }
  return { text: `Booting up ${title}! Show me what you've got!`, emotion: 'smug' }
}

function convertImageDataToDataUrl(shot: { width: number, height: number, data: ArrayLike<number> }): string {
  try {
    const offscreen = document.createElement('canvas')
    offscreen.width = shot.width
    offscreen.height = shot.height
    const ctx = offscreen.getContext('2d')
    if (!ctx)
      return ''

    let imgData: ImageData
    if (typeof ImageData !== 'undefined' && shot instanceof ImageData) {
      imgData = shot
    }
    else {
      imgData = ctx.createImageData(shot.width, shot.height)
      imgData.data.set(shot.data)
    }

    ctx.putImageData(imgData, 0, 0)
    return offscreen.toDataURL('image/jpeg', 0.85)
  }
  catch (e) {
    console.error('[Arcade] Failed converting ImageData to DataURL:', e)
    return ''
  }
}

async function captureCurrentGameFrame(): Promise<{ dataUrl: string, base64: string, mimeType: string } | null> {
  try {
    let dataUrl = ''
    if (activeEngine.value === 'jsdos') {
      if (currentCommandInterface && typeof currentCommandInterface.screenshot === 'function') {
        try {
          const shot = await currentCommandInterface.screenshot()
          if (typeof shot === 'string') {
            dataUrl = shot
          }
          else if (shot && typeof (shot as HTMLCanvasElement).toDataURL === 'function') {
            dataUrl = (shot as HTMLCanvasElement).toDataURL('image/jpeg', 0.85)
          }
          else if (shot && typeof shot.width === 'number' && typeof shot.height === 'number' && shot.data) {
            dataUrl = convertImageDataToDataUrl(shot)
          }
        }
        catch (e) {
          console.warn('[Arcade] CommandInterface screenshot failed, falling back to canvas query:', e)
        }
      }
      if (!dataUrl && dosContainerRef.value) {
        const canvas = dosContainerRef.value.querySelector('canvas')
        if (canvas) {
          try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          }
          catch (e) {
            console.warn('[Arcade] Canvas toDataURL failed:', e)
          }
        }
      }
    }
    else if (activeEngine.value === 'canvas-2048') {
      if (canvasRef.value) {
        dataUrl = canvasRef.value.toDataURL('image/jpeg', 0.85)
      }
    }

    if (!dataUrl)
      return null

    const mimeType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl

    return { dataUrl, base64, mimeType }
  }
  catch (err) {
    console.error('[Arcade] Failed to capture game frame:', err)
    return null
  }
}

async function handleAttachFrame() {
  if (isCapturing.value)
    return
  isCapturing.value = true
  try {
    const frame = await captureCurrentGameFrame()
    if (!frame) {
      triggerReactiveReaction('Couldn\'t snap a screenshot right now—is the game still rendering?', 'thinking')
      return
    }
    attachedFrame.value = frame
    triggerReactiveReaction('📸 Game screen captured! What do you want to ask about it?', 'smug')
  }
  finally {
    isCapturing.value = false
  }
}

async function handleQuickAsk() {
  if (isCapturing.value)
    return
  isCapturing.value = true
  try {
    const frame = await captureCurrentGameFrame()
    if (!frame) {
      triggerReactiveReaction('Couldn\'t capture the screen right now—is the game ready?', 'thinking')
      return
    }
    const promptText = 'Look at my game screen right now! What should I do next?'
    await dispatchUserMessage(promptText, frame)
  }
  finally {
    isCapturing.value = false
  }
}

async function dispatchUserMessage(text: string, frame?: { dataUrl: string, base64: string, mimeType: string }) {
  const content = text.trim()
  if (!content && !frame)
    return

  const userMsgId = `user-${Date.now()}`
  chatTranscript.value.push({
    id: userMsgId,
    sender: 'user',
    authorName: 'You',
    text: content,
    timestamp: 'Just now',
    isAdvice: true,
    imageAttachment: frame?.dataUrl,
  })
  scrollToBottom()

  let sentToLlm = false
  try {
    const providerId = consciousnessStore.activeProvider
    const modelId = consciousnessStore.activeModel

    if (providerId && modelId && chatSession.activeSessionId) {
      const providerConfig = providersStore.getProviderConfig(providerId)
      sentToLlm = true

      const replyMsgId = `react-${Date.now()}`
      activeLlmReplyId.value = replyMsgId
      chatTranscript.value.push({
        id: replyMsgId,
        sender: 'character',
        authorName: activeCard.value?.name || 'AIRI',
        text: 'Analyzing the game screen...',
        timestamp: 'Just now',
        emotion: 'thinking',
      })
      scrollToBottom()

      const attachmentsToSend = frame
        ? [{
            type: 'image' as const,
            data: frame.base64,
            mimeType: frame.mimeType,
            fileName: `${currentGameIdentifier.value}_snap.jpg`,
            size: 0,
          }]
        : []

      const systemPrefix = `[Arcade Spectator Mode: You are live-spectating the user playing "${currentGameTitle.value}". Give a quick, energetic, in-character reaction or gaming advice (1-2 sentences) on what you see.] `

      await chatOrchestrator.ingest(`${systemPrefix}${content}`, {
        model: modelId,
        chatProvider: providerId,
        providerConfig,
        attachments: attachmentsToSend,
      }, chatSession.activeSessionId)
    }
  }
  catch (err) {
    console.warn('[Arcade] LLM dispatch failed or unconfigured, falling back to simulated banter:', err)
    sentToLlm = false
    activeLlmReplyId.value = null
  }

  if (!sentToLlm) {
    setTimeout(() => {
      if (frame) {
        const visionReplies = [
          { text: `Analyzing your screen for ${currentGameTitle.value}... Keep your momentum going and watch that flank!`, emotion: 'cheering' as const },
          { text: 'I see what you\'re aiming for! Clear out that middle section before moving ahead!', emotion: 'smug' as const },
          { text: 'Looking at that screen... Don\'t get trapped in the corner!', emotion: 'panicked' as const },
          { text: 'Nice position! Focus on resource management and keep your defense tight.', emotion: 'thinking' as const },
        ]
        const pick = visionReplies[Math.floor(Math.random() * visionReplies.length)]
        triggerReactiveReaction(pick.text, pick.emotion)
      }
      else {
        const replies = [
          { text: 'Got it! Following your lead!', emotion: 'cheering' as const },
          { text: 'Wait, are you sure about that move?!', emotion: 'panicked' as const },
          { text: 'Hmph, I had that completely under control anyway.', emotion: 'smug' as const },
          { text: 'Good eye! That opened up a whole new path.', emotion: 'cheering' as const },
        ]
        const pick = replies[Math.floor(Math.random() * replies.length)]
        triggerReactiveReaction(pick.text, pick.emotion)
      }
    }, 750)
  }
}

async function handleSendAdvice(presetText?: string) {
  const content = presetText || userInputText.value.trim()
  const frame = attachedFrame.value
  if (!content && !frame)
    return

  const promptText = content || (frame ? 'What should I do here?' : '')
  attachedFrame.value = null
  userInputText.value = ''

  await dispatchUserMessage(promptText, frame || undefined)
}

// --- Option A: Autonomous Turn & Co-pilot Execution Primitives ---

async function executeClick(normX: number, normY: number) {
  if (activeEngine.value === 'jsdos') {
    const canvas = dosContainerRef.value?.querySelector('canvas')
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      const clientX = rect.left + (normX / 1000) * rect.width
      const clientY = rect.top + (normY / 1000) * rect.height
      const canvasX = Math.round((normX / 1000) * canvas.width)
      const canvasY = Math.round((normY / 1000) * canvas.height)

      canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY, button: 0 }))
      await new Promise(r => setTimeout(r, 40))
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY, button: 0, buttons: 1 }))
      await new Promise(r => setTimeout(r, 80))
      canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX, clientY, button: 0, buttons: 0 }))
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY, button: 0 }))

      if (currentCommandInterface) {
        try {
          if (typeof currentCommandInterface.sendMouse === 'function') {
            currentCommandInterface.sendMouse(canvasX, canvasY, 1)
            await new Promise(r => setTimeout(r, 80))
            currentCommandInterface.sendMouse(canvasX, canvasY, 0)
          }
          else if (typeof currentCommandInterface.sendMouseClick === 'function') {
            currentCommandInterface.sendMouseClick(0, canvasX, canvasY)
          }
        }
        catch (err) {
          console.warn('[Arcade] CI sendMouse failed:', err)
        }
      }
    }
  }
  else if (activeEngine.value === 'canvas-2048') {
    canvasRef.value?.focus()
  }
}

function resolveKeyDetails(rawKey: string): { key: string, code: string, keyCode: number } {
  const k = (rawKey || '').trim()
  const lower = k.toLowerCase()

  if (lower === 'enter' || lower === 'return')
    return { key: 'Enter', code: 'Enter', keyCode: 13 }
  if (lower === 'space' || lower === 'spacebar' || lower === ' ')
    return { key: ' ', code: 'Space', keyCode: 32 }
  if (lower === 'escape' || lower === 'esc')
    return { key: 'Escape', code: 'Escape', keyCode: 27 }
  if (lower === 'arrowup' || lower === 'up')
    return { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }
  if (lower === 'arrowdown' || lower === 'down')
    return { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }
  if (lower === 'arrowleft' || lower === 'left')
    return { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }
  if (lower === 'arrowright' || lower === 'right')
    return { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
  if (lower === 'backspace')
    return { key: 'Backspace', code: 'Backspace', keyCode: 8 }
  if (lower === 'tab')
    return { key: 'Tab', code: 'Tab', keyCode: 9 }

  const charCode = k.toUpperCase().charCodeAt(0)
  return {
    key: k,
    code: /^\d$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`,
    keyCode: Number.isNaN(charCode) ? 0 : charCode,
  }
}

async function executeKeyPress(rawKey: string) {
  const details = resolveKeyDetails(rawKey)

  if (activeEngine.value === 'canvas-2048') {
    if (details.key === 'ArrowLeft' || details.key === 'a')
      move('left')
    else if (details.key === 'ArrowRight' || details.key === 'd')
      move('right')
    else if (details.key === 'ArrowUp' || details.key === 'w')
      move('up')
    else if (details.key === 'ArrowDown' || details.key === 's')
      move('down')
    return
  }

  if (activeEngine.value === 'jsdos') {
    const target = (dosContainerRef.value?.querySelector('canvas') as HTMLElement | null) || window
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: details.key,
      code: details.code,
      keyCode: details.keyCode,
      which: details.keyCode,
      bubbles: true,
      cancelable: true,
    }))

    await new Promise(r => setTimeout(r, 60))

    target.dispatchEvent(new KeyboardEvent('keyup', {
      key: details.key,
      code: details.code,
      keyCode: details.keyCode,
      which: details.keyCode,
      bubbles: true,
      cancelable: true,
    }))

    if (currentCommandInterface) {
      try {
        if (typeof currentCommandInterface.simulateKeyPress === 'function') {
          currentCommandInterface.simulateKeyPress(details.keyCode || details.key)
        }
        else if (typeof currentCommandInterface.sendKeyEvent === 'function') {
          currentCommandInterface.sendKeyEvent(details.keyCode, true)
          await new Promise(r => setTimeout(r, 60))
          currentCommandInterface.sendKeyEvent(details.keyCode, false)
        }
      }
      catch (err) {
        console.warn('[Arcade] CI sendKeyEvent failed:', err)
      }
    }
  }
}

async function executeTypeText(text: string) {
  for (const char of text) {
    await executeKeyPress(char)
    await new Promise(r => setTimeout(r, 80))
  }
}

function createCurrentGameAdapter(): GameAdapter {
  return {
    id: activeEngine.value === 'jsdos' ? (currentGameIdentifier.value || 'jsdos') : 'canvas-2048',
    title: currentGameTitle.value,
    engine: activeEngine.value === 'jsdos' ? 'jsdos' : 'html5-canvas',
    captureFrame: async () => {
      const frame = await captureCurrentGameFrame()
      return frame?.dataUrl || null
    },
    getCanvasElement: () => {
      if (activeEngine.value === 'jsdos') {
        return dosContainerRef.value?.querySelector('canvas') || null
      }
      return canvasRef.value || null
    },
    executeClick: async (normX, normY) => {
      await executeClick(normX, normY)
    },
    executeKeyPress: async (key) => {
      await executeKeyPress(key)
    },
    executeTypeText: async (text) => {
      await executeTypeText(text)
    },
    duckAudio: (duck) => {
      if (currentCommandInterface?.sound) {
        try {
          if (typeof currentCommandInterface.sound.setVolume === 'function') {
            currentCommandInterface.sound.setVolume(duck ? 0.3 : 1.0)
          }
        }
        catch {}
      }
    },
  }
}

async function handleAiriTakeTurn() {
  if (arcadeAgent.turnState.value !== 'idle') {
    arcadeAgent.interrupt()
    toast.info('Controller returned to player!')
    return
  }

  arcadeAgent.bindAdapter(createCurrentGameAdapter())

  const plan = await arcadeAgent.takeTurn({
    onCommentary: (turnPlan) => {
      chatTranscript.value.push({
        id: `turn-${Date.now()}`,
        sender: 'character',
        authorName: activeCard.value?.name || 'AIRI',
        text: turnPlan.spoken_commentary,
        timestamp: 'Just now',
        emotion: 'cheering',
        turnPlan,
      })
      scrollToBottom()
    },
    speakCommentary: async (textWithEmotion) => {
      try {
        await characterStore.emitTextOutput(textWithEmotion)
      }
      catch (err) {
        console.warn('[Arcade] Character speech playback failed:', err)
      }
    },
  })

  if (plan) {
    plan.executed = true
    toast.success(`Airi finished move: ${plan.plan.slice(0, 35)}...`)
  }
}

async function handleExecuteMovesOnCanvas(plan: TurnPlan) {
  arcadeAgent.bindAdapter(createCurrentGameAdapter())
  await arcadeAgent.executePlan(plan)
  plan.executed = true
  toast.success('Moves executed on canvas!')
}

function toggleMute() {
  isMuted.value = !isMuted.value
  if (currentCommandInterface) {
    if (isMuted.value)
      currentCommandInterface.mute?.()
    else
      currentCommandInterface.unmute?.()
  }
}

onMounted(() => {
  initGame()
  emit('ready')
})

onUnmounted(() => {
  if (dosPlayerInstance) {
    try {
      dosPlayerInstance.stop()
    }
    catch {}
    dosPlayerInstance = null
    currentCommandInterface = null
  }
  if (audioCtx) {
    void audioCtx.close()
  }
})
</script>

<template>
  <div class="h-full w-full flex overflow-hidden bg-neutral-100/60 dark:bg-neutral-950/40">
    <!-- 1. LEFT PANE: Retro Game Viewport (65% width) -->
    <div class="relative h-full flex flex-1 flex-col overflow-hidden border-r border-neutral-200/50 p-4 dark:border-neutral-800/50">
      <!-- Hidden file input for custom ROM / ZIP -->
      <input
        ref="fileInputRef"
        type="file"
        accept=".zip,.jsdos"
        class="hidden"
        @change="handleFileInputChange"
      >

      <!-- Game Top Toolbar (Library & Game Selection) -->
      <div class="mb-3 flex items-center justify-between border border-neutral-200/40 rounded-xl bg-white/70 px-4 py-2 shadow-sm backdrop-blur-md dark:border-neutral-800/40 dark:bg-neutral-900/60">
        <!-- Title & Preset Selector -->
        <div class="flex items-center gap-3">
          <div class="i-solar:gamepad-bold-duotone text-xl text-primary-500" />
          <div class="flex items-center gap-2">
            <!-- Preset Selector Dropdown -->
            <select
              :value="currentGameIdentifier"
              class="border border-neutral-200/80 rounded-lg bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800 font-bold outline-none transition-colors dark:border-neutral-700/80 dark:bg-neutral-800 dark:text-neutral-100"
              @change="(e: any) => handleSelectPreset(e.target.value)"
            >
              <option v-for="preset in GAME_PRESETS" :key="preset.id" :value="preset.id">
                {{ preset.title }}
              </option>
            </select>
          </div>
        </div>

        <!-- Middle Tools: Browse Catalog & Load File -->
        <div class="flex items-center gap-2">
          <button
            class="shadow-2xs flex items-center gap-1.5 border border-primary-500/30 rounded-lg bg-primary-500/10 px-3 py-1.5 text-xs text-primary-600 font-bold transition-all active:scale-95 hover:bg-primary-500/20 dark:text-primary-400"
            @click="isCatalogOpen = true"
          >
            <div class="i-solar:magnifer-linear text-xs" />
            <span>Browse 8,000+ Games</span>
          </button>

          <button
            class="shadow-2xs dark:hover:bg-neutral-750 flex items-center gap-1.5 border border-neutral-200/80 rounded-lg bg-white px-2.5 py-1.5 text-xs text-neutral-700 font-medium transition-all dark:border-neutral-700/80 dark:bg-neutral-800 hover:bg-neutral-50 dark:text-neutral-200"
            title="Load custom .zip or .jsdos file"
            @click="fileInputRef?.click()"
          >
            <div class="i-solar:folder-open-linear text-xs" />
            <span>Load .zip</span>
          </button>
        </div>

        <!-- Right: Audio, Save/Load & Status -->
        <div class="flex items-center gap-1.5">
          <!-- QuickSave / QuickLoad (JS-DOS only) -->
          <template v-if="activeEngine === 'jsdos'">
            <button
              class="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              title="QuickSave (F5 snapshot)"
              @click="handleQuickSave"
            >
              <div class="i-solar:diskette-bold text-base" />
            </button>
            <button
              class="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              title="QuickLoad (Restore F9 snapshot)"
              @click="handleQuickLoad"
            >
              <div class="i-solar:upload-track-2-bold text-base" />
            </button>
          </template>

          <button
            class="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            :title="isMuted ? 'Unmute Audio' : 'Mute Audio'"
            @click="toggleMute"
          >
            <div :class="isMuted ? 'i-solar:volume-cross-bold' : 'i-solar:volume-loud-bold'" class="text-base" />
          </button>

          <button
            v-if="activeEngine === 'canvas-2048'"
            class="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title="Restart 2048"
            @click="initGame"
          >
            <div class="i-solar:restart-bold text-base" />
          </button>

          <div class="ml-2 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-500 font-bold">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span>{{ activeEngine === 'jsdos' ? 'DOSBox Active' : 'Spectator' }}</span>
          </div>
        </div>
      </div>

      <!-- Main Game Viewport with Drag-and-Drop & Aspect-Ratio Lock -->
      <div
        class="relative flex flex-1 items-center justify-center overflow-hidden"
        @dragover.prevent
        @drop.prevent="handleFileDrop"
      >
        <!-- 2048 RETRO CANVAS VIEWPORT -->
        <div
          v-if="activeEngine === 'canvas-2048'"
          class="relative cursor-pointer border-4 rounded-2xl p-2 shadow-2xl transition-all duration-300"
          :class="isCanvasFocused
            ? 'border-primary-500/80 shadow-primary-500/20 ring-4 ring-primary-500/10'
            : 'border-neutral-800/80 hover:border-neutral-700'"
          @click="focusCanvas"
        >
          <!-- Retro Bezel Badge -->
          <div class="backdrop-blur-xs absolute left-4 top-4 z-10 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-[9px] text-neutral-400 tracking-widest font-mono uppercase">
            <span>CRT 60FPS</span>
          </div>

          <canvas
            ref="canvasRef"
            tabindex="0"
            width="420"
            height="420"
            class="block rounded-xl outline-none"
            @keydown="handleCanvasKeyDown"
            @focus="isCanvasFocused = true"
            @blur="isCanvasFocused = false"
          />

          <!-- Unfocused Click Overlay -->
          <div
            v-if="!isCanvasFocused"
            class="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black/40 backdrop-blur-[2px] transition-all"
          >
            <div class="i-solar:keyboard-bold mb-2 animate-bounce text-3xl text-white/90" />
            <span class="rounded-full bg-neutral-900/80 px-3.5 py-1.5 text-xs text-white font-bold tracking-wide shadow-lg">
              Click to Control Canvas
            </span>
            <span class="mt-1 text-[10px] text-white/60 font-medium">Use Arrow Keys or WASD</span>
          </div>

          <!-- Ghost Cursor overlay for 2048 -->
          <ArcadeGhostCursor
            v-if="activeEngine === 'canvas-2048'"
            :cursor-state="arcadeAgent.cursorState.value"
            :character-name="activeCard?.name || 'Airi'"
          />
        </div>

        <!-- JSDOS WEB PLAYER CONTAINER -->
        <div
          v-show="activeEngine === 'jsdos'"
          class="relative h-full max-h-[580px] max-w-[780px] w-full flex items-center justify-center overflow-hidden border-4 border-neutral-800/80 rounded-2xl bg-black p-1 shadow-2xl"
        >
          <!-- DOS Bezel Badge -->
          <div class="backdrop-blur-xs pointer-events-none absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded bg-black/70 px-2 py-0.5 text-[9px] text-neutral-400 tracking-widest font-mono uppercase">
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="isGameReady ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'"
            />
            <span>{{ isGameReady ? 'DOSBox WASM &bull; 4:3' : 'DOSBox Initializing...' }}</span>
          </div>

          <!-- Splash Screen Overlay (Shown while loading or before ci-ready) -->
          <div
            v-if="!isGameReady"
            class="absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden rounded-xl bg-neutral-950"
          >
            <!-- Ambient blurred backdrop -->
            <img
              v-if="currentSplashUrl"
              :src="currentSplashUrl"
              :alt="currentGameTitle"
              class="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-lg filter"
            >
            <div class="absolute inset-0 from-black/90 via-black/50 to-black/80 bg-gradient-to-t" />

            <!-- Clean Foreground Screenshot / Cover -->
            <div
              v-if="currentSplashUrl"
              class="relative z-10 max-h-[60%] max-w-[70%] overflow-hidden border border-white/15 rounded-xl shadow-2xl"
            >
              <img
                :src="currentSplashUrl"
                :alt="currentGameTitle"
                class="max-h-[260px] w-auto object-contain"
                @error="(e: any) => { e.target.style.display = 'none' }"
              >
            </div>
            <div v-else class="relative z-10 text-neutral-600">
              <div class="i-solar:gamepad-bold text-6xl" />
            </div>

            <!-- Title & Progress Bar / Spinner -->
            <div class="relative z-10 mt-3 flex flex-col items-center px-4 text-center">
              <div class="text-sm text-white font-bold tracking-wide drop-shadow-md">
                {{ currentGameTitle }}
              </div>
              <div
                v-if="isDosEngineLoading"
                class="mt-2 flex items-center gap-2 border border-white/10 rounded-full bg-black/70 px-3.5 py-1 text-xs text-neutral-200 shadow-lg backdrop-blur-md"
              >
                <div class="i-solar:restart-bold animate-spin text-sm text-primary-400" />
                <span>{{ dosLoadingProgress }}</span>
              </div>
            </div>
          </div>

          <div
            ref="dosContainerRef"
            class="h-full w-full overflow-hidden rounded-xl"
          />

          <!-- Ghost Cursor overlay for JSDOS -->
          <ArcadeGhostCursor
            v-if="activeEngine === 'jsdos'"
            :cursor-state="arcadeAgent.cursorState.value"
            :character-name="activeCard?.name || 'Airi'"
          />
        </div>
      </div>

      <!-- AI Companion Bottom Control Deck -->
      <div class="mt-3 flex items-center justify-between border border-neutral-200/50 rounded-xl bg-white/70 px-4 py-2.5 shadow-sm backdrop-blur-md dark:border-neutral-800/50 dark:bg-neutral-900/70">
        <!-- Left: Primary Companion Actions -->
        <div class="flex items-center gap-2.5">
          <!-- Airi Pass Controller / Take Turn -->
          <button
            class="shadow-2xs flex items-center gap-2 border rounded-lg px-3.5 py-1.5 text-xs text-white font-bold transition-all active:scale-95 disabled:opacity-50"
            :class="[
              arcadeAgent.turnState.value === 'executing'
                ? 'border-amber-500/40 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 animate-pulse'
                : arcadeAgent.turnState.value === 'thinking' || arcadeAgent.turnState.value === 'capturing'
                  ? 'border-purple-500/40 bg-gradient-to-r from-purple-600 to-indigo-600'
                  : 'border-purple-500/40 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700',
            ]"
            :disabled="isCapturing"
            :title="arcadeAgent.turnState.value === 'executing' ? 'Airi is currently playing! Click to take back controller.' : 'Pass the controller: Airi inspects the screen with your global VLM, shares tactical commentary, and takes a turn!'"
            @click="handleAiriTakeTurn"
          >
            <div
              :class="[
                arcadeAgent.turnState.value === 'thinking' || arcadeAgent.turnState.value === 'capturing'
                  ? 'i-solar:restart-bold animate-spin'
                  : arcadeAgent.turnState.value === 'executing'
                    ? 'i-solar:hand-shake-bold'
                    : 'i-solar:gamepad-charge-bold',
              ]"
              class="text-sm"
            />
            <span>
              {{
                arcadeAgent.turnState.value === 'capturing'
                  ? 'Observing Game...'
                  : arcadeAgent.turnState.value === 'thinking'
                    ? 'Airi Planning Move...'
                    : arcadeAgent.turnState.value === 'executing'
                      ? 'Take Back Controller'
                      : 'Pass to Airi'
              }}
            </span>
          </button>

          <!-- Auto-Play Toggle -->
          <label class="flex cursor-pointer select-none items-center gap-1.5 border border-neutral-200/80 rounded-lg bg-neutral-50/80 px-2.5 py-1.5 text-xs text-neutral-700 font-semibold transition-colors dark:border-neutral-700/80 dark:bg-neutral-800/80 hover:bg-neutral-100 dark:text-neutral-200">
            <input v-model="arcadeAgent.autoPlay.value" type="checkbox" class="size-3.5 rounded accent-purple-600">
            <span>Auto-Play</span>
          </label>
        </div>

        <!-- Right: Real-Time Companion Tools & Memory -->
        <div class="flex items-center gap-2">
          <!-- Quick Ask Airi -->
          <button
            class="shadow-2xs flex items-center gap-1.5 border border-primary-500/40 rounded-lg bg-primary-500 px-3 py-1.5 text-xs text-white font-bold transition-all active:scale-95 hover:bg-primary-600 disabled:opacity-50"
            :disabled="isCapturing"
            title="Instantly snap game screen and ask Airi what to do next"
            @click="handleQuickAsk"
          >
            <div :class="isCapturing ? 'i-solar:restart-bold animate-spin' : 'i-solar:plain-bold'" class="text-xs" />
            <span>Quick Ask Airi</span>
          </button>

          <!-- Attach Frame -->
          <button
            class="shadow-2xs dark:hover:bg-neutral-750 flex items-center gap-1.5 border border-neutral-200/80 rounded-lg bg-white px-2.5 py-1.5 text-xs text-neutral-700 font-medium transition-all active:scale-95 dark:border-neutral-700/80 dark:bg-neutral-800 hover:bg-neutral-50 dark:text-neutral-200 disabled:opacity-50"
            :disabled="isCapturing"
            title="Capture current game frame and attach to chat message"
            @click="handleAttachFrame"
          >
            <div class="i-solar:camera-bold text-xs text-primary-500" />
            <span>Attach Frame</span>
          </button>

          <!-- Turn Memory Indicator (if turns have occurred) -->
          <div
            v-if="arcadeAgent.turnHistory.value.length > 0"
            class="ml-1 flex items-center gap-1 border border-purple-500/20 rounded-full bg-purple-500/10 px-2.5 py-1 text-[10px] text-purple-600 font-medium dark:text-purple-400"
            :title="`Recorded ${arcadeAgent.turnHistory.value.length} recent turns in memory`"
          >
            <div class="i-solar:history-bold text-xs" />
            <span>Turn {{ arcadeAgent.turnHistory.value[arcadeAgent.turnHistory.value.length - 1].turnIndex }}</span>
          </div>
        </div>
      </div>

      <!-- Bottom Status & Controls Guide -->
      <div class="mt-3 flex items-center justify-between px-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        <div class="flex items-center gap-3">
          <template v-if="activeEngine === 'canvas-2048'">
            <span class="flex items-center gap-1">
              <kbd class="border border-neutral-300 rounded bg-neutral-200/50 px-1.5 py-0.5 text-[10px] font-mono dark:border-neutral-700 dark:bg-neutral-800">Arrows / WASD</kbd>
              Move
            </span>
            <span class="flex items-center gap-1">
              <kbd class="border border-neutral-300 rounded bg-neutral-200/50 px-1.5 py-0.5 text-[10px] font-mono dark:border-neutral-700 dark:bg-neutral-800">R</kbd>
              Restart
            </span>
            <span class="flex items-center gap-1">
              <kbd class="border border-neutral-300 rounded bg-neutral-200/50 px-1.5 py-0.5 text-[10px] font-mono dark:border-neutral-700 dark:bg-neutral-800">P</kbd>
              Pause
            </span>
          </template>
          <template v-else>
            <span class="flex items-center gap-1">
              <kbd class="border border-neutral-300 rounded bg-neutral-200/50 px-1.5 py-0.5 text-[10px] font-mono dark:border-neutral-700 dark:bg-neutral-800">Drag &amp; Drop</kbd>
              Load Custom .zip/.jsdos
            </span>
            <span class="flex items-center gap-1">
              <kbd class="border border-neutral-300 rounded bg-neutral-200/50 px-1.5 py-0.5 text-[10px] font-mono dark:border-neutral-700 dark:bg-neutral-800">IndexedDB</kbd>
              Offline Cached
            </span>
          </template>
        </div>
        <div class="text-[10px] text-neutral-400">
          Generic Gaming Runtime &bull; Phase 2 JS-DOS &amp; 8,000+ Catalog
        </div>
      </div>
    </div>

    <!-- 2. RIGHT PANE: Backseat Chat Stream (35% width, w-88 to w-96) -->
    <div class="w-88 flex flex-col bg-white/40 backdrop-blur-md dark:bg-neutral-950/20">
      <!-- Backseat Header -->
      <div class="flex items-center justify-between border-b border-neutral-200/40 p-3.5 dark:border-neutral-800/40">
        <div class="flex items-center gap-2.5">
          <div class="h-7 w-7 flex items-center justify-center rounded-lg bg-primary-500/10 text-primary-500">
            <div class="i-solar:chat-line-bold-duotone text-base" />
          </div>
          <div>
            <h4 class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
              {{ activeCard?.name || 'Airi' }}'s Live Reactions
            </h4>
            <span class="text-[10px] text-emerald-500 font-semibold">● Spectating {{ currentGameTitle }}</span>
          </div>
        </div>
      </div>

      <!-- Transcript Feed -->
      <div
        ref="transcriptContainerRef"
        class="flex-1 overflow-y-auto p-4 space-y-3"
      >
        <template v-for="msg in chatTranscript" :key="msg.id">
          <!-- Character Dialogue Bubble -->
          <div v-if="msg.sender === 'character'" class="flex flex-col items-start gap-1">
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-neutral-400 font-bold">{{ msg.authorName }}</span>
              <span
                v-if="msg.emotion && msg.emotion !== 'neutral'"
                class="rounded-full px-1.5 py-0.2 text-[8px] font-bold tracking-wider uppercase"
                :class="msg.emotion === 'smug'
                  ? 'bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300'
                  : msg.emotion === 'panicked'
                    ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300'"
              >
                {{ msg.emotion }}
              </span>
            </div>
            <div class="shadow-xs max-w-[90%] rounded-2xl rounded-tl-none bg-white p-3 text-xs text-neutral-800 leading-relaxed dark:bg-neutral-800/80 dark:text-neutral-200">
              <div
                v-if="msg.imageAttachment"
                class="mb-2 overflow-hidden border border-neutral-200 rounded-lg bg-black/40 shadow-inner dark:border-neutral-700"
              >
                <img
                  :src="msg.imageAttachment"
                  alt="Captured game screen"
                  class="max-h-44 w-full object-contain"
                >
              </div>
              <div>{{ msg.text }}</div>

              <!-- Turn Plan Card -->
              <div
                v-if="msg.turnPlan"
                class="mt-2.5 border border-purple-500/30 rounded-xl bg-purple-500/5 p-2.5 space-y-2 dark:border-purple-400/30 dark:bg-purple-950/20"
              >
                <div class="flex items-center justify-between gap-1 text-[11px] text-purple-700 font-bold dark:text-purple-300">
                  <div class="flex items-center gap-1.5">
                    <div class="i-solar:gamepad-charge-bold text-sm text-purple-500" />
                    <span>🎯 {{ msg.turnPlan.plan }}</span>
                  </div>
                  <span
                    v-if="msg.turnPlan.executed"
                    class="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] text-emerald-600 font-bold dark:bg-emerald-950/50 dark:text-emerald-400"
                  >
                    Executed ✓
                  </span>
                </div>

                <!-- Actions list -->
                <div
                  v-if="msg.turnPlan.actions?.length > 0"
                  class="flex flex-wrap gap-1 pt-0.5"
                >
                  <span
                    v-for="(act, idx) in msg.turnPlan.actions"
                    :key="idx"
                    class="shadow-2xs border border-neutral-200/80 rounded bg-white/90 px-1.5 py-0.5 text-[9px] text-neutral-700 font-mono dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  >
                    {{ act.type === 'click' ? `🖱️ Click (${act.x}, ${act.y})` : act.type === 'key_press' ? `⌨️ Key [${act.key}]` : act.type === 'type_text' ? `⌨️ Type "${act.text}"` : '⏳ Wait' }}
                  </span>
                </div>

                <!-- Execute Move Button -->
                <div
                  v-if="!msg.turnPlan.executed && msg.turnPlan.actions?.length > 0"
                  class="pt-1"
                >
                  <button
                    type="button"
                    class="shadow-xs w-full flex items-center justify-center gap-1.5 rounded-lg from-purple-600 to-indigo-600 bg-gradient-to-r px-3 py-1.5 text-[10px] text-white font-bold transition-all active:scale-95 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50"
                    :disabled="arcadeAgent.turnState.value !== 'idle'"
                    @click="handleExecuteMovesOnCanvas(msg.turnPlan)"
                  >
                    <div :class="arcadeAgent.turnState.value === 'executing' ? 'i-solar:restart-bold animate-spin' : 'i-solar:play-bold'" class="text-xs" />
                    <span>{{ arcadeAgent.turnState.value === 'executing' ? 'Executing Moves...' : '▶ Execute Moves on Canvas' }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- User Backseat Tip Bubble -->
          <div v-else class="flex flex-col items-end gap-1">
            <span class="text-[10px] text-neutral-400 font-bold">You (Backseat Tip)</span>
            <div class="shadow-xs max-w-[90%] rounded-2xl rounded-tr-none bg-primary-500 p-3 text-xs text-white leading-relaxed">
              <div
                v-if="msg.imageAttachment"
                class="mb-2 overflow-hidden border border-white/25 rounded-lg bg-black/40 shadow-inner"
              >
                <img
                  :src="msg.imageAttachment"
                  alt="Captured game screen"
                  class="max-h-44 w-full object-contain"
                >
              </div>
              <div>{{ msg.text }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- Quick Backseat Advice Chips -->
      <div class="border-t border-neutral-200/30 px-3 py-2 dark:border-neutral-800/30">
        <div class="mb-1 text-[9px] text-neutral-400 font-bold tracking-wider uppercase">
          Quick Backseat Calls
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="tip in ['Watch your health!', 'Check that corner!', 'Save your ammo!', 'Awesome move!']"
            :key="tip"
            class="rounded-lg bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 font-medium transition-colors dark:bg-neutral-800 hover:bg-primary-50 dark:text-neutral-300 hover:text-primary-600 dark:hover:bg-primary-950/30 dark:hover:text-primary-400"
            @click="handleSendAdvice(tip)"
          >
            {{ tip }}
          </button>
        </div>
      </div>

      <!-- Minimal Backseat Composer -->
      <div class="border-t border-neutral-200/40 p-3 dark:border-neutral-800/40">
        <!-- Attached Frame Preview Chip -->
        <div
          v-if="attachedFrame"
          class="mb-2 flex items-center justify-between gap-2 border border-primary-500/30 rounded-lg bg-primary-500/10 p-1.5 px-2 backdrop-blur-sm"
        >
          <div class="flex items-center gap-2 overflow-hidden">
            <img
              :src="attachedFrame.dataUrl"
              class="shadow-xs h-10 w-14 border border-primary-500/20 rounded object-cover"
              alt="Snapshot Preview"
            >
            <div class="flex flex-col overflow-hidden">
              <span class="text-[10px] text-primary-600 font-bold dark:text-primary-400">📸 Frame Snapshot Attached</span>
              <span class="truncate text-[9px] text-neutral-500 dark:text-neutral-400">{{ currentGameTitle }}</span>
            </div>
          </div>
          <button
            type="button"
            class="rounded p-1 text-neutral-400 transition-colors hover:text-rose-500 dark:hover:text-rose-400"
            title="Remove attachment"
            @click="attachedFrame = null"
          >
            <div class="i-solar:close-circle-bold text-base" />
          </button>
        </div>

        <form
          class="shadow-xs flex items-center gap-1.5 rounded-xl bg-white/80 p-1.5 ring-1 ring-neutral-200/60 dark:bg-neutral-900/80 dark:ring-neutral-800/60"
          @submit.prevent="handleSendAdvice()"
        >
          <button
            type="button"
            class="h-7 w-7 flex items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-primary-500 dark:hover:bg-neutral-800"
            :title="attachedFrame ? 'Frame snapshot attached' : 'Snap and attach game screen'"
            @click="handleAttachFrame"
          >
            <div class="i-solar:camera-bold text-sm" />
          </button>

          <input
            v-model="userInputText"
            type="text"
            placeholder="Give backseat advice..."
            class="flex-1 bg-transparent px-1.5 text-xs text-neutral-800 outline-none dark:text-neutral-200 placeholder:text-neutral-400"
            @keydown.stop
          >
          <button
            type="submit"
            :disabled="!userInputText.trim() && !attachedFrame"
            class="h-7 w-7 flex items-center justify-center rounded-lg bg-primary-500 text-white transition-opacity disabled:opacity-40"
          >
            <div class="i-solar:plain-bold text-xs" />
          </button>
        </form>
      </div>
    </div>

    <!-- Retro Arcade Catalog Modal -->
    <ArcadeCatalogModal
      :open="isCatalogOpen"
      @close="isCatalogOpen = false"
      @launch="handleCatalogLaunch"
    />
  </div>
</template>
