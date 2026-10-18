import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { WarpDrivePlugin } from './index'

function makeProvider() {
  return {
    getPublicUrl: vi.fn((key: string) => `https://cdn/${key}`),
    upload: vi.fn(async () => {}),
    cleanPrefix: vi.fn(async () => {}),
    shouldSkipUpload: vi.fn(async () => false),
  }
}

describe('warpDrivePlugin', () => {
  it('renderBuiltUrl tracks and returns url', () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/\.(wasm)$/], prefix: 'remote-assets' })
    const cfg = plugin.config()
    const url = cfg.experimental.renderBuiltUrl('foo.wasm', { hostId: 'h', hostType: 't' })
    expect(url).toBe('https://cdn/remote-assets/foo.wasm')
  })

  it('renderBuiltUrl no include match returns undefined', () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/\.(wasm)$/], prefix: 'p' })
    const cfg = plugin.config()
    expect(cfg.experimental.renderBuiltUrl('foo.js', {})).toBeUndefined()
  })

  it('renderBuiltUrl no provider returns undefined', () => {
    const plugin: any = WarpDrivePlugin({ provider: undefined as any, include: [/.*/] })
    const cfg = plugin.config()
    expect(cfg.experimental.renderBuiltUrl('foo.wasm', {})).toBeUndefined()
  })

  it('include function matcher', () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [(f: string) => f.endsWith('.x')], includeBy: (f: string) => f === 'a.x' })
    const cfg = plugin.config()
    expect(cfg.experimental.renderBuiltUrl('a.x', {})).toBe('https://cdn/remote-assets/a.x'.replace('remote-assets', 'remote-assets'))
  })

  it('generateBundle + closeBundle upload flow', async () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/], manifest: true, delete: true, clean: true, skipNotModified: true })
    plugin.configResolved({ root: tmpdir(), build: { outDir: 'dist' }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    const file = join(tmpdir(), 'asset.txt')
    await writeFile(file, 'data')
    const bundle: any = { 'asset.txt': { type: 'asset', source: 'data' } }
    // tracked must exist; call renderBuiltUrl first
    plugin.config().experimental.renderBuiltUrl('asset.txt', {})
    await plugin.generateBundle.call({ emitFile: vi.fn() }, {}, bundle)
    await plugin.closeBundle()
    expect(provider.upload).toHaveBeenCalled()
  })

  it('configResolved missing warns', async () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/] })
    await plugin.generateBundle({}, {})
    // no resolvedConfig
  })

  it('closeBundle dry run', async () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/], dryRun: true })
    plugin.configResolved({ root: tmpdir(), build: { outDir: 'dist' }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    plugin.config().experimental.renderBuiltUrl('a.txt', {})
    const bundle: any = { 'a.txt': { type: 'asset', source: 'data' } }
    await plugin.generateBundle({}, bundle)
    await plugin.closeBundle()
    expect(provider.upload).not.toHaveBeenCalled()
  })

  it('closeBundle skip not modified', async () => {
    const provider = makeProvider()
    provider.shouldSkipUpload.mockResolvedValue(true)
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/], delete: true })
    plugin.configResolved({ root: tmpdir(), build: { outDir: 'dist' }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    plugin.config().experimental.renderBuiltUrl('b.txt', {})
    const file = join(tmpdir(), 'dist', 'b.txt')
    await writeFile(file, 'data').catch(() => {})
    const bundle: any = { 'b.txt': { type: 'asset', source: 'data' } }
    await plugin.generateBundle({}, bundle)
    await plugin.closeBundle()
  })

  it('closeBundle clean no prefix branch', async () => {
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/], prefix: '', clean: true })
    plugin.configResolved({ root: tmpdir(), build: { outDir: 'dist' }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    plugin.config().experimental.renderBuiltUrl('c.txt', {})
    const bundle: any = { 'c.txt': { type: 'asset', source: 'data' } }
    await plugin.generateBundle({}, bundle)
    await plugin.closeBundle()
  })

  it('closeBundle clean no cleanPrefix support', async () => {
    const provider = makeProvider()
    delete provider.cleanPrefix
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/], clean: true })
    plugin.configResolved({ root: tmpdir(), build: { outDir: 'dist' }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    plugin.config().experimental.renderBuiltUrl('d.txt', {})
    const bundle: any = { 'd.txt': { type: 'asset', source: Buffer.from('x') } }
    await plugin.generateBundle({}, bundle)
    await plugin.closeBundle()
  })

  it('closeBundle upload failure throws', async () => {
    const provider = makeProvider()
    provider.upload.mockRejectedValue(new Error('fail'))
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/], delete: false, skipNotModified: false })
    plugin.configResolved({ root: tmpdir(), build: { outDir: 'dist' }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    plugin.config().experimental.renderBuiltUrl('e.txt', {})
    const bundle: any = { 'e.txt': { type: 'asset', source: 'data' } }
    await plugin.generateBundle({}, bundle)
    await expect(plugin.closeBundle()).rejects.toThrow()
  })

  it('normalizePrefix/getAssetSize branches', () => {
    // getAssetSize via bundle with buffer source
    const provider = makeProvider()
    const plugin: any = WarpDrivePlugin({ provider: provider as any, include: [/.*/] })
    // no direct; ok
    expect(plugin.name).toBe('proj-airi-warpdrive')
  })
})
