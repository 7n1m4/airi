import type {
  CompanionConsent,
  CompanionGuestAccess,
  CompanionGuestSnapshot,
  CompanionShareCard,
  CompanionShareScope,
} from '@proj-airi/stage-shared/agentic'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import {
  COMPANION_TOPIC,
  companionConsentChanged,
  companionServiceGetConsent,
  companionServiceRecordObservedShare,
  companionServiceReportGuestSnapshot,
  companionServiceSetConsent,
  companionServiceShare,
  companionServiceVisit,
  parseCompanionShare,
} from '@proj-airi/stage-shared/agentic'
import { libp2pMessageReceived } from '@proj-airi/stage-shared/libp2p'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { useEchoesStore } from './echo-chips'
import { useMemoryLifetimeStore } from './memory-lifetime'
import { useAiriCardStore } from './modules/airi-card'

/**
 * The friendship mesh: share this companion, visit a peer's companion, host a
 * visiting one.
 *
 * ── Why the renderer owns this store ────────────────────────────────────────
 * Main owns the *publisher* and the *consent gate*, because a share must be
 * refuseable in the process that can actually publish it. The renderer owns the
 * card* and the *memory pillars*, because those live in IndexedDB and Pinia.
 * So the round trip is: renderer reads the card → main gates on consent and
 * publishes → peers receive on `airi/companion` → each renderer reports what it
 * saw to its own main → a guest's visit is answered from that record.
 *
 * Neither side reads the other's store, so there is one source of truth per
 * concern and no fabricated fallback on either side.
 */

/** Bounded so `card-and-lifetime` cannot carry an unbounded summary. */
const MAX_LIFETIME_CHARS = 4000
/** Bounded so a large portrait cannot blow out topic traffic. */
const MAX_PORTRAIT_CHARS = 512 * 1024
/** Echo-chip slices sent to a guest, newest first. */
const MAX_GUEST_CHIPS = 20

/** Share scopes, narrowest first, for the settings page's ordered control. */
export const COMPANION_SCOPES: readonly CompanionShareScope[] = ['card-only', 'card-and-echo-chips', 'card-and-lifetime']

