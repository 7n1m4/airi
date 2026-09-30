import { describe, expect, it } from 'vitest'

import {
  classifyExpression,
  filterCandidateExpressions,
  isTrackingNoise,
} from './expression-noise-gate'

describe('expression-noise-gate', () => {
  describe('classifyExpression - ARKit 52 FACS', () => {
    it('correctly classifies standard Apple ARKit blendshapes as arkit', () => {
      expect(classifyExpression('eyeBlinkLeft')).toBe('arkit')
      expect(classifyExpression('eyeBlinkRight')).toBe('arkit')
      expect(classifyExpression('jawOpen')).toBe('arkit')
      expect(classifyExpression('mouthSmileRight')).toBe('arkit')
      expect(classifyExpression('mouthFrownLeft')).toBe('arkit')
      expect(classifyExpression('browDownRight')).toBe('arkit')
      expect(classifyExpression('cheekPuff')).toBe('arkit')
      expect(classifyExpression('tongueOut')).toBe('arkit')
    })

    it('handles snake_case and case-insensitive ARKit variations', () => {
      expect(classifyExpression('eye_blink_left')).toBe('arkit')
      expect(classifyExpression('mouth_smile_right')).toBe('arkit')
      expect(classifyExpression('jaw_open')).toBe('arkit')
    })
  })

  describe('classifyExpression - Speech Visemes', () => {
    it('classifies VRM standard vowels and Oculus phonemes as viseme', () => {
      expect(classifyExpression('a')).toBe('viseme')
      expect(classifyExpression('i')).toBe('viseme')
      expect(classifyExpression('u')).toBe('viseme')
      expect(classifyExpression('e')).toBe('viseme')
      expect(classifyExpression('o')).toBe('viseme')
      expect(classifyExpression('sil')).toBe('viseme')
      expect(classifyExpression('pp')).toBe('viseme')
      expect(classifyExpression('ff')).toBe('viseme')
      expect(classifyExpression('th')).toBe('viseme')
    })

    it('classifies Japanese kana visemes with digits/tildes as viseme', () => {
      expect(classifyExpression('あ')).toBe('viseme')
      expect(classifyExpression('い')).toBe('viseme')
      expect(classifyExpression('う')).toBe('viseme')
      expect(classifyExpression('え')).toBe('viseme')
      expect(classifyExpression('お')).toBe('viseme')
      expect(classifyExpression('あ2')).toBe('viseme')
      expect(classifyExpression('い~')).toBe('viseme')
      expect(classifyExpression('え４')).toBe('viseme')
      expect(classifyExpression('ああ')).toBe('viseme')
      expect(classifyExpression('いい3')).toBe('viseme')
    })
  })

  describe('classifyExpression - Procedural Eye, Gaze, & Bone Tracking', () => {
    it('classifies directional gaze and LookAt channels as procedural_eye', () => {
      expect(classifyExpression('LookUp')).toBe('procedural_eye')
      expect(classifyExpression('look_down')).toBe('procedural_eye')
      expect(classifyExpression('camera_look')).toBe('procedural_eye')
      expect(classifyExpression('カメラ目線')).toBe('procedural_eye')
      expect(classifyExpression('瞳上')).toBe('procedural_eye')
      expect(classifyExpression('瞳サイズ調整')).toBe('procedural_eye')
      expect(classifyExpression('上右')).toBe('procedural_eye')
      expect(classifyExpression('下左')).toBe('procedural_eye')
    })

    it('classifies procedural blink and eyelid morphs as procedural_eye', () => {
      expect(classifyExpression('まばたき')).toBe('procedural_eye')
      expect(classifyExpression('ウィンク')).toBe('procedural_eye')
      expect(classifyExpression('ウインク右')).toBe('procedural_eye')
      expect(classifyExpression('下まぶた上げ左')).toBe('procedural_eye')
      expect(classifyExpression('ハイライト消し')).toBe('procedural_eye')
      expect(classifyExpression('teeth_short')).toBe('procedural_eye')
      expect(classifyExpression('上歯を隠す')).toBe('procedural_eye')
    })

    it('classifies compound tracking morphs as procedural_eye', () => {
      expect(classifyExpression('_eyeSquint+LowerUp_L')).toBe('procedural_eye')
      expect(classifyExpression('_mouthPress+DuckMouth')).toBe('procedural_eye')
    })

    it('classifies VRoid internal component morphs (Fcl_*) as procedural_eye', () => {
      expect(classifyExpression('Fcl_ALL_Angry')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_ALL_Fun')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_ALL_Joy')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_ALL_Sorrow')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_ALL_Surprised')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_BRW_Joy')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_EYE_Angry')).toBe('procedural_eye')
      expect(classifyExpression('Fcl_MTH_SkinFung')).toBe('procedural_eye')
    })
  })

  describe('classifyExpression - Neutral & Numeric Index Noise', () => {
    it('classifies base poses and index noise as neutral', () => {
      expect(classifyExpression('neutral')).toBe('neutral')
      expect(classifyExpression('default')).toBe('neutral')
      expect(classifyExpression('base')).toBe('neutral')
      expect(classifyExpression('基本セット')).toBe('neutral')
      expect(classifyExpression('take01')).toBe('neutral')
      expect(classifyExpression('blendshapeclip#40')).toBe('neutral')
      expect(classifyExpression('------BROW------')).toBe('neutral')
      expect(classifyExpression('動作チェック')).toBe('neutral')
    })
  })

  describe('classifyExpression - Wardrobe & Mesh Toggles', () => {
    it('classifies clothes, props, hairstyles, and accessory toggles as wardrobe', () => {
      expect(classifyExpression('glasses')).toBe('wardrobe')
      expect(classifyExpression('jacket_toggle')).toBe('wardrobe')
      expect(classifyExpression('dress_off')).toBe('wardrobe')
      expect(classifyExpression('costume')).toBe('wardrobe')
      expect(classifyExpression('twintail')).toBe('wardrobe')
      expect(classifyExpression('ahoge')).toBe('wardrobe')
      expect(classifyExpression('メガネ')).toBe('wardrobe')
      expect(classifyExpression('制服')).toBe('wardrobe')
      expect(classifyExpression('帽子')).toBe('wardrobe')
      expect(classifyExpression('短袖')).toBe('wardrobe')
      expect(classifyExpression('換裝-公主裙')).toBe('wardrobe')
    })
  })

  describe('classifyExpression - High-Signal Emotes', () => {
    it('classifies English emotions as emote', () => {
      expect(classifyExpression('joy')).toBe('emote')
      expect(classifyExpression('angry')).toBe('emote')
      expect(classifyExpression('sorrow')).toBe('emote')
      expect(classifyExpression('fun')).toBe('emote')
      expect(classifyExpression('surprised')).toBe('emote')
      expect(classifyExpression('smug')).toBe('emote')
      expect(classifyExpression('pout')).toBe('emote')
      expect(classifyExpression('blush')).toBe('emote')
      expect(classifyExpression('ahegao')).toBe('emote')
    })

    it('classifies Japanese anime emotes as emote', () => {
      expect(classifyExpression('ドヤ')).toBe('emote')
      expect(classifyExpression('どや')).toBe('emote')
      expect(classifyExpression('ジト目')).toBe('emote')
      expect(classifyExpression('じと眉')).toBe('emote')
      expect(classifyExpression('照れ')).toBe('emote')
      expect(classifyExpression('うるうる')).toBe('emote')
      expect(classifyExpression('青ざめ')).toBe('emote')
      expect(classifyExpression('赤面')).toBe('emote')
      expect(classifyExpression('はぅ')).toBe('emote')
      expect(classifyExpression('にこり')).toBe('emote')
      expect(classifyExpression('むふふ')).toBe('emote')
    })

    it('classifies Chinese anime emotes as emote', () => {
      expect(classifyExpression('星星眼')).toBe('emote')
      expect(classifyExpression('猫猫嘴')).toBe('emote')
      expect(classifyExpression('大哭')).toBe('emote')
      expect(classifyExpression('流汗')).toBe('emote')
      expect(classifyExpression('臉紅')).toBe('emote')
      expect(classifyExpression('水汪汪')).toBe('emote')
      expect(classifyExpression('輕蔑')).toBe('emote')
      expect(classifyExpression('嫌棄')).toBe('emote')
    })

    it('classifies ASCII/kaomoji as emote', () => {
      expect(classifyExpression('>_<')).toBe('emote')
      expect(classifyExpression('^w^')).toBe('emote')
      expect(classifyExpression('xd')).toBe('emote')
      expect(classifyExpression('T_T')).toBe('emote')
      expect(classifyExpression(';w;')).toBe('emote')
    })
  })

  describe('isTrackingNoise', () => {
    it('returns true for arkit, viseme, procedural_eye, neutral', () => {
      expect(isTrackingNoise('arkit')).toBe(true)
      expect(isTrackingNoise('viseme')).toBe(true)
      expect(isTrackingNoise('procedural_eye')).toBe(true)
      expect(isTrackingNoise('neutral')).toBe(true)
    })

    it('returns false for emote, wardrobe, unclassified', () => {
      expect(isTrackingNoise('emote')).toBe(false)
      expect(isTrackingNoise('wardrobe')).toBe(false)
      expect(isTrackingNoise('unclassified')).toBe(false)
    })
  })

  describe('filterCandidateExpressions', () => {
    it('bundles both emotes and unclassified into candidates while filtering noise and wardrobe', () => {
      const rawList = [
        'eyeBlinkLeft', // arkit
        'jawOpen', // arkit
        'a', // viseme
        'あ', // viseme
        'LookUp', // procedural_eye
        'まばたき', // procedural_eye
        'neutral', // neutral
        'glasses', // wardrobe
        'jacket', // wardrobe
        'joy', // emote
        'ジト目', // emote
        '星星眼', // emote
        'SomeMysteryMorph', // unclassified
      ]

      const result = filterCandidateExpressions(rawList)
      expect(result.rawCount).toBe(13)
      expect(result.filteredNoise).toEqual(['eyeBlinkLeft', 'jawOpen', 'a', 'あ', 'LookUp', 'まばたき', 'neutral'])
      expect(result.wardrobe).toEqual(['glasses', 'jacket'])
      // Candidates contains all emotes + unclassified
      expect(result.candidates).toEqual(['joy', 'ジト目', '星星眼', 'SomeMysteryMorph'])
    })
  })
})
