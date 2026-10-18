import type { DiffCluster } from './diff-utils'

import { describe, expect, it } from 'vitest'

import { correlateInput, detectLossBurst, euclidean, getClusters, trackTrajectories } from './diff-utils'

function C(x: number, y: number, heading: DiffCluster['heading'] = 'STATIONARY', dx = 0, dy = 0): DiffCluster {
  return {
    x,
    y,
    size: 1,
    bbox: [x, y, x, y],
    pixels: [],
    heading,
    dx,
    dy,
  }
}

describe('getClusters', () => {
  it('returns empty for null/empty points', () => {
    expect(getClusters([])).toEqual([])
    expect(getClusters(null as unknown as Array<[number, number]>)).toEqual([])
  })

  it('single point cluster', () => {
    const c = getClusters([[5, 5]])
    expect(c).toHaveLength(1)
    expect(c[0].size).toBe(1)
    expect(c[0].x).toBe(5)
    expect(c[0].y).toBe(5)
    expect(c[0].heading).toBe('STATIONARY')
    expect(c[0].bbox).toEqual([5, 5, 5, 5])
  })

  it('groups nearby points', () => {
    const c = getClusters([[0, 0], [1, 1], [10, 10]], 2.5)
    expect(c).toHaveLength(2)
    expect(c[0].size).toBe(2)
  })

  it('does not group distant points', () => {
    const c = getClusters([[0, 0], [100, 100]], 2.5)
    expect(c).toHaveLength(2)
  })

  it('sorts descending by size', () => {
    const c = getClusters([[0, 0], [1, 0], [2, 0], [50, 50]])
    expect(c[0].size).toBeGreaterThanOrEqual(c[1].size)
  })

  it('cellSize min 1 when threshold < 1', () => {
    const c = getClusters([[0, 0], [0.5, 0.5]], 1.5)
    expect(c).toHaveLength(1)
  })
})

