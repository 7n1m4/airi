import type { AiriCard } from './modules/airi-card'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_COOLDOWN_MINUTES, useAgenticStore } from './agentic'
import { useChatOrchestratorStore } from './chat'
import { useAiriCardStore } from './modules/airi-card'
import { usePresenceStore } from './presence'
import { useProactivityStore } from './proactivity'

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
 * Nap as a *derived* rest state — §11 `nap.state`.
 *
 * These tests pin the four claims the design makes about nap and nothing else:
 *
 * 1. Nap enters at the canonical presence source's AFK threshold, with **no
 *    timer of its own** — the derivation reads the presence store's public
 *    `afk` predicate, so a card that changes `heartbeats.afkThresholdMinutes`
 *    moves the nap floor without nap owning a number.
 * 2. Nap exits as soon as the user is present again.
 * 3. A napping companion refuses a `scheduled` cycle (§3 "what it refuses to
 *    do"); the gate cases live in `agentic.gate.test.ts`.
 * 4. Nap does **not** require `autonomousMode` to be non-`disabled`, because
 *    napping is a rest state rather than an action.
 *
 * What is deliberately absent: a fake `setTimeout`/`vi.useFakeTimers` around
 * nap. Writing such a test would pin the opposite of the design — that nap has
 * its own timer — so the "no timer" property is proven by the derivation being
 * driven from the signal, not by advancing a clock.
 */
describe('nap state derivation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  /** A card whose nap is enabled; `napEnabled` is the only decision nap owns. */
  function seedCard(napEnabled: boolean, afkThresholdMinutes?: number) {
    const cardStore = useAiriCardStore()
    cardStore.cards.set('nap-card', {
      id: 'nap-card',
      name: 'Nap test',
      extensions: {
        airi: {
          nap: { enabled: napEnabled },
          ...(afkThresholdMinutes !== undefined ? { heartbeats: { afkThresholdMinutes } } : {}),
        },
      },
    } as unknown as AiriCard)
    cardStore.activeCardId = 'nap-card'
    return cardStore
  }

  /** Feed the canonical presence source an idle reading, as the loop would. */
  function writeIdle(idleSec: number) {
    const presence = usePresenceStore()
    presence.addSignalProvider({ id: 'nap-signal', readIdleSec: () => idleSec })
    presence.writeIdleTimeSec(idleSec)
    return presence
  }

  function agentic() {
    const store = useAgenticStore()
    store.autonomousMode = 'when-away'
    store.cooldownMinutes = DEFAULT_COOLDOWN_MINUTES
    store.lastCycleAt = 0
    return store
  }

  /** The machine reads as busy or quiet; idle has no effect on it either way. */
  function setPipeBusy(busy: boolean) {
    const chat = useChatOrchestratorStore()
    chat.sending = busy
  }

  it('enters nap at the canonical presence AFK threshold, with no timer of its own', () => {
    seedCard(true)
    // 300s sits on the default 5-minute AFK threshold (`>=`, matching the
    // upstream heartbeat gate's arithmetic exactly).
    writeIdle(300)
    setPipeBusy(false)
    const store = agentic()

    const presence = usePresenceStore()
    expect(presence.afk).toBe(true)
    expect(store.napState).toBe('napping')
    expect(store.isNapping).toBe(true)
  })

  it('stays active just below the AFK threshold, so the floor is the shared one', () => {
    seedCard(true)
    // 299s is one second under the default 5-minute threshold. The point of the
    // assertion is that nap has no threshold of its own to drift: the same
    // number presence uses is the number nap uses.
    writeIdle(299)
    setPipeBusy(false)
    const store = agentic()

    expect(usePresenceStore().afk).toBe(false)
    expect(store.napState).toBe('active')
  })

  it('follows the presence source when the card changes the shared AFK threshold', () => {
    // Nap owns no number: the card's `heartbeats.afkThresholdMinutes` is what
    // presence resolves, and nap inherits it. 240s is below the default 5
    // minutes, so this only flips once the card moves the floor to 4 minutes.
    seedCard(true, 4)
    writeIdle(240)
    setPipeBusy(false)
    const store = agentic()

    expect(usePresenceStore().afkThresholdMinutes).toBe(4)
    expect(usePresenceStore().afk).toBe(true)
    expect(store.napState).toBe('napping')
  })

  it('exits nap the moment the user is present again', () => {
    seedCard(true)
    const presence = writeIdle(600)
    setPipeBusy(false)
    const store = agentic()
    expect(store.napState).toBe('napping')

    presence.writeIdleTimeSec(0)

    expect(presence.afk).toBe(false)
    expect(store.napState).toBe('active')
    expect(store.isNapping).toBe(false)
  })

  it('stays active when nap is disabled on the card, however long the user is away', () => {
    seedCard(false)
    writeIdle(600)
    setPipeBusy(false)
    const store = agentic()

    expect(usePresenceStore().afk).toBe(true)
    expect(store.napState).toBe('active')
  })

  it('naps while the autonomous mode is disabled, because napping is a rest state', () => {
    // The separation is the design's core claim: `disabled` stops the cycle, not
    // the rest. A companion in `disabled` mode that could not nap would be the
    // "performs at an empty desk" failure the doc calls out.
    seedCard(true)
    writeIdle(600)
    setPipeBusy(false)
    const store = agentic()
    store.autonomousMode = 'disabled'

    expect(store.autonomousMode).toBe('disabled')
    expect(store.napState).toBe('napping')
  })

  it('refuses to nap while the chat pipe is busy, so a mid-sentence companion rests only after finishing', () => {
    seedCard(true)
    writeIdle(600)
    setPipeBusy(true)
    const store = agentic()

    // AFK is true and nap is enabled — the busy pipe is the only thing holding
    // the companion up, which is exactly the "a companion mid-sentence does not
    // nap" rule.
    expect(usePresenceStore().afk).toBe(true)
    expect(store.napState).toBe('active')

    setPipeBusy(false)
    expect(store.napState).toBe('napping')
  })

  it('refuses a scheduled cycle while napping', () => {
    // §3: "the nap ref is checked first, and a napping companion rejects the
    // cycle". The gate cases live in `agentic.gate.test.ts`; this pins that the
    // derivation and the gate agree, with no second timer in between.
    seedCard(true)
    writeIdle(600)
    setPipeBusy(false)
    const store = agentic()

    expect(store.napState).toBe('napping')
    expect(store.gate('scheduled')).toEqual({ allowed: false, reason: 'napping' })
  })

  it('keeps resting while a dream evaluation runs, because nap keeps dreaming', () => {
    // Dream consolidation runs on the same 10s tick and the same AFK signal, and
    // "what it does while napping" is precisely "it keeps dreaming". The busy
    // predicate therefore must not treat `isDreamStateEvaluating` as blocking
    // nap, or the two could never both be true — and a consolidation's whole
    // duration would become a window for a `scheduled` cycle to fire.
    seedCard(true)
    writeIdle(600)
    setPipeBusy(false)
    const store = agentic()

    useProactivityStore().isDreamStateEvaluating = true

    expect(store.napState).toBe('napping')
    expect(store.gate('scheduled')).toEqual({ allowed: false, reason: 'napping' })
  })

  it('does not nap while a heartbeat is being evaluated, so two voices never overlap', () => {
    // The heartbeat's own evaluation would speak, and a companion that is both
    // resting and speaking is the confusion this derivation exists to prevent.
    seedCard(true)
    writeIdle(600)
    setPipeBusy(false)
    const store = agentic()

    useProactivityStore().isHeartbeatEvaluating = true

    expect(store.napState).toBe('active')
  })
})
