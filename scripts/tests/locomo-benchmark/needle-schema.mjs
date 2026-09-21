/**
 * Needle 2 Tool Schema and Host Span Validation.
 * Follows the peer-reviewed specification in docs/memory_lab/LoCoMo-Pass2-Entity-Ledger-Review.md.
 */

export const EXTRACT_MEMORY_FRAGMENTS_TOOL = {
  name: 'extract_memory_fragments',
  description: 'Copy mentions and factual or contextual fragments from the target passage. Keep uncertainty, negation and plans. Leave absent spans out. Return empty arrays when nothing is extractable.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mentions: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 64 },
        description: 'Names of people, animals/pets, places, organizations, or objects directly mentioned.',
      },
      temporal_phrase: {
        type: 'string',
        maxLength: 64,
        description: 'Relative or absolute time expression if present (e.g. "last week", "yesterday", "in April 2022").',
      },
      claims: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quote: { type: 'string', minLength: 1, maxLength: 240 },
            subject_span: { type: 'string', minLength: 1, maxLength: 64 },
            predicate_span: { type: 'string', minLength: 1, maxLength: 64 },
            object_span: { type: 'string', minLength: 1, maxLength: 96 },
            time_span: { type: 'string', minLength: 1, maxLength: 64 },
            polarity: { type: 'string', enum: ['positive', 'negative', 'unknown'] },
            mode: {
              type: 'string',
              enum: ['asserted', 'question', 'plan', 'hypothetical', 'quoted', 'fragment', 'unknown'],
            },
          },
          required: ['quote', 'polarity', 'mode'],
        },
      },
    },
    required: ['mentions', 'claims'],
  },
}

/**
 * Validates that all extracted spans and quotes exist as exact substrings of targetText.
 * Drops any hallucinated or ungrounded spans.
 *
 * @param {string} targetText
 * @param {object} extractionResult
 * @returns {object} Validated extraction result
 */
export function validateExtractionSpans(targetText, extractionResult) {
  if (!extractionResult || typeof extractionResult !== 'object') {
    return { mentions: [], claims: [], temporal_phrase: null }
  }

  const normTarget = targetText.toLowerCase()

  // Validate mentions
  const rawMentions = Array.isArray(extractionResult.mentions) ? extractionResult.mentions : []
  const validMentions = []
  for (const m of rawMentions) {
    if (typeof m === 'string' && m.trim().length > 0) {
      const trimmed = m.trim()
      if (normTarget.includes(trimmed.toLowerCase())) {
        validMentions.push(trimmed)
      }
    }
  }

  // Validate temporal phrase
  let validTemporal = null
  if (typeof extractionResult.temporal_phrase === 'string') {
    const tp = extractionResult.temporal_phrase.trim()
    if (tp.length > 0 && normTarget.includes(tp.toLowerCase())) {
      validTemporal = tp
    }
  }

  // Validate claims
  const rawClaims = Array.isArray(extractionResult.claims) ? extractionResult.claims : []
  const validClaims = []
  for (const c of rawClaims) {
    if (!c || typeof c !== 'object')
      continue
    const quote = typeof c.quote === 'string' ? c.quote.trim() : ''
    // Quote must be present in source text
    if (quote.length > 0 && normTarget.includes(quote.toLowerCase())) {
      const validClaim = {
        quote,
        polarity: ['positive', 'negative', 'unknown'].includes(c.polarity) ? c.polarity : 'positive',
        mode: ['asserted', 'question', 'plan', 'hypothetical', 'quoted', 'fragment', 'unknown'].includes(c.mode)
          ? c.mode
          : 'asserted',
      }
      if (c.subject_span && normTarget.includes(c.subject_span.trim().toLowerCase())) {
        validClaim.subject_span = c.subject_span.trim()
      }
      if (c.predicate_span && normTarget.includes(c.predicate_span.trim().toLowerCase())) {
        validClaim.predicate_span = c.predicate_span.trim()
      }
      if (c.object_span && normTarget.includes(c.object_span.trim().toLowerCase())) {
        validClaim.object_span = c.object_span.trim()
      }
      if (c.time_span && normTarget.includes(c.time_span.trim().toLowerCase())) {
        validClaim.time_span = c.time_span.trim()
      }
      validClaims.push(validClaim)
    }
  }

  return {
    mentions: validMentions,
    temporal_phrase: validTemporal,
    claims: validClaims,
  }
}
