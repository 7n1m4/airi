import { describe, expect, it } from 'vitest'

import {
  buildLiveSettingsTopology,
  buildSettingsCatalogTopology,
  classifyTransition,
  computeEscapementPose,
  createBalanced3x3Fixture,
  createDeepChainFixture,
  createEikiReferenceFixture,
  createHeaderTrackScene,
  createInvalidCycleFixture,
  createInvalidMissingParentFixture,
  createInvalidUnreachableFixture,
  createOrbitalScene,
  createRootOnlyFixture,
  createSingleChildFixture,
  createWideSiblingsFixture,
  DEFAULT_ESCAPEMENT_TIMING,
  getSiblingAngle,
  resolvePath,
  resolvePathFromRoute,
  validateTopology,
} from './index'

describe('settings Topology Model & Validator', () => {
  it('validates Eiki Reference V1 fixture correctly matching canonical spec', () => {
    const fixture = createEikiReferenceFixture()
    const result = validateTopology(fixture)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.nodeCount).toBe(27) // 1 root + 10 areas + 12 modules + 4 system
    expect(result.edgeCount).toBe(26) // 10 root-area + 12 module children + 4 system children
    expect(result.leafCount).toBe(24) // 8 leaf areas + 12 module leaves + 4 system leaves
    expect(result.maxDepth).toBe(2) // Height of 2
  })

  it('validates Canonical Settings Catalog topology with full semantic clusters and glyphs', () => {
    const catalogTopology = buildSettingsCatalogTopology()
    const result = validateTopology(catalogTopology)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.nodeCount).toBeGreaterThanOrEqual(45)
    expect(result.maxDepth).toBe(3) // Hub -> Providers -> Speech -> Kokoro
    expect(catalogTopology.nodesById['mod-consciousness']?.glyph).toBe('識')
    expect(catalogTopology.nodesById['mod-consciousness']?.metadata?.clusterGroup).toBe('PERCEPTION & FACULTIES 感')
  })

  it('validates Live Settings topology projected from search index and alias map', () => {
    const liveTopology = buildLiveSettingsTopology()
    const result = validateTopology(liveTopology)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.nodeCount).toBeGreaterThanOrEqual(35)
    expect(result.maxDepth).toBeGreaterThanOrEqual(3) // Has deep provider subtrees
  })

  it('validates synthetic stress fixtures without errors', () => {
    expect(validateTopology(createRootOnlyFixture()).valid).toBe(true)
    expect(validateTopology(createSingleChildFixture()).valid).toBe(true)
    expect(validateTopology(createBalanced3x3Fixture()).valid).toBe(true)
    expect(validateTopology(createWideSiblingsFixture(14)).valid).toBe(true)
    expect(validateTopology(createWideSiblingsFixture(30)).valid).toBe(true)
    expect(validateTopology(createDeepChainFixture(5)).valid).toBe(true)
  })

  it('detects cycles in invalid fixtures', () => {
    const cycleFixture = createInvalidCycleFixture()
    const result = validateTopology(cycleFixture)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Cycle detected'))).toBe(true)
  })

  it('detects missing parent in invalid fixtures', () => {
    const missingParentFixture = createInvalidMissingParentFixture()
    const result = validateTopology(missingParentFixture)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('references non-existent parentId'))).toBe(true)
  })

  it('detects unreachable nodes in invalid fixtures', () => {
    const unreachableFixture = createInvalidUnreachableFixture()
    const result = validateTopology(unreachableFixture)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Unreachable node'))).toBe(true)
  })
})

