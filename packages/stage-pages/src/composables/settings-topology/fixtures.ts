import type { SettingsTopology, SettingsTopologyNode } from './types'

/**
 * Eiki Reference V1 Fixture
 * Canonical 29-node tree from "personal_airi/noding around.md".
 *
 * Structure:
 * - 1 root hub ("Settings")
 * - 10 area nodes (|A| = 10)
 * - 18 subpage nodes (|S| = 18):
 *   - 14 children under Modules (|M| = 14)
 *   - 4 children under System (|Y| = 4)
 *   - All other 8 areas are leaves
 * - Total nodes |V| = 29
 * - Total edges |E| = 28
 * - Total leaves = 26
 * - Max depth (height) = 2
 */
export function createEikiReferenceFixture(): SettingsTopology {
  const nodesById: Record<string, SettingsTopologyNode> = {}

  // Root
  nodesById.hub = {
    id: 'hub',
    label: 'Settings Hub',
    shortLabel: 'Hub',
    route: '/settings',
    parentId: null,
    children: [
      'area-card',
      'area-scene',
      'area-models',
      'area-memory',
      'area-dating-sim',
      'area-stage',
      'area-modules',
      'area-providers',
      'area-system',
      'area-data',
    ],
    order: 0,
    kind: 'root',
    icon: 'i-solar:settings-bold-duotone',
    glyph: 'HUB',
  }

  // 10 Areas
  const areaDefs: Array<{ id: string, label: string, shortLabel: string, route: string, icon: string, glyph?: string, children?: string[] }> = [
    { id: 'area-card', label: 'AIRI Card Editor', shortLabel: 'Card', route: '/settings/airi-card', icon: 'i-solar:emoji-funny-square-bold-duotone', glyph: '01' },
    { id: 'area-scene', label: 'Scene & Stage', shortLabel: 'Scene', route: '/settings/scene', icon: 'i-solar:armchair-2-bold-duotone', glyph: '02' },
    { id: 'area-models', label: 'Display Models', shortLabel: 'Models', route: '/settings/models', icon: 'i-solar:people-nearby-bold-duotone', glyph: '03' },
    { id: 'area-memory', label: 'Memory Systems', shortLabel: 'Memory', route: '/settings/memory', icon: 'i-solar:leaf-bold-duotone', glyph: '04' },
    { id: 'area-dating-sim', label: 'Dating Sim Mode', shortLabel: 'DatingSim', route: '/settings/dating-sim', icon: 'i-solar:heart-bold-duotone', glyph: '05' },
    { id: 'area-stage', label: 'Control Strip Stage', shortLabel: 'Stage', route: '/settings/stage', icon: 'i-solar:widget-2-bold-duotone', glyph: '06' },
    { id: 'area-modules', label: 'Modules (部品)', shortLabel: 'Modules', route: '/settings/modules', icon: 'i-solar:layers-bold-duotone', glyph: '部品' },
    { id: 'area-providers', label: 'Inference Providers', shortLabel: 'Providers', route: '/settings/providers', icon: 'i-solar:box-minimalistic-bold-duotone', glyph: '08' },
    { id: 'area-system', label: 'System (系)', shortLabel: 'System', route: '/settings/system', icon: 'i-solar:filters-bold-duotone', glyph: '系' },
    { id: 'area-data', label: 'Data Management', shortLabel: 'Data', route: '/settings/data', icon: 'i-solar:database-bold-duotone', glyph: '10' },
  ]

  // 14 Module subpages
  const moduleSubpages: Array<{ id: string, label: string, shortLabel: string, route: string, icon: string }> = [
    { id: 'mod-01-consciousness', label: 'MODULE 01 · Consciousness', shortLabel: 'M01', route: '/settings/modules/consciousness', icon: 'i-solar:ghost-bold-duotone' },
    { id: 'mod-02-speech', label: 'MODULE 02 · Speech (TTS)', shortLabel: 'M02', route: '/settings/modules/speech', icon: 'i-solar:user-speak-rounded-bold-duotone' },
    { id: 'mod-03-hearing', label: 'MODULE 03 · Hearing (STT)', shortLabel: 'M03', route: '/settings/modules/hearing', icon: 'i-solar:microphone-3-bold-duotone' },
    { id: 'mod-04-vision', label: 'MODULE 04 · Vision (VLM)', shortLabel: 'M04', route: '/settings/modules/vision', icon: 'i-solar:eye-closed-bold-duotone' },
    { id: 'mod-05-artistry', label: 'MODULE 05 · Artistry', shortLabel: 'M05', route: '/settings/modules/artistry', icon: 'i-iconify-heroicons:photo' },
    { id: 'mod-06-text-to-motion', label: 'MODULE 06 · Text to Motion', shortLabel: 'M06', route: '/settings/modules/text-to-motion', icon: 'i-solar:running-round-bold-duotone' },
    { id: 'mod-07-discord', label: 'MODULE 07 · Discord Bot', shortLabel: 'M07', route: '/settings/modules/messaging-discord', icon: 'i-simple-icons:discord' },
    { id: 'mod-08-twitter', label: 'MODULE 08 · X (Twitter)', shortLabel: 'M08', route: '/settings/modules/x', icon: 'i-simple-icons:x' },
    { id: 'mod-10-factorio', label: 'MODULE 10 · Factorio', shortLabel: 'M10', route: '/settings/modules/gaming-factorio', icon: 'i-solar:gamepad-bold-duotone' },
    { id: 'mod-11-mcp', label: 'MODULE 11 · MCP Servers', shortLabel: 'M11', route: '/settings/modules/mcp', icon: 'i-solar:server-bold-duotone' },
    { id: 'mod-12-beat-sync', label: 'MODULE 12 · Beat Sync', shortLabel: 'M12', route: '/settings/modules/beat-sync', icon: 'i-solar:music-notes-bold-duotone' },
    { id: 'mod-13-cloud-sync', label: 'MODULE 13 · Cloud Sync', shortLabel: 'M13', route: '/settings/modules/cloud-sync', icon: 'i-solar:cloud-bold-duotone' },
    { id: 'mod-14-stmm', label: 'MODULE 14 · Short-Term Memory', shortLabel: 'M14', route: '/settings/modules/memory-short-term', icon: 'i-solar:bookmark-bold-duotone' },
  ]

  // 4 System subpages
  const systemSubpages: Array<{ id: string, label: string, shortLabel: string, route: string, icon: string }> = [
    { id: 'sys-01-user-profile', label: 'SYSTEM 1 · User Profile', shortLabel: 'S01', route: '/settings/system/user-profile', icon: 'i-solar:user-bold-duotone' },
    { id: 'sys-02-general', label: 'SYSTEM 2 · General Settings', shortLabel: 'S02', route: '/settings/system/general', icon: 'i-solar:emoji-funny-square-bold-duotone' },
    { id: 'sys-03-color-scheme', label: 'SYSTEM 3 · Color Scheme', shortLabel: 'S03', route: '/settings/system/color-scheme', icon: 'i-solar:pallete-2-bold-duotone' },
    { id: 'sys-04-developer', label: 'SYSTEM 4 · Developer Tools', shortLabel: 'S04', route: '/settings/system/developer', icon: 'i-solar:code-bold-duotone' },
  ]

  for (let i = 0; i < areaDefs.length; i++) {
    const area = areaDefs[i]
    let children: string[] = []
    if (area.id === 'area-modules') {
      children = moduleSubpages.map(m => m.id)
    }
    else if (area.id === 'area-system') {
      children = systemSubpages.map(s => s.id)
    }

    nodesById[area.id] = {
      id: area.id,
      label: area.label,
      shortLabel: area.shortLabel,
      route: area.route,
      parentId: 'hub',
      children,
      order: i,
      kind: 'area',
      icon: area.icon,
      glyph: area.glyph,
    }
  }

  for (let i = 0; i < moduleSubpages.length; i++) {
    const mod = moduleSubpages[i]
    nodesById[mod.id] = {
      id: mod.id,
      label: mod.label,
      shortLabel: mod.shortLabel,
      route: mod.route,
      parentId: 'area-modules',
      children: [],
      order: i,
      kind: 'page',
      icon: mod.icon,
      glyph: `${i + 1}`,
    }
  }

  for (let i = 0; i < systemSubpages.length; i++) {
    const sys = systemSubpages[i]
    nodesById[sys.id] = {
      id: sys.id,
      label: sys.label,
      shortLabel: sys.shortLabel,
      route: sys.route,
      parentId: 'area-system',
      children: [],
      order: i,
      kind: 'page',
      icon: sys.icon,
      glyph: `${i + 1}`,
    }
  }

  return {
    rootId: 'hub',
    nodesById,
  }
}

