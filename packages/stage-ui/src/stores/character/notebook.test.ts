import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCharacterNotebookStore } from './notebook'

describe('store character-notebook', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useRealTimers()
  })

  it('adds entries of each kind', () => {
    const store = useCharacterNotebookStore()
    const note = store.addNote('hello', { tags: ['a'], metadata: { x: 1 } })
    const diary = store.addDiaryEntry('diary text')
    const focus = store.addFocusEntry('focus text')

    expect(note.kind).toBe('note')
    expect(note.text).toBe('hello')
    expect(note.tags).toEqual(['a'])
    expect(note.metadata).toEqual({ x: 1 })
    expect(store.entries).toHaveLength(3)
    expect(store.partitionDiary).toEqual([diary])
    expect(store.partitionFocus).toEqual([focus])
  })

  it('schedules tasks with defaults and due status', () => {
    const store = useCharacterNotebookStore()
    const task = store.scheduleTask({ title: 't', details: 'd', priority: 'high', dueAt: 123, metadata: { m: 2 } })
    expect(task.status).toBe('scheduled')
    expect(task.priority).toBe('high')
    expect(task.dueAt).toBe(123)
    expect(store.tasks).toHaveLength(1)

    const queued = store.scheduleTask({ title: 'q' })
    expect(queued.status).toBe('queued')
    expect(queued.priority).toBe('normal')
  })

  it('marks task done', () => {
    const store = useCharacterNotebookStore()
    const task = store.scheduleTask({ title: 't' })
    store.markTaskDone(task.id)
    expect(store.tasks[0].status).toBe('done')
    expect(typeof store.tasks[0].updatedAt).toBe('number')
  })

  it('marks task done no-op for unknown id', () => {
    const store = useCharacterNotebookStore()
    store.scheduleTask({ title: 't' })
    store.markTaskDone('nope')
    expect(store.tasks[0].status).toBe('queued')
  })

  it('requeues task with dueAt and reason', () => {
    const store = useCharacterNotebookStore()
    const task = store.scheduleTask({ title: 't', dueAt: 5 })
    store.requeueTask(task.id, { dueAt: 9, reason: 'later' })
    const updated = store.tasks[0]
    expect(updated.status).toBe('queued')
    expect(updated.dueAt).toBe(9)
    expect(updated.metadata).toEqual({ requeueReason: 'later' })
  })

  it('requeue merges metadata and handles missing task', () => {
    const store = useCharacterNotebookStore()
    const task = store.scheduleTask({ title: 't', metadata: { a: 1 } })
    store.requeueTask(task.id, { reason: 'r' })
    expect(store.tasks[0].metadata).toEqual({ a: 1, requeueReason: 'r' })
    store.requeueTask('nope', { reason: 'x' })
    expect(store.tasks).toHaveLength(1)
  })

  it('marks task notified', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = useCharacterNotebookStore()
    const task = store.scheduleTask({ title: 't' })
    store.markTaskNotified(task.id, 999)
    expect(store.tasks[0].lastNotifiedAt).toBe(Date.now())
    expect(store.tasks[0].nextNotifyAt).toBe(999)
  })

  it('marks task notified no-op for unknown', () => {
    const store = useCharacterNotebookStore()
    store.scheduleTask({ title: 't' })
    store.markTaskNotified('nope', 1)
    expect(store.tasks[0].nextNotifyAt).toBeUndefined()
  })

  it('getDueTasks filters correctly', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const now = Date.now()
    const store = useCharacterNotebookStore()
    const t1 = store.scheduleTask({ title: 'due', dueAt: now })
    const t2 = store.scheduleTask({ title: 'future', dueAt: now + 100000 })
    store.scheduleTask({ title: 'done' })
    store.markTaskDone(store.tasks[2].id)
    const due = store.scheduleTask({ title: 'notified' })
    store.markTaskNotified(due.id, now + 5000)

    const result = store.getDueTasks(now, 1000)
    const ids = result.map(t => t.id)
    expect(ids).toContain(t1.id)
    expect(ids).not.toContain(t2.id)
    expect(ids).not.toContain(due.id)
    // done task excluded
    expect(result.find(t => t.title === 'done')).toBeUndefined()
  })

  it('getDueTasks treats missing dueAt as now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const now = Date.now()
    const store = useCharacterNotebookStore()
    store.scheduleTask({ title: 'queued-no-due' })
    const result = store.getDueTasks(now, 0)
    expect(result).toHaveLength(1)
  })

  it('getDueTasks excludes nextNotifyAt future only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const now = Date.now()
    const store = useCharacterNotebookStore()
    const t = store.scheduleTask({ title: 't', dueAt: now })
    store.markTaskNotified(t.id, now - 1)
    const result = store.getDueTasks(now, 0)
    expect(result).toHaveLength(1)
  })

  it('drops excluded', () => {
    const store = useCharacterNotebookStore()
    const t = store.scheduleTask({ title: 't' })
    t.status = 'dropped'
    const now = Date.now()
    expect(store.getDueTasks(now, 1000)).toHaveLength(0)
  })
})