describe('path & Transition Resolvers', () => {
  const eiki = createEikiReferenceFixture()

  it('resolves root-to-node paths correctly', () => {
    expect(resolvePath(eiki, 'hub')).toEqual(['hub'])
    expect(resolvePath(eiki, 'area-modules')).toEqual(['hub', 'area-modules'])
    expect(resolvePath(eiki, 'mod-01-consciousness')).toEqual(['hub', 'area-modules', 'mod-01-consciousness'])
  })

  it('resolves path from route URL string', () => {
    const match = resolvePathFromRoute(eiki, '/settings/modules/consciousness')
    expect(match.nodeId).toBe('mod-01-consciousness')
    expect(match.path).toEqual(['hub', 'area-modules', 'mod-01-consciousness'])
  })

  it('classifies initial transition', () => {
    const transition = classifyTransition([], ['hub', 'area-card'])
    expect(transition.type).toBe('initial')
  })

  it('classifies sibling transition', () => {
    const prev = ['hub', 'area-modules', 'mod-01-consciousness']
    const next = ['hub', 'area-modules', 'mod-02-speech']
    const transition = classifyTransition(prev, next)
    expect(transition.type).toBe('sibling')
    if (transition.type === 'sibling') {
      expect(transition.from).toBe('mod-01-consciousness')
      expect(transition.to).toBe('mod-02-speech')
      expect(transition.commonDepth).toBe(2)
    }
  })

  it('classifies descend transition', () => {
    const prev = ['hub', 'area-modules']
    const next = ['hub', 'area-modules', 'mod-01-consciousness']
    const transition = classifyTransition(prev, next)
    expect(transition.type).toBe('descend')
    if (transition.type === 'descend') {
      expect(transition.added).toEqual(['mod-01-consciousness'])
      expect(transition.commonDepth).toBe(2)
    }
  })

  it('classifies ascend transition', () => {
    const prev = ['hub', 'area-modules', 'mod-01-consciousness']
    const next = ['hub', 'area-modules']
    const transition = classifyTransition(prev, next)
    expect(transition.type).toBe('ascend')
    if (transition.type === 'ascend') {
      expect(transition.removed).toEqual(['mod-01-consciousness'])
      expect(transition.commonDepth).toBe(2)
    }
  })

  it('classifies branch switch transition', () => {
    const prev = ['hub', 'area-modules', 'mod-01-consciousness']
    const next = ['hub', 'area-system', 'sys-04-developer']
    const transition = classifyTransition(prev, next)
    expect(transition.type).toBe('branch')
    if (transition.type === 'branch') {
      expect(transition.commonDepth).toBe(1)
      expect(transition.removed).toEqual(['area-modules', 'mod-01-consciousness'])
      expect(transition.added).toEqual(['area-system', 'sys-04-developer'])
    }
  })
})

describe('kinetic Escapement Engine & Motion Grammar', () => {
  const catalog = buildSettingsCatalogTopology()
  const prev = ['hub', 'area-modules', 'mod-01-consciousness']
  const next = ['hub', 'area-modules', 'mod-06-speech']
  const transition = classifyTransition(prev, next)

  it('computes angular positions correctly anchored at -90 deg apex', () => {
    expect(getSiblingAngle(0, 4)).toBe(-90)
    expect(getSiblingAngle(1, 4)).toBe(0)
    expect(getSiblingAngle(2, 4)).toBe(90)
    expect(getSiblingAngle(3, 4)).toBe(180)
  })

  it('executes 4-phase motion grammar across beat timeline', () => {
    // Phase 1: Release (0 to 100ms)
    const poseRelease = computeEscapementPose(transition, catalog, prev, next, 50, DEFAULT_ESCAPEMENT_TIMING)
    expect(poseRelease.phase).toBe('release')
    expect(poseRelease.engagementOffset).toBeLessThan(0) // Withdrawn from detent

    // Phase 2: Counter-Strike (100 to 200ms)
    const poseCounter = computeEscapementPose(transition, catalog, prev, next, 150, DEFAULT_ESCAPEMENT_TIMING)
    expect(poseCounter.phase).toBe('counter-strike')

    // Phase 3: Traversal (200 to 400ms)
    const poseTraversal = computeEscapementPose(transition, catalog, prev, next, 300, DEFAULT_ESCAPEMENT_TIMING)
    expect(poseTraversal.phase).toBe('traversal')

    // Phase 4: Settle & Recoil (400 to 500ms)
    const poseSettle = computeEscapementPose(transition, catalog, prev, next, 450, DEFAULT_ESCAPEMENT_TIMING)
    expect(poseSettle.phase).toBe('settle')

    // Post-beat Settled
    const poseSettled = computeEscapementPose(transition, catalog, prev, next, 550, DEFAULT_ESCAPEMENT_TIMING)
    expect(poseSettled.phase).toBe('idle')
    expect(poseSettled.engagementOffset).toBe(0)
  })

  it('instantly settles in reduced-motion mode without intermediate traversal', () => {
    const poseReduced = computeEscapementPose(transition, catalog, prev, next, 100, DEFAULT_ESCAPEMENT_TIMING, true)
    expect(poseReduced.phase).toBe('idle')
    expect(poseReduced.engagementOffset).toBe(0)
  })
})

