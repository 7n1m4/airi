import { describe, expect, it } from 'vitest'

import { createControllableStream } from './stream'

describe('createControllableStream', () => {
  it('returns a ReadableStream and a controller', () => {
    const { stream, controller } = createControllableStream<number>()
    expect(stream).toBeInstanceOf(ReadableStream)
    expect(controller).toBeDefined()
    expect(typeof controller.enqueue).toBe('function')
    expect(typeof controller.close).toBe('function')
  })

  it('controller can enqueue and close the stream', async () => {
    const { stream, controller } = createControllableStream<number>()
    const reader = stream.getReader()
    controller.enqueue(1)
    controller.enqueue(2)
    controller.close()

    const chunks: number[] = []

    while (true) {
      const { value, done } = await reader.read()
      if (done)
        break
      chunks.push(value)
    }
    expect(chunks).toEqual([1, 2])
  })

  it('works with default generic', async () => {
    const { stream, controller } = createControllableStream()
    const reader = stream.getReader()
    controller.enqueue('x')
    controller.close()
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    expect(value).toBe('x')
  })

  it('controller error propagates to reader', async () => {
    const { stream, controller } = createControllableStream<number>()
    const reader = stream.getReader()
    const err = new Error('boom')
    controller.error(err)
    await expect(reader.read()).rejects.toThrow('boom')
  })
})
