import type { SettingsTopology } from './settings-catalog'

import { describe, expect, it } from 'vitest'

import {
  buildSettingsCatalogTopology,
  convertProviderToCatalogNodeItem,
  getAllCatalogItems,
  resolvePath,
  resolvePathFromRoute,
  resolveSettingsBackRoute,
  SETTINGS_CATALOG_ITEMS,
} from './settings-catalog'

describe('settings-catalog', () => {
  it('non-empty', () => { expect(SETTINGS_CATALOG_ITEMS.length).toBeGreaterThan(0) })
  it('convert basic', () => { expect(convertProviderToCatalogNodeItem({ id: 'foo', name: 'Foo', category: 'chat' }).id).toBe('prov-foo') })
  it('convert unknown category fallback parent', () => {
    const n = convertProviderToCatalogNodeItem({ id: 'bar', name: 'Bar (x)', category: 'unknown', deployment: 'cloud' })
    expect(n.parentId).toBe('prov-cat-chat')
    expect(n.glyph).toBe('雲')
  })
  it('convert transcription route + hearing', () => {
    const t = convertProviderToCatalogNodeItem({ id: 'stt1', name: 'STT', category: 'transcription' })
    const h = convertProviderToCatalogNodeItem({ id: 'hear1', name: 'Hear', category: 'hearing' })
    expect(t.route).toContain('/transcription/')
    expect(h.route).toContain('/transcription/')
  })
  it('convert blip-local route chat', () => {
    const n = convertProviderToCatalogNodeItem({ id: 'blip-local', name: 'Blip', category: 'vision' })
    expect(n.route).toContain('/chat/')
  })
  it('convert local wasm rwkv', () => {
    const n = convertProviderToCatalogNodeItem({ id: 'x-wasm', name: 'X', deployment: 'cloud' })
    expect(n.glyph).toBe('端')
    const n2 = convertProviderToCatalogNodeItem({ id: 'rwkv-y', name: 'RWKV' })
    expect(n2.glyph).toBe('端')
  })
  it('convert shortLabel fallback empty parens', () => {
    const n = convertProviderToCatalogNodeItem({ id: 'z', name: '(only)' })
    const shortLabel = n.shortLabel ?? ''
    expect(shortLabel.length).toBeGreaterThan(0)
  })
  it('convert description/icon fallback', () => {
    const n = convertProviderToCatalogNodeItem({ id: 'q', name: 'Q', deployment: 'local' })
    expect(n.description).toContain('inference provider')
    expect(n.icon).toBe('i-solar:cpu-bold-duotone')
  })
  it('getAll array', () => { expect(getAllCatalogItems([{ id: 'custom1', name: 'Custom', category: 'chat' }]).some(i => i.id === 'prov-custom1')).toBe(true) })
  it('getAll record', () => { expect(getAllCatalogItems({ a: { id: 'custom2', name: 'Custom2', category: 'chat' } }).some(i => i.id === 'prov-custom2')).toBe(true) })
  it('getAll no args', () => { expect(Array.isArray(getAllCatalogItems())).toBe(true) })
  it('getAll skip invalid and duplicates', () => {
    const items = getAllCatalogItems([{ id: 'dup', name: 'Dup' }, null, { name: 'noId' }, { id: 'dup', name: 'Dup2' }])
    expect(items.filter(i => i.id === 'prov-dup').length).toBe(1)
  })
  it('buildTopology', () => { expect(buildSettingsCatalogTopology().rootId).toBe('hub') })
  it('buildTopology custom providers', () => { expect(buildSettingsCatalogTopology([{ id: 'cp', name: 'CP' }]).nodesById['prov-cp']).toBeDefined() })
  it('resolvePath unknown', () => { expect(resolvePath(buildSettingsCatalogTopology(), 'nonexistent')).toEqual(['hub']) })
  it('resolvePath prepends root', () => {
    const topo: SettingsTopology = { rootId: 'hub', nodesById: { hub: { id: 'hub', label: 'hub', shortLabel: 'hub', route: '/', parentId: null, children: [], order: 0, kind: 'root', metadata: {} }, x: { id: 'x', label: 'x', shortLabel: 'x', route: '/x', parentId: null, children: [], order: 0, kind: 'page', metadata: {} } } }
    expect(resolvePath(topo, 'x')).toEqual(['hub', 'x'])
  })
  it('resolvePath cycle', () => {
    // Deliberate cycle: `hub` is its own parent, so path resolution must bail out instead of looping.
    const topo2: SettingsTopology = { rootId: 'hub', nodesById: { hub: { id: 'hub', label: 'hub', shortLabel: 'hub', route: '/', parentId: 'hub', children: [], order: 0, kind: 'root', metadata: {} } } }
    expect(resolvePath(topo2, 'hub')).toEqual(['hub'])
  })
  it('resolvePathFromRoute exact hash', () => {
    const topo = buildSettingsCatalogTopology()
    const r = resolvePathFromRoute(topo, '/settings/providers', 'speech')
    expect(r.nodeId).toBeDefined()
  })
  it('resolvePathFromRoute exact route', () => {
    const topo = buildSettingsCatalogTopology()
    const r = resolvePathFromRoute(topo, '/settings')
    expect(r.nodeId).toBeDefined()
  })
  it('resolvePathFromRoute prefix fallback root', () => {
    const topo = buildSettingsCatalogTopology()
    const r = resolvePathFromRoute(topo, '/zzz/nope')
    expect(r.nodeId).toBe('hub')
  })
  it('resolvePathFromRoute longest prefix', () => {
    const topo = buildSettingsCatalogTopology()
    const r = resolvePathFromRoute(topo, '/settings/providers/chat/foo')
    expect(r.path.length).toBeGreaterThan(0)
  })
  it('back root', () => { expect(resolveSettingsBackRoute('/settings')).toBe('/') })
  it('back root desktop', () => { expect(resolveSettingsBackRoute('/settings', { isDesktop: true })).toBeNull() })
  it('back providers', () => { expect(resolveSettingsBackRoute('/settings/providers/chat/foo')).toBe('/settings/providers#chat') })
  it('back providers free-hub', () => { expect(resolveSettingsBackRoute('/settings/providers/free-hub/x')).toBe('/settings/providers') })
  it('back providers non-chat category', () => { expect(resolveSettingsBackRoute('/settings/providers/speech/foo')).toBe('/settings/providers#speech') })
  it('back single', () => { expect(resolveSettingsBackRoute('/foo')).toBe('/settings') })
  it('back topology exact child', () => {
    const topo = buildSettingsCatalogTopology()
    expect(resolveSettingsBackRoute('/settings/system/color-scheme', { topology: topo })).toBeDefined()
  })
  it('back topology matched node route prefix', () => {
    const topo = buildSettingsCatalogTopology()
    expect(resolveSettingsBackRoute('/settings/models/explore/extra', { topology: topo })).toBeDefined()
  })
  it('back topology parent route', () => {
    const topo = buildSettingsCatalogTopology()
    expect(resolveSettingsBackRoute('/settings/providers/chat/foo/bar', { topology: topo })).toBeDefined()
  })
  it('back segments fallback', () => {
    expect(resolveSettingsBackRoute('/a/b')).toBe('/a')
  })
  it('resolvePathFromRoute hashed base skip', () => {
    const topo = buildSettingsCatalogTopology()
    expect(resolvePathFromRoute(topo, '/settings/providers').nodeId).toBeDefined()
  })
  it('back segments parent no route', () => {
    const topo = buildSettingsCatalogTopology()
    expect(resolveSettingsBackRoute('/nonexistent-parent/child', { topology: topo })).toBe('/nonexistent-parent')
  })
  it('resolvePathFromRoute full hashed route', () => {
    const topo = buildSettingsCatalogTopology()
    const r = resolvePathFromRoute(topo, '/settings/providers#chat')
    expect(r.nodeId).toBeDefined()
  })
  it('back settings child parent route', () => {
    const topo = buildSettingsCatalogTopology()
    expect(resolveSettingsBackRoute('/settings/system/general', { topology: topo })).toBe('/settings/system')
  })
})
