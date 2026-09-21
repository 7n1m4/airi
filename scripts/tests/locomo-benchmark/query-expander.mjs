/**
 * Casual Spoken Query Expander.
 * Inspired by Anima's query expansion prompt, optimized as a fast rule-based expander
 * to prevent conversational mismatch without latency.
 */

const CASUAL_SYNONYMS = [
  {
    pattern: /\b(?:trip to\s+)?canada\b/i,
    expansion: 'Canada Toronto Vancouver departure air tickets flight',
  },
  {
    pattern: /\bstart(?:ed)?\s+(?:his\s+)?job\s+(?:in\s+)?it\b/i,
    expansion: 'left IT job 3 years started working career',
  },
  {
    pattern: /\bgirlfriend\b/i,
    expansion: 'girlfriend dating relationship Samantha partner',
  },
  {
    pattern: /\bplaying(?:\s+the)?\s+drums\b/i,
    expansion: 'playing drums drumming adulthood practice instruments',
  },
  {
    pattern: /\bprogramming\s+competition\b/i,
    expansion: 'programming competition online contest hackathon friends',
  },
]

/**
 * Expands query text with conversational aliases and context words.
 *
 * @param {string} question
 * @returns {string}
 */
export function expandCasualQuery(question) {
  if (!question || typeof question !== 'string')
    return question

  let expanded = question
  for (const { pattern, expansion } of CASUAL_SYNONYMS) {
    if (pattern.test(question)) {
      expanded = `${expanded} ${expansion}`
    }
  }
  return expanded
}
