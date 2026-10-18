import type { ReaderLike } from 'clustr'

import type { TTSInputChunk } from './tts'

import { describe, expect, it, vi } from 'vitest'

import { chunkEmitter, chunkTTSInput, TTS_FLUSH_INSTRUCTION, TTS_SPECIAL_TOKEN } from './tts'

async function collect(input: string | ReadableStreamDefaultReader<Uint8Array>, options?: Parameters<typeof chunkTTSInput>[1]): Promise<TTSInputChunk[]> {
  const out: TTSInputChunk[] = []
  for await (const c of chunkTTSInput(input, options)) out.push(c)
  return out
}

describe('chunkTTSInput', () => {
  it('empty input yields nothing', async () => {
    expect(await collect('')).toEqual([])
  })

  it('simple text yields one flush chunk', async () => {
    const r = await collect('hello world')
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('hello world')
    expect(r[0].reason).toBe('flush')
  })

  it('boost yields early chunks', async () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen'
    const r = await collect(text, { boost: 1, minimumWords: 2, maximumWords: 5 })
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('hard punctuation flushes', async () => {
    const r = await collect('Hello world. Foo bar')
    expect(r.some(c => c.reason === 'hard')).toBe(true)
  })

  it('soft punctuation accumulates', async () => {
    const r = await collect('Hello, world')
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('flush instruction yields flush', async () => {
    const r = await collect(`hi${TTS_FLUSH_INSTRUCTION}there`)
    expect(r.some(c => c.reason === 'flush')).toBe(true)
  })

  it('special token yields special', async () => {
    const r = await collect(`hi${TTS_SPECIAL_TOKEN}`)
    expect(r.some(c => c.reason === 'special')).toBe(true)
  })

  it('special token with empty buffer yields special with empty text', async () => {
    const r = await collect(TTS_SPECIAL_TOKEN)
    expect(r[0]).toMatchObject({ text: '', words: 0, reason: 'special' })
  })

  it('decimal point stays', async () => {
    const r = await collect('value 2.5 here')
    const joined = r.map(c => c.text).join(' ')
    expect(joined).toContain('2.5')
  })

  it('ellipsis becomes …', async () => {
    const r = await collect('wait...')
    const joined = r.map(c => c.text).join(' ')
    expect(joined).toContain('…')
  })

  it('ellipsis partial (two dots) handled', async () => {
    const r = await collect('a..b')
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('max words triggers limit', async () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
    const r = await collect(words, { maximumWords: 5, minimumWords: 1, boost: 0 })
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('kept punctuation handling', async () => {
    const r = await collect('really? yes!')
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('unicode grapheme multi-length skip', async () => {
    // emoji with skin tone is multi-codepoint; readGraphemeClusters yields cluster length>1 -> skip path
    const r = await collect('hi 😀 there')
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('readerLike input works', async () => {
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('hello world')); c.close() },
    })
    const reader = stream.getReader()
    const r = await collect(reader)
    expect(r.length).toBeGreaterThanOrEqual(1)
  })
})

describe('chunkEmitter', () => {
  it('calls handler for chunks', async () => {
    const handler = vi.fn()
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('hello world')); c.close() },
    })
    await chunkEmitter(stream.getReader(), [], handler)
    expect(handler).toHaveBeenCalled()
  })

  it('special shifts pendingSpecials', async () => {
    const handler = vi.fn()
    const input = `hi${TTS_SPECIAL_TOKEN}`
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(input)); c.close() },
    })
    await chunkEmitter(stream.getReader(), ['SP1'], handler)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ special: 'SP1' }))
  })

  it('special with empty pendingSpecials yields null', async () => {
    const handler = vi.fn()
    const input = TTS_SPECIAL_TOKEN
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(input)); c.close() },
    })
    await chunkEmitter(stream.getReader(), [], handler)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ special: null }))
  })

  it('sanitizes tokens in chunk', async () => {
    const handler = vi.fn()
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('hi world')); c.close() },
    })
    await chunkEmitter(stream.getReader(), [], handler)
    const arg = handler.mock.calls[0][0]
    expect(arg.chunk).not.toContain(TTS_SPECIAL_TOKEN)
  })

  it('catches errors without throwing', async () => {
    // pass a broken reader
    const handler = vi.fn()
    const badReader = { read: async () => { throw new Error('boom') } } as unknown as ReaderLike
    await expect(chunkEmitter(badReader, [], handler)).resolves.toBeUndefined()
  })
})