describe('layout Scene Generators', () => {
  const eiki = createEikiReferenceFixture()
  const activePath = ['hub', 'area-modules', 'mod-01-consciousness']

  it('generates valid Header Track scene', () => {
    const scene = createHeaderTrackScene(eiki, activePath, { width: 800, height: 120 })
    expect(scene.markers.length).toBeGreaterThan(0)
    expect(scene.tracks.length).toBeGreaterThan(0)
    expect(scene.activeMarker?.nodeId).toBe('mod-01-consciousness')
    expect(scene.breadcrumbs.length).toBe(3)
  })

  it('generates valid Orbital scene with concentric tracks and markers', () => {
    const scene = createOrbitalScene(eiki, activePath, { width: 180, height: 180 })
    expect(scene.markers.length).toBeGreaterThan(0)
    expect(scene.tracks.length).toBeGreaterThanOrEqual(2)
    expect(scene.activeMarker?.nodeId).toBe('mod-01-consciousness')
    expect(scene.connectors.length).toBeGreaterThan(0)
  })
})

describe('quantized Inward Momentum Transfer Engine', () => {
  it('computes 3-beat physical momentum cascade with piecewise velocity crossover', async () => {
    const { computeQuantizedMomentumPose, DEFAULT_MOMENTUM_TIMING } = await import('./layouts/quantized-momentum-engine')

    // Beat 1: Initiation (t = 200ms) -> Outer accelerating with tension, Middle dormant
    const poseB1 = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, 200, DEFAULT_MOMENTUM_TIMING)
    expect(poseB1.phase).toBe('initiation')
    expect(poseB1.angles[0]).toBeGreaterThan(-90)
    expect(poseB1.angles[1]).toBe(-90) // Middle dormant
    expect(poseB1.velocities[0]).toBeGreaterThan(0)
    expect(poseB1.velocities[1]).toBe(0)

    // Impact 1: t = 380ms -> Outer peaks, Middle begins accelerating
    const poseImpact1Before = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, 375, DEFAULT_MOMENTUM_TIMING)
    const poseImpact1After = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, 390, DEFAULT_MOMENTUM_TIMING)
    expect(poseImpact1After.phase).toBe('transfer')
    expect(Math.abs(poseImpact1After.velocities[0])).toBeLessThan(Math.abs(poseImpact1Before.velocities[0])) // Outer decelerating
    expect(Math.abs(poseImpact1After.velocities[1])).toBeGreaterThan(0) // Middle accelerating

    // Impact 2: t = 620ms -> Middle strikes Core
    const poseImpact2Before = computeQuantizedMomentumPose([1, 2, 0], [2, 0, 3], 1, 2, 615, DEFAULT_MOMENTUM_TIMING)
    const poseImpact2After = computeQuantizedMomentumPose([1, 2, 0], [2, 0, 3], 1, 2, 630, DEFAULT_MOMENTUM_TIMING)
    expect(poseImpact2After.phase).toBe('snap-lock')
    expect(Math.abs(poseImpact2After.velocities[1])).toBeLessThan(Math.abs(poseImpact2Before.velocities[1])) // Middle decelerating
    expect(Math.abs(poseImpact2After.velocities[2])).toBeGreaterThan(0) // Core accelerating

    // Hard Stop Recoil & Delayed Propagation (t = 820ms)
    const poseRecoil = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, 820, DEFAULT_MOMENTUM_TIMING)
    expect(poseRecoil.phase).toBe('recoil')
    expect(poseRecoil.recoils[2]).not.toBe(0) // Core ringing down
    expect(poseRecoil.recoils[1]).not.toBe(0) // Middle counter-kick

    // Rest & Cardinal Alignment (t = 1000ms -> 1200ms)
    const poseRest = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, 1000, DEFAULT_MOMENTUM_TIMING)
    expect(poseRest.phase).toBe('rest')
    expect(poseRest.recoils).toEqual([0, 0, 0])
    expect(poseRest.angles[0]).toBe(0) // 1 * 90 - 90 = 0 (East)
    expect(poseRest.angles[1]).toBe(90) // 2 * 90 - 90 = 90 (South)
    expect(poseRest.angles[2]).toBe(-90) // 0 * 90 - 90 = -90 (North)
  })

  it('instantly settles in reduced-motion mode without intermediate momentum', async () => {
    const { computeQuantizedMomentumPose, DEFAULT_MOMENTUM_TIMING } = await import('./layouts/quantized-momentum-engine')
    const poseReduced = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, 200, DEFAULT_MOMENTUM_TIMING, true)
    expect(poseReduced.phase).toBe('rest')
    expect(poseReduced.angles).toEqual([0, 90, -90])
    expect(poseReduced.velocities).toEqual([0, 0, 0])
    expect(poseReduced.recoils).toEqual([0, 0, 0])
  })

  it('maintains continuous finite values across the complete timeline', async () => {
    const { computeQuantizedMomentumPose, DEFAULT_MOMENTUM_TIMING } = await import('./layouts/quantized-momentum-engine')
    for (let t = 0; t <= 1200; t += 20) {
      const pose = computeQuantizedMomentumPose([0, 0, 0], [1, 2, 0], 0, 1, t, DEFAULT_MOMENTUM_TIMING)
      expect(Number.isFinite(pose.angles[0])).toBe(true)
      expect(Number.isFinite(pose.angles[1])).toBe(true)
      expect(Number.isFinite(pose.angles[2])).toBe(true)
      expect(Number.isFinite(pose.velocities[0])).toBe(true)
      expect(Number.isFinite(pose.velocities[1])).toBe(true)
      expect(Number.isFinite(pose.velocities[2])).toBe(true)
    }
  })
})