export const useCompanionStore = defineStore('companion', () => {
  const airiCardStore = useAiriCardStore()
  const echoesStore = useEchoesStore()
  const lifetimeStore = useMemoryLifetimeStore()

  const invokeShare = useElectronEventaInvoke(companionServiceShare)
  const invokeVisit = useElectronEventaInvoke(companionServiceVisit)
  const invokeGetConsent = useElectronEventaInvoke(companionServiceGetConsent)
  const invokeSetConsent = useElectronEventaInvoke(companionServiceSetConsent)
  const invokeReportSnapshot = useElectronEventaInvoke(companionServiceReportGuestSnapshot)
  const invokeRecordObservedShare = useElectronEventaInvoke(companionServiceRecordObservedShare)

  /**
   * Consent, mirrored into the renderer only as a *cache* of what main said.
   *
   * NOTICE: main is authoritative, so every mutation goes through
   * `invokeSetConsent` and the returned value overwrites the cache. The local
   * ref exists so the settings page renders before the first round trip lands,
   * and so a revoke feels immediate; it must never be treated as the decision.
   */
  const consent = ref<CompanionConsent>({ granted: false, scope: 'card-only', grantedAt: undefined })
  const isSharing = ref(false)
  const isVisiting = ref(false)
  const lastShareResult = ref<{ shared: boolean, scope: CompanionShareScope, reason?: string } | null>(null)

  /** Shares observed on `airi/companion`, by host peer id. */
  const receivedShares = ref(new Map<string, CompanionShareCard>())
  /** The guest view of the most recent successful visit. */
  const lastVisit = ref<CompanionGuestAccess | null>(null)

  // ── Card snapshot the guest may see ────────────────────────────────────────

  /**
   * The active card, as the fields a share carries.
   *
   * NOTICE: the character card has no `id` field of its own — the card *store*
   * keys it (`activeCardId`), so that key is the share's `cardId`. Reusing the
   * store's own identity is the honest way to name a card: there is no second
   * identifier to invent.
   */
  const shareCard = computed<CompanionShareCard | null>(() => {
    const card = airiCardStore.activeCard
    if (!card)
      return null

    return {
      cardId: airiCardStore.activeCardId,
      name: card.name,
      ...(card.description !== undefined ? { description: card.description } : {}),
      hostPeerId: '',
      publishedAt: Date.now(),
      scope: consent.value.granted ? consent.value.scope : 'card-only',
    }
  })

  /**
   * The memory snapshot a hosted guest may read, built from the real pillars.
   *
   * Every pillar is read from its own store's already-loaded collection, so no
   * pillar is awaited or forced to load here: the guest sees what this session
   * has, and the honest empty case is an empty snapshot rather than a fetch the
   * host does not need to make on a guest's behalf.
   */
  const guestSnapshot = computed<CompanionGuestSnapshot>(() => {
    const characterId = airiCardStore.activeCardId
    const echoChips = echoesStore.chips
      .filter(chip => chip.characterId === characterId)
      .slice(0, MAX_GUEST_CHIPS)
      .map(chip => ({
        id: chip.id,
        content: chip.content,
        type: chip.type,
        relevanceScore: chip.relevanceScore,
      }))

    // The lifetime archive is a *distilled* artifact by construction — its
    // `distilledContent` is the relational essence, never the raw archive or the
    // chunk summaries behind it. Reading anything else would leak the source
    // conversations that the distillation exists to abstract away.
    const artifact = lifetimeStore.artifacts.get(characterId)
    const lifetimeDistilled = artifact?.distilledContent?.slice(0, MAX_LIFETIME_CHARS)

    return {
      echoChips,
      ...(lifetimeDistilled !== undefined ? { lifetimeDistilled } : {}),
    }
  })

  // ── Consent ────────────────────────────────────────────────────────────────

  /** Refresh the consent cache from main, the authoritative holder. */
  async function refreshConsent(): Promise<void> {
    try {
      consent.value = await invokeGetConsent()
    }
    catch (err) {
      // A failed round trip must leave the previous value alone; flipping to a
      // safe default here would erase a real grant the operator made.
      console.warn('[CompanionStore] Failed to read consent:', err)
    }
  }

  /** Grant or revoke consent. Main persists and broadcasts; the cache follows. */
  async function setConsent(input: { granted: boolean, scope: CompanionShareScope }): Promise<CompanionConsent> {
    consent.value = await invokeSetConsent(input)
    return consent.value
  }

  // ── Share / visit / host ───────────────────────────────────────────────────

  /** Share this companion with the mesh, at a scope no wider than the consent. */
  async function share(scope: CompanionShareScope): Promise<{ shared: boolean, scope: CompanionShareScope, reason?: string }> {
    const card = shareCard.value
    if (!card) {
      const result = { shared: false, scope, reason: 'no-active-card' }
      lastShareResult.value = result
      return result
    }

    isSharing.value = true
    try {
      const result = await invokeShare({
        cardId: card.cardId,
        name: card.name,
        ...(card.description !== undefined ? { description: card.description } : {}),
        // Only a data-URL or base64 portrait is in-bounds for a topic payload;
        // an http(s) URL would make every peer fetch it.
        ...(card.portraitBase64 !== undefined && card.portraitBase64.length <= MAX_PORTRAIT_CHARS
          ? { portraitBase64: card.portraitBase64 }
          : {}),
        scope,
      })
      lastShareResult.value = result
      return result
    }
    finally {
      isSharing.value = false
    }
  }

  /** Visit a peer's companion, given the host peer id whose share was observed. */
  async function visit(hostPeerId: string): Promise<CompanionGuestAccess | { error: string }> {
    isVisiting.value = true
    try {
      const result = await invokeVisit({ hostPeerId })
      if ('error' in result)
        return result

      lastVisit.value = result
      return result
    }
    finally {
      isVisiting.value = false
    }
  }

  /**
   * Report the guest snapshot to main, so a hosted guest can be packed.
   *
   * Called on mount and whenever the underlying pillars change, because main
   * holds no way to read them and a snapshot reported once would go stale the
   * moment a chip was added.
   */
  async function reportGuestSnapshot(): Promise<void> {
    if (!consent.value.granted)
      return

    try {
      await invokeReportSnapshot(guestSnapshot.value)
    }
    catch (err) {
      // Hosting is opt-in, so a failed report must not break the session; the
      // guest simply receives an honest empty pack instead of a fabricated one.
      console.warn('[CompanionStore] Failed to report guest snapshot:', err)
    }
  }

  // ── Mesh wiring ────────────────────────────────────────────────────────────

  const eventaContext = useElectronEventaContext()

  /** Unlisten handles for the currently bound eventa context. */
  let unbindEvents: Array<() => void> = []

  /**
   * Bind the mesh and consent handlers to one eventa context.
   *
   * `useElectronEventaContext()` hands back a `ref` whose value is resolved
   * asynchronously, so the store binds whenever the context becomes available
   * and never binds twice.
   */
  function bindEvents() {
    for (const off of unbindEvents)
      off()
    unbindEvents = []

    const ctx = eventaContext.value
    if (!ctx) {
      return
    }

    unbindEvents = [
      ctx.on(libp2pMessageReceived, (event) => {
        if (event.body)
          void handleMeshMessage(event.body)
      }),
      ctx.on(companionConsentChanged, (event) => {
        if (event.body)
          consent.value = event.body
      }),
    ]
  }

  bindEvents()

  /**
   * Report a share the mesh delivered to this renderer.
   *
   * NOTICE: topic messages arrive in the renderer, not main, because the libp2p
   * service pushes every message to the renderer as `libp2pMessageReceived`;
   * main holds no subscriber of its own on `airi/companion`. So the renderer
   * parses the payload and hands the result to main, which is what makes a
   * later visit answerable. A malformed payload is dropped here rather than
   * forwarded, because a bad shape must never reach main's record.
   */
  async function handleMeshMessage(message: { topic: string, data: string }): Promise<void> {
    if (message.topic !== COMPANION_TOPIC)
      return

    let share = null
    try {
      const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0))
      share = parseCompanionShare(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
    }
    catch (err) {
      console.warn('[CompanionStore] Dropped malformed companion share:', err)
      return
    }

    if (!share)
      return

    receivedShares.value.set(share.hostPeerId, share)
    // Best-effort: main's record is what a guest visit reads, so a failure to
    // report means visiting later answers "no share observed" rather than
    // showing a peer that was never really there.
    try {
      await invokeRecordObservedShare(share)
    }
    catch (err) {
      console.warn('[CompanionStore] Failed to record observed share:', err)
    }
  }

  // Keep main's snapshot fresh as the pillars change, and refresh consent once
  // so the page never shows a stale grant.
  watch(guestSnapshot, () => void reportGuestSnapshot(), { deep: true })
  watch(() => consent.value.granted, () => void reportGuestSnapshot())

  void refreshConsent()
  void reportGuestSnapshot()

  onScopeDispose(() => {
    for (const off of unbindEvents)
      off()
    unbindEvents = []
  })

  return {
    consent,
    isSharing,
    isVisiting,
    lastShareResult,
    receivedShares,
    lastVisit,
    shareCard,
    guestSnapshot,
    share,
    visit,
    setConsent,
    refreshConsent,
    reportGuestSnapshot,
  }
})