/**
 * Synthetic Stress Fixture: Root Only
 */
export function createRootOnlyFixture(): SettingsTopology {
  return {
    rootId: 'hub',
    nodesById: {
      hub: {
        id: 'hub',
        label: 'Single Root Hub',
        shortLabel: 'Hub',
        route: '/settings',
        parentId: null,
        children: [],
        order: 0,
        kind: 'root',
        icon: 'i-solar:settings-bold-duotone',
      },
    },
  }
}

/**
 * Synthetic Stress Fixture: Single Child Chain (1 Area, 1 Child)
 */
export function createSingleChildFixture(): SettingsTopology {
  return {
    rootId: 'hub',
    nodesById: {
      'hub': {
        id: 'hub',
        label: 'Root Hub',
        shortLabel: 'Hub',
        route: '/settings',
        parentId: null,
        children: ['area-solo'],
        order: 0,
        kind: 'root',
        icon: 'i-solar:settings-bold-duotone',
      },
      'area-solo': {
        id: 'area-solo',
        label: 'Solo Area',
        shortLabel: 'Solo',
        route: '/settings/solo',
        parentId: 'hub',
        children: ['page-lonely'],
        order: 0,
        kind: 'area',
        icon: 'i-solar:star-bold-duotone',
      },
      'page-lonely': {
        id: 'page-lonely',
        label: 'Single Terminal Leaf',
        shortLabel: 'Leaf',
        route: '/settings/solo/leaf',
        parentId: 'area-solo',
        children: [],
        order: 0,
        kind: 'page',
        icon: 'i-solar:leaf-bold-duotone',
      },
    },
  }
}

