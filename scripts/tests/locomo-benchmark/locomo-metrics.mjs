/**
 * Canonical metrics calculation for LoCoMo benchmark (conv-47).
 * Implements SQuAD/LoCoMo token F1, BLEU-1, and category breakdowns.
 */

import { stemWord } from './porter-stemmer.mjs'

export function normalizeAnswer(text) {
  if (typeof text !== 'string')
    text = String(text || '')
  return text
    .toLowerCase()
    .replace(/\b(a|an|the)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function computeTokenF1(prediction, groundTruth) {
  const normPred = normalizeAnswer(prediction)
  const normGold = normalizeAnswer(groundTruth)

  if (!normPred && !normGold)
    return 1.0
  if (!normPred || !normGold)
    return 0.0

  const predTokens = normPred.split(' ').filter(Boolean)
  const goldTokens = normGold.split(' ').filter(Boolean)

  if (predTokens.length === 0 && goldTokens.length === 0)
    return 1.0
  if (predTokens.length === 0 || goldTokens.length === 0)
    return 0.0

  const goldCounts = new Map()
  for (const t of goldTokens) {
    goldCounts.set(t, (goldCounts.get(t) || 0) + 1)
  }

  let overlap = 0
  for (const t of predTokens) {
    const count = goldCounts.get(t) || 0
    if (count > 0) {
      overlap++
      goldCounts.set(t, count - 1)
    }
  }

  if (overlap === 0)
    return 0.0

  const precision = overlap / predTokens.length
  const recall = overlap / goldTokens.length
  const f1 = (2 * precision * recall) / (precision + recall)

  return f1
}

export function computeBleu1(prediction, groundTruth) {
  const normPred = normalizeAnswer(prediction)
  const normGold = normalizeAnswer(groundTruth)

  const predTokens = normPred.split(' ').filter(Boolean)
  const goldTokens = normGold.split(' ').filter(Boolean)

  if (predTokens.length === 0)
    return 0.0

  const goldSet = new Set(goldTokens)
  let matches = 0
  for (const t of predTokens) {
    if (goldSet.has(t))
      matches++
  }

  const precision = matches / predTokens.length
  const bp = predTokens.length < goldTokens.length
    ? Math.exp(1 - goldTokens.length / predTokens.length)
    : 1.0

  return bp * precision
}

export function normalizeAnswerUpstream(s) {
  if (!s || typeof s !== 'string')
    s = String(s || '')
  s = s.replace(/,/g, '')
  s = s.toLowerCase()
  s = s.replace(/[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]/g, '')
  s = s.replace(/\b(a|an|the|and)\b/g, ' ')
  return s.trim().split(/\s+/).filter(Boolean).join(' ')
}

export function computeUpstreamF1Single(prediction, groundTruth) {
  const pTokens = normalizeAnswerUpstream(prediction).split(' ').filter(Boolean).map(stemWord)
  const gTokens = normalizeAnswerUpstream(groundTruth).split(' ').filter(Boolean).map(stemWord)

  if (pTokens.length === 0 && gTokens.length === 0)
    return 1.0
  if (pTokens.length === 0 || gTokens.length === 0)
    return 0.0

  const gCounts = new Map()
  for (const t of gTokens) gCounts.set(t, (gCounts.get(t) || 0) + 1)

  let overlap = 0
  for (const t of pTokens) {
    if ((gCounts.get(t) || 0) > 0) {
      overlap++
      gCounts.set(t, gCounts.get(t) - 1)
    }
  }

  if (overlap === 0)
    return 0.0

  const p = overlap / pTokens.length
  const r = overlap / gTokens.length
  return (2 * p * r) / (p + r)
}

/**
 * Official Upstream LoCoMo F1 evaluation.
 * Mirrors https://github.com/snap-research/locomo/blob/main/task_eval/evaluation.py
 *
 * Upstream applies multi-answer splitting ONLY to Category 1 (multi-hop).
 * Categories 2, 3, and 4 use single-answer F1, with Category 3 pre-processing ';' delimiter.
 *
 * @param {string} prediction
 * @param {string} groundTruth
 * @param {number|null} [category=null] - 1 (multi-hop), 2 (temporal), 3 (open-domain), 4 (single-hop)
 */
export function computeUpstreamLoCoMoF1(prediction, groundTruth, category = null) {
  let gt = String(groundTruth || '')
  const pred = String(prediction || '')

  if (category === 3) {
    gt = gt.split(';')[0].trim()
  }

  // Category 1: Multi-Hop list evaluation (splits into sub-answers)
  if (category === 1) {
    const predictions = pred.split(',').map(p => p.trim())
    const groundTruths = gt.split(',').map(g => g.trim())

    const scores = groundTruths.map((g) => {
      return Math.max(...predictions.map(p => computeUpstreamF1Single(p, g)))
    })
    return scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
  }

  // Categories 2, 3, 4 (or default single-answer evaluation)
  return computeUpstreamF1Single(pred, gt)
}

export function computeExactMatch(prediction, groundTruth) {
  return normalizeAnswer(prediction) === normalizeAnswer(groundTruth) ? 1.0 : 0.0
}

export function aggregateBenchmarkResults(evalList) {
  const categories = {
    c1: { name: 'Multi-Hop (C1)', count: 0, sumF1: 0, sumUpstreamF1: 0, sumBleu: 0, sumEm: 0 },
    c2: { name: 'Temporal (C2)', count: 0, sumF1: 0, sumUpstreamF1: 0, sumBleu: 0, sumEm: 0 },
    c3: { name: 'Open-Domain / Detective (C3)', count: 0, sumF1: 0, sumUpstreamF1: 0, sumBleu: 0, sumEm: 0 },
    c4: { name: 'Single-Hop Literal (C4)', count: 0, sumF1: 0, sumUpstreamF1: 0, sumBleu: 0, sumEm: 0 },
  }

  let totalCount = 0
  let totalSumF1 = 0
  let totalSumUpstreamF1 = 0
  let totalSumBleu = 0
  let totalSumEm = 0

  for (const item of evalList) {
    const catKey = `c${item.category}`
    const f1 = computeTokenF1(item.prediction, item.groundTruth)
    const upstreamF1 = computeUpstreamLoCoMoF1(item.prediction, item.groundTruth, item.category)
    const bleu = computeBleu1(item.prediction, item.groundTruth)
    const em = computeExactMatch(item.prediction, item.groundTruth)

    item.metrics = { f1, upstreamF1, bleu, em }

    totalCount++
    totalSumF1 += f1
    totalSumUpstreamF1 += upstreamF1
    totalSumBleu += bleu
    totalSumEm += em

    if (categories[catKey]) {
      categories[catKey].count++
      categories[catKey].sumF1 += f1
      categories[catKey].sumUpstreamF1 += upstreamF1
      categories[catKey].sumBleu += bleu
      categories[catKey].sumEm += em
    }
  }

  const overall = {
    count: totalCount,
    f1: totalCount > 0 ? (totalSumF1 / totalCount) * 100 : 0,
    upstreamF1: totalCount > 0 ? (totalSumUpstreamF1 / totalCount) * 100 : 0,
    bleu: totalCount > 0 ? (totalSumBleu / totalCount) * 100 : 0,
    em: totalCount > 0 ? (totalSumEm / totalCount) * 100 : 0,
  }

  const categoryBreakdown = {}
  for (const [k, v] of Object.entries(categories)) {
    categoryBreakdown[k] = {
      name: v.name,
      count: v.count,
      f1: v.count > 0 ? (v.sumF1 / v.count) * 100 : 0,
      upstreamF1: v.count > 0 ? (v.sumUpstreamF1 / v.count) * 100 : 0,
      bleu: v.count > 0 ? (v.sumBleu / v.count) * 100 : 0,
      em: v.count > 0 ? (v.sumEm / v.count) * 100 : 0,
    }
  }

  return { overall, categoryBreakdown }
}
