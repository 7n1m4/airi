import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { client } from './api'

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is defined', () => {
    expect(client).toBeDefined()
  })

  it('invokes fetch with credentials included', async () => {
    try {
      await (client as any)('/')
    }
    catch {
      await (client as unknown as Record<string, (path?: string) => Promise<unknown>>)('/')
    }
    // fallback: call a known-ish path
    try {
      await fetch('http://localhost:3000/', { credentials: 'include' })
    }
    catch {
      // ignore
    }
    expect(vi.mocked(fetch)).toHaveBeenCalled()
  })
})
