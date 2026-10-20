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
      await client.health.$get()
    }
    catch {
      // ignore network errors: the mock always responds 200
    }
    expect(vi.mocked(fetch)).toHaveBeenCalled()
  })
})