/**
 * Synthetic Stress Fixture: Balanced 3x3 Tree
 */
export function createBalanced3x3Fixture(): SettingsTopology {
  const nodesById: Record<string, SettingsTopologyNode> = {
    hub: {
      id: 'hub',
      label: 'Balanced Root',
      shortLabel: 'Hub',
      route: '/settings',
      parentId: null,
      children: ['branch-a', 'branch-b', 'branch-c'],
      order: 0,
      kind: 'root',
      icon: 'i-solar:settings-bold-duotone',
    },
  }

  for (const b of ['a', 'b', 'c']) {
    const branchId = `branch-${b}`
    const children = [`leaf-${b}1`, `leaf-${b}2`, `leaf-${b}3`]
    nodesById[branchId] = {
      id: branchId,
      label: `Branch ${b.toUpperCase()}`,
      shortLabel: `Br-${b.toUpperCase()}`,
      route: `/settings/branch-${b}`,
      parentId: 'hub',
      children,
      order: b.charCodeAt(0),
      kind: 'area',
      icon: 'i-solar:folder-bold-duotone',
    }

    for (let j = 1; j <= 3; j++) {
      const leafId = `leaf-${b}${j}`
      nodesById[leafId] = {
        id: leafId,
        label: `Page ${b.toUpperCase()}.${j}`,
        shortLabel: `P-${b.toUpperCase()}${j}`,
        route: `/settings/branch-${b}/p${j}`,
        parentId: branchId,
        children: [],
        order: j,
        kind: 'page',
        icon: 'i-solar:document-text-bold-duotone',
      }
    }
  }

  return { rootId: 'hub', nodesById }
}

/**
 * Synthetic Stress Fixture: Wide Siblings (N = 14 or N = 30)
 */
