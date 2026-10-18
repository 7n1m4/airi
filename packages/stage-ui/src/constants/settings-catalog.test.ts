import { describe, expect, it } from 'vitest'

import {
  buildSettingsCatalogTopology,
  convertProviderToCatalogNodeItem,
  getAllCatalogItems,
  resolvePath,
  resolveSettingsBackRoute,
  SETTINGS_CATALOG_ITEMS,
} from './settings-catalog'

describe('settings-catalog', () => {
  it('non-empty', () => { expect(SETTINGS_CATALOG_ITEMS.length).toBeGreaterThan(0) })
  it('convert basic', () => { expect(convertProviderToCatalogNodeItem({ id: 'foo', name: 'Foo', category: 'chat' }).id).toBe('prov-foo') })
  it('getAll array', () => { expect(getAllCatalogItems([{ id: 'custom1', name: 'Custom', category: 'chat' }]).some(i => i.id === 'prov-custom1')).toBe(true) })
  it('getAll no args', () => { expect(Array.isArray(getAllCatalogItems())).toBe(true) })
  it('buildTopology', () => { expect(buildSettingsCatalogTopology().rootId).toBe('hub') })
  it('resolvePath unknown', () => { expect(resolvePath(buildSettingsCatalogTopology(), 'nonexistent')).toEqual(['hub']) })
  it('resolvePath prepends root', () => {
    const topo = { rootId: 'hub', nodesById: { hub: { id: 'hub', label: 'hub', shortLabel: 'hub', route: '/', parentId: null, children: [], order: 0, kind: 'root', metadata: {} }, x: { id: 'x', label: 'x', shortLabel: 'x', route: '/x', parentId: null, children: [], order: 0, kind: 'page', metadata: {} } } }
    expect(resolvePath(topo as unknown as Parameters<typeof resolvePath>[0], 'x')).toEqual(['hub', 'x'])
  })
  it('back root', () => { expect(resolveSettingsBackRoute('/settings')).toBe('/') })
  it('back providers', () => { expect(resolveSettingsBackRoute('/settings/providers/chat/foo')).toBe('/settings/providers#chat') })
  it('back single', () => { expect(resolveSettingsBackRoute('/foo')).toBe('/settings') })
})
