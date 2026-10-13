import type { AutonomousMode } from '@proj-airi/stage-shared/agentic'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_COOLDOWN_MINUTES, MAX_COOLDOWN_MINUTES, MIN_COOLDOWN_MINUTES, useAgenticStore } from './agentic'
import { usePresenceStore } from './presence'

// The repo's established pattern for renderer store tests: the electron bridge
// and the i18n composable are the only two seams mocked, and the stores
// themselves stay real Pinia instances.
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async () => undefined,
  useElectronEventaContext: () => ({ value: undefined }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

/**
 * Gate precedence, against the real stores.
 *
 * The precedence matters more than any single branch: mode is checked before
 * presence, presence before cooldown, and an explicit trigger bypasses both
 * presence and cooldown. Getting that order wrong is how an autonomous feature
 * starts interrupting the user at their desk, so it is pinned once here rather
 * than assumed from reading each `if`.
 */
describe('agentic gate precedence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  /** Set the derived presence state the gate reads, without any sensor probing. */
  function setPresence(state: string) {
    const presence = usePresenceStore()
    // The store exposes the snapshot as a plain reactive object; writing the
    // derived state directly is the honest way to test the gate, because there
    // is no second timer to fake.
    presence.presence.state = state as typeof presence.presence.state
    presence.presence.reason = 'test'
    presence.presence.updatedAt = Date.now()
  }

  function agentic(mode: AutonomousMode) {
    const store = useAgenticStore()
    store.autonomousMode = mode
    store.cooldownMinutes = DEFAULT_COOLDOWN_MINUTES
    store.lastCycleAt = 0
    return store
  }

  it('refuses every trigger when the mode is disabled', () => {
    setPresence('away')
    const store = agentic('disabled')

    for (const trigger of ['scheduled', 'manual', 'http'] as const)
      expect(store.gate(trigger)).toEqual({ allowed: false, reason: 'mode-disabled' })
  })

  it('refuses a scheduled cycle while the user is present', () => {
    setPresence('active')
    const store = agentic('when-away')

    expect(store.gate('scheduled').allowed).toBe(false)
    expect(store.gate('scheduled').reason).toBe('presence:active')
  })

  it('refuses a scheduled cycle while the machine is merely idle', () => {
    // `idle` means the user is quiet but plausibly at the desk, which is exactly
    // when a companion must not speak.
    setPresence('idle')
    const store = agentic('when-away')

    expect(store.gate('scheduled').reason).toBe('presence:idle')
  })

  it('allows a scheduled cycle only when away', () => {
    setPresence('away')
    const store = agentic('when-away')

    expect(store.gate('scheduled').allowed).toBe(true)
    expect(store.gate('scheduled').reason).toBeUndefined()
  })

  it('allows a scheduled cycle in `always` mode even while present', () => {
    // `always` is documented as interruption-heavy, so presence does not block it.
    setPresence('active')
    const store = agentic('always')

    expect(store.gate('scheduled').allowed).toBe(true)
  })

  it('checks presence before cooldown, so presence is the reported reason', () => {
    setPresence('active')
    const store = agentic('when-away')
    store.lastCycleAt = Date.now()

    expect(store.gate('scheduled').reason).toBe('presence:active')
  })

  it('refuses a scheduled cycle during the cooldown', () => {
    setPresence('away')
    const store = agentic('when-away')
    store.lastCycleAt = Date.now()

    const result = store.gate('scheduled')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/^cooldown:\d+s$/)
  })

  it('allows a scheduled cycle once the cooldown has elapsed', () => {
    setPresence('away')
    const store = agentic('when-away')
    store.lastCycleAt = Date.now() - (DEFAULT_COOLDOWN_MINUTES + 1) * 60 * 1000

    expect(store.gate('scheduled').allowed).toBe(true)
  })

  it('lets manual and http bypass presence and cooldown', () => {
    // An explicit request is not an interruption, and this is also what makes
    // the loopback HTTP endpoint safe to expose at all.
    setPresence('active')
    const store = agentic('when-away')
    store.lastCycleAt = Date.now()

    expect(store.gate('manual').allowed).toBe(true)
    expect(store.gate('http').allowed).toBe(true)
  })

  it('still refuses manual and http when the mode is disabled', () => {
    setPresence('away')
    const store = agentic('disabled')

    expect(store.gate('manual').allowed).toBe(false)
    expect(store.gate('http').allowed).toBe(false)
  })

  it('never reports a negative or NaN cooldown when the clock is skewed', () => {
    setPresence('away')
    const store = agentic('when-away')
    store.lastCycleAt = Date.now() + 10 * 60 * 1000

    const result = store.gate('scheduled')
    expect(result.allowed).toBe(false)
    // The reason carries the remaining seconds; a skewed clock must still
    // produce a parseable, non-negative number rather than `NaN` or a negative.
    const seconds = Number(result.reason?.replace('cooldown:', '').replace('s', ''))
    expect(Number.isNaN(seconds)).toBe(false)
    expect(seconds).toBeGreaterThan(0)
  })
})

describe('cooldown band', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('clamps the cooldown into the documented 5–30 minute band', () => {
    const store = useAgenticStore()
    store.lastCycleAt = Date.now()

    const cases: [number, number][] = [
      [1, MIN_COOLDOWN_MINUTES],
      [100, MAX_COOLDOWN_MINUTES],
      [-20, MIN_COOLDOWN_MINUTES],
      [Number.NaN, DEFAULT_COOLDOWN_MINUTES],
      [Number.POSITIVE_INFINITY, DEFAULT_COOLDOWN_MINUTES],
      [15, 15],
    ]

    for (const [value, expectedMinutes] of cases) {
      store.cooldownMinutes = value
      // The remaining time is the clamped cooldown minus the (near-zero) time
      // elapsed since `lastCycleAt`, so it rounds up to the clamped whole minutes.
      const remainingMinutes = store.cooldownRemainingMs() / 60_000
      expect(Math.ceil(remainingMinutes)).toBe(expectedMinutes)
    }
  })

  it('reports zero cooldown once a cycle is due', () => {
    const store = useAgenticStore()
    store.lastCycleAt = Date.now() - (DEFAULT_COOLDOWN_MINUTES + 5) * 60 * 1000

    expect(store.cooldownRemainingMs()).toBe(0)
  })
})
