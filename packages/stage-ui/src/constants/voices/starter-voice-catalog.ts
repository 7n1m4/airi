/**
 * Starter Voice Catalog for Local Zero-Shot Voice Cloning (Pocket-TTS & MOSS-TTS).
 *
 * Bundles 18 high-fidelity reference audio samples (.wav) synthesized via
 * MOSS-VoiceGenerator for the 8 Gold-Standard Starter Companions, male archetypes,
 * and multilingual/whacky voices.
 */

export interface StarterVoiceEntry {
  id: string
  name: string
  actorKey: string
  gender: 'female' | 'male' | 'creature'
  languageCode: string
  languageTitle: string
  assetUrl: string
  description?: string
}

export const STARTER_VOICE_CATALOG: StarterVoiceEntry[] = [
  // 8 Canonical Female Starter Companions
  {
    id: 'airi_relu',
    name: 'ReLU (Empathetic)',
    actorKey: 'relu',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_relu.wav', import.meta.url).href,
    description: 'Youthful, warm, playful anime kitten-girl (soul mate)',
  },
  {
    id: 'airi_aria',
    name: 'Dr. Aria (Analytical)',
    actorKey: 'aria',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_aria.wav', import.meta.url).href,
    description: 'Composed, articulate scientist with sharp academic wit',
  },
  {
    id: 'airi_lupin',
    name: 'Lupin (Guardian)',
    actorKey: 'lupin',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_lupin.wav', import.meta.url).href,
    description: 'Stoic, grounded, calm lower-register guardian',
  },
  {
    id: 'airi_kira',
    name: 'Kira (Tsundere)',
    actorKey: 'kira',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_kira.wav', import.meta.url).href,
    description: 'Sharp, punchy, easily flustered with hidden warmth',
  },
  {
    id: 'airi_rin',
    name: 'Rin (Kuudere)',
    actorKey: 'rin',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_rin.wav', import.meta.url).href,
    description: 'Quiet, serene, measured dispassionate analyst',
  },
  {
    id: 'airi_yuki',
    name: 'Yuki (Yandere)',
    actorKey: 'yuki',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_yuki.wav', import.meta.url).href,
    description: 'Soft-spoken, whispery, intensely devoted and possessive',
  },
  {
    id: 'airi_mio',
    name: 'Mio (Dandere)',
    actorKey: 'mio',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_mio.wav', import.meta.url).href,
    description: 'Delicate, timid, sweet and modest teenage companion',
  },
  {
    id: 'airi_hana',
    name: 'Hana (Deredere)',
    actorKey: 'hana',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_hana.wav', import.meta.url).href,
    description: 'Radiant, cheerful, energetic sunshine cheerleader',
  },

  // 3 Male Archetypes
  {
    id: 'airi_ren',
    name: 'Ren (Shonen Hero)',
    actorKey: 'ren',
    gender: 'male',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_ren.wav', import.meta.url).href,
    description: 'Energetic, confident, warm youthful anime protagonist',
  },
  {
    id: 'airi_klaus',
    name: 'Klaus (Tactician)',
    actorKey: 'klaus',
    gender: 'male',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_klaus.wav', import.meta.url).href,
    description: 'Deep, steady, authoritative protective baritone',
  },
  {
    id: 'airi_sebastian',
    name: 'Sebastian (Butler)',
    actorKey: 'sebastian',
    gender: 'male',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_sebastian.wav', import.meta.url).href,
    description: 'Refined, velvety British RP accent, elegant and courteous',
  },

  // Multilingual & Cultural Showcase
  {
    id: 'airi_sakura',
    name: 'Sakura (Japanese)',
    actorKey: 'sakura',
    gender: 'female',
    languageCode: 'ja-JP',
    languageTitle: 'Japanese',
    assetUrl: new URL('../../assets/voices/airi_sakura.wav', import.meta.url).href,
    description: 'Authentic cheerful Japanese anime heroine',
  },
  {
    id: 'airi_lucia',
    name: 'Lucía (Spanish)',
    actorKey: 'lucia',
    gender: 'female',
    languageCode: 'es-ES',
    languageTitle: 'Spanish',
    assetUrl: new URL('../../assets/voices/airi_lucia.wav', import.meta.url).href,
    description: 'Warm, vibrant native Spanish companion',
  },
  {
    id: 'airi_amelie',
    name: 'Amélie (French)',
    actorKey: 'amelie',
    gender: 'female',
    languageCode: 'fr-FR',
    languageTitle: 'French',
    assetUrl: new URL('../../assets/voices/airi_amelie.wav', import.meta.url).href,
    description: 'Chic Parisian companion with an authentic French accent',
  },
  {
    id: 'airi_meilin',
    name: 'Meilin (Mandarin)',
    actorKey: 'meilin',
    gender: 'female',
    languageCode: 'zh-CN',
    languageTitle: 'Chinese (Mandarin)',
    assetUrl: new URL('../../assets/voices/airi_meilin.wav', import.meta.url).href,
    description: 'Gentle, melodic native Mandarin companion',
  },

  // Whacky & Expressive Archetypes
  {
    id: 'airi_pico',
    name: 'Pico (Chibi Mascot)',
    actorKey: 'pico',
    gender: 'creature',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_pico.wav', import.meta.url).href,
    description: 'High-pitched, playful, mischievous magical fairy mascot',
  },
  {
    id: 'airi_morgana',
    name: 'Morgana (Gothic Vampire)',
    actorKey: 'morgana',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_morgana.wav', import.meta.url).href,
    description: 'Dramatic, velvety, theatrical chuunibyou vampire princess',
  },
  {
    id: 'airi_unit7',
    name: 'Unit-07 (Android)',
    actorKey: 'unit7',
    gender: 'female',
    languageCode: 'en-US',
    languageTitle: 'English (US)',
    assetUrl: new URL('../../assets/voices/airi_unit7.wav', import.meta.url).href,
    description: 'Deadpan, sterile, retro synth synthetic female android AI',
  },
]