export function createWideSiblingsFixture(count: number = 30): SettingsTopology {
  const children: string[] = []
  const nodesById: Record<string, SettingsTopologyNode> = {
    hub: {
      id: 'hub',
      label: 'Wide Cluster Hub',
      shortLabel: 'Hub',
      route: '/settings',
      parentId: null,
      children: ['cluster-area'],
      order: 0,
      kind: 'root',
      icon: 'i-solar:settings-bold-duotone',
    },
  }

  for (let i = 1; i <= count; i++) {
    const id = `dense-node-${String(i).padStart(2, '0')}`
    children.push(id)
    nodesById[id] = {
      id,
      label: `Dense Node ${String(i).padStart(2, '0')}`,
      shortLabel: `D${i}`,
      route: `/settings/cluster/${i}`,
      parentId: 'cluster-area',
      children: [],
      order: i,
      kind: 'page',
      icon: 'i-solar:star-fall-bold-duotone',
    }
  }

  nodesById['cluster-area'] = {
    id: 'cluster-area',
    label: `Dense Orbit (${count} Siblings)`,
    shortLabel: 'Dense',
    route: '/settings/cluster',
    parentId: 'hub',
    children,
    order: 0,
    kind: 'area',
    icon: 'i-solar:layers-bold-duotone',
  }

  return { rootId: 'hub', nodesById }
}

/**
 * Synthetic Stress Fixture: Deep Chain (Depth = 5)
 */
export function createDeepChainFixture(depth: number = 5): SettingsTopology {
  const nodesById: Record<string, SettingsTopologyNode> = {}

  let prevId: string | null = null
  for (let d = 0; d <= depth; d++) {
    const id = d === 0 ? 'hub' : `level-${d}`
    const isRoot = d === 0
    const isLeaf = d === depth
    const nextId = isLeaf ? undefined : `level-${d + 1}`

    nodesById[id] = {
      id,
      label: isRoot ? 'Deep Chain Root (L0)' : `Deep Chain Level ${d}`,
      shortLabel: `L${d}`,
      route: d === 0 ? '/settings' : `/settings/d${d}`,
      parentId: prevId,
      children: nextId ? [nextId] : [],
      order: d,
      kind: isRoot ? 'root' : isLeaf ? 'page' : 'area',
      icon: 'i-solar:link-round-bold-duotone',
    }
    prevId = id
  }

  return { rootId: 'hub', nodesById }
}

/**
 * Synthetic Stress Fixture: Uneven Deep Tree (Depth = 5 with varying branches)
 */
