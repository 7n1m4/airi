import { computeDirectionalLightOrbit } from '@proj-airi/stage-shared'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

describe('model Lighting Settings & Reactivity', () => {
  it('persists and updates VRM directional and ambient light settings', async () => {
    const { useModelStore } = await import('@proj-airi/stage-ui-three')
    const pinia = createPinia()
    setActivePinia(pinia)

    try {
      const model = useModelStore()

      // 1. Initial defaults check
      expect(model.directionalLightIntensity).toBe(9.06)
      expect(model.directionalLightColor).toBe('#4a3413')
      expect(model.ambientLightIntensity).toBe(1.32)
      expect(model.ambientLightColor).toBe('#FFFFFF')
      expect(model.directionalLightRotation.x).toBe(-34)
      expect(model.directionalLightRotation.y).toBe(0)

      // 2. Directional light rotation mutation
      model.directionalLightRotation.x = 45
      model.directionalLightRotation.y = 90
      await nextTick()

      expect(model.directionalLightRotation.x).toBe(45)
      expect(model.directionalLightRotation.y).toBe(90)

      // 3. Ambient light updates
      model.ambientLightIntensity = 1.2
      model.ambientLightColor = '#ffeedd'
      await nextTick()

      expect(model.ambientLightIntensity).toBe(1.2)
      expect(model.ambientLightColor).toBe('#ffeedd')
    }
    finally {
      disposePinia(pinia)
    }
  })

  it('persists and updates MMD directional and ambient light settings with aliases', async () => {
    const { useMmd } = await import('@proj-airi/stage-ui-mmd/stores/mmd')
    const pinia = createPinia()
    setActivePinia(pinia)

    try {
      const mmd = useMmd()

      // 1. Initial defaults and alias checks
      expect(mmd.directionalIntensity).toBe(9.06)
      expect(mmd.directionalColor).toBe('#4a3413')
      expect(mmd.ambientIntensity).toBe(1.32)
      expect(mmd.ambientColor).toBe('#FFFFFF')
      expect(mmd.directionalLightRotation.x).toBe(-34)
      expect(mmd.directionalLightRotation.y).toBe(0)

      // 2. Modifying via aliases updates underlying store refs
      mmd.directionalIntensity = 1.5
      mmd.directionalColor = '#112233'
      mmd.ambientIntensity = 0.8
      mmd.ambientColor = '#445566'
      await nextTick()

      expect(mmd.directionalLightIntensity).toBe(1.5)
      expect(mmd.directionalLightColor).toBe('#112233')
      expect(mmd.ambientLightIntensity).toBe(0.8)
      expect(mmd.ambientLightColor).toBe('#445566')

      // 3. Directional rotation update
      mmd.directionalLightRotation.x = 30
      mmd.directionalLightRotation.y = -60
      await nextTick()

      expect(mmd.directionalLightRotation.x).toBe(30)
      expect(mmd.directionalLightRotation.y).toBe(-60)
    }
    finally {
      disposePinia(pinia)
    }
  })

  it('calculates proper directional light orbit coordinates around avatar', () => {
    // Model origin at (0, 0, 0), model height 1.6m -> target at y = 0.96m
    const targetPoint = { x: 0, y: 0.96, z: 0 }

    // Front-facing (0, 0)
    const front = computeDirectionalLightOrbit({ x: 0, y: 0 }, { target: targetPoint, distance: 3.0 })
    expect(front.position.x).toBeCloseTo(0, 3)
    expect(front.position.y).toBeCloseTo(0.96, 3)
    expect(front.position.z).toBeCloseTo(3.0, 3)
    expect(front.target).toEqual(targetPoint)

    // Pitched up 45 deg, yawed 45 deg right
    const angled = computeDirectionalLightOrbit({ x: 45, y: 45 }, { target: targetPoint, distance: 3.0 })
    // y = 0.96 + 3.0 * sin(45°) = 0.96 + 2.1213 = 3.0813
    // x = 0 + 3.0 * cos(45°) * sin(45°) = 3.0 * 0.5 = 1.5
    // z = 0 + 3.0 * cos(45°) * cos(45°) = 3.0 * 0.5 = 1.5
    expect(angled.position.x).toBeCloseTo(1.5, 3)
    expect(angled.position.y).toBeCloseTo(3.081, 3)
    expect(angled.position.z).toBeCloseTo(1.5, 3)
  })
})
