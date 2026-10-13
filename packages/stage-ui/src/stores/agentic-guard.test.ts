import type { AutonomousMode } from '@proj-airi/stage-shared/agentic'

import { describe, expect, it } from 'vitest'

import { evaluateConstitutionalGuard, shouldRunForPresence } from './agentic'

const ACTION_INTENT = 'expression.body'

function guard(overrides: Partial<Parameters<typeof evaluateConstitutionalGuard>[0]> = {}) {
  return evaluateConstitutionalGuard({
    canSpeak: true,
    hasAvailableActionIntents: true,
    availableActionIntents: [ACTION_INTENT],
    requestedActionIntent: ACTION_INTENT,
    ...overrides,
  })
}

describe('evaluateConstitutionalGuard', () => {
  it('allows a cycle when the provider can speak and allows the intent', () => {
    expect(guard().allowed).toBe(true)
  })

  it('refuses when the provider cannot speak', () => {
    // A silent autonomous action is invisible to the user, which is the exact
    // failure mode autonomous speech is supposed to avoid.
    expect(guard({ canSpeak: false }).allowed).toBe(false)
  })

  it('refuses when the provider exposes no action-intent surface', () => {
    expect(guard({ hasAvailableActionIntents: false }).allowed).toBe(false)
  })

  it('refuses an intent the provider did not list', () => {
    const result = guard({ requestedActionIntent: 'filesystem.delete' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('filesystem.delete')
  })

  it('refuses the autonomous intent itself when the intent list omits it', () => {
    expect(guard({ availableActionIntents: [] }).allowed).toBe(false)
  })

  it('does not infer permission from an empty intent list', () => {
    // Regression: `availableActionIntents.includes('')` is true, so an unset
    // intent string must never be treated as allowed.
    expect(guard({ requestedActionIntent: '' }).allowed).toBe(false)
  })

  it('reports a reason for every refusal', () => {
    for (const refusal of [guard({ canSpeak: false }), guard({ hasAvailableActionIntents: false }), guard({ availableActionIntents: [] })])
      expect(refusal.reason).toBeTruthy()
  })
})

describe('shouldRunForPresence', () => {
  const cases: [AutonomousMode, string, boolean][] = [
    ['disabled', 'away', false],
    ['disabled', 'active', false],
    ['when-away', 'away', true],
    ['when-away', 'active', false],
    ['when-away', 'idle', false],
    ['when-away', 'screen-locked', false],
    ['when-away', 'sleep', false],
    ['always', 'active', true],
    ['always', 'away', true],
  ]

  it.each(cases)('mode %s in state %s runs=%s', (mode, presence, expected) => {
    expect(shouldRunForPresence(mode, presence)).toBe(expected)
  })

  it('never runs on an unrecognised presence state', () => {
    // A presence state the renderer cannot justify must not unlock autonomous
    // action, even under the most permissive mode.
    expect(shouldRunForPresence('when-away', 'unknown-state')).toBe(false)
  })
})
