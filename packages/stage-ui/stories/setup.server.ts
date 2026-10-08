import './setup'

// Mock browser globals for server-side story collection (Vite-Node)
// This prevents crashes from packages that assume a browser environment
const g = globalThis as any

// Live2D Cubism Core mock
g.Live2DCubismCore = {
  CubismFramework: {
    startUp: () => {},
    cleanUp: () => {},
    option: () => ({}),
  },
}

// Audio & Web API mocks
g.AudioWorkletNode = class {}
g.OfflineAudioContext = class {}
g.AudioContext = class {}

g.CSS = undefined

// NOTICE: collection workers run in Tinypool worker threads behind a JSDOM
// window (no localStorage), while globalThis.BroadcastChannel is Node's
// native implementation. Module-scope `localStorage.getItem` calls and raw
// `new BroadcastChannel` usages (screen-watcher, web-llm-channel, beat-sync,
// speech bus, dating-sim, cloudflare) then crash collection: the former with
// "Cannot read properties of undefined", the latter fatally with
// ERR_INVALID_ARG_TYPE when a post crosses worker realms into a foreign
// MessageEvent. Static collection needs neither, so stub them here.
const memoryStorage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
})()
if (typeof g.localStorage === 'undefined')
  g.localStorage = memoryStorage
if (typeof g.sessionStorage === 'undefined')
  g.sessionStorage = memoryStorage

class NoopBroadcastChannel {
  name: string
  onmessage: ((event: any) => void) | null = null
  constructor(name: string) {
    this.name = name
  }

  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
g.BroadcastChannel = NoopBroadcastChannel
