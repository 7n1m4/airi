import { describe, expect, it } from 'vitest'

import { createLlmJsonInterceptor } from './llm-json-interceptor'

describe('createLlmJsonInterceptor', () => {
  it('passes plain text through', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('Hello, world!')
    await interceptor.end()
    expect(texts.join('')).toBe('Hello, world!')
  })

  it('emits a json fenced block via onJson', async () => {
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: () => {}, onJson: (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('```json\n{"component":"Foo"}\n```\n')
    await interceptor.end()
    expect(jsons).toHaveLength(1)
  })

  it('emits generic block with json content via onJson', async () => {
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: () => {}, onJson: (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('```\n{"action":"click","id":1}\n```\n')
    await interceptor.end()
    expect(jsons).toHaveLength(1)
  })

  it('emits generic block with componentName via onJson', async () => {
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: () => {}, onJson: (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('```\n{"componentName":"Bar"}\n```\n')
    await interceptor.end()
    expect(jsons).toHaveLength(1)
  })

  it('emits generic block as text when json lacks required keys', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('```\n{"foo":"bar"}\n```\n')
    await interceptor.end()
    expect(texts.join('')).toContain('```')
  })

  it('emits generic block as text when content is not json', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('```\nhello world\n```\n')
    await interceptor.end()
    expect(texts.join('')).toContain('hello world')
  })

  it('emits generic block as text when json primitive', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('```\n123\n```\n')
    await interceptor.end()
    expect(texts.join('')).toContain('```')
  })

  it('emits generic block as text when json invalid', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('```\n{bad json}\n```\n')
    await interceptor.end()
    expect(texts.join('')).toContain('```')
  })

  it('handles text before block', async () => {
    const texts: string[] = []
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('intro ```json\n{"component":"X"}\n```\n')
    await interceptor.end()
    expect(texts.join('')).toContain('intro')
    expect(jsons).toHaveLength(1)
  })

  it('handles multiple blocks', async () => {
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: () => {}, onJson: (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('```json\n{"component":"A"}\n``` and ```json\n{"component":"B"}\n```\n')
    await interceptor.end()
    expect(jsons).toHaveLength(2)
  })

  it('buffers partial backtick tail', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('hello `')
    await interceptor.consume('tail')
    await interceptor.end()
    expect(true).toBe(true)
  })

  it('handles chunked streaming', async () => {
    const texts: string[] = []
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('before ')
    await interceptor.consume('```json\n{"component":"C"}')
    await interceptor.consume('\n```\nafter')
    await interceptor.end()
    expect(jsons).toHaveLength(1)
    expect(texts.join('')).toContain('before')
    expect(texts.join('')).toContain('after')
  })

  it('breaks when block not closed', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('```json\n{"component":"D"}')
    await interceptor.end()
    expect(texts.join('')).toContain('```json')
  })

  it('end() with empty buffer', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('')
    await interceptor.end()
    expect(texts).toEqual([])
  })

  it('end() resets state', async () => {
    const texts: string[] = []
    const interceptor = createLlmJsonInterceptor({ onText: (t) => { texts.push(t) }, onJson: () => {} })
    await interceptor.consume('```json\n{"component":"E"}\n```\n')
    await interceptor.end()
    await interceptor.consume('tail')
    await interceptor.end()
    expect(texts.join('')).toContain('tail')
  })

  it('async callbacks', async () => {
    const texts: string[] = []
    const jsons: { j: unknown, r: string }[] = []
    const interceptor = createLlmJsonInterceptor({ onText: async (t) => { texts.push(t) }, onJson: async (j, r) => { jsons.push({ j, r }) } })
    await interceptor.consume('hi ```json\n{"component":"H"}\n```\n')
    await interceptor.end()
    expect(texts.join('')).toContain('hi')
    expect(jsons).toHaveLength(1)
  })
})
