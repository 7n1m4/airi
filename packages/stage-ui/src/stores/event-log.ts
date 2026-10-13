import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { storage } from '../database/storage'

/**
 * Event categories for the ledger.
 *
 * `agentic` carries the autonomous-cycle records produced by
 * `stores/agentic.ts`. Its entries always set `autonomous: true` in their
 * payload so the "Autonomous log" UI and any consumer can tell a
 * companion-initiated turn apart from a user- or heartbeat-initiated one.
 */
export type EventCategory = 'vision' | 'tools' | 'chat' | 'proactivity' | 'memory' | 'stage' | 'discord' | 'agentic'

export interface AiriSystemEvent<T = Record<string, unknown>> {
  id: string
  timestamp: number
  isoTime: string
  category: EventCategory
  type: string
  source: string
  textSummary: string
  /**
   * True when the event was produced by the autonomous cycle rather than by a
   * user turn, a heartbeat, or a module. Set from the payload's `autonomous`
   * flag so it is queryable without re-reading the payload object.
   */
  autonomous?: boolean
  payload?: T
  inspectable?: boolean
}

export type EventCategoryFilter = EventCategory | 'all'

const STORAGE_KEY = 'local:event-log'
const DEFAULT_MAX_CAPACITY = 500

export const useEventLogStore = defineStore('event-log', () => {
  const events = ref<AiriSystemEvent[]>([])
  const maxCapacity = ref(DEFAULT_MAX_CAPACITY)
  const searchQuery = ref('')
  const selectedCategory = ref<EventCategoryFilter>('all')
  const isPaused = ref(false)
  const isInitialized = ref(false)

  async function init() {
    if (isInitialized.value)
      return
    try {
      const stored = await storage.getItem<AiriSystemEvent[]>(STORAGE_KEY)
      if (Array.isArray(stored)) {
        events.value = stored
      }
    }
    catch (err) {
      console.warn('[EventLogStore] failed to load stored events from IndexedDB', err)
    }
    finally {
      isInitialized.value = true
    }
  }

  async function persist() {
    try {
      await storage.setItem(STORAGE_KEY, events.value)
    }
    catch (err) {
      console.warn('[EventLogStore] failed to persist events to IndexedDB', err)
    }
  }

  async function appendEvent(input: {
    category: EventCategory
    type: string
    source: string
    textSummary: string
    /**
     * Marks the event as produced by the autonomous cycle. The flag is hoisted
     * onto the entry itself so the autonomous log can filter without knowing
     * the payload shape.
     */
    autonomous?: boolean
    payload?: Record<string, unknown>
    inspectable?: boolean
  }): Promise<AiriSystemEvent> {
    if (!isInitialized.value) {
      await init()
    }

    const newEvent: AiriSystemEvent = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      category: input.category,
      type: input.type,
      source: input.source,
      textSummary: input.textSummary,
      autonomous: input.autonomous ?? input.payload?.autonomous === true,
      payload: input.payload,
      inspectable: input.inspectable ?? Boolean(input.payload && Object.keys(input.payload).length > 0),
    }

    if (!isPaused.value) {
      events.value.unshift(newEvent)
      if (events.value.length > maxCapacity.value) {
        events.value = events.value.slice(0, maxCapacity.value)
      }
      await persist()
    }

    return newEvent
  }

  async function clearLog() {
    events.value = []
    await persist()
  }

  const filteredEvents = computed(() => {
    return events.value.filter((evt) => {
      if (selectedCategory.value !== 'all' && evt.category !== selectedCategory.value) {
        return false
      }
      if (searchQuery.value.trim()) {
        const query = searchQuery.value.toLowerCase().trim()
        const textMatch = evt.textSummary.toLowerCase().includes(query)
        const typeMatch = evt.type.toLowerCase().includes(query)
        const sourceMatch = evt.source.toLowerCase().includes(query)
        return textMatch || typeMatch || sourceMatch
      }
      return true
    })
  })

  /** Every event the autonomous cycle produced, newest first. */
  const autonomousEvents = computed(() => events.value.filter(evt => evt.autonomous === true))

  function getRecentEventsText(count = 6): string {
    const recent = events.value.slice(0, count)
    if (recent.length === 0) {
      return ''
    }
    const lines = recent.map((evt) => {
      const timeStr = new Date(evt.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      return `• [${timeStr}] ${evt.textSummary}`
    })
    return lines.join('\n')
  }

  return {
    events,
    maxCapacity,
    searchQuery,
    selectedCategory,
    isPaused,
    isInitialized,
    filteredEvents,
    autonomousEvents,
    init,
    appendEvent,
    clearLog,
    getRecentEventsText,
  }
})
