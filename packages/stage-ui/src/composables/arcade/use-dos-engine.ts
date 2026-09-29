import type { GameAdapter } from '../../types/arcade'

import JSZip from 'jszip'
import localforage from 'localforage'

import { computed, onMounted, onUnmounted, ref } from 'vue'

import { burnCoordinateGridToCanvas } from './utils/grid-overlay'

export interface ArchiveOrgResolvedGame {
  bundleUrl: string
  splashUrl?: string
  zipName: string
  emulatorStart?: string
}

export function useDosEngine(options?: {
  onGameReady?: (title: string) => void
  onLoadingProgress?: (progress: string) => void
  onError?: (err: any) => void
}) {
  const dosContainerRef = ref<HTMLDivElement | null>(null)
  let dosPlayerInstance: any = null
  let currentCommandInterface: any = null
  let isJsDosLoaded = false

  const isDosEngineLoading = ref(false)
  const dosLoadingProgress = ref('')
  const isGameReady = ref(false)
  const currentSplashUrl = ref<string | null>(null)
  const currentGameTitle = ref('')
  const currentGameIdentifier = ref('')
  const isPointerLocked = ref(false)
  const isMuted = ref(false)

  const isFpsGame = computed(() => {
    const title = (currentGameTitle.value || '').toLowerCase()
    const id = (currentGameIdentifier.value || '').toLowerCase()
    return (
      title.includes('doom')
      || title.includes('wolfenstein')
      || title.includes('heretic')
      || title.includes('hexen')
      || title.includes('quake')
      || id.includes('doom')
      || id.includes('wolf')
    )
  })

  // IndexedDB Stores
  const arcadeCacheStore = localforage.createInstance({
    name: 'airi-arcade-cache',
    storeName: 'games',
  })

  const arcadeSavestatesStore = localforage.createInstance({
    name: 'airi-arcade-savestates',
    storeName: 'states',
  })

  async function ensureJsDosLoaded(): Promise<any> {
    if (typeof (window as any).Dos === 'function') {
      return (window as any).Dos
    }
    if (isJsDosLoaded) {
      return (window as any).Dos
    }

    if (typeof document !== 'undefined') {
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
    }

    return (window as any).Dos
  }

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

  async function resolveArchiveOrgBundle(identifier: string): Promise<ArchiveOrgResolvedGame> {
    const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`
    const res = await fetch(metaUrl)
    if (!res.ok)
      throw new Error(`Failed to fetch metadata for ${identifier} (HTTP ${res.status})`)
    const data = await res.json()
    const manifest: any[] = data?.files || data?.result || []
    const emulatorStart: string | undefined = data?.metadata?.emulator_start

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

    if (!dosContainerRef.value) {
      throw new Error('DOS container ref is not mounted')
    }

    dosContainerRef.value.innerHTML = ''

    let effectiveBuffer = buffer
    try {
      const zip = await JSZip.loadAsync(buffer as any)
      let needsCustomConf = false
      let confContent = ''

      if (zip.file('.jsdos/dosbox.conf')) {
        confContent = await zip.file('.jsdos/dosbox.conf')!.async('string')
      }
      else if (zip.file('dosbox.conf')) {
        confContent = await zip.file('dosbox.conf')!.async('string')
        needsCustomConf = true
      }
      else {
        needsCustomConf = true
      }

      if (needsCustomConf) {
        let exeToLaunch = emulatorStart || ''
        if (!exeToLaunch) {
          const files = Object.keys(zip.files)
          const exe = files.find(f => !f.includes('/') && f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('setup') && !f.toLowerCase().includes('install'))
            || files.find(f => !f.includes('/') && f.toLowerCase().endsWith('.com'))
            || files.find(f => !f.includes('/') && f.toLowerCase().endsWith('.bat'))
            || files.find(f => f.toLowerCase().endsWith('.exe'))
            || files.find(f => f.toLowerCase().endsWith('.bat'))
          if (exe) {
            exeToLaunch = exe.split('/').pop() || exe
          }
        }

        const autoexecCmd = exeToLaunch ? `${exeToLaunch}\n` : ''
        confContent = `[dosbox]\nmemsize=32\n\n[cpu]\ncycles=max\n\n[render]\naspect=true\n\n[autoexec]\nmount c .\nc:\n${autoexecCmd}`
        zip.file('.jsdos/dosbox.conf', confContent)
        effectiveBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })
      }
    }
    catch (err) {
      console.error('[useDosEngine] Error verifying/synthesizing bundle:', err)
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
      mouseCapture: isFpsGame.value,
      fsChanges: {
        local: true,
        urlToKey: async () => currentGameIdentifier.value,
      },
      onEvent: (event: string, ci: any) => {
        if (event === 'ci-ready') {
          currentCommandInterface = ci
          if (typeof window !== 'undefined') {
            const win = window as any
            win.__AIRI_ARCADE_CI__ = ci
            win.__AIRI_ARCADE_CLICK__ = executeClick
            win.__AIRI_ARCADE_DRAG__ = executeDrag
          }
          isGameReady.value = true
          isDosEngineLoading.value = false
          options?.onGameReady?.(gameTitle)
        }
      },
    })

    return effectiveBuffer
  }

  async function launchDosGame(game: { identifier: string, title: string, bundleUrl?: string, thumbnailUrl?: string }) {
    isDosEngineLoading.value = true
    isGameReady.value = false
    dosLoadingProgress.value = 'Preparing emulator...'
    options?.onLoadingProgress?.(dosLoadingProgress.value)

    currentSplashUrl.value = game.thumbnailUrl || `https://archive.org/services/img/${game.identifier}`

    try {
      currentGameTitle.value = game.title
      currentGameIdentifier.value = game.identifier

      let gameBuffer = await arcadeCacheStore.getItem<ArrayBuffer>(game.identifier)
      let emulatorStart: string | undefined

      if (gameBuffer) {
        dosLoadingProgress.value = 'Loading from local cache...'
        options?.onLoadingProgress?.(dosLoadingProgress.value)
      }
      else {
        let targetUrl = game.bundleUrl
        if (!targetUrl) {
          dosLoadingProgress.value = 'Resolving game bundle...'
          options?.onLoadingProgress?.(dosLoadingProgress.value)
          const resolved = await resolveArchiveOrgBundle(game.identifier)
          targetUrl = resolved.bundleUrl
          emulatorStart = resolved.emulatorStart
          if (resolved.splashUrl) {
            currentSplashUrl.value = resolved.splashUrl
          }
        }

        dosLoadingProgress.value = 'Downloading game 0%...'
        options?.onLoadingProgress?.(dosLoadingProgress.value)
        gameBuffer = await fetchWithProgress(targetUrl, (pct) => {
          dosLoadingProgress.value = `Downloading game ${pct}%...`
          options?.onLoadingProgress?.(dosLoadingProgress.value)
        })

        try {
          await arcadeCacheStore.setItem(game.identifier, gameBuffer)
        }
        catch (cacheErr) {
          console.warn('[useDosEngine] Failed to cache game in IndexedDB:', cacheErr)
        }
      }

      dosLoadingProgress.value = 'Booting DOSBox...'
      options?.onLoadingProgress?.(dosLoadingProgress.value)
      await mountDosGame(gameBuffer, game.title, emulatorStart)
    }
    catch (err: any) {
      console.error('[useDosEngine] Failed to load game:', err)
      isDosEngineLoading.value = false
      dosLoadingProgress.value = ''
      options?.onError?.(err)
      throw err
    }
  }

  async function launchCustomFile(file: File) {
    isDosEngineLoading.value = true
    isGameReady.value = false
    currentSplashUrl.value = null
    dosLoadingProgress.value = `Reading ${file.name}...`
    options?.onLoadingProgress?.(dosLoadingProgress.value)

    try {
      const buffer = await file.arrayBuffer()
      const customId = `custom_${file.name.replace(/\W/g, '_')}`
      currentGameTitle.value = file.name.replace(/\.(zip|jsdos)$/i, '')
      currentGameIdentifier.value = customId

      dosLoadingProgress.value = 'Mounting custom bundle...'
      options?.onLoadingProgress?.(dosLoadingProgress.value)
      const readyBuffer = await mountDosGame(buffer, currentGameTitle.value)
      await arcadeCacheStore.setItem(customId, readyBuffer)
    }
    catch (err: any) {
      console.error('[useDosEngine] Failed to launch custom file:', err)
      isDosEngineLoading.value = false
      dosLoadingProgress.value = ''
      options?.onError?.(err)
      throw err
    }
  }

  // Pointer Lock Controls
  function onPointerLockChange() {
    const canvas = dosContainerRef.value?.querySelector('canvas')
    isPointerLocked.value = !!(
      document.pointerLockElement
      && (document.pointerLockElement === canvas || dosContainerRef.value?.contains(document.pointerLockElement))
    )
  }

  function requestGamePointerLock() {
    const target = (dosContainerRef.value?.querySelector('.emulator-mouse-overlay') as HTMLElement | null)
      || (dosContainerRef.value?.querySelector('canvas') as HTMLElement | null)
    if (target && typeof target.requestPointerLock === 'function') {
      try {
        target.requestPointerLock()
      }
      catch (err) {
        console.warn('[useDosEngine] Pointer lock request failed:', err)
      }
    }
  }

  function releaseGamePointerLock() {
    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      try {
        document.exitPointerLock()
      }
      catch (err) {
        console.warn('[useDosEngine] Pointer lock exit failed:', err)
      }
    }
  }

  // Savestates
  async function quickSave(): Promise<boolean> {
    if (!currentCommandInterface) {
      return false
    }

    try {
      const state = await currentCommandInterface.persist()
      if (state) {
        await arcadeSavestatesStore.setItem(currentGameIdentifier.value, state)
        return true
      }
    }
    catch (err) {
      console.error('[useDosEngine] QuickSave error:', err)
    }
    return false
  }

  async function quickLoad(): Promise<boolean> {
    try {
      const state = await arcadeSavestatesStore.getItem<Uint8Array | Blob | ArrayBuffer>(currentGameIdentifier.value)
      if (!state)
        return false

      isDosEngineLoading.value = true
      dosLoadingProgress.value = 'Preparing savestate...'
      options?.onLoadingProgress?.(dosLoadingProgress.value)

      let baseBuffer = await arcadeCacheStore.getItem<ArrayBuffer | Blob>(currentGameIdentifier.value)
      let emulatorStart: string | undefined

      if (!baseBuffer) {
        const resolved = await resolveArchiveOrgBundle(currentGameIdentifier.value)
        baseBuffer = await fetchWithProgress(resolved.bundleUrl, (pct) => {
          dosLoadingProgress.value = `Downloading base game ${pct}%...`
          options?.onLoadingProgress?.(dosLoadingProgress.value)
        })
        emulatorStart = resolved.emulatorStart
      }

      let rawBaseBuffer: ArrayBuffer
      if (baseBuffer instanceof Blob) {
        rawBaseBuffer = await (baseBuffer as Blob).arrayBuffer()
      }
      else if ((baseBuffer as any) instanceof ArrayBuffer) {
        rawBaseBuffer = baseBuffer as ArrayBuffer
      }
      else {
        rawBaseBuffer = (baseBuffer as any).buffer
      }

      let stateBytes: Uint8Array | ArrayBuffer
      if (state instanceof Blob) {
        stateBytes = await (state as Blob).arrayBuffer()
      }
      else if ((state as any) instanceof Uint8Array) {
        stateBytes = state as Uint8Array
      }
      else {
        stateBytes = (state as any).buffer || state
      }

      dosLoadingProgress.value = 'Merging savestate...'
      options?.onLoadingProgress?.(dosLoadingProgress.value)
      const baseZip = await JSZip.loadAsync(rawBaseBuffer.slice(0))
      const deltaZip = await JSZip.loadAsync(stateBytes)

      for (const [relativePath, entry] of Object.entries(deltaZip.files)) {
        if (!entry.dir) {
          if (relativePath === '.jsdos/dosbox.conf' && baseZip.file('.jsdos/dosbox.conf')) {
            continue
          }
          const fileData = await entry.async('uint8array')
          baseZip.file(relativePath, fileData)
        }
      }

      const mergedBuffer = await baseZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })
      dosLoadingProgress.value = 'Booting DOSBox with savestate...'
      options?.onLoadingProgress?.(dosLoadingProgress.value)
      await mountDosGame(mergedBuffer, currentGameTitle.value, emulatorStart)
      return true
    }
    catch (err) {
      console.error('[useDosEngine] QuickLoad error:', err)
      isDosEngineLoading.value = false
      dosLoadingProgress.value = ''
      return false
    }
  }

  // Key details resolution
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

  async function executeKeyPress(rawKey: string, durationMs = 60) {
    const details = resolveKeyDetails(rawKey)
    const target = (dosContainerRef.value?.querySelector('canvas') as HTMLElement | null) || window

    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: details.key,
      code: details.code,
      keyCode: details.keyCode,
      which: details.keyCode,
      bubbles: true,
      cancelable: true,
    }))

    await new Promise(r => setTimeout(r, durationMs))

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
          await new Promise(r => setTimeout(r, durationMs))
          currentCommandInterface.sendKeyEvent(details.keyCode, false)
        }
      }
      catch (err) {
        console.warn('[useDosEngine] CI sendKeyEvent failed:', err)
      }
    }
  }

  async function executeTypeText(text: string) {
    for (const char of text) {
      await executeKeyPress(char, 50)
      await new Promise(r => setTimeout(r, 60))
    }
  }

  async function executeClick(normX: number, normY: number, button: 'left' | 'right' | 'middle' = 'left') {
    const clampedX = Math.max(0, Math.min(1000, normX))
    const clampedY = Math.max(0, Math.min(1000, normY))

    const ci = currentCommandInterface || (typeof window !== 'undefined' ? (window as any).__AIRI_ARCADE_CI__ : null)
    if (!ci)
      return

    try {
      let gameX = clampedX / 1000
      let gameY = clampedY / 1000

      const container = dosContainerRef.value
      const canvas = container?.querySelector('canvas')
      if (container && canvas) {
        const cRect = container.getBoundingClientRect()
        const kRect = canvas.getBoundingClientRect()
        if (kRect.width > 0 && kRect.height > 0) {
          const clientX = cRect.left + (clampedX / 1000) * cRect.width
          const clientY = cRect.top + (clampedY / 1000) * cRect.height
          gameX = Math.max(0, Math.min(1, (clientX - kRect.left) / kRect.width))
          gameY = Math.max(0, Math.min(1, (clientY - kRect.top) / kRect.height))
        }
      }

      ci.sendMouseMotion?.(gameX, gameY)
      await new Promise(r => setTimeout(r, 60))

      const btn = button === 'right' ? 2 : button === 'middle' ? 1 : 0
      ci.sendMouseButton?.(btn, true)
      await new Promise(r => setTimeout(r, 120))
      ci.sendMouseButton?.(btn, false)
    }
    catch (err) {
      console.warn('[useDosEngine] CI executeClick failed:', err)
    }
  }

  async function executeDrag(fromNormX: number, fromNormY: number, toNormX: number, toNormY: number) {
    const normStartX = Math.max(0, Math.min(1000, fromNormX))
    const normStartY = Math.max(0, Math.min(1000, fromNormY))
    const normEndX = Math.max(0, Math.min(1000, toNormX))
    const normEndY = Math.max(0, Math.min(1000, toNormY))

    const ci = currentCommandInterface || (typeof window !== 'undefined' ? (window as any).__AIRI_ARCADE_CI__ : null)
    if (!ci)
      return

    try {
      let startX = normStartX / 1000
      let startY = normStartY / 1000
      let endX = normEndX / 1000
      let endY = normEndY / 1000

      const container = dosContainerRef.value
      const canvas = container?.querySelector('canvas')
      if (container && canvas) {
        const cRect = container.getBoundingClientRect()
        const kRect = canvas.getBoundingClientRect()
        if (kRect.width > 0 && kRect.height > 0) {
          const startClientX = cRect.left + (normStartX / 1000) * cRect.width
          const startClientY = cRect.top + (normStartY / 1000) * cRect.height
          const endClientX = cRect.left + (normEndX / 1000) * cRect.width
          const endClientY = cRect.top + (normEndY / 1000) * cRect.height

          startX = Math.max(0, Math.min(1, (startClientX - kRect.left) / kRect.width))
          startY = Math.max(0, Math.min(1, (startClientY - kRect.top) / kRect.height))
          endX = Math.max(0, Math.min(1, (endClientX - kRect.left) / kRect.width))
          endY = Math.max(0, Math.min(1, (endClientY - kRect.top) / kRect.height))
        }
      }

      ci.sendMouseMotion?.(startX, startY)
      await new Promise(r => setTimeout(r, 60))
      ci.sendMouseButton?.(0, true)
      await new Promise(r => setTimeout(r, 80))

      const dist = Math.hypot(normEndX - normStartX, normEndY - normStartY)
      const steps = Math.max(12, Math.min(60, Math.ceil(dist / 8)))
      for (let s = 1; s <= steps; s++) {
        const curX = startX + (endX - startX) * (s / steps)
        const curY = startY + (endY - startY) * (s / steps)
        ci.sendMouseMotion?.(curX, curY)
        await new Promise(r => setTimeout(r, 25))
      }

      ci.sendMouseMotion?.(endX, endY)
      await new Promise(r => setTimeout(r, 80))
      ci.sendMouseButton?.(0, false)
      await new Promise(r => setTimeout(r, 60))
    }
    catch (err) {
      console.warn('[useDosEngine] CI executeDrag failed:', err)
    }
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

  function duckAudio(duck: boolean) {
    if (currentCommandInterface?.sound) {
      try {
        if (typeof currentCommandInterface.sound.setVolume === 'function') {
          currentCommandInterface.sound.setVolume(duck ? 0.3 : 1.0)
        }
      }
      catch {}
    }
  }

  function stopEngine() {
    if (currentCommandInterface) {
      try {
        currentCommandInterface.exit()
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

    isGameReady.value = false
    isDosEngineLoading.value = false
    dosLoadingProgress.value = ''
  }

  function captureFrame(withGrid = false): { dataUrl: string, base64: string, mimeType: string } | null {
    const canvas = dosContainerRef.value?.querySelector('canvas')
    if (!canvas)
      return null
    return burnCoordinateGridToCanvas(canvas, withGrid)
  }

  function createGameAdapter(): GameAdapter {
    return {
      id: currentGameIdentifier.value || 'jsdos',
      title: currentGameTitle.value || 'DOS Game',
      engine: 'jsdos',
      captureFrame: async () => {
        const frame = captureFrame(false)
        return frame?.dataUrl || null
      },
      getCanvasElement: () => {
        return dosContainerRef.value?.querySelector('canvas') || null
      },
      executeClick,
      executeDrag,
      executeKeyPress,
      executeTypeText,
      duckAudio,
    }
  }

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerlockchange', onPointerLockChange)
    }
  })

  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
    }
    stopEngine()
  })

  return {
    dosContainerRef,
    isDosEngineLoading,
    dosLoadingProgress,
    isGameReady,
    currentSplashUrl,
    currentGameTitle,
    currentGameIdentifier,
    isPointerLocked,
    isMuted,
    isFpsGame,
    ensureJsDosLoaded,
    mountDosGame,
    launchDosGame,
    launchCustomFile,
    requestGamePointerLock,
    releaseGamePointerLock,
    quickSave,
    quickLoad,
    executeClick,
    executeDrag,
    executeKeyPress,
    executeTypeText,
    toggleMute,
    duckAudio,
    stopEngine,
    captureFrame,
    createGameAdapter,
  }
}
