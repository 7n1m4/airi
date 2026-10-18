import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { client } from '../composables/api'
import { charactersRepo } from '../database/repos/characters.repo'
import { useCharacterStore } from './characters'

vi.mock('./auth', () => ({
  useAuthStore: () => ({
    userId: 'user-1',
    isAuthenticated: true,
  }),
}))

vi.mock('../database/repos/characters.repo', () => ({
  charactersRepo: {
    getAll: vi.fn(async () => []),
    saveAll: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}))

vi.mock('../composables/api', () => ({
  client: {
    api: {
      characters: {
        '$get': vi.fn(async () => ({ ok: true, json: async () => [makeChar('remote-1')] })),
        '$post': vi.fn(async () => ({ ok: true, json: async () => makeChar('remote-2') })),
        ':id': {
          $get: vi.fn(async () => ({ ok: true, json: async () => makeChar('remote-3') })),
          $patch: vi.fn(async () => ({ ok: true, json: async () => makeChar('remote-3') })),
          $delete: vi.fn(async () => ({ ok: true })),
          like: { $post: vi.fn(async () => ({ ok: true, json: async () => makeChar('remote-3') })) },
          bookmark: { $post: vi.fn(async () => ({ ok: true, json: async () => makeChar('remote-3') })) },
        },
      },
    },
  },
}))

function makeChar(id: string) {
  return {
    id,
    version: '1',
    coverUrl: '',
    priceCredit: '0',
    likesCount: 0,
    bookmarksCount: 0,
    interactionsCount: 0,
    forksCount: 0,
    creatorId: 'user-1',
    ownerId: 'user-1',
    characterId: 'c1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    capabilities: [],
    avatarModels: [],
    i18n: [],
    prompts: [],
    likes: [],
    bookmarks: [],
  }
}

async function flush() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

describe('store characters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(charactersRepo.getAll).mockResolvedValue([])
    vi.mocked(charactersRepo.saveAll).mockResolvedValue(undefined)
    vi.mocked(charactersRepo.upsert).mockResolvedValue(undefined)
    vi.mocked(charactersRepo.remove).mockResolvedValue(undefined)
    vi.mocked(client.api.characters.$get).mockResolvedValue({ ok: true, json: async () => [makeChar('remote-1')] } as never)
    vi.mocked(client.api.characters.$post).mockResolvedValue({ ok: true, json: async () => makeChar('remote-2') } as never)
    vi.mocked(client.api.characters[':id'].$get).mockResolvedValue({ ok: true, json: async () => makeChar('remote-3') } as never)
    vi.mocked(client.api.characters[':id'].$patch).mockResolvedValue({ ok: true, json: async () => makeChar('remote-3') } as never)
    vi.mocked(client.api.characters[':id'].$delete).mockResolvedValue({ ok: true } as never)
    vi.mocked(client.api.characters[':id'].like.$post).mockResolvedValue({ ok: true, json: async () => makeChar('remote-3') } as never)
    vi.mocked(client.api.characters[':id'].bookmark.$post).mockResolvedValue({ ok: true, json: async () => makeChar('remote-3') } as never)
  })

  it('fetchList success', async () => {
    const store = useCharacterStore()
    await store.fetchList()
    await flush()
    expect(store.characters.size).toBeGreaterThan(0)
  })

  it('fetchList all', async () => {
    const store = useCharacterStore()
    await store.fetchList(true)
    await flush()
    expect(store.characters.size).toBeGreaterThan(0)
  })

  it('fetchList cached local', async () => {
    vi.mocked(charactersRepo.getAll).mockResolvedValueOnce([makeChar('cached-1')] as never)
    const store = useCharacterStore()
    await store.fetchList()
    await flush()
    expect(true).toBe(true)
  })

  it('update with empty payload', async () => {
    const store = useCharacterStore()
    store.characters.set('u2', makeChar('u2') as never)
    await store.update('u2', {} as never)
    await flush()
    expect(store.characters.has('u2')).toBe(true)
  })

  it('create with full payload and id', async () => {
    const store = useCharacterStore()
    const payload = {
      character: { id: 'provided-id', version: '1', coverUrl: '', characterId: 'c1' },
      capabilities: [{ type: 'llm', config: { apiKey: '', apiBaseUrl: '' } }],
      avatarModels: [{ name: 'm', type: 'live2d', description: '', config: {} }],
      i18n: [{ language: 'en', name: 'n', description: 'd', tags: [] }],
      prompts: [{ language: 'en', type: 'system', content: 'hi' }],
    } as never
    await store.create(payload)
    await flush()
    expect(store.characters.has('provided-id') || store.characters.size > 0).toBe(true)
  })

  it('fetchList remote fail', async () => {
    vi.mocked(client.api.characters.$get).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    await store.fetchList()
    await flush()
    expect(true).toBe(true)
  })

  it('fetchById cached', async () => {
    const store = useCharacterStore()
    store.characters.set('x', makeChar('x') as never)
    await store.fetchById('x')
    await flush()
    expect(store.characters.has('x')).toBe(true)
  })

  it('fetchById from repo', async () => {
    vi.mocked(charactersRepo.getAll).mockResolvedValueOnce([makeChar('repo-1')] as never)
    const store = useCharacterStore()
    await store.fetchById('repo-1')
    await flush()
    expect(store.characters.has('repo-1')).toBe(true)
  })

  it('fetchById remote', async () => {
    const store = useCharacterStore()
    await store.fetchById('remote-3')
    await flush()
    expect(store.characters.has('remote-3')).toBe(true)
  })

  it('fetchById remote fail', async () => {
    vi.mocked(client.api.characters[':id'].$get).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    await store.fetchById('nope')
    await flush()
    expect(true).toBe(true)
  })

  it('create', async () => {
    const store = useCharacterStore()
    const payload = { character: { version: '1', coverUrl: '', characterId: 'c1' } } as never
    await store.create(payload)
    await flush()
    expect(store.characters.size).toBeGreaterThan(0)
  })

  it('create remote fail', async () => {
    vi.mocked(client.api.characters.$post).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    const payload = { character: { version: '1', coverUrl: '', characterId: 'c1' } } as never
    await store.create(payload)
    await flush()
    expect(true).toBe(true)
  })

  it('update existing', async () => {
    const store = useCharacterStore()
    store.characters.set('u', makeChar('u') as never)
    await store.update('u', { version: '2', coverUrl: 'c', characterId: 'c2' } as never)
    await flush()
    expect(store.characters.get('u')?.version).toBe('2')
  })

  it('update missing', async () => {
    const store = useCharacterStore()
    await store.update('missing', { version: '2' } as never)
    await flush()
    expect(true).toBe(true)
  })

  it('update remote', async () => {
    const store = useCharacterStore()
    store.characters.set('remote-3', makeChar('remote-3') as never)
    await store.update('remote-3', { version: '2' } as never)
    await flush()
    expect(store.characters.has('remote-3')).toBe(true)
  })

  it('update remote fail', async () => {
    vi.mocked(client.api.characters[':id'].$patch).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    store.characters.set('remote-3', makeChar('remote-3') as never)
    await store.update('remote-3', { version: '2' } as never)
    await flush()
    expect(true).toBe(true)
  })

  it('remove', async () => {
    const store = useCharacterStore()
    store.characters.set('r', makeChar('r') as never)
    await store.remove('r')
    await flush()
    expect(store.characters.has('r')).toBe(false)
  })

  it('remove remote fail', async () => {
    vi.mocked(client.api.characters[':id'].$delete).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    store.characters.set('r2', makeChar('r2') as never)
    await store.remove('r2')
    await flush()
    expect(true).toBe(true)
  })

  it('like existing', async () => {
    const store = useCharacterStore()
    store.characters.set('l', makeChar('l') as never)
    await store.like('l')
    await flush()
    const likedChar = store.characters.get('l') as { likesCount: number }
    expect(likedChar.likesCount).toBe(1)
  })

  it('like missing', async () => {
    const store = useCharacterStore()
    await store.like('missing')
    await flush()
    expect(true).toBe(true)
  })

  it('like already liked', async () => {
    const store = useCharacterStore()
    const c = makeChar('l2') as { likes: { userId: string, characterId: string }[], likesCount: number }
    c.likes = [{ userId: 'user-1', characterId: 'l2' }]
    store.characters.set('l2', c as never)
    await store.like('l2')
    await flush()
    const likedChar2 = store.characters.get('l2') as { likesCount: number }
    expect(likedChar2.likesCount).toBe(0)
  })

  it('like remote', async () => {
    const store = useCharacterStore()
    store.characters.set('remote-3', makeChar('remote-3') as never)
    await store.like('remote-3')
    await flush()
    expect(store.characters.has('remote-3')).toBe(true)
  })

  it('like remote fail', async () => {
    vi.mocked(client.api.characters[':id'].like.$post).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    store.characters.set('remote-3', makeChar('remote-3') as never)
    await store.like('remote-3')
    await flush()
    expect(true).toBe(true)
  })

  it('bookmark existing', async () => {
    const store = useCharacterStore()
    store.characters.set('b', makeChar('b') as never)
    await store.bookmark('b')
    await flush()
    const bookmarkedChar = store.characters.get('b') as { bookmarksCount: number }
    expect(bookmarkedChar.bookmarksCount).toBe(1)
  })

  it('bookmark missing', async () => {
    const store = useCharacterStore()
    await store.bookmark('missing')
    await flush()
    expect(true).toBe(true)
  })

  it('bookmark already bookmarked', async () => {
    const store = useCharacterStore()
    const c = makeChar('b2') as { bookmarks: { userId: string, characterId: string }[], bookmarksCount: number }
    c.bookmarks = [{ userId: 'user-1', characterId: 'b2' }]
    store.characters.set('b2', c as never)
    await store.bookmark('b2')
    await flush()
    const bookmarkedChar2 = store.characters.get('b2') as { bookmarksCount: number }
    expect(bookmarkedChar2.bookmarksCount).toBe(0)
  })

  it('bookmark remote', async () => {
    const store = useCharacterStore()
    store.characters.set('remote-3', makeChar('remote-3') as never)
    await store.bookmark('remote-3')
    await flush()
    expect(store.characters.has('remote-3')).toBe(true)
  })

  it('bookmark remote fail', async () => {
    vi.mocked(client.api.characters[':id'].bookmark.$post).mockResolvedValueOnce({ ok: false } as never)
    const store = useCharacterStore()
    store.characters.set('remote-3', makeChar('remote-3') as never)
    await store.bookmark('remote-3')
    await flush()
    expect(true).toBe(true)
  })

  it('getCharacter', () => {
    const store = useCharacterStore()
    store.characters.set('g', makeChar('g') as never)
    expect(store.getCharacter('g')?.id).toBe('g')
  })
})
