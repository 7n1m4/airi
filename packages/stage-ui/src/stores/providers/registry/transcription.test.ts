import { describe, expect, it, vi } from 'vitest'

import { transcriptionMetadata } from './transcription'

describe('transcription registry coverage', () => {
  describe('extra branches', () => {
    it('aliyun transcription fn', async () => {
      const meta = (transcriptionMetadata as any)['aliyun-nls-transcription']
      const provider: any = await meta.createProvider({ accessKeyId: 'a', accessKeySecret: 's', appKey: 'k', region: 'cn-shanghai' })
      const t = provider.transcription('m', {})
      expect(typeof t).toBe('object')
    })
    it('mimo non-blob and mp3', async () => {
      const meta = (transcriptionMetadata as any)['mimo-audio-transcription']
      const provider: any = await meta.createProvider({ apiKey: 'key', baseUrl: 'https://api.xiaomimimo.com/v1/', model: 'mimo-v2-omni' })
      const t = provider.transcription('mimo-v2-omni')
      const fd = new FormData()
      fd.append('file', 'notblob' as any)
      try { await t.fetch('url', { body: fd }) }
      catch {}
      const fd2 = new FormData()
      fd2.append('file', new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }))
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })) as any
      const res = await t.fetch('url', { body: fd2 })
      await res.json()
    })
  })
  it('exercises all metadata entries', async () => {
    for (const [id, meta] of Object.entries(transcriptionMetadata)) {
      expect(meta.id).toBe(id)
      // defaultOptions
      if (typeof meta.defaultOptions === 'function') {
        const opts = meta.defaultOptions()
        expect(opts).toBeTruthy()
      }
      // isAvailableBy
      if ('isAvailableBy' in meta && typeof meta.isAvailableBy === 'function') {
        try { await meta.isAvailableBy() }
        catch { /* ignore */ }
      }
      // validators
      if (meta.validators?.validateProviderConfig) {
        try { meta.validators.validateProviderConfig({}) }
        catch { /* ignore */ }
        try { meta.validators.validateProviderConfig({ apiKey: 'x', baseUrl: 'https://example.com/v1/' }) }
        catch { /* ignore */ }
      }
      // capabilities listModels/listVoices
      if (meta.capabilities?.listModels) {
        try { await meta.capabilities.listModels({ apiKey: 'x', baseUrl: 'https://example.com/v1/' }) }
        catch { /* ignore */ }
      }
      if (meta.capabilities && 'listVoices' in meta.capabilities && typeof meta.capabilities.listVoices === 'function') {
        try { await meta.capabilities.listVoices({}) }
        catch { /* ignore */ }
      }
      if (typeof meta.createProvider === 'function') {
        try { await meta.createProvider({ apiKey: 'x', baseUrl: 'https://example.com/v1/', accessKeyId: 'a', accessKeySecret: 's', appKey: 'k', region: 'cn-shanghai', model: 'm', language: 'en' }) }
        catch { /* ignore */ }
      }
    }
  })

  it('exercises mimo fetch path', async () => {
    const meta = (transcriptionMetadata as any)['mimo-audio-transcription']
    const provider: any = await meta.createProvider({ apiKey: 'key', baseUrl: 'https://api.xiaomimimo.com/v1/', model: 'mimo-v2-omni' })
    const t = provider.transcription('mimo-v2-omni')
    const fn = t.fetch
    // invalid body
    try { await fn('url', { body: 'notformdata' }) }
    catch { /* ignore */ }
    // empty file
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))
    // mock fetch
    const origFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })) as any
    const res = await fn('url', { body: fd })
    await res.json()
    globalThis.fetch = origFetch
    // non-ok
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('err', { status: 500, statusText: 'ERR' })) as any
    try { await fn('url', { body: fd }) }
    catch { /* ignore */ }
    globalThis.fetch = origFetch
  })

  it('exercises browser web speech validator branches', () => {
    const meta = (transcriptionMetadata as any)['browser-web-speech-api']
    // make window available
    ;(globalThis as any).window = { webkitSpeechRecognition() {} }
    const r = meta.validators.validateProviderConfig({})
    expect(r.valid).toBe(true)
    delete (globalThis as any).window
    const r2 = meta.validators.validateProviderConfig({})
    expect(r2.valid).toBe(false)
  })

  it('exercises isAvailableBy branches', async () => {
    const meta = (transcriptionMetadata as any)['browser-web-speech-api']
    // no window
    expect(await meta.isAvailableBy()).toBe(false)
    ;(globalThis as any).window = {}
    ;(globalThis as any).isStageTamagotchi = () => false
    expect(await meta.isAvailableBy()).toBe(false)
    ;(globalThis as any).window = { SpeechRecognition() {} }
    expect(await meta.isAvailableBy()).toBe(true)
    delete (globalThis as any).window
  })

  it('exercises aliyun createProvider branches', async () => {
    const meta = (transcriptionMetadata as any)['aliyun-nls-transcription']
    // incomplete
    await expect(meta.createProvider({})).rejects.toThrow()
    // invalid region
    try { meta.validators.validateProviderConfig({ accessKeyId: 'a', accessKeySecret: 's', appKey: 'k', region: 'bad' }) }
    catch {}
    const v = meta.validators.validateProviderConfig({ accessKeyId: 'a', accessKeySecret: 's', appKey: 'k', region: 'bad' })
    expect(v.valid).toBe(false)
  })

  it('exercises openai-compatible listModels', async () => {
    const meta = (transcriptionMetadata as any)['openai-compatible-audio-transcription']
    expect(await meta.capabilities.listModels({})).toEqual([])
    // mock listModels by importing? skip; cover catch via bad baseUrl
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as any
    expect(await meta.capabilities.listModels({ apiKey: 'x', baseUrl: 'https://example.com/v1/' })).toEqual([])
    // @ts-ignore
    globalThis.fetch = undefined
  })
})
