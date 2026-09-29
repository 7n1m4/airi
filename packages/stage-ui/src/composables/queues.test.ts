import { describe, expect, it } from 'vitest'

import {
  extractEmotions,
  normalizeDelayMs,
  normalizeDuration,
  normalizeEmotionName,
  normalizeIntensity,
  parseActEmotion,
  parseDelay,
} from './queues'

describe('queues: ACT tokens & timing parsing invariants', () => {
  describe('normalizeDuration', () => {
    it('preserves valid positive numbers', () => {
      expect(normalizeDuration(3)).toBe(3)
      expect(normalizeDuration(0.5)).toBe(0.5)
      expect(normalizeDuration(10)).toBe(10)
    })

    it('preserves 0 for immediate reset signalling', () => {
      expect(normalizeDuration(0)).toBe(0)
      expect(normalizeDuration('0')).toBe(0)
    })

    it('parses numeric strings and strings with units', () => {
      expect(normalizeDuration('4')).toBe(4)
      expect(normalizeDuration('2.5')).toBe(2.5)
      expect(normalizeDuration('3s')).toBe(3)
      expect(normalizeDuration('1.5sec')).toBe(1.5)
    })

    it('returns undefined for invalid or negative durations', () => {
      expect(normalizeDuration(-1)).toBeUndefined()
      expect(normalizeDuration('-5')).toBeUndefined()
      expect(normalizeDuration(Number.NaN)).toBeUndefined()
      expect(normalizeDuration('invalid')).toBeUndefined()
      expect(normalizeDuration(null)).toBeUndefined()
      expect(normalizeDuration(undefined)).toBeUndefined()
    })
  })

  describe('normalizeIntensity', () => {
    it('clamps values to [0, 1]', () => {
      expect(normalizeIntensity(0.5)).toBe(0.5)
      expect(normalizeIntensity(-0.2)).toBe(0)
      expect(normalizeIntensity(1.5)).toBe(1)
    })

    it('defaults to 1 for invalid or NaN inputs', () => {
      expect(normalizeIntensity(Number.NaN)).toBe(1)
      expect(normalizeIntensity('high')).toBe(1)
      expect(normalizeIntensity(undefined)).toBe(1)
    })
  })

  describe('normalizeEmotionName', () => {
    it('normalizes standard enum emotions to lowercase', () => {
      expect(normalizeEmotionName('Happy')).toBe('happy')
      expect(normalizeEmotionName('SAD')).toBe('sad')
      expect(normalizeEmotionName('neutral')).toBe('neutral')
    })

    it('preserves casing for non-enum custom expressions / VRMA filenames', () => {
      expect(normalizeEmotionName('Pixel_Glasses')).toBe('Pixel_Glasses')
      expect(normalizeEmotionName('CustomPose_01')).toBe('CustomPose_01')
    })
  })

  describe('parseActEmotion (Short Format)', () => {
    it('parses standard short format with single emotion', () => {
      const result = parseActEmotion('Hello! <|ACT:emotion="happy"|> Nice to meet you.')
      expect(result.ok).toBe(true)
      expect(result.emotions).toEqual([
        { name: 'happy', intensity: 1, duration: undefined },
      ])
    })

    it('parses short format with duration parameter', () => {
      const result = parseActEmotion('Check this out: <|ACT:emotion="happy",duration="3"|>')
      expect(result.ok).toBe(true)
      expect(result.emotions).toEqual([
        { name: 'happy', intensity: 1, duration: 3 },
      ])
    })

    it('parses short format with intensity and duration', () => {
      const result = parseActEmotion('<|ACT:emotion="cheerful",intensity="0.8",duration="2.5"|>')
      expect(result.ok).toBe(true)
      expect(result.emotions).toEqual([
        { name: 'cheerful', intensity: 0.8, duration: 2.5 },
      ])
    })

    it('parses motion cue with duration', () => {
      const result = parseActEmotion('<|ACT:motion="wave",duration="4"|>')
      expect(result.ok).toBe(true)
      expect(result.emotions).toEqual([
        { name: 'wave', intensity: 1, duration: 4 },
      ])
    })

    it('parses combined emotion and motion tags with duration', () => {
      const result = parseActEmotion('<|ACT:emotion="happy",motion="wave",duration="3"|>')
      expect(result.ok).toBe(true)
      expect(result.emotions).toHaveLength(2)
      expect(result.emotions[0]).toEqual({ name: 'happy', intensity: 1, duration: 3 })
      expect(result.emotions[1]).toEqual({ name: 'wave', intensity: 1, duration: 3 })
    })

    it('parses immediate reset signals (neutral or duration="0")', () => {
      const neutralResult = parseActEmotion('<|ACT:emotion="neutral"|>')
      expect(neutralResult.ok).toBe(true)
      expect(neutralResult.emotions[0].name).toBe('neutral')

      const zeroDurationResult = parseActEmotion('<|ACT:emotion="happy",duration="0"|>')
      expect(zeroDurationResult.ok).toBe(true)
      expect(zeroDurationResult.emotions[0]).toEqual({ name: 'happy', intensity: 1, duration: 0 })
    })

    it('parses VFX aura tokens', () => {
      const result = parseActEmotion('<|ACT:vfx="fire",duration="4"|>')
      expect(result.ok).toBe(true)
      expect(result.emotions).toEqual([
        { name: 'fire', intensity: 1, duration: 4 },
      ])
    })

    it('tolerates legacy bare close tag >', () => {
      const result = parseActEmotion('<|ACT:emotion="cool",duration="2">')
      expect(result.ok).toBe(true)
      expect(result.emotions).toEqual([
        { name: 'cool', intensity: 1, duration: 2 },
      ])
    })

    it('returns ok: false when no ACT tag is present', () => {
      const result = parseActEmotion('Just normal text without any markers.')
      expect(result.ok).toBe(false)
      expect(result.emotions).toEqual([])
    })
  })

  describe('extractEmotions (JSON Chaining Format)', () => {
    it('parses nested emotion object with custom intensity and duration', () => {
      const payload = {
        emotion: {
          name: 'surprised',
          intensity: 0.7,
          duration: 3.5,
        },
        motion: 'nod',
      }
      const emotions = extractEmotions(payload)
      expect(emotions).toEqual([
        { name: 'surprised', intensity: 0.7, duration: 3.5 },
        { name: 'nod', intensity: 1, duration: undefined },
      ])
    })

    it('applies global duration to motion when individual duration is omitted', () => {
      const payload = {
        emotion: 'happy',
        motion: 'jump',
        duration: 4,
      }
      const emotions = extractEmotions(payload)
      expect(emotions).toEqual([
        { name: 'happy', intensity: 1, duration: 4 },
        { name: 'jump', intensity: 1, duration: 4 },
      ])
    })
  })

  describe('parseDelay & normalizeDelayMs', () => {
    it('normalizes seconds to milliseconds', () => {
      expect(normalizeDelayMs(1)).toBe(1000)
      expect(normalizeDelayMs(2.5)).toBe(2500)
      expect(normalizeDelayMs(0.5)).toBe(500)
    })

    it('preserves raw milliseconds when >= 50', () => {
      expect(normalizeDelayMs(800)).toBe(800)
      expect(normalizeDelayMs(2000)).toBe(2000)
    })

    it('enforces 10-second safety ceiling', () => {
      expect(normalizeDelayMs(25)).toBe(10000) // 25s clamped to 10s
      expect(normalizeDelayMs(15000)).toBe(10000) // 15000ms clamped to 10000ms
    })

    it('parses DELAY token in content string', () => {
      expect(parseDelay('Let me think... <|DELAY:2|> Ah, got it!')).toBe(2000)
      expect(parseDelay('Wait! <|DELAY:0.8|>')).toBe(800)
      expect(parseDelay('No delay here')).toBeNull()
    })
  })
})
