import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, watch } from 'vue'

// Mock browser environment for Node.js Vitest runner
if (typeof window === 'undefined') {
  ;(globalThis as any).window = globalThis
}

const eventTarget = new EventTarget()
if (!globalThis.window.addEventListener) {
  globalThis.window.addEventListener = eventTarget.addEventListener.bind(eventTarget)
}
if (!globalThis.window.removeEventListener) {
  globalThis.window.removeEventListener = eventTarget.removeEventListener.bind(eventTarget)
}
if (!globalThis.window.dispatchEvent) {
  globalThis.window.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget)
}

const store = new Map<string, string>()
const storageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => store.set(key, String(val)),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size
  },
}

try {
  delete (globalThis as any).localStorage
}
catch {}
Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  writable: true,
  configurable: true,
})
if (globalThis.window) {
  try {
    delete (globalThis.window as any).localStorage
  }
  catch {}
  Object.defineProperty(globalThis.window, 'localStorage', {
    value: storageMock,
    writable: true,
    configurable: true,
  })
}

const { setSSRHandler } = await import('@vueuse/core')
setSSRHandler('getDefaultStorage', () => storageMock)

const { useLocalStorageManualReset } = await import('./use-local-storage-manual-reset')

describe('useLocalStorageManualReset', () => {
  beforeEach(() => {
    store.clear()
  })

  afterEach(() => {
    store.clear()
  })

  it('does not reflect persisted values when storage listening is disabled', async () => {
    const state = useLocalStorageManualReset('cards', new Map<string, string>(), {
      listenToStorageChanges: false,
    })
    let changes = 0
    const stop = watch(state, () => {
      changes += 1
    }, { flush: 'sync' })

    state.value = new Map([['card-1', 'ReLU']])
    await nextTick()

    expect(changes).toBe(1)
    expect(state.value).toEqual(new Map([['card-1', 'ReLU']]))
    stop()
  })

  // ROOT CAUSE:
  // `refManualReset` resets to `toValue(source)`, and the source was the
  // storage ref. So `reset()` assigned the value that storage already held.
  it('restores the initial value and stores it when reset', async () => {
    const state = useLocalStorageManualReset('provider', 'default')

    state.value = 'changed'
    await nextTick()
    expect(globalThis.localStorage.getItem('provider')).toBe('changed')

    state.reset()
    await nextTick()

    expect(state.value).toBe('default')
    expect(globalThis.localStorage.getItem('provider')).toBe('default')
  })

  it('restores the initial value when storage held a value before the ref was created', async () => {
    globalThis.localStorage.setItem('provider', 'stored')
    const state = useLocalStorageManualReset('provider', 'default')
    expect(state.value).toBe('stored')

    state.reset()
    await nextTick()

    expect(state.value).toBe('default')
    expect(globalThis.localStorage.getItem('provider')).toBe('default')
  })

  // ROOT CAUSE:
  // The storage ref wraps an object default in a deep reactive proxy. So an
  // in-place write also changed the object that the caller passed in.
  it('restores an object initial value after an in-place write', async () => {
    const state = useLocalStorageManualReset('offset', { x: 0, y: 0 })

    state.value.x = 5
    await nextTick()

    state.reset()
    await nextTick()

    expect(state.value).toEqual({ x: 0, y: 0 })
    expect(globalThis.localStorage.getItem('offset')).toBe('{"x":0,"y":0}')
  })

  // ROOT CAUSE:
  // `reset()` put a plain copy of the default into the state. In-place writes
  // to it skipped the storage proxy, so storage and deep watchers missed them.
  it('stores in-place writes made after a reset', async () => {
    const state = useLocalStorageManualReset('offset', { x: 0, y: 0 })
    let changes = 0
    const stop = watch(state, () => {
      changes += 1
    }, { deep: true, flush: 'sync' })

    state.reset()
    await nextTick()
    changes = 0

    state.value.x = 7
    await nextTick()

    expect(changes).toBe(1)
    expect(globalThis.localStorage.getItem('offset')).toBe('{"x":7,"y":0}')
    stop()
  })

  it('stores Map writes made after a reset', async () => {
    const state = useLocalStorageManualReset('cards', new Map<string, string>(), {
      listenToStorageChanges: false,
    })

    state.reset()
    await nextTick()

    state.value.set('card-1', 'ReLU')
    await nextTick()

    expect(JSON.parse(globalThis.localStorage.getItem('cards')!)).toEqual([['card-1', 'ReLU']])
  })

  it('executes getter initial values on each reset', async () => {
    let callCount = 0
    const state = useLocalStorageManualReset('getter-arr', () => {
      callCount += 1
      return [`item-${callCount}`]
    })

    expect(state.value).toEqual(['item-1'])
    state.value = ['mutated']
    await nextTick()

    state.reset()
    await nextTick()

    expect(state.value).toEqual(['item-2'])
  })
})