describe('transmission Wave Kinematic Engine', () => {
  it('propagates outward motion with tick/crank cadence and opposing middle phase', async () => {
    const { computeTransmissionPose, DEFAULT_TRANSMISSION_CONFIG, getPhraseDuration } = await import('./layouts/transmission-wave-engine')

    // Tick 1 (t = 80ms, middle of Tick 1): Inner starts moving clockwise, Middle janked clockwise
    const poseTick1Early = computeTransmissionPose([0, 0, 0], 40, DEFAULT_TRANSMISSION_CONFIG)
    expect(poseTick1Early.phase).toBe('tick-1')
    expect(poseTick1Early.angles[2]).toBeGreaterThan(0) // Inner moving clockwise
    expect(poseTick1Early.angles[1]).toBeGreaterThan(0) // Middle pulled initially clockwise

    // Tick 1 (t = 150ms, late in Tick 1): Middle enters opposing counter-rotation
    const poseTick1Late = computeTransmissionPose([0, 0, 0], 150, DEFAULT_TRANSMISSION_CONFIG)
    expect(poseTick1Late.angles[1]).toBeLessThan(0) // Middle counter-rotates opposingly
    expect(poseTick1Late.angles[0]).toBeGreaterThan(0) // Outer dragged along

    // Hold Phase (at end of phrase): Zero velocity, settled angles
    const totalDuration = getPhraseDuration(DEFAULT_TRANSMISSION_CONFIG)
    const poseHold = computeTransmissionPose([0, 0, 0], totalDuration - 20, DEFAULT_TRANSMISSION_CONFIG)
    expect(poseHold.phase).toBe('hold')
    expect(Number.isFinite(poseHold.angles[0])).toBe(true)
    expect(Number.isFinite(poseHold.angles[1])).toBe(true)
    expect(Number.isFinite(poseHold.angles[2])).toBe(true)
  })

  it('settles cleanly in reduced-motion mode', async () => {
    const { computeTransmissionPose, DEFAULT_TRANSMISSION_CONFIG } = await import('./layouts/transmission-wave-engine')
    const poseReduced = computeTransmissionPose([10, -5, 45], 200, DEFAULT_TRANSMISSION_CONFIG, true)
    expect(poseReduced.phase).toBe('hold')
    expect(poseReduced.angles).toEqual([10, -5, 45])
    expect(poseReduced.velocities).toEqual([0, 0, 0])
  })

  it('guarantees continuous finite values across full phrase timeline', async () => {
    const { computeTransmissionPose, DEFAULT_TRANSMISSION_CONFIG, getPhraseDuration } = await import('./layouts/transmission-wave-engine')
    const total = getPhraseDuration(DEFAULT_TRANSMISSION_CONFIG)
    for (let t = 0; t <= total; t += 10) {
      const pose = computeTransmissionPose([0, 0, 0], t, DEFAULT_TRANSMISSION_CONFIG)
      expect(Number.isFinite(pose.angles[0])).toBe(true)
      expect(Number.isFinite(pose.angles[1])).toBe(true)
      expect(Number.isFinite(pose.angles[2])).toBe(true)
      expect(Number.isFinite(pose.velocities[0])).toBe(true)
      expect(Number.isFinite(pose.velocities[1])).toBe(true)
      expect(Number.isFinite(pose.velocities[2])).toBe(true)
    }
  })
})