export function createUnevenDeepFixture(): SettingsTopology {
  const nodesById: Record<string, SettingsTopologyNode> = {
    'hub': {
      id: 'hub',
      label: 'Uneven Root',
      shortLabel: 'Hub',
      route: '/settings',
      parentId: null,
      children: ['shallow-a', 'deep-b', 'medium-c'],
      order: 0,
      kind: 'root',
      icon: 'i-solar:settings-bold-duotone',
    },
    'shallow-a': {
      id: 'shallow-a',
      label: 'Shallow Area A (Leaf)',
      shortLabel: 'A',
      route: '/settings/a',
      parentId: 'hub',
      children: [],
      order: 0,
      kind: 'area',
      icon: 'i-solar:star-bold-duotone',
    },
    'medium-c': {
      id: 'medium-c',
      label: 'Medium Area C',
      shortLabel: 'C',
      route: '/settings/c',
      parentId: 'hub',
      children: ['c-sub-1', 'c-sub-2'],
      order: 2,
      kind: 'area',
      icon: 'i-solar:folder-bold-duotone',
    },
    'c-sub-1': {
      id: 'c-sub-1',
      label: 'Subpage C.1',
      shortLabel: 'C1',
      route: '/settings/c/1',
      parentId: 'medium-c',
      children: [],
      order: 0,
      kind: 'page',
      icon: 'i-solar:document-text-bold-duotone',
    },
    'c-sub-2': {
      id: 'c-sub-2',
      label: 'Subpage C.2',
      shortLabel: 'C2',
      route: '/settings/c/2',
      parentId: 'medium-c',
      children: [],
      order: 1,
      kind: 'page',
      icon: 'i-solar:document-text-bold-duotone',
    },
    'deep-b': {
      id: 'deep-b',
      label: 'Deep Branch B (L1)',
      shortLabel: 'B',
      route: '/settings/b',
      parentId: 'hub',
      children: ['b-l2'],
      order: 1,
      kind: 'area',
      icon: 'i-solar:folder-bold-duotone',
    },
    'b-l2': {
      id: 'b-l2',
      label: 'Sub-branch B (L2)',
      shortLabel: 'B2',
      route: '/settings/b/l2',
      parentId: 'deep-b',
      children: ['b-l3-a', 'b-l3-b'],
      order: 0,
      kind: 'category',
      icon: 'i-solar:box-bold-duotone',
    },
    'b-l3-a': {
      id: 'b-l3-a',
      label: 'Sub-branch B (L3 Alpha)',
      shortLabel: 'B3a',
      route: '/settings/b/l2/a',
      parentId: 'b-l2',
      children: ['b-l4'],
      order: 0,
      kind: 'category',
      icon: 'i-solar:box-bold-duotone',
    },
    'b-l3-b': {
      id: 'b-l3-b',
      label: 'Leaf B (L3 Beta)',
      shortLabel: 'B3b',
      route: '/settings/b/l2/b',
      parentId: 'b-l2',
      children: [],
      order: 1,
      kind: 'page',
      icon: 'i-solar:document-bold-duotone',
    },
    'b-l4': {
      id: 'b-l4',
      label: 'Sub-branch B (L4)',
      shortLabel: 'B4',
      route: '/settings/b/l2/a/l4',
      parentId: 'b-l3-a',
      children: ['b-l5-deepest'],
      order: 0,
      kind: 'category',
      icon: 'i-solar:box-bold-duotone',
    },
    'b-l5-deepest': {
      id: 'b-l5-deepest',
      label: 'Deepest Abyss Leaf (L5)',
      shortLabel: 'B5',
      route: '/settings/b/l2/a/l4/deepest',
      parentId: 'b-l4',
      children: [],
      order: 0,
      kind: 'page',
      icon: 'i-solar:flame-bold-duotone',
    },
  }

  return { rootId: 'hub', nodesById }
}

/**
 * Invalid Fixture: Cycle
 */
export function createInvalidCycleFixture(): SettingsTopology {
  return {
    rootId: 'hub',
    nodesById: {
      'hub': {
        id: 'hub',
        label: 'Root',
        shortLabel: 'Hub',
        route: '/settings',
        parentId: null,
        children: ['node-a'],
        order: 0,
      },
      'node-a': {
        id: 'node-a',
        label: 'Node A',
        parentId: 'hub',
        children: ['node-b'],
        order: 0,
      },
      'node-b': {
        id: 'node-b',
        label: 'Node B (Loops to A)',
        parentId: 'node-a',
        children: ['node-a'], // Cycle!
        order: 0,
      },
    },
  }
}

/**
 * Invalid Fixture: Missing Parent
 */
export function createInvalidMissingParentFixture(): SettingsTopology {
  return {
    rootId: 'hub',
    nodesById: {
      'hub': {
        id: 'hub',
        label: 'Root',
        shortLabel: 'Hub',
        route: '/settings',
        parentId: null,
        children: ['node-orphan'],
        order: 0,
      },
      'node-orphan': {
        id: 'node-orphan',
        label: 'Orphaned Node',
        parentId: 'non-existent-parent-id', // Missing parent!
        children: [],
        order: 0,
      },
    },
  }
}

/**
 * Invalid Fixture: Unreachable Node
 */
export function createInvalidUnreachableFixture(): SettingsTopology {
  return {
    rootId: 'hub',
    nodesById: {
      'hub': {
        id: 'hub',
        label: 'Root',
        shortLabel: 'Hub',
        route: '/settings',
        parentId: null,
        children: [],
        order: 0,
      },
      'node-ghost': {
        id: 'node-ghost',
        label: 'Ghost Node (Unreachable)',
        parentId: 'hub',
        children: [],
        order: 0,
      },
    },
  }
}
