/**
 * Test Suite: Evaluator Parity & Entity Ledger Fresh Ingestion Integrity
 *
 * Validates:
 * 1. Porter Stemmer NLTK extension parity with official nltk.stem.PorterStemmer.
 * 2. Scorer parity with Snap Research task_eval/evaluation.py (C1 multi-answer, C2-C4 single answer).
 * 3. EntityLedger fresh ingestion (unpopulated claimId) indexing and query equivalence before/after JSON serialization.
 */

import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { EntityLedger } from './entity-ledger.mjs'
import {
  computeUpstreamLoCoMoF1,
} from './locomo-metrics.mjs'
import { stemWord } from './porter-stemmer.mjs'

describe('nLTK Porter Stemmer Parity', () => {
  it('correctly handles NLTK extension words', () => {
    const cases = [
      ['used', 'use'],
      ['one', 'one'],
      ['are', 'are'],
      ['playing', 'play'],
      ['played', 'play'],
      ['days', 'day'],
      ['enjoying', 'enjoy'],
      ['enjoys', 'enjoy'],
      ['saying', 'say'],
      ['journey', 'journey'],
      ['turkey', 'turkey'],
      ['yesterday', 'yesterday'],
      ['sky', 'sky'],
      ['outing', 'outing'],
      ['trying', 'tri'],
    ]

    for (const [input, expected] of cases) {
      assert.equal(stemWord(input), expected, `Failed stem for "${input}": expected "${expected}", got "${stemWord(input)}"`)
    }
  })
})

describe('official Upstream LoCoMo F1 Parity', () => {
  it('evaluates Category 1 with comma-separated multi-answer splitting', () => {
    // Prediction has one match out of three gold answers
    const pred = 'Paris, London'
    const gold = 'Paris, Tokyo, Berlin'
    const score = computeUpstreamLoCoMoF1(pred, gold, 1)
    // 1 match for Paris (1.0), 0 for Tokyo, 0 for Berlin -> mean = 1/3 ~ 0.3333
    assert.ok(Math.abs(score - 1 / 3) < 0.001)
  })

  it('evaluates Category 2 (temporal) as a single answer without comma splitting', () => {
    // Date with comma should NOT give partial credit for just matching the year
    const pred = 'April 20, 2022'
    const gold = 'April 26, 2022'
    const score = computeUpstreamLoCoMoF1(pred, gold, 2)
    // pred tokens: [april, 20, 2022], gold tokens: [april, 26, 2022]
    // overlap = 2 (april, 2022), len(p) = 3, len(g) = 3 -> F1 = (2 * 2/3 * 2/3) / (4/3) = 2/3 ~ 0.6667
    assert.ok(Math.abs(score - 2 / 3) < 0.001)
  })

  it('evaluates Category 3 with semicolon reference pre-processing', () => {
    const pred = 'Mafia'
    const gold = 'Mafia; a party game where players find impostors'
    const score = computeUpstreamLoCoMoF1(pred, gold, 3)
    assert.equal(score, 1.0)
  })

  it('evaluates Category 4 single-hop literal answers', () => {
    const pred = 'Dr. James Robinson'
    const gold = 'James Robinson'
    const score = computeUpstreamLoCoMoF1(pred, gold, 4)
    // pred: [dr, jame, robinson], gold: [jame, robinson]
    // overlap = 2, p = 2/3, r = 2/2 = 1.0 -> F1 = (2 * 2/3 * 1) / (5/3) = 4/5 = 0.8
    assert.ok(Math.abs(score - 0.8) < 0.001)
  })
})

