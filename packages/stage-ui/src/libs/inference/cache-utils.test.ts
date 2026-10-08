import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isModelCached } from './cache-utils'

describe('isModelCached - moondream2', () => {
  const originalCaches = globalThis.caches

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (originalCaches !== undefined) {
      globalThis.caches = originalCaches
    }
    else {
      delete (globalThis as any).caches
    }
  })

  it('should return false if moondream2 is not in cache', async () => {
    const mockCache = {
      keys: vi.fn().mockResolvedValue([]),
    }
    globalThis.caches = {
      open: vi.fn().mockResolvedValue(mockCache),
    } as any

    const cached = await isModelCached('Xenova/moondream2')
    expect(cached).toBe(false)
  })

  it('should return false if only partial shards or config files are cached', async () => {
    const mockCache = {
      keys: vi.fn().mockResolvedValue([
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/config.json' },
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/onnx/decoder_model_merged_q4.onnx' },
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/onnx/embed_tokens.onnx' },
        // missing vision_encoder
      ]),
    }
    globalThis.caches = {
      open: vi.fn().mockResolvedValue(mockCache),
    } as any

    const cached = await isModelCached('Xenova/moondream2')
    expect(cached).toBe(false)
  })

  it('should return true when all 3 required shards (decoder, vision, embed) are cached', async () => {
    const mockCache = {
      keys: vi.fn().mockResolvedValue([
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/config.json' },
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/onnx/decoder_model_merged_q4.onnx' },
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/onnx/embed_tokens.onnx' },
        { url: 'https://huggingface.co/Xenova/moondream2/resolve/main/onnx/vision_encoder_quantized.onnx' },
      ]),
    }
    globalThis.caches = {
      open: vi.fn().mockResolvedValue(mockCache),
    } as any

    const cached = await isModelCached('Xenova/moondream2')
    expect(cached).toBe(true)
  })
})
