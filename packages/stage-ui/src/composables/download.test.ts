import type { Mock } from 'vitest'

// @ts-expect-error jsdom lacks declaration in this config
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDownload } from './download'

describe('useDownload', () => {
  let createObjectURL: Mock
  let revokeObjectURL: Mock
  let click: Mock
  let createdLink: { href: string, download: string, click: Mock }

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    globalThis.document = dom.window.document as unknown as Document
    createObjectURL = vi.fn(() => 'blob:http://localhost/fake-url')
    revokeObjectURL = vi.fn()
    click = vi.fn()
    createdLink = { href: '', download: '', click }

    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })

    vi.spyOn(document, 'createElement').mockReturnValue(createdLink as never)

    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns a download function', () => {
    const { download } = useDownload(new Blob(['hi']), 'file.txt')
    expect(typeof download).toBe('function')
  })

  it('creates object URL, sets link attributes, clicks, and revokes after timeout', () => {
    const blob = new Blob(['hi'], { type: 'text/plain' })
    const { download } = useDownload(blob, 'file.txt')

    download()

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(createdLink.href).toBe('blob:http://localhost/fake-url')
    expect(createdLink.download).toBe('file.txt')
    expect(click).toHaveBeenCalled()

    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fake-url')
  })

  it('revokes only after 5 seconds', () => {
    const { download } = useDownload(new Blob(['x']), 'x.bin')
    download()
    vi.advanceTimersByTime(4999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalled()
  })
})