describe('22.5° Quantized Escapement Odometer Engine', () => {
  it('computes exact 22.5° sibling steps and inverts Square ↔ Diamond every 2 steps', async () => {
    const { computeOdometerAngle, ODOMETER_STEP_DEG } = await import('./layouts/odometer-engine')

    expect(ODOMETER_STEP_DEG).toBe(22.5)
    expect(computeOdometerAngle(0)).toBe(0) // Square
    expect(computeOdometerAngle(1)).toBe(22.5) // Half-turned
    expect(computeOdometerAngle(2)).toBe(45.0) // Diamond
    expect(computeOdometerAngle(3)).toBe(67.5) // Half-turned
    expect(computeOdometerAngle(4)).toBe(90.0) // Square again
    expect(computeOdometerAngle(5)).toBe(112.5) // Half-turned
  })

  it('resolves full 3-layer hierarchical combination lock pose with locked parent layers', async () => {
    const { resolveOdometerPose } = await import('./layouts/odometer-engine')

    // Root level browsing (Depth 0, Index 2): Layer 1 at 45°, layers 2 & 3 parked/terminal
    const poseDepth0 = resolveOdometerPose([2, 0, 0], 0, [4, 8, 3])
    expect(poseDepth0.angles[0]).toBe(45.0)
    expect(poseDepth0.layers[0].isActive).toBe(true)
    expect(poseDepth0.layers[0].isLocked).toBe(false)
    expect(poseDepth0.layers[1].isTerminal).toBe(true)

    // Section browsing (Depth 1, Category index 0 -> Section index 5): Layer 1 locked at 0°, Layer 2 at 112.5°
    const poseDepth1 = resolveOdometerPose([0, 5, 0], 1, [4, 8, 3])
    expect(poseDepth1.angles[0]).toBe(0) // Locked
    expect(poseDepth1.angles[1]).toBe(112.5) // 5 * 22.5°
    expect(poseDepth1.layers[0].isLocked).toBe(true)
    expect(poseDepth1.layers[1].isActive).toBe(true)
    expect(poseDepth1.glyphSignature).toBe('[ 0.0°, 112.5°, 112.5° ]')

    // Full 3-layer terminal route (Depth 2, [0, 5, 2]): [ 0°, 112.5°, 45.0° ]
    const poseDepth2 = resolveOdometerPose([0, 5, 2], 2, [4, 8, 3])
    expect(poseDepth2.angles[0]).toBe(0)
    expect(poseDepth2.angles[1]).toBe(112.5)
    expect(poseDepth2.angles[2]).toBe(45.0)
    expect(poseDepth2.layers[0].isLocked).toBe(true)
    expect(poseDepth2.layers[1].isLocked).toBe(true)
    expect(poseDepth2.layers[2].isActive).toBe(true)
    expect(poseDepth2.glyphSignature).toBe('[ 0.0°, 112.5°, 45.0° ]')
  })

  it('generates sequential section-by-section startup ratchet frames', async () => {
    const { generateStartupRatchetSequence } = await import('./layouts/odometer-engine')

    const frames = generateStartupRatchetSequence([1, 2, 1])
    expect(frames.length).toBeGreaterThan(1)
    // Frame 0: Initial rest
    expect(frames[0].angles).toEqual([0, 0, 0])
    // Final Frame: Settled at target angles [22.5°, 45.0°, 22.5°]
    const lastFrame = frames[frames.length - 1]
    expect(lastFrame.angles).toEqual([22.5, 45.0, 22.5])
  })
})

