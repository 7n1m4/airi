import type { MockInstance } from 'vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isBrowserAndMemoryEnough,
  logWarn,
  normalizeProviderBaseUrl,
  toProviderRootBaseUrl,
  toV1SpeechBaseUrl,
  validateProviderBaseUrl,
} from './helpers'

vi.mock('@proj-airi/stage-shared', () => ({
  isUrl: (url: string) => {
    try {
      // eslint-disable-next-line no-new
      new URL(url)
      return true
    }
    catch {
      return false
    }
  },
}))

const { isWebGPUSupported } = vi.hoisted(() => ({ isWebGPUSupported: vi.fn() }))
vi.mock('@proj-airi/stage-shared/webgpu', () => ({
  isWebGPUSupported,
}))

const DEBUG_KEY = 'airi:debug'

describe('logWarn', () => {
  const debugFlag = (value: string) => localStorage.setItem(DEBUG_KEY, value)

  let warnSpy: MockInstance<Console['warn']>

  beforeEach(() => {
    localStorage.removeItem(DEBUG_KEY)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    localStorage.removeItem(DEBUG_KEY)
  })

  it('does not log when the debug flag is unset', () => {
    logWarn('hidden')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not log when the debug flag is not "1"', () => {
    debugFlag('0')
    logWarn('hidden')
    expect(warnSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalledWith('hidden')
  })

  it('logs every argument when the debug flag is "1"', () => {
    debugFlag('1')
    logWarn('a', { b: 1 }, 3)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('a', { b: 1 }, 3)
  })

  it('logs nothing but stays silent when the flag is set differently', () => {
    debugFlag('true')
    logWarn('still hidden')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by the storage access', () => {
    // The setup installs a Map-backed localStorage object; shadow getItem on
    // that object so logWarn's try/catch path is exercised.
    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => logWarn('x')).not.toThrow()
    // LogWarn reached the storage read (so the throw happened inside its try)
    // and returned normally, which only the catch block can explain.
    expect(getItemSpy).toHaveBeenCalledWith(DEBUG_KEY)
    expect(warnSpy).not.toHaveBeenCalled()

    getItemSpy.mockRestore()
  })
})

describe('normalizeProviderBaseUrl', () => {
  it('returns an empty string for non-string inputs', () => {
    expect(normalizeProviderBaseUrl(undefined)).toBe('')
    expect(normalizeProviderBaseUrl(null)).toBe('')
    expect(normalizeProviderBaseUrl(123)).toBe('')
    expect(normalizeProviderBaseUrl({ url: 'https://x/' })).toBe('')
  })

  it('returns an empty string for blank strings', () => {
    expect(normalizeProviderBaseUrl('')).toBe('')
    expect(normalizeProviderBaseUrl('   ')).toBe('')
    expect(normalizeProviderBaseUrl('\t\n')).toBe('')
  })

  it('appends a trailing slash when missing', () => {
    expect(normalizeProviderBaseUrl('https://api.example.com')).toBe('https://api.example.com/')
  })

  it('keeps an existing trailing slash without duplicating it', () => {
    expect(normalizeProviderBaseUrl('https://api.example.com/')).toBe('https://api.example.com/')
  })

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizeProviderBaseUrl('  https://api.example.com  ')).toBe('https://api.example.com/')
    expect(normalizeProviderBaseUrl('  https://api.example.com/  ')).toBe('https://api.example.com/')
  })

  it('preserves paths and query strings intact', () => {
    expect(normalizeProviderBaseUrl('https://api.example.com/v1/audio')).toBe('https://api.example.com/v1/audio/')
  })
})

