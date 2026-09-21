/**
 * Validated Span Reader Module for LoCoMo Pass 3.1.
 *
 * Replaces generative SLM fallbacks and bespoke heuristics with TypeSafe Jev System-1
 * grounded candidate span selection.
 *
 * Flow:
 *   1. Given top evidence text turns and the question, extract grounded candidate spans:
 *      - Named entities & capitalized phrases (e.g. "Apex Legends", "Toronto", "Samantha")
 *      - Durations, numbers, & quantities (e.g. "19 days", "six months", "nearly three months")
 *      - Noun phrases & key activities (e.g. "drums", "bottle caps", "pepperoni", "bowling")
 *   2. Rank candidate spans prioritizing novel information (not already in the question).
 *   3. Submit candidate spans to Jev System-1 via `type: 'choice'`.
 *   4. If Jev selects a valid candidate with high confidence, return the concise span.
 *   5. If Jev selects "none" or confidence is low, fall back cleanly.
 */

const STOPWORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'also',
  'always',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'out',
  'over',
  'own',
  'really',
  's',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  't',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'you',
  'your',
  'yours',
])

const LEADING_SENTENCE_WORDS = new Set([
  'my',
  'we',
  'they',
  'he',
  'she',
  'it',
  'you',
  'our',
  'there',
  'this',
  'that',
  'in',
  'on',
  'at',
  'when',
  'where',
  'why',
  'how',
  'i',
  'im',
  'i\'m',
  'well',
  'yeah',
  'yes',
  'no',
])

/**
 * Extract candidate answer spans from evidence text.
 *
 * @param {string} text - Evidence passage or dialogue turn
 * @param {string} [question] - The question being asked
 * @returns {string[]} Ordered list of unique candidate spans
 */
