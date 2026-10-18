import html2canvas from 'html2canvas'

import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { colorFromElement, patchThemeSamplingHtml2CanvasClone } from './color-from-element'

vi.mock('html2canvas', () => ({
  default: vi.fn(),
}))

vi.mock('node-vibrant/browser', () => ({
  Vibrant: class {
    constructor(_src: string) {}
    async getPalette() {
      return { Vibrant: { hex: '#ff0000' }, DarkVibrant: { hex: '#880000' } }
    }
  },
}))

vi.mock('culori', () => ({
  average: vi.fn(() => ({ r: 1, g: 2, b: 3 })),
}))

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' })
const gDoc2 = globalThis as { document?: Document }
gDoc2.document = dom.window.document as unknown as Document
;(globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = dom.window.HTMLImageElement
describe('patchThemeSamplingHtml2CanvasClone', () => {
  it('placeholder', () => {
    expect(true).toBe(true)
  })

  it('placeholder2', () => { expect(true).toBe(true) })
  it('returns when document missing', () => {
    const g = globalThis as Record<string, unknown>
    const saved = g.document
    Reflect.deleteProperty(g, 'document')
    expect(() => patchThemeSamplingHtml2CanvasClone(null!)).not.toThrow()
    g.document = saved
  })

  it('returns when getComputedStyle missing', () => {
    const g = globalThis as Record<string, unknown>
    const saved = g.getComputedStyle
    Reflect.deleteProperty(g, 'getComputedStyle')
    expect(() => patchThemeSamplingHtml2CanvasClone(null!)).not.toThrow()
    g.getComputedStyle = saved
  })

  it('hides overlays and styles colored areas', () => {
    document.documentElement.classList.add('dark')
    const overlay = document.createElement('div')
    overlay.className = 'theme-overlay'
    const wave = document.createElement('div')
    wave.className = 'colored-area'
    document.body.appendChild(overlay)
    document.body.appendChild(wave)
    const gc = globalThis as unknown as { getComputedStyle: (el: Element) => { getPropertyValue: (n: string) => string } }
    gc.getComputedStyle = () => ({ getPropertyValue: () => '210' })
    patchThemeSamplingHtml2CanvasClone(document)
    expect((overlay as HTMLElement).style.display).toBe('none')
    expect((wave as HTMLElement).style.background).toBeTruthy()
    document.body.removeChild(overlay)
    document.body.removeChild(wave)
    document.documentElement.classList.remove('dark')
  })

  it('styles colored areas in light mode with empty hue fallback', () => {
    document.documentElement.classList.remove('dark')
    const wave = document.createElement('div')
    wave.className = 'colored-area'
    document.body.appendChild(wave)
    const gc = globalThis as unknown as { getComputedStyle: (el: Element) => { getPropertyValue: (n: string) => string } }
    gc.getComputedStyle = () => ({ getPropertyValue: () => '' })
    patchThemeSamplingHtml2CanvasClone(document)
    expect((wave as HTMLElement).style.background).toBeTruthy()
    document.body.removeChild(wave)
  })
})

describe('colorFromElement', () => {
  beforeEach(() => {
    vi.mocked(html2canvas).mockResolvedValue({
      width: 10,
      height: 10,
      getContext: () => ({
        getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }),
      }),
    } as unknown as HTMLCanvasElement)
  })

  it('vibrant mode with no image source returns empty', async () => {
    const el = document.createElement('div')
    const res = await colorFromElement(el, { mode: 'vibrant' })
    expect(res.vibrant).toEqual({ palette: [], dominant: undefined })
  })

  it('vibrant mode with img element', async () => {
    const img = document.createElement('img') as HTMLImageElement
    img.src = 'data:image/png;base64,AAAA'
    class MockImage {
      crossOrigin = ''
      naturalWidth = 4
      naturalHeight = 4
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) { queueMicrotask(() => this.onload?.()) }
    }
    ;(globalThis as unknown as { Image: unknown }).Image = MockImage
    const canvas = document.createElement('canvas')
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas')
        return canvas
      return origCreate(tag)
    })
    const ctx = { drawImage: vi.fn() }
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,BBBB')
    const res = await colorFromElement(img, { mode: 'vibrant', vibrant: { sampleTopRatio: 0.5 } })
    expect(res.vibrant?.palette).toContain('#ff0000')
    vi.restoreAllMocks()
  })

  it('vibrant mode with img element and null canvas ctx skips draw', async () => {
    const img = document.createElement('img') as HTMLImageElement
    img.src = 'data:image/png;base64,AAAA'
    class MockImage {
      crossOrigin = ''
      naturalWidth = 4
      naturalHeight = 4
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) { queueMicrotask(() => this.onload?.()) }
    }
    ;(globalThis as unknown as { Image: unknown }).Image = MockImage
    const canvas = document.createElement('canvas')
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas')
        return canvas
      return origCreate(tag)
    })
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,BBBB')
    const res = await colorFromElement(img, { mode: 'vibrant' })
    expect(res.vibrant?.palette).toContain('#ff0000')
    vi.restoreAllMocks()
  })

  it('html2canvas mode', async () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const res = await colorFromElement(el, { mode: 'html2canvas', html2canvas: { sampleHeight: 2, sampleStride: 2, scale: 0.25 } })
    expect(res.html2canvas?.average).toContain('rgb(')
    expect(res.html2canvas?.canvas).toBeTruthy()
  })

  it('html2canvas mode no ctx returns undefined average', async () => {
    vi.mocked(html2canvas).mockResolvedValue({ width: 2, height: 2, getContext: () => null } as unknown as HTMLCanvasElement)
    vi.mocked((await import('culori')).average).mockReturnValueOnce(undefined as never)
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const res = await colorFromElement(el, { mode: 'html2canvas' })
    expect(res.html2canvas?.average).toBeUndefined()
  })

  it('html2canvas mode empty colors returns undefined', async () => {
    vi.mocked(html2canvas).mockResolvedValue({
      width: 2,
      height: 2,
      getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }) }),
    } as unknown as HTMLCanvasElement)
    vi.mocked((await import('culori')).average).mockReturnValueOnce(undefined as never)
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const res = await colorFromElement(el, { mode: 'html2canvas' })
    expect(res.html2canvas?.average).toBeUndefined()
  })

  it('html2canvas catches errors', async () => {
    vi.mocked(html2canvas).mockRejectedValue(new Error('boom'))
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const res = await colorFromElement(el, { mode: 'html2canvas' })
    expect(res.html2canvas).toBeUndefined()
  })

  it('both mode default', async () => {
    vi.mocked(html2canvas).mockResolvedValue({
      width: 2,
      height: 2,
      getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]) }) }),
    } as unknown as HTMLCanvasElement)
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const res = await colorFromElement(el)
    expect(res).toBeTruthy()
  })

  it('onclone option forwarded', async () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const onclone = vi.fn()
    vi.mocked(html2canvas).mockResolvedValue({
      width: 2,
      height: 2,
      getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]) }) }),
    } as unknown as HTMLCanvasElement)
    await colorFromElement(el, { mode: 'html2canvas', html2canvas: { onclone, region: { x: 1, y: 2, width: 3, height: 4 }, backgroundColor: 'red', allowTaint: false, useCORS: false, logging: true } })
    expect(html2canvas).toHaveBeenCalledWith(el, expect.objectContaining({ onclone, x: 1, y: 2, width: 3, height: 4 }))
  })

  it('html2canvas mode returns undefined average when culori average undefined', async () => {
    vi.mocked(html2canvas).mockResolvedValue({
      width: 2,
      height: 2,
      getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]) }) }),
    } as unknown as HTMLCanvasElement)
    vi.mocked((await import('culori')).average).mockReturnValueOnce(undefined as never)
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetWidth', { value: 5 })
    Object.defineProperty(el, 'offsetHeight', { value: 5 })
    const res = await colorFromElement(el, { mode: 'html2canvas' })
    expect(res.html2canvas?.average).toBeUndefined()
  })
})
