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
  it('production routing decision is completely invariant to goldCategory', async () => {
    const { shouldEscalateToSystem2 } = await import('./answer-head-pass3.mjs')

    const triageLiteral = { category: 4, choice: 'c4_literal' }
    const triageDetective = { category: 3, choice: 'c3_detective' }

    // When reader finds a span, it does not escalate regardless of what category it is
    assert.equal(shouldEscalateToSystem2(null, triageLiteral, 'Toronto'), false)

    // When reader abstains (UNKNOWN), it escalates
    assert.equal(shouldEscalateToSystem2(null, triageLiteral, 'UNKNOWN'), true)

    // When triage predicts detective, it escalates
    assert.equal(shouldEscalateToSystem2(null, triageDetective, 'something'), true)

    // When ledger result is present, it never escalates
    assert.equal(shouldEscalateToSystem2({ type: 'pet_list' }, triageDetective, 'UNKNOWN'), false)
  })
})

describe('pass 7: Jev Multi-Field Triage, Greeting Filtering & Count Normalization', () => {
  it('prevents subordinate "when" from hijacking literal queries to session dates', async () => {
    const { AnswerHeadPass3 } = await import('./answer-head-pass3.mjs')
    const head = new AnswerHeadPass3()

    const q = 'What instrument did James used to play when he was younger?'
    const searchResult = {
      ledgerResult: null,
      textCandidates: [
        {
          id: 'D24:14',
          rawText: 'James: I used to play guitar when I was a teenager.',
          text: 'James: I used to play guitar when I was a teenager.',
          timestamp: '11:42 am on 18 September, 2022',
        },
      ],
    }
    const triage = {
      category: 4,
      choice: 'c4_literal',
      temporalSubtype: 'none',
      searchScope: 'single_session',
    }

    // Because temporalSubtype is 'none', it does not format the session date 'September 18, 2022'
    const ans = await head.formatAnswer(q, searchResult, triage)
    assert.notEqual(ans, 'September 18, 2022', 'Should not hijack to session timestamp')
  })

  it('temporalSubtype: "none" strictly bypasses calendar date fallback even with category: 2', async () => {
    const { AnswerHeadPass3 } = await import('./answer-head-pass3.mjs')
    const head = new AnswerHeadPass3()

    // Query categorized as 2, but Jev explicitly diagnosed temporalSubtype as 'none'
    const q = 'What topic did James and John discuss during their morning chat?'
    const searchResult = {
      ledgerResult: null,
      textCandidates: [
        {
          id: 'D29:8',
          rawText: 'James: We decided to live together and rent an apartment.',
          text: 'James: We decided to live together and rent an apartment.',
          timestamp: '10:00 am on 15 October, 2023',
        },
      ],
    }
    const triage = {
      category: 2,
      choice: 'c2_temporal',
      temporalSubtype: 'none',
      searchScope: 'single_session',
    }

    const ans = await head.formatAnswer(q, searchResult, triage)
    assert.notEqual(ans, 'October 15, 2023', 'Explicit temporalSubtype: none must strictly bypass calendar date formatting')
  })

  it('filters conversational greeting recency phrases from duration extraction', async () => {
    const { AnswerHeadPass3 } = await import('./answer-head-pass3.mjs')
    const head = new AnswerHeadPass3()

    // Q62 scenario: candidate has conversational greeting "it's been a few days since we talked"
    // along with the actual event description
    const q = 'How long did their training retreat last?'
    const searchResult = {
      ledgerResult: null,
      textCandidates: [
        {
          id: 'D29:1',
          rawText: 'John: Hey James, it\'s been a few days since we talked! The workshop was intense, we were in training for six months.',
          text: 'John: Hey James, it\'s been a few days since we talked! The workshop was intense, we were in training for six months.',
          timestamp: '10:00 am on 15 October, 2023',
        },
      ],
    }
    const triage = {
      category: 2,
      choice: 'c2_temporal',
      temporalSubtype: 'duration',
      searchScope: 'single_session',
    }

    const ans = await head.formatAnswer(q, searchResult, triage)
    assert.equal(ans, 'six months', 'Should extract "six months" and ignore greeting phrase "a few days"')
  })

  it('normalizes count answers from digits to English words for count queries', async () => {
    const { normalizeCountAnswer } = await import('./answer-head-pass3.mjs')

    // Standalone digits for count questions
    assert.equal(normalizeCountAnswer('2', 'How many pets does James have?'), 'two')
    assert.equal(normalizeCountAnswer('1', 'How many dogs does John have?'), 'one')
    assert.equal(normalizeCountAnswer('3', 'What is the number of books James read?'), 'three')
    assert.equal(normalizeCountAnswer('4 dogs', 'How many dogs?'), 'four dogs')

    // Preserves non-count numbers (dates, turn IDs, percentages)
    assert.equal(normalizeCountAnswer('April 26, 2022', 'When did James adopt Ned?'), 'April 26, 2022')
    assert.equal(normalizeCountAnswer('D16:13', 'Which turn id?'), 'D16:13')
    assert.equal(normalizeCountAnswer('150 meters', 'What height did he jump from?'), '150 meters')
  })

  it('documents Q31 Session 16 dialogue truth vs disputed reference', async () => {
    // Session 16 (9 July, 2022):
    // D16:9: "leaving the day after tomorrow evening" -> July 11
    // D16:13: "I plan to return on July 20"
    // True elapsed duration = 9 days (or 10 inclusive days). The reference "19 days" is unmentioned in dialogue.
    const s16_date = '5:13 pm on 9 July, 2022'
    const departure = new Date('2022-07-11T18:00:00')
    const returnDate = new Date('2022-07-20T18:00:00')
    const elapsedDays = Math.round((returnDate - departure) / (1000 * 60 * 60 * 24))
    assert.equal(elapsedDays, 9, 'Elapsed days between July 11 and July 20 is 9 days, not 19 days')
  })
})