const STARTER_VOICE_MAP = new Map(STARTER_VOICE_CATALOG.map(v => [v.id, v]))
const STARTER_VOICE_BY_ACTOR_MAP = new Map(STARTER_VOICE_CATALOG.map(v => [v.actorKey, v]))

export function getStarterVoiceById(id: string): StarterVoiceEntry | undefined {
  return STARTER_VOICE_MAP.get(id)
}

export function getStarterVoiceByActorKey(actorKey: string): StarterVoiceEntry | undefined {
  return STARTER_VOICE_BY_ACTOR_MAP.get(actorKey)
}

export function isStarterVoiceId(id: string): boolean {
  return STARTER_VOICE_MAP.has(id)
}

/** In-memory cache for fetched audio buffers to avoid redundant fetches */
const starterVoiceBufferCache = new Map<string, ArrayBuffer>()

/**
 * Fetch and return the raw WAV ArrayBuffer for a bundled starter voice.
 */
export async function getStarterVoiceArrayBuffer(id: string): Promise<ArrayBuffer | null> {
  const entry = STARTER_VOICE_MAP.get(id)
  if (!entry)
    return null

  if (starterVoiceBufferCache.has(id)) {
    return starterVoiceBufferCache.get(id)!.slice(0)
  }

  try {
    const response = await fetch(entry.assetUrl)
    if (!response.ok) {
      console.warn(`[StarterVoiceCatalog] Failed to fetch voice asset for '${id}': HTTP ${response.status}`)
      return null
    }
    const buf = await response.arrayBuffer()
    starterVoiceBufferCache.set(id, buf)
    return buf.slice(0)
  }
  catch (err) {
    console.error(`[StarterVoiceCatalog] Error loading voice asset for '${id}':`, err)
    return null
  }
}