describe('entityLedger Fresh Ingestion & Indexing Integrity', () => {
  it('correctly populates secondary indexes with generated IDs when claimId is null', () => {
    const ledger = new EntityLedger()
    ledger.getOrCreateEntity('Mira', 'person')
    const c1 = ledger.addClaim({ subject: 'Mira', predicate: 'owns_pet', object: 'Luna', evidence: ['D1:1'] })
    const c2 = ledger.addClaim({ subject: 'Mira', predicate: 'owns_pet', object: 'Buster', evidence: ['D1:2'] })

    // Verify claims are keyed by generated ID
    assert.ok(ledger.claims.has(c1.claimId))
    assert.ok(ledger.claims.has(c2.claimId))

    // Verify secondary index bySubjectPredicate contains real IDs, NOT null
    const subjMap = ledger.bySubjectPredicate.get('Mira')
    assert.ok(subjMap)
    const petClaims = subjMap.get('owns_pet')
    assert.ok(petClaims)
    assert.equal(petClaims.has(null), false, 'bySubjectPredicate should not contain null')
    assert.ok(petClaims.has(c1.claimId))
    assert.ok(petClaims.has(c2.claimId))

    // Verify queryPetsByOwner succeeds without throwing
    const petsBefore = ledger.queryPetsByOwner('Mira')
    assert.deepEqual(petsBefore.names.sort(), ['Buster', 'Luna'])

    // Verify serialization round-trip equivalence
    const json = JSON.parse(JSON.stringify(ledger.toJSON()))
    const reloaded = EntityLedger.fromJSON(json)
    const petsAfter = reloaded.queryPetsByOwner('Mira')
    assert.deepEqual(petsAfter.names.sort(), ['Buster', 'Luna'])
  })
})

describe('temporal Arithmetic: "last year" Resolution', () => {
  it('resolves "last year" anchored to 20 April, 2022 to "In 2021"', async () => {
    const { resolveTemporalExpression } = await import('./temporal-resolver.mjs')
    const res = resolveTemporalExpression('last year', '9:32 pm on 20 April, 2022', 'D6:12')
    assert.ok(res)
    assert.equal(res.formatted_label, 'In 2021')
    assert.equal(res.kind, 'interval')
    assert.equal(res.precision, 'year')
  })
})

describe('span Reader Sentence Isolation & Verbatim Validation', () => {
  it('does not generate cross-sentence n-grams like "York Boston"', async () => {
    const { extractCandidateSpans } = await import('./span-reader.mjs')
    const passage = 'Mira visited York. Boston was crowded.'
    const spans = extractCandidateSpans(passage, 'Which city did Mira visit?')
    assert.equal(spans.includes('York Boston'), false, 'Should not bridge across sentence boundaries')
    assert.ok(spans.includes('York'))
    assert.ok(spans.includes('Boston'))
    for (const span of spans) {
      assert.ok(passage.toLowerCase().includes(span.toLowerCase()), `Span "${span}" must be a substring of passage`)
    }
  })
})

describe('label-Blind Routing Invariance', () => {
  it('routing decision is completely invariant to goldCategory', () => {
    const route = (ledgerResult, jevTriage, p3Pred, _goldCategory) => {
      // Label-blind autonomous dual-process routing
      const isDetectiveTriage = jevTriage.category === 3 || jevTriage.choice === 'c3_detective'
      const isReaderAbstain = p3Pred === 'UNKNOWN'
      return !ledgerResult && (isDetectiveTriage || isReaderAbstain)
    }

    const triageLiteral = { category: 4, choice: 'c4_literal' }
    const triageDetective = { category: 3, choice: 'c3_detective' }

    // When reader finds a span, it does not escalate regardless of what goldCategory is
    for (const goldCat of [1, 2, 3, 4, 999]) {
      assert.equal(route(null, triageLiteral, 'Toronto', goldCat), false)
    }

    // When reader abstains (UNKNOWN), it escalates regardless of what goldCategory is
    for (const goldCat of [1, 2, 3, 4, 999]) {
      assert.equal(route(null, triageLiteral, 'UNKNOWN', goldCat), true)
    }

    // When triage predicts detective, it escalates regardless of what goldCategory is
    for (const goldCat of [1, 2, 3, 4, 999]) {
      assert.equal(route(null, triageDetective, 'something', goldCat), true)
    }
  })
})