describe('toV1SpeechBaseUrl', () => {
  it('appends "v1/" to a bare base URL', () => {
    expect(toV1SpeechBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1/')
  })

  it('does not append when the URL already ends with "v1/"', () => {
    expect(toV1SpeechBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/')
  })

  it('appends "v1/" after a non-v1 path segment', () => {
    expect(toV1SpeechBaseUrl('https://api.example.com/api')).toBe('https://api.example.com/api/v1/')
  })

  it('forwards blank inputs as empty strings', () => {
    expect(toV1SpeechBaseUrl('')).toBe('')
    expect(toV1SpeechBaseUrl('   ')).toBe('')
    expect(toV1SpeechBaseUrl(undefined)).toBe('')
  })

  it('trims whitespace before deciding', () => {
    expect(toV1SpeechBaseUrl(' http://localhost:8880/v1/ ')).toBe('http://localhost:8880/v1/')
  })

  it('does not treat a "/v1" prefix in the middle as already normalized', () => {
    expect(toV1SpeechBaseUrl('https://api.example.com/v1beta')).toBe('https://api.example.com/v1beta/v1/')
  })
})

describe('toProviderRootBaseUrl', () => {
  it('strips the trailing "v1/" segment', () => {
    expect(toProviderRootBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/')
  })

  it('adds "v1/" then strips it, ending back at the root', () => {
    expect(toProviderRootBaseUrl('https://api.example.com')).toBe('https://api.example.com/')
  })

  it('only strips a trailing "v1/", never a middle occurrence', () => {
    expect(toProviderRootBaseUrl('https://api.example.com/v1/audio/')).toBe('https://api.example.com/v1/audio/')
  })

  it('keeps the "/v1/" path when the caller still holds a v1 URL', () => {
    expect(toProviderRootBaseUrl('http://localhost:8880/v1/')).toBe('http://localhost:8880/')
  })

  it('returns an empty string for blank inputs', () => {
    expect(toProviderRootBaseUrl('')).toBe('')
    expect(toProviderRootBaseUrl(null)).toBe('')
  })
})

describe('validateProviderBaseUrl', () => {
  it('returns null for a valid absolute base URL ending with "/"', () => {
    expect(validateProviderBaseUrl('https://api.example.com/')).toBeNull()
  })

  it('reports a missing base URL for null/undefined', () => {
    for (const value of [null, undefined]) {
      const result = validateProviderBaseUrl(value)
      expect(result).not.toBeNull()
      expect(result!.valid).toBe(false)
      expect(result!.reason).toBe('Base URL is required.')
      expect(result!.errors).toHaveLength(1)
      expect((result!.errors[0] as Error).message).toBe('Base URL is required.')
    }
  })

  it('reports a missing base URL for an empty string only', () => {
    const result = validateProviderBaseUrl('')
    expect(result!.reason).toBe('Base URL is required.')
    expect(result!.valid).toBe(false)
  })

  it('treats a whitespace-only string as non-absolute', () => {
    // Falsy-string and string checks both pass, so the URL parser rejects it.
    const result = validateProviderBaseUrl('   ')
    expect(result!.reason).toBe('Base URL is not absolute. Try to include a scheme (http:// or https://).')
    expect(result!.valid).toBe(false)
  })

  it('reports a non-string base URL', () => {
    const result = validateProviderBaseUrl(42)
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(false)
    expect(result!.reason).toBe('Base URL must be a string.')
    expect((result!.errors[0] as Error).message).toBe('Base URL must be a string.')
  })

  it('reports a base URL that fails URL parsing', () => {
    const result = validateProviderBaseUrl('not a url with spaces/')
    expect(result!.reason).toBe('Base URL is not absolute. Try to include a scheme (http:// or https://).')
    expect(result!.valid).toBe(false)
  })

  it('reports a scheme-relative base URL as non-absolute', () => {
    const result = validateProviderBaseUrl('/api/v1/')
    expect(result!.reason).toBe('Base URL is not absolute. Try to include a scheme (http:// or https://).')
  })

  it('reports a base URL with a scheme but empty host', () => {
    const result = validateProviderBaseUrl('file:///')
    expect(result!.reason).toBe('Base URL is not absolute. Try to include a scheme (http:// or https://).')
    expect(result!.valid).toBe(false)
  })

  it('reports a valid absolute base URL missing its trailing slash', () => {
    const result = validateProviderBaseUrl('https://api.example.com')
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(false)
    expect(result!.reason).toBe('Base URL must end with a trailing slash (/).')
    expect((result!.errors[0] as Error).message).toBe('Base URL must end with a trailing slash (/).')
  })

  it('accepts http and https schemes alike', () => {
    expect(validateProviderBaseUrl('http://localhost:8880/')).toBeNull()
    expect(validateProviderBaseUrl('https://api.example.com/')).toBeNull()
  })
})

describe('isBrowserAndMemoryEnough', () => {
  const originalDeviceMemory = Object.getOwnPropertyDescriptor(globalThis.navigator, 'deviceMemory')

  /** Redefine the instance property so each case can report its own value. */
  const deviceMemory = (value: unknown) => Object.defineProperty(globalThis.navigator, 'deviceMemory', { value, configurable: true, writable: true })

  beforeEach(() => {
    isWebGPUSupported.mockReset()
    if (originalDeviceMemory)
      Object.defineProperty(globalThis.navigator, 'deviceMemory', originalDeviceMemory)
  })

  afterEach(() => {
    if (originalDeviceMemory)
      Object.defineProperty(globalThis.navigator, 'deviceMemory', originalDeviceMemory)
    else
      Reflect.deleteProperty(globalThis.navigator, 'deviceMemory')
  })

  it('returns true when WebGPU is supported', async () => {
    isWebGPUSupported.mockResolvedValue(true)
    deviceMemory(2)
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(true)
  })

  it('ignores low device memory when WebGPU is supported', async () => {
    isWebGPUSupported.mockResolvedValue(true)
    deviceMemory(1)
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(true)
  })

  it('returns true when device memory meets the 8 GiB threshold', async () => {
    isWebGPUSupported.mockResolvedValue(false)
    deviceMemory(8)
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(true)
  })

  it('returns true when device memory exceeds the threshold', async () => {
    isWebGPUSupported.mockResolvedValue(false)
    deviceMemory(16)
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(true)
  })

  it('returns false when device memory is below the threshold', async () => {
    isWebGPUSupported.mockResolvedValue(false)
    deviceMemory(4)
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(false)
  })

  it('returns false when device memory is not reported', async () => {
    isWebGPUSupported.mockResolvedValue(false)
    Reflect.deleteProperty(globalThis.navigator, 'deviceMemory')
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(false)
  })

  it('returns false when device memory is not a number', async () => {
    isWebGPUSupported.mockResolvedValue(false)
    deviceMemory('16')
    await expect(isBrowserAndMemoryEnough()).resolves.toBe(false)
  })
})
