/**
 * Canonical Porter Stemmer with NLTK parity (NLTK_EXTENSIONS mode).
 * Mirrors nltk.stem.PorterStemmer(mode=PorterStemmer.NLTK_EXTENSIONS)
 * as used by Snap Research's official LoCoMo evaluation suite:
 * https://github.com/snap-research/locomo/blob/main/task_eval/evaluation.py
 */

function isConsonant(word, i) {
  const c = word[i]
  if ('aeiou'.includes(c))
    return false
  if (c === 'y') {
    if (i === 0)
      return true
    return !isConsonant(word, i - 1)
  }
  return true
}

function measure(word) {
  let n = 0
  let i = 0
  const len = word.length
  while (i < len && isConsonant(word, i)) i++
  while (i < len) {
    while (i < len && !isConsonant(word, i)) i++
    if (i >= len)
      break
    while (i < len && isConsonant(word, i)) i++
    n++
  }
  return n
}

function containsVowel(word) {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i))
      return true
  }
  return false
}

function endsCvc(word) {
  if (word.length >= 3) {
    const l = word.length
    return isConsonant(word, l - 3)
      && !isConsonant(word, l - 2)
      && isConsonant(word, l - 1)
      && !['w', 'x', 'y'].includes(word[l - 1])
  }
  // NLTK extension: 2-letter vowel+consonant behaves as cvc (e.g. 'on', 'us', 'ar')
  if (word.length === 2) {
    return !isConsonant(word, 0) && isConsonant(word, 1)
  }
  return false
}

const NLTK_POOL = {
  sky: 'sky',
  skies: 'sky',
  dying: 'die',
  lying: 'lie',
  tying: 'tie',
  news: 'news',
  innings: 'inning',
  inning: 'inning',
  outings: 'outing',
  outing: 'outing',
  cannings: 'canning',
  canning: 'canning',
  howe: 'howe',
  proceed: 'proceed',
  exceed: 'exceed',
  succeed: 'succeed',
}

const STEP2_RULES = [
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['izer', 'ize'],
  ['bli', 'ble'],
  ['alli', 'al'],
  ['entli', 'ent'],
  ['eli', 'e'],
  ['ousli', 'ous'],
  ['ization', 'ize'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['alism', 'al'],
  ['iveness', 'ive'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
  ['logi', 'log'],
  ['fulli', 'ful'],
]

const STEP3_RULES = [
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
]

const STEP4_RULES = [
  'al',
  'ance',
  'ence',
  'er',
  'ic',
  'able',
  'ible',
  'ant',
  'ement',
  'ment',
  'ent',
  'sion',
  'tion',
  'ou',
  'ism',
  'ate',
  'iti',
  'ous',
  'ive',
  'ize',
]

export function stemWord(word) {
  if (!word || typeof word !== 'string')
    return ''
  word = word.toLowerCase()

  if (NLTK_POOL[word])
    return NLTK_POOL[word]
  if (word.length <= 2)
    return word

  // Step 1a
  if (word.endsWith('sses')) {
    word = word.slice(0, -2)
  }
  else if (word.endsWith('ies')) {
    word = word.length === 4 ? word.slice(0, -1) : word.slice(0, -2)
  }
  else if (word.endsWith('ss')) {
    // unchanged
  }
  else if (word.endsWith('s')) {
    word = word.slice(0, -1)
  }

  // Step 1b (with NLTK extension for -ied)
  let extra1b = false
  if (word.endsWith('ied')) {
    word = word.length === 4 ? `${word.slice(0, -3)}ie` : `${word.slice(0, -3)}i`
  }
  else if (word.endsWith('eed')) {
    const stem = word.slice(0, -3)
    if (measure(stem) > 0)
      word = `${stem}ee`
  }
  else if (word.endsWith('ed')) {
    const stem = word.slice(0, -2)
    if (containsVowel(stem)) {
      word = stem
      extra1b = true
    }
  }
  else if (word.endsWith('ing')) {
    const stem = word.slice(0, -3)
    if (containsVowel(stem)) {
      word = stem
      extra1b = true
    }
  }

  if (extra1b) {
    if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) {
      word = `${word}e`
    }
    else if (word.length >= 2
      && isConsonant(word, word.length - 1)
      && word[word.length - 1] === word[word.length - 2]
      && !['l', 's', 'z'].includes(word[word.length - 1])) {
      word = word.slice(0, -1)
    }
    else if (measure(word) === 1 && endsCvc(word)) {
      word = `${word}e`
    }
  }

  // Step 1c (NLTK extension: only change y->i when preceded by a consonant, len(stem) > 1)
  if (word.endsWith('y')) {
    const stem = word.slice(0, -1)
    if (stem.length > 1 && isConsonant(stem, stem.length - 1)) {
      word = `${stem}i`
    }
  }

  // Step 2
  for (const [suff, repl] of STEP2_RULES) {
    if (word.endsWith(suff)) {
      const stem = word.slice(0, -suff.length)
      if (suff === 'logi' ? measure(word.slice(0, -3)) > 0 : measure(stem) > 0) {
        word = stem + repl
      }
      break
    }
  }

  // Step 3
  for (const [suff, repl] of STEP3_RULES) {
    if (word.endsWith(suff)) {
      const stem = word.slice(0, -suff.length)
      if (measure(stem) > 0) {
        word = stem + repl
      }
      break
    }
  }

  // Step 4
  for (const suff of STEP4_RULES) {
    if (word.endsWith(suff)) {
      if (suff === 'sion' || suff === 'tion') {
        const stem = word.slice(0, -3) // retain s or t
        if (measure(stem) > 1)
          word = stem
      }
      else {
        const stem = word.slice(0, -suff.length)
        if (measure(stem) > 1)
          word = stem
      }
      break
    }
  }

  // Step 5a
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1)
    const m = measure(stem)
    if (m > 1 || (m === 1 && !endsCvc(stem))) {
      word = stem
    }
  }

  // Step 5b
  if (measure(word) > 1 && word.endsWith('ll')) {
    word = word.slice(0, -1)
  }

  return word
}
