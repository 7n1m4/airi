import type { EmotionPayload } from './emotions'

import { describe, expect, it } from 'vitest'

import {
  Emotion,
  EMOTION_EmotionMotionName_value,
  EMOTION_VALUES,
  EMOTION_VRMExpressionName_value,
  EmotionAngryMotionName,
  EmotionAwkwardMotionName,
  EmotionCoolMotionName,
  EmotionCuriousMotionName,
  EmotionHappyMotionName,
  EmotionNeutralMotionName,

  EmotionQuestionMotionName,
  EmotionSadMotionName,
  EmotionSurpriseMotionName,
  EmotionThinkMotionName,
} from './emotions'

describe('emotions constants', () => {
  it('exports enum with expected values', () => {
    expect(Object.values(Emotion)).toEqual([
      'happy',
      'sad',
      'angry',
      'think',
      'surprised',
      'awkward',
      'question',
      'curious',
      'neutral',
      'cool',
    ])
  })

  it('eMOTION_VALUES matches enum values', () => {
    expect(EMOTION_VALUES).toEqual(Object.values(Emotion))
  })

  it('exports motion name constants', () => {
    expect(EmotionHappyMotionName).toBe('Happy')
    expect(EmotionSadMotionName).toBe('Sad')
    expect(EmotionAngryMotionName).toBe('Angry')
    expect(EmotionAwkwardMotionName).toBe('Awkward')
    expect(EmotionThinkMotionName).toBe('Think')
    expect(EmotionSurpriseMotionName).toBe('Surprise')
    expect(EmotionQuestionMotionName).toBe('Question')
    expect(EmotionNeutralMotionName).toBe('Idle')
    expect(EmotionCuriousMotionName).toBe('Curious')
    expect(EmotionCoolMotionName).toBe('Cool')
  })

  it('maps every emotion to a motion name', () => {
    for (const e of EMOTION_VALUES) {
      expect(typeof EMOTION_EmotionMotionName_value[e as Emotion]).toBe('string')
    }
    expect(EMOTION_EmotionMotionName_value[Emotion.Happy]).toBe('Happy')
    expect(EMOTION_EmotionMotionName_value[Emotion.Neutral]).toBe('Idle')
  })

  it('maps every emotion to a VRM expression', () => {
    for (const e of EMOTION_VALUES) {
      expect(typeof EMOTION_VRMExpressionName_value[e as Emotion]).toBe('string')
    }
    expect(EMOTION_VRMExpressionName_value[Emotion.Awkward]).toBe('neutral')
    expect(EMOTION_VRMExpressionName_value[Emotion.Curious]).toBe('think')
  })

  it('emotionPayload type is usable', () => {
    const p: EmotionPayload = { name: Emotion.Happy, intensity: 1 }
    expect(p.name).toBe('happy')
    expect(p.intensity).toBe(1)
    const p2: EmotionPayload = { name: 'custom', intensity: 0.5, duration: 100, kind: 'motion' }
    expect(p2.kind).toBe('motion')
  })
})