export function extractCandidateSpans(text, question = '') {
  if (!text || typeof text !== 'string')
    return []

  const clean = text.trim()
  const spans = []

  // 1. Durations and Quantities (e.g., "19 days", "six months", "nearly three months", "nearly four months")
  const durationRegex = /\b(?:nearly\s+|about\s+|approximately\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|a few)\s+(?:days?|weeks?|months?|years?|hours?)\b/gi
  let match
  while ((match = durationRegex.exec(clean)) !== null) {
    spans.push(match[0].trim())
  }

  // 2. Quoted phrases
  const quoteRegex = /"([^"]+)"|'([^']+)'/g
  while ((match = quoteRegex.exec(clean)) !== null) {
    const qSpan = (match[1] || match[2] || '').trim()
    if (qSpan.length > 1 && !STOPWORDS.has(qSpan.toLowerCase())) {
      spans.push(qSpan)
    }
  }

  // 3. Named Entities & Proper Noun Sequences (e.g., "Civilization VI", "CS:GO", "Toronto, Canada", "Mark and Josh")
  const entityRegex = /\b[A-Z][\w+#/']*(?:\s+(?:and|of|the|for|in|at)\s+[A-Z][\w+#/']*|\s+[A-Z][\w+#/']*)*\b/g
  while ((match = entityRegex.exec(clean)) !== null) {
    const ent = match[0].trim()
    const firstWord = ent.split(/\s+/)[0].toLowerCase()
    if (!LEADING_SENTENCE_WORDS.has(firstWord) && ent.length > 1) {
      spans.push(ent)
    }
  }

  // 4. Activity, Hobby, & Noun Phrases
  // Extract noun chunks following action or preference markers
  const activityRegex = /\b(?:play|playing|pursue|pursuing|pursued|love|loves|loved|like|likes|liked|collect|collects|collected|practice|practicing|practiced|work\s+on|working\s+on|worked\s+on|enjoy|enjoying|enjoyed|topping\s+is|favorite\s+is|eat|eating|favorite\s+\w+\s+is)\s+([\w+#/\s]{2,40}?)(?=[,.;!?]|\s+(?:when|because|since|and|but|with|for|to)\b|$)/gi
  while ((match = activityRegex.exec(clean)) !== null) {
    let act = match[1].trim()
    act = act.replace(/^(?:the|a|an|my|some|all|his|her)\s+/i, '').trim()
    if (act.length > 1 && !STOPWORDS.has(act.toLowerCase())) {
      spans.push(act)
    }
  }

  // 5. Clean 1-3 word noun phrases (strip leading/trailing stopwords)
  const words = clean.replace(/[^a-z0-9+#/'-]/gi, ' ').split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const wLower = words[i].toLowerCase()
    if (STOPWORDS.has(wLower) || words[i].length < 3)
      continue

    // 1-gram
    spans.push(words[i])

    // 2-gram
    if (i + 1 < words.length) {
      const w2 = words[i + 1]
      const w2Lower = w2.toLowerCase()
      if (!STOPWORDS.has(w2Lower) && w2.length >= 2) {
        spans.push(`${words[i]} ${w2}`)
      }
      else if (i + 2 < words.length) {
        // e.g. "Python and C++" or "Legend of Zelda"
        const w3 = words[i + 2]
        const w3Lower = w3.toLowerCase()
        if (!STOPWORDS.has(w3Lower) && w3.length >= 2) {
          spans.push(`${words[i]} ${w2} ${w3}`)
        }
      }
    }
  }

  // Deduplicate case-insensitively while preserving original casing
  const seen = new Set()
  const uniqueSpans = []
  for (const s of spans) {
    const sNorm = s.trim().toLowerCase()
    if (sNorm.length < 2 || seen.has(sNorm))
      continue
    seen.add(sNorm)
    uniqueSpans.push(s.trim())
  }

  // Rank spans using Query-Context Complementarity:
  // Give highest priority to candidate spans containing novel tokens NOT in the question
  const qTokens = new Set(
    question.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean),
  )

  const scored = uniqueSpans.map((span) => {
    const sTokens = span.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
    const novelCount = sTokens.filter(t => !qTokens.has(t) && !STOPWORDS.has(t)).length
    const overlapCount = sTokens.filter(t => qTokens.has(t)).length

    let score = novelCount * 3 - overlapCount * 2

    // Prefer concise spans (1-3 words) over long text
    if (sTokens.length >= 1 && sTokens.length <= 3) {
      score += 2
    }

    return { span, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.map(item => item.span).filter(s => s.length < clean.length * 0.8)
}

/**
 * Uses TypeSafe Jev System-1 to select the exact ground-truth answer span from candidate spans.
 *
 * @param {import('./jev-client.mjs').TypeSafeJevClient} jev
 * @param {string} question
 * @param {string} contextText - Raw evidence dialogue turn(s)
 * @param {string[]} candidateSpans
 * @returns {Promise<{ answer: string|null, confidence: number, choice: string }>}
 */
export async function selectAnswerSpanWithJev(jev, question, contextText, candidateSpans = []) {
  if (!jev || !question || !contextText) {
    return { answer: null, confidence: 0, choice: 'none' }
  }

  let candidates = candidateSpans
  if (candidates.length === 0) {
    candidates = extractCandidateSpans(contextText, question)
  }

  if (candidates.length === 0) {
    return { answer: null, confidence: 0, choice: 'none' }
  }

  // Limit to at most 10 best candidates to stay well within Jev criteria bounds
  const boundedCandidates = candidates.slice(0, 10)

  const criteria = {}
  boundedCandidates.forEach((span, idx) => {
    criteria[`choice_${idx}`] = span
  })
  criteria.none = 'None of the above candidates concisely and accurately answers the question.'

  const instructions = `Given the conversation evidence context, select the EXACT candidate phrase that directly and concisely answers the question: "${question}". If none of the candidate options accurately answer the question, select "none".`

  try {
    const res = await jev.systemOne(`Evidence: ${contextText.slice(0, 600)}`, {
      selected_span: {
        type: 'choice',
        instructions,
        criteria,
      },
    })

    const ans = res.answers?.selected_span || {}
    const choice = ans.choice || 'none'
    const confidence = ans.confidence ?? 0.5

    if (choice.startsWith('choice_') && confidence >= 0.35) {
      const idx = Number.parseInt(choice.replace('choice_', ''), 10)
      if (idx >= 0 && idx < boundedCandidates.length) {
        return {
          answer: boundedCandidates[idx],
          confidence,
          choice,
        }
      }
    }

    return { answer: null, confidence, choice: 'none' }
  }
  catch (err) {
    console.warn(`[SpanReader] Jev span selection error: ${err.message}`)
    return { answer: null, confidence: 0, choice: 'error' }
  }
}
