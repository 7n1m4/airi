import { describe, expect, it, vi } from 'vitest'

import {
  createTextJournalTool,
  executeCreateTextJournalEntry,
  executeSearchTextJournalEntries,
  executeTextJournalAction,
  textJournalParams,
} from './text-journal'

const mockCreateEntry = vi.fn(async (payload: any) => ({
  title: payload.title,
  characterName: 'TestChar',
}))

const mockSearchEntries = vi.fn(async () => [] as any[])
const mockLoadJournal = vi.fn(async () => {})
const mockSearchBlocks = vi.fn(() => [] as any[])
const mockLoadShortTerm = vi.fn(async () => {})

vi.mock('../../memory-text-journal', () => ({
  useTextJournalStore: () => ({
    createEntry: mockCreateEntry,
    load: mockLoadJournal,
    searchEntries: mockSearchEntries,
  }),
}))

vi.mock('../../memory-short-term', () => ({
  useShortTermMemoryStore: () => ({
    load: mockLoadShortTerm,
    searchBlocks: mockSearchBlocks,
  }),
}))

describe('text-journal module', () => {
  it('creates entry from content', async () => {
    const res = await executeCreateTextJournalEntry({ content: 'hello world' })
    expect(res).toBe('Saved text journal entry "hello world" for TestChar.')
    expect(mockCreateEntry).toHaveBeenCalledWith({ title: 'hello world', content: 'hello world', source: 'tool' })
  })

  it('creates entry using title when content missing', async () => {
    const res = await executeCreateTextJournalEntry({ title: 'My Title' })
    expect(res).toBe('Saved text journal entry "My Title" for TestChar.')
  })

  it('returns error when no content', async () => {
    const res = await executeCreateTextJournalEntry({})
    expect(res).toContain('Error: content is required')
  })

  it('truncates title to 40 chars', async () => {
    const long = 'a'.repeat(60)
    await executeCreateTextJournalEntry({ content: long })
    const call = mockCreateEntry.mock.calls.at(-1)?.[0]
    expect(call.title).toBe(long.slice(0, 40))
  })

  it('searches journal entries', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: '1', kind: 'journal', title: 'T', content: 'c', createdAt: '2024-01-02T00:00:00Z', score: 0.5 },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q', limit: 3 })
    const parsed = JSON.parse(res)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].layer).toBe('long-term')
    expect(parsed[0].date).toBe('2024-01-02')
    expect(parsed[0].relevanceScore).toBe(0.5)
  })

  it('kg claim layer', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: '2', kind: 'kg_claim', isKgClaim: true, subject: 'S', predicate: 'P', object: 'O', content: 'c', createdAt: '2024-03-04T00:00:00Z' },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].layer).toBe('knowledge-graph')
    expect(parsed[0].fact).toBe('S P O')
  })
  it('dateInfo timestamp branch', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: 'd1', kind: 'journal', title: 'T', content: 'c', dateInfo: { timestamp: '2024-09-10T00:00:00Z' }, score: 0.1 },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].date).toBe('2024-09-10')
  })
  it('timestamp branch', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: 'd2', kind: 'journal', title: 'T', content: 'c', timestamp: '2024-11-12', score: 0.1 },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].date).toBe('2024-11-12')
  })
  it('timestamp T branch', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: 'd3', kind: 'journal', title: 'T', content: 'c', timestamp: '2024-12-13T00:00:00Z', score: 0.1 },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].date).toBe('2024-12-13')
  })
  it('fallback createdAt branch', async () => {
    mockSearchEntries.mockResolvedValueOnce([])
    mockSearchBlocks.mockReturnValueOnce([
      { id: 'b2', summary: 'sum2', createdAt: '2024-02-03T00:00:00Z' },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].date).toBe('2024-02-03')
  })

  it('short-term layer', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: '3', kind: 'stmm', title: 'T', content: 'c', createdAt: '2024-05-06T00:00:00Z' },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].layer).toBe('short-term')
  })

  it('dialogue layer', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: '4', kind: 'raw', title: 'T', content: 'c', createdAt: '2024-07-08T00:00:00Z' },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed[0].layer).toBe('dialogue')
  })

  it('falls back to short-term blocks when no entries', async () => {
    mockSearchEntries.mockResolvedValueOnce([])
    mockSearchBlocks.mockReturnValueOnce([
      { id: 'b1', date: '2024-01-01', summary: 'sum', createdAt: '2024-01-01T00:00:00Z' },
    ])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    const parsed = JSON.parse(res)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].layer).toBe('short-term')
    expect(parsed[0].fact).toBe('sum')
  })

  it('returns empty array when no fallback', async () => {
    mockSearchEntries.mockResolvedValueOnce([])
    mockSearchBlocks.mockReturnValueOnce([])
    const res = await executeSearchTextJournalEntries({ query: 'q' })
    expect(JSON.parse(res)).toEqual([])
  })

  it('requires query', async () => {
    const res = await executeSearchTextJournalEntries({})
    expect(res).toContain('Error: query is required')
  })

  it('action dispatch create', async () => {
    const res = await executeTextJournalAction({ action: 'create', content: 'x' })
    expect(res).toContain('Saved')
  })

  it('action dispatch search', async () => {
    mockSearchEntries.mockResolvedValueOnce([])
    mockSearchBlocks.mockReturnValueOnce([])
    const res = await executeTextJournalAction({ action: 'search', query: 'q' })
    expect(JSON.parse(res)).toEqual([])
  })
  it('no-op message', async () => {
    const res = await executeTextJournalAction({ action: 'nope' as any })
    expect(res).toBe('No text journal action performed.')
  })

  it('createTextJournalTool factory', async () => {
    mockCreateEntry.mockResolvedValueOnce({ title: 'hello tool', characterName: 'Asuka' })
    const toolDef = await createTextJournalTool()
    expect((toolDef as { name?: string, function?: { name?: string } }).name || (toolDef as { name?: string, function?: { name?: string } }).function?.name).toBe('text_journal')
    expect(typeof (toolDef as { execute?: unknown }).execute).toBe('function')
    const created = await (toolDef as { execute: (p: unknown) => Promise<unknown> }).execute({ action: 'create', content: 'hello tool' })
    expect(created).toContain('Saved text journal entry')
  })

  it('params schema validates', () => {
    const r = textJournalParams.safeParse({ action: 'create', content: 'x' })
    expect(r.success).toBe(true)
    const r2 = textJournalParams.safeParse({ action: 'nope' })
    expect(r2.success).toBe(false)
  })
})
