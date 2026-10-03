import { describe, expect, it } from 'vitest'

import {
  buildExpressionCapabilities,
  buildMotionCapabilities,
  normalizeVrmKey,
  resolveDefaultMotionLabel,
} from './model-capabilities'

describe('model-capabilities', () => {
  describe('normalizeVrmKey', () => {
    it('normalizes VRM blendshape prefixes and title-cases', () => {
      expect(normalizeVrmKey('Face.M_F00_000_00_Fcl_ALL_Joy')).toBe('Joy')
      expect(normalizeVrmKey('Fcl_BRW_Angry')).toBe('Angry')
      expect(normalizeVrmKey('vrc.v_aa')).toBe('Aa')
      expect(normalizeVrmKey('ARKit_eyeBlinkLeft')).toBe('Eye Blink Left')
    })
  })

  describe('resolveDefaultMotionLabel', () => {
    it('unpacks packed motion numbers correctly', () => {
      expect(resolveDefaultMotionLabel('Motions_A10_0_File_0')).toBe('A10 #1')
      expect(resolveDefaultMotionLabel('motions/Motions_A10_1_File_0.motion3.json')).toBe('A10 #2')
      expect(resolveDefaultMotionLabel('dance_happy.mtn')).toBe('dance happy')
    })
  })

  describe('buildExpressionCapabilities', () => {
    it('auto-curates usable flag via noise gate', () => {
      const rawKeys = [
        'joy',
        'angry',
        'eyeBlinkLeft', // noise FACS
        'mouthPressLeft', // noise FACS
      ]

      const items = buildExpressionCapabilities(rawKeys, false)
      expect(items).toHaveLength(4)

      const joy = items.find(i => i.rawKey === 'joy')
      expect(joy).toBeDefined()
      expect(joy?.label).toBe('joy')
      expect(joy?.usable).toBe(true)

      const blink = items.find(i => i.rawKey === 'eyeBlinkLeft')
      expect(blink).toBeDefined()
      expect(blink?.usable).toBe(false)
    })
  })

  describe('buildMotionCapabilities', () => {
    it('builds motions with usable: true and normalized labels', () => {
      const rawMotions = ['Motions_A10_0_File_0', 'dance_fun.motion3.json']
      const items = buildMotionCapabilities(rawMotions)

      expect(items).toHaveLength(2)
      const packed = items.find(i => i.rawKey === 'Motions_A10_0_File_0')
      expect(packed).toEqual({
        rawKey: 'Motions_A10_0_File_0',
        label: 'A10 #1',
        usable: true,
      })

      const dance = items.find(i => i.rawKey === 'dance_fun.motion3.json')
      expect(dance).toEqual({
        rawKey: 'dance_fun.motion3.json',
        label: 'dance fun',
        usable: true,
      })
    })
  })
})
