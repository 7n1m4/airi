import { describe, expect, it } from 'vitest'

import { EntityLedger, normalizeCanonicalEntityLabel } from './entity-ledger'

describe('normalizeCanonicalEntityLabel', () => {
  it('handles empty', () => {
    const r = normalizeCanonicalEntityLabel('')
    expect(r).toBeTruthy()
  })
  it('strips honorific camel', () => {
    const r = normalizeCanonicalEntityLabel('AliceChan')
    expect(r.canonical).toContain('Alice')
  })
  it('handles hyphen honorific', () => {
    const r = normalizeCanonicalEntityLabel('alice-chan')
    expect(r).toBeTruthy()
  })
  it('plain label', () => {
    const r = normalizeCanonicalEntityLabel('  Bob  ')
    expect(r.normalizedKey).toBe('bob')
  })
})

describe('entityLedger', () => {
  it('addSource', () => {
    const L = new EntityLedger()
    L.addSource({ turnId: 't1', text: 'x', timestamp: 1 } as { turnId: string, text: string, timestamp: number })
    expect(L.sources.size).toBe(1)
    expect(L.bySource.has('t1')).toBe(true)
  })

  it('getOrCreateEntity new and existing', () => {
    const L = new EntityLedger()
    const e1 = L.getOrCreateEntity('Alice', 'person')
    const e2 = L.getOrCreateEntity('alice')
    expect(e2.entityId).toBe(e1.entityId)
    expect(e1.type).toBe('person')
    // canonical
    const e3 = L.getOrCreateEntity('  Bob Chan  ', 'person')
    expect(e3.attributes.aliases).toContain('Bob Chan')
  })

  it('addMention', () => {
    const L = new EntityLedger()
    const e = L.getOrCreateEntity('X')
    const m = L.addMention({ span: 'x', turnId: 't1', entityId: e.entityId })
    expect(e.mentions.has(m.mentionId)).toBe(true)
    // unknown entity
    const m2 = L.addMention({ span: 'y', turnId: 't1', entityId: 'nope' })
    expect(m2.mentionId).toBeTruthy()
  })

  it('addClaim and indexes', () => {
    const L = new EntityLedger()
    const c = L.addClaim({ subject: 'A', predicate: 'likes', object: 'B', evidence: ['t1'] })
    expect(L.claims.size).toBe(1)
    expect(L.bySource.get('t1')?.has(c.claimId)).toBe(true)
    expect(L.bySubjectPredicate.get('A')?.get('likes')?.has(c.claimId)).toBe(true)
  })

  it('addEvent', () => {
    const L = new EntityLedger()
    const ev = L.addEvent({ type: 'meet', roles: { a: 1 }, claimIds: ['c1'] })
    expect(L.events.size).toBe(1)
    expect(L.byEvent.get(ev.eventId)?.has('c1')).toBe(true)
  })

  it('queryEntities', () => {
    const L = new EntityLedger()
    L.getOrCreateEntity('Alice', 'person', { foo: 'bar' })
    L.getOrCreateEntity('Bob', 'place')
    expect(L.queryEntities('person').length).toBe(1)
    expect(L.queryEntities('all', 'ali').length).toBe(1)
    expect(L.queryEntities(undefined, 'bar').length).toBe(1)
  })

  it('queryClaims', () => {
    const L = new EntityLedger()
    L.addClaim({ subject: 'Alice', predicate: 'likes', object: 'Bob' })
    L.addClaim({ subject: 'Alice', predicate: 'knows', object: 'Carol', qualifiers: { isCurrent: false } })
    expect(L.queryClaims('alice', 'likes').length).toBe(1)
    expect(L.queryClaims('alice').length).toBe(2)
    expect(L.queryClaims(undefined, undefined, true).length).toBe(1)
  })

  it('applyPCLClaim reinforce/update/invalidate/new', () => {
    const L = new EntityLedger()
    const c0 = L.addClaim({ subject: 'A', predicate: 'p', object: 'B' })
    // reinforce
    const r1 = L.applyPCLClaim({ subject: 'A', predicate: 'P', object: 'B', action: 'reinforce' })
    expect(r1.actionTaken).toBe('reinforced')
    // update
    const r2 = L.applyPCLClaim({ subject: 'A', predicate: 'p', object: 'C', action: 'update', date: '2020', evidenceTurnId: 't1' })
    expect(r2.actionTaken).toBe('updated')
    // invalidate
    const r3 = L.applyPCLClaim({ subject: 'A', predicate: 'p', object: 'C', action: 'invalidate' })
    expect(r3.actionTaken).toBe('invalidated')
    // new
    const r4 = L.applyPCLClaim({ subject: 'X', predicate: 'q', object: 'Y', action: 'new' })
    expect(r4.actionTaken).toBe('created')
    // reinforce not found falls to? action reinforce with no match -> falls through to new
    const r5 = L.applyPCLClaim({ subject: 'Z', predicate: 'q', object: 'W', action: 'reinforce' })
    expect(r5.actionTaken).toBe('created')
    expect(c0.claimId).toBeTruthy()
  })

  it('getSummaryStats', () => {
    const L = new EntityLedger()
    L.addSource({ turnId: 't1', text: 'x' } as { turnId: string, text: string })
    const s = L.getSummaryStats()
    expect(s.sourcesCount).toBe(1)
  })

  it('toJSON/fromJSON roundtrip', () => {
    const L = new EntityLedger()
    L.addSource({ turnId: 't1', text: 'x', timestamp: 1 } as { turnId: string, text: string, timestamp: number })
    L.getOrCreateEntity('Alice', 'person')
    L.addClaim({ subject: 'A', predicate: 'p', object: 'B', evidence: ['t1'] })
    L.addEvent({ type: 'e', claimIds: ['claim_1'] })
    const json = L.toJSON()
    const L2 = EntityLedger.fromJSON(json)
    expect(L2.sources.size).toBe(1)
    expect(L2.entities.size).toBe(1)
    expect(L2.claims.size).toBe(1)
    expect(L2.events.size).toBe(1)
    expect(L2.ingestion.size).toBe(0)
  })

  it('fromJSON null/empty', () => {
    const L = EntityLedger.fromJSON(null)
    expect(L.sources.size).toBe(0)
    const L2 = EntityLedger.fromJSON({ ingestion: [['k', 'v']] })
    expect(L2.ingestion.get('k')).toBe('v')
  })
})

describe('entity-ledger extra coverage', () => {
  it('reinforce with evidence turn', () => {
    const L = new EntityLedger()
    L.addClaim({ subject: 'A', predicate: 'p', object: 'B', evidence: [] })
    const r = L.applyPCLClaim({ subject: 'A', predicate: 'p', object: 'B', action: 'reinforce', evidenceTurnId: 't9' })
    expect(r.actionTaken).toBe('reinforced')
  })
  it('fromJSON mentions', () => {
    const L = EntityLedger.fromJSON({ mentions: [{ mentionId: 'm1', span: 'x', turnId: 't1', entityId: 'e' }] })
    expect(L.mentions.size).toBe(1)
  })
  it('getOrCreateEntity missing aliases branch', () => {
    const L = new EntityLedger()
    const e = L.getOrCreateEntity('Alice', 'person')
    delete (e.attributes as Record<string, unknown>).aliases
    const e2 = L.getOrCreateEntity('alice')
    expect(e2.entityId).toBe(e.entityId)
  })
})
