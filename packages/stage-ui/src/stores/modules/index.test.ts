import { describe, expect, it } from 'vitest'

import * as modules from './index'

/**
 * `stores/modules/index.ts` is a pure re-export barrel: it holds no logic of its
 * own, so its statements are fully exercised by the act of importing it. These
 * tests pin the barrel's public surface so that removing a module, or renaming a
 * store/composable, becomes a failing test instead of a silent runtime break in
 * one of the ~20 importers that depend on `stores/modules`.
 */
describe('stores/modules index barrel', () => {
  it('exports every store of its re-exported modules', () => {
    expect(modules.useAiriCardStore).toBeTypeOf('function')
    expect(modules.useArcadeKnowledgeStore).toBeTypeOf('function')
    expect(modules.useConsciousnessStore).toBeTypeOf('function')
    expect(modules.useDiscordStore).toBeTypeOf('function')
    expect(modules.useFactorioStore).toBeTypeOf('function')
    expect(modules.useHearingStore).toBeTypeOf('function')
    expect(modules.useHearingSpeechInputPipeline).toBeTypeOf('function')
    expect(modules.useNan0Store).toBeTypeOf('function')
    expect(modules.useSpeechStore).toBeTypeOf('function')
    expect(modules.useTextToMotionStore).toBeTypeOf('function')
    expect(modules.useTwitterStore).toBeTypeOf('function')
  })

  it('exports the non-store helpers re-exported through the barrel', () => {
    expect(modules.buildSystemPrompt).toBeTypeOf('function')
    expect(modules.isMainWindow).toBeTypeOf('function')
    expect(modules.toSignedPercent).toBeTypeOf('function')
  })

  it('re-exports the garret of shared constants defined by its modules', () => {
    expect(modules.NAN0_DEFAULT_EMOTIONS).toBeTypeOf('object')
    expect(Object.keys(modules.NAN0_DEFAULT_EMOTIONS).length).toBeGreaterThan(0)
  })

  it('does not leak private members of the barrel-imported modules', () => {
    // Every export must come from one of the barrel's re-exported modules, so a
    // stray accidental addendum is caught by this exhaustive membership check.
    const expected: Record<string, true> = {
      useAiriCardStore: true,
      useArcadeKnowledgeStore: true,
      useConsciousnessStore: true,
      useDiscordStore: true,
      useFactorioStore: true,
      useHearingStore: true,
      useHearingSpeechInputPipeline: true,
      useNan0Store: true,
      useSpeechStore: true,
      useTextToMotionStore: true,
      useTwitterStore: true,
      buildSystemPrompt: true,
      isMainWindow: true,
      toSignedPercent: true,
      NAN0_DEFAULT_EMOTIONS: true,
    }

    const unexpected = Object.keys(modules).filter(key => !expected[key])
    expect(unexpected).toEqual([])
  })
})
