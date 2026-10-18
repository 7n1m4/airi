import { describe, expect, it, vi } from 'vitest'

import { burnCoordinateGridToCanvas, burnCoordinateGridToDataUrl, drawCoordinateGrid } from './grid-overlay'

type Ctx = Record<string, (...args: unknown[]) => unknown> & {
  lineWidth: number
  strokeStyle: string
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
}

function makeCtx(): Ctx {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  }
  return ctx as unknown as Ctx
}

const g = globalThis as unknown as Record<string, unknown>

describe('drawCoordinateGrid', () => {
  it('draws with defaults', () => {
    const ctx = makeCtx()
    drawCoordinateGrid(ctx as unknown as CanvasRenderingContext2D, 400, 300)
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
    expect(ctx.strokeRect).toHaveBeenCalled()
  })

  it('accentCenter false and showPills false', () => {
    const ctx = makeCtx()
    drawCoordinateGrid(ctx as unknown as CanvasRenderingContext2D, 400, 300, { accentCenter: false, showPills: false })
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })

  it('small dimensions skip pills', () => {
    const ctx = makeCtx()
    drawCoordinateGrid(ctx as unknown as CanvasRenderingContext2D, 100, 100, { showPills: true })
    expect(ctx.fillText).not.toHaveBeenCalled()
  })
})

describe('burnCoordinateGridToCanvas', () => {
  it('returns null when document undefined', () => {
    const prev = g.document
    delete g.document
    const res = burnCoordinateGridToCanvas({ width: 10, height: 10 } as unknown as HTMLCanvasElement)
    expect(res).toBeNull()
    if (prev)
      g.document = prev
  })

  it('returns null for non-positive dimensions', () => {
    const ctx = makeCtx()
    const canvas = { width: 0, height: 10, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }
    const res = burnCoordinateGridToCanvas({ width: 0, height: 10 } as unknown as HTMLCanvasElement)
    expect(res).toBeNull()
    delete g.document
  })

  it('returns null when ctx null', () => {
    const canvas = { width: 10, height: 10, getContext: () => null, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }
    const res = burnCoordinateGridToCanvas({ width: 10, height: 10 } as unknown as HTMLCanvasElement)
    expect(res).toBeNull()
    delete g.document
  })

  it('burns ImageData source', () => {
    const ctx = makeCtx()
    const canvas = { width: 10, height: 10, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }
    const source = { width: 10, height: 10, data: new Uint8ClampedArray(400) }
    const res = burnCoordinateGridToCanvas(source as unknown as ImageData, true)
    expect(res).not.toBeNull()
    expect(ctx.putImageData).toHaveBeenCalled()
    delete g.document
  })

  it('burns canvas source without grid', () => {
    const ctx = makeCtx()
    const canvas = { width: 10, height: 10, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }
    const source = { width: 10, height: 10 }
    const res = burnCoordinateGridToCanvas(source as unknown as HTMLCanvasElement, false)
    expect(res).not.toBeNull()
    expect(ctx.drawImage).toHaveBeenCalled()
    delete g.document
  })
})

describe('burnCoordinateGridToDataUrl', () => {
  it('fallback when document undefined', async () => {
    const prev = g.document
    delete g.document
    const res = await burnCoordinateGridToDataUrl('data:image/jpeg;base64,XYZ')
    expect(res.dataUrl).toBe('data:image/jpeg;base64,XYZ')
    if (prev)
      g.document = prev
  })

  it('success path', async () => {
    const ctx = makeCtx()
    const canvas: Record<string, unknown> = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }

    class FakeImage {
      naturalWidth = 50
      naturalHeight = 40
      width = 50
      height = 40
      complete = true
      onload: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      src = ''
      dispatchEvent = (e: unknown) => {
        if (this.onload)
          this.onload(e); return true
      }

      constructor() {}
      set srcSetter(v: string) {}
    }
    // make src assignment trigger load synchronously
    Object.defineProperty(FakeImage.prototype, 'src', {
      set(this: FakeImage, v: string) {
        this.src = v
        if (this.complete && this.onload)
          this.onload(new Event('load'))
      },
      get() { return '' },
    })
    g.Image = FakeImage

    const res = await burnCoordinateGridToDataUrl('data:image/jpeg;base64,XYZ')
    expect(res).toBeDefined()
    delete g.document
    delete g.Image
  })

  it('ctx null path', async () => {
    const canvas = { width: 0, height: 0, getContext: () => null, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }

    class FakeImage {
      naturalWidth = 50
      naturalHeight = 40
      width = 50
      height = 40
      complete = true
      onload: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      _src = ''
      dispatchEvent = (e: unknown) => {
        if (this.onload)
          this.onload(e); return true
      }

      constructor() {}
    }
    Object.defineProperty(FakeImage.prototype, 'src', {
      set(this: FakeImage, v: string) {
        this._src = v; if (this.complete && this.onload)
          this.onload(new Event('load'))
      },
      get(this: FakeImage) { return this._src },
    })
    g.Image = FakeImage
    const res = await burnCoordinateGridToDataUrl('data:image/jpeg;base64,XYZ')
    expect(res.dataUrl).toBe('data:image/jpeg;base64,XYZ')
    delete g.document
    delete g.Image
  })

  it('onerror path', async () => {
    const canvas = { width: 10, height: 10, getContext: () => null, toDataURL: () => 'x' }
    g.document = { createElement: () => canvas }

    class FakeImage {
      complete = false
      onload: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      _src = ''
      dispatchEvent = () => true
      constructor() {}
    }
    Object.defineProperty(FakeImage.prototype, 'src', {
      set(this: FakeImage, v: string) {
        this._src = v
        // trigger onerror synchronously
        if (this.onerror)
          this.onerror(new Error('fail'))
      },
      get(this: FakeImage) { return this._src },
    })
    g.Image = FakeImage
    const res = await burnCoordinateGridToDataUrl('data:image/jpeg;base64,XYZ')
    expect(res).toBeDefined()
    delete g.document
    delete g.Image
  })

  it('catch path', async () => {
    const ctx = makeCtx()
    ctx.drawImage = () => { throw new Error('boom') }
    const canvas: Record<string, unknown> = { width: 50, height: 40, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,AAA' }
    g.document = { createElement: () => canvas }

    class FakeImage {
      naturalWidth = 50
      naturalHeight = 40
      width = 50
      height = 40
      complete = true
      onload: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      _src = ''
      dispatchEvent = (e: unknown) => {
        if (this.onload)
          this.onload(e); return true
      }

      constructor() {}
    }
    Object.defineProperty(FakeImage.prototype, 'src', {
      set(this: FakeImage, v: string) {
        this._src = v; if (this.complete && this.onload)
          this.onload(new Event('load'))
      },
      get(this: FakeImage) { return this._src },
    })
    g.Image = FakeImage
    const res = await burnCoordinateGridToDataUrl('data:image/jpeg;base64,XYZ')
    expect(res.dataUrl).toBe('data:image/jpeg;base64,XYZ')
    delete g.document
    delete g.Image
  })
})