describe('euclidean', () => {
  it('null/undefined returns Infinity', () => {
    expect(euclidean(null, [1, 2])).toBe(Infinity)
    expect(euclidean(undefined, [1, 2])).toBe(Infinity)
    expect(euclidean([1, 2], null)).toBe(Infinity)
  })

  it('array points', () => {
    expect(euclidean([0, 0], [3, 4])).toBe(5)
  })

  it('object points', () => {
    expect(euclidean({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('missing coords default 0', () => {
    expect(euclidean({}, {})).toBe(0)
    expect(euclidean({ x: 5 }, {})).toBe(5)
  })
})

describe('trackTrajectories', () => {
  it('empty curr returns []', () => {
    expect(trackTrajectories([], [])).toEqual([])
    const prev = [C(0, 0)]
    expect(trackTrajectories(prev, [])).toEqual([])
  })

  it('no prev returns stationary copies', () => {
    const curr = [C(1, 2)]
    const r = trackTrajectories([], curr)
    expect(r[0].dx).toBe(0)
    expect(r[0].dy).toBe(0)
    expect(r[0].heading).toBe('STATIONARY')
  })

  it('null prev/curr handled', () => {
    expect(trackTrajectories(null as unknown as DiffCluster[], null as unknown as DiffCluster[])).toEqual([])
  })

  it('matches and assigns headings', () => {
    const prev = [C(0, 0)]
    const curr = [C(5, 0)]
    const r = trackTrajectories(prev, curr, 10)
    expect(r[0].heading).toBe('RIGHT')
    expect(r[0].dx).toBe(5)
  })

  it('lEFT heading', () => {
    const prev = [C(5, 0)]
    const curr = [C(0, 0)]
    const r = trackTrajectories(prev, curr, 10)
    expect(r[0].heading).toBe('LEFT')
  })

  it('dOWN heading', () => {
    const prev = [C(0, 0)]
    const curr = [C(0, 5)]
    const r = trackTrajectories(prev, curr, 10)
    expect(r[0].heading).toBe('DOWN')
  })

  it('uP heading', () => {
    const prev = [C(0, 5)]
    const curr = [C(0, 0)]
    const r = trackTrajectories(prev, curr, 10)
    expect(r[0].heading).toBe('UP')
  })

  it('stationary small movement', () => {
    const prev = [C(0, 0)]
    const curr = [{ ...C(0, 0), x: 0.1 }]
    const r = trackTrajectories(prev, curr, 10)
    expect(r[0].heading).toBe('STATIONARY')
  })

  it('no match beyond threshold returns stationary', () => {
    const prev = [C(0, 0)]
    const curr = [C(100, 100)]
    const r = trackTrajectories(prev, curr, 8)
    expect(r[0].heading).toBe('STATIONARY')
  })

  it('tie greedy', () => {
    const prev = [C(0, 0), C(1, 0)]
    const curr = [C(0.5, 0)]
    const r = trackTrajectories(prev, curr, 10)
    expect(r).toHaveLength(1)
  })
})

describe('correlateInput', () => {
  it('empty clusters returns null', () => {
    expect(correlateInput([], [])).toBeNull()
    expect(correlateInput(null as unknown as DiffCluster[], [])).toBeNull()
  })

  it('no keys returns moving or first', () => {
    const c = [C(0, 0, 'STATIONARY'), C(1, 0, 'RIGHT')]
    expect(correlateInput(c, [])).toBe(c[1])
    const allStationary = [C(0, 0, 'STATIONARY')]
    expect(correlateInput(allStationary, [])).toBe(allStationary[0])
  })

  it('null keys treated as none', () => {
    const c = [C(0, 0)]
    expect(correlateInput(c, null as unknown as string[])).toBe(c[0])
  })

  it('with keys scores and returns best', () => {
    const c = [C(0, 0, 'UP', 0, -1)]
    const r = correlateInput(c, ['ArrowUp'])
    expect(r).toBe(c[0])
  })

  it('bestScore <=0 returns clusters[0]', () => {
    const c = [C(0, 0, 'STATIONARY', 0, 0)]
    const r = correlateInput(c, ['ArrowUp'])
    expect(r).toBe(c[0])
  })

  it('various key aliases', () => {
    const c = [C(0, 0, 'DOWN', 0, 1)]
    expect(correlateInput(c, ['s'])).toBe(c[0])
    expect(correlateInput(c, ['S'])).toBe(c[0])
    expect(correlateInput(c, ['ArrowDown'])).toBe(c[0])
  })

  it('left/right aliases', () => {
    const c = [C(0, 0, 'LEFT', -1, 0)]
    expect(correlateInput(c, ['a'])).toBe(c[0])
    expect(correlateInput(c, ['A'])).toBe(c[0])
    expect(correlateInput(c, ['ArrowLeft'])).toBe(c[0])
    const c2 = [C(0, 0, 'RIGHT', 1, 0)]
    expect(correlateInput(c2, ['d'])).toBe(c2[0])
    expect(correlateInput(c2, ['D'])).toBe(c2[0])
    expect(correlateInput(c2, ['ArrowRight'])).toBe(c2[0])
  })

  it('opposing penalty', () => {
    const c = [C(0, 0, 'DOWN', 0, 1)]
    const r = correlateInput(c, ['w'])
    expect(r).toBe(c[0])
  })

  it('opposing penalties down/left/right', () => {
    const c1 = [C(0, 0, 'UP', 0, -1)]
    expect(correlateInput(c1, ['ArrowDown'])).toBe(c1[0])
    const c2 = [C(0, 0, 'RIGHT', 1, 0)]
    expect(correlateInput(c2, ['ArrowLeft'])).toBe(c2[0])
    const c3 = [C(0, 0, 'LEFT', -1, 0)]
    expect(correlateInput(c3, ['ArrowRight'])).toBe(c3[0])
  })
})

describe('detectLossBurst', () => {
  it('null returns false', () => {
    expect(detectLossBurst(null)).toBe(false)
    expect(detectLossBurst(undefined)).toBe(false)
  })

  it('below threshold false', () => {
    expect(detectLossBurst({ added: [[1, 1]], removed: [] }, 35)).toBe(false)
  })

  it('above threshold true', () => {
    const added = Array.from({ length: 40 }, (_, i) => [i, 0] as [number, number])
    expect(detectLossBurst({ added, removed: [] }, 35)).toBe(true)
  })

  it('missing arrays treated as 0', () => {
    expect(detectLossBurst({}, 35)).toBe(false)
    expect(detectLossBurst({ added: undefined, removed: undefined })).toBe(false)
  })

  it('sum added+removed', () => {
    const a = Array.from({ length: 20 }, (_, i) => [i, 0] as [number, number])
    const r = Array.from({ length: 20 }, (_, i) => [i, 1] as [number, number])
    expect(detectLossBurst({ added: a, removed: r }, 35)).toBe(true)
  })
})