describe('astrolabe Canopy Topology Engine', () => {
  it('builds valid canopy scene with 3 concentric arcs and illuminated active spline', async () => {
    const { buildAstrolabeCanopyScene } = await import('./layouts/astrolabe-engine')

    const mockHierarchy = [
      {
        name: 'General',
        items: [
          { name: 'App Appearance', items: [{ name: 'Theme' }, { name: 'Color' }] },
          { name: 'Language', items: [{ name: 'English' }] },
        ],
      },
      {
        name: 'Consciousness',
        items: [
          { name: 'LLM Dispatch', items: [{ name: 'Model ID' }, { name: 'Temperature' }] },
        ],
      },
    ]

    const scene = buildAstrolabeCanopyScene(mockHierarchy, [0, 0, 1], { width: 500, height: 400 })

    expect(scene.spine.anchors.length).toBeGreaterThanOrEqual(4)
    expect(scene.arcs.length).toBe(3)
    expect(scene.arcs[0].nodes.length).toBe(2) // 2 categories
    expect(scene.arcs[1].nodes.length).toBe(2) // 2 sections in General
    expect(scene.arcs[2].nodes.length).toBe(2) // 2 fields in Appearance

    // Active path nodes
    expect(scene.activePathNodes.length).toBe(3)
    expect(scene.activePathNodes[0].label).toBe('General')
    expect(scene.activePathNodes[1].label).toBe('App Appearance')
    expect(scene.activePathNodes[2].label).toBe('Color')

    // Valid SVG path strings
    expect(scene.activeSplineD.startsWith('M ')).toBe(true)
    expect(scene.arcs[0].pathD.startsWith('M ')).toBe(true)
  })

  it('extracts valid 3-tier Astrolabe hierarchy and active coordinates from SettingsTopology', async () => {
    const { extractAstrolabeHierarchyFromTopology } = await import('./layouts/astrolabe-engine')
    const { buildSettingsCatalogTopology } = await import('./settings-catalog')

    const topology = buildSettingsCatalogTopology()
    const result = extractAstrolabeHierarchyFromTopology(topology, ['hub', 'area-card'])

    expect(result.hierarchy.length).toBeGreaterThan(0)
    expect(result.activeIndices).toEqual([0, 0, 0])

    const resultMemory = extractAstrolabeHierarchyFromTopology(topology, ['hub', 'area-memory', 'cat-lifetime'])
    expect(resultMemory.hierarchy.length).toBeGreaterThan(0)
    expect(resultMemory.activeIndices[0]).toBe(3) // area-memory is 4th child (index 3)
  })

  it('extracts valid 3-layer Odometer combination pose from SettingsTopology', async () => {
    const { extractOdometerPoseFromTopology } = await import('./layouts/odometer-engine')
    const { buildSettingsCatalogTopology } = await import('./settings-catalog')

    const topology = buildSettingsCatalogTopology()
    const poseHub = extractOdometerPoseFromTopology(topology, ['hub'])
    expect(poseHub.angles).toEqual([0, 0, 0])

    const poseModules = extractOdometerPoseFromTopology(topology, ['hub', 'area-modules'])
    expect(poseModules.angles[0]).toBe(4 * 22.5) // area-modules is 5th area (index 4)
    expect(poseModules.layers[0].isActive).toBe(true)

    const poseSpeech = extractOdometerPoseFromTopology(topology, ['hub', 'area-modules', 'mod-speech'])
    expect(poseSpeech.angles[0]).toBe(4 * 22.5) // area-modules stays locked at 90°
    expect(poseSpeech.layers[0].isLocked).toBe(true)
    expect(poseSpeech.layers[1].isActive).toBe(true)
  })

  it('correctly resolves hierarchical parent routes for settings back navigation', async () => {
    const { resolveSettingsBackRoute } = await import('./path-resolver')

    // 1. Root of settings
    expect(resolveSettingsBackRoute('/settings', { isDesktop: true })).toBe(null)
    expect(resolveSettingsBackRoute('/settings', { isDesktop: false })).toBe('/')
    expect(resolveSettingsBackRoute('/settings/', { isDesktop: false })).toBe('/')

    // 2. System Subpages
    expect(resolveSettingsBackRoute('/settings/system/connection', { isDesktop: true })).toBe('/settings/system')
    expect(resolveSettingsBackRoute('/settings/system/user-profile', { isDesktop: true })).toBe('/settings/system')
    expect(resolveSettingsBackRoute('/settings/system/general', { isDesktop: true })).toBe('/settings/system')
    expect(resolveSettingsBackRoute('/settings/system/color-scheme', { isDesktop: true })).toBe('/settings/system')
    expect(resolveSettingsBackRoute('/settings/system/chat', { isDesktop: true })).toBe('/settings/system')
    expect(resolveSettingsBackRoute('/settings/system/window-shortcuts', { isDesktop: true })).toBe('/settings/system')
    expect(resolveSettingsBackRoute('/settings/system/developer', { isDesktop: true })).toBe('/settings/system')

    // 3. System Hub -> Root
    expect(resolveSettingsBackRoute('/settings/system', { isDesktop: true })).toBe('/settings')
    expect(resolveSettingsBackRoute('/settings/system', { isDesktop: false })).toBe('/settings')

    // 4. Provider Subpages -> Tab Hash
    expect(resolveSettingsBackRoute('/settings/providers/speech/pocket-tts-local')).toBe('/settings/providers#speech')
    expect(resolveSettingsBackRoute('/settings/providers/chat/ollama')).toBe('/settings/providers#chat')
    expect(resolveSettingsBackRoute('/settings/providers/artistry/comfyui')).toBe('/settings/providers#artistry')
    expect(resolveSettingsBackRoute('/settings/providers')).toBe('/settings')

    // 5. Modules & Memory
    expect(resolveSettingsBackRoute('/settings/modules/text-to-motion')).toBe('/settings/modules')
    expect(resolveSettingsBackRoute('/settings/modules')).toBe('/settings')
    expect(resolveSettingsBackRoute('/settings/memory/stmm')).toBe('/settings/memory')
    expect(resolveSettingsBackRoute('/settings/memory')).toBe('/settings')
  })
})
