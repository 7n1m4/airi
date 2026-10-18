import type { GameAction } from '../../types/arcade'

import { describe, expect, it } from 'vitest'

import { normalizePlanActions } from './use-arcade-agent'

describe('normalizePlanActions', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizePlanActions(undefined as unknown as never)).toEqual([])
    expect(normalizePlanActions(null as unknown as never)).toEqual([])
    expect(normalizePlanActions('foo' as unknown as never)).toEqual([])
  })

  it('passes through non-object and unknown actions unchanged', () => {
    const input: unknown[] = [null, 42, 'x', { type: 'wait', ms: 10 }]
    expect(normalizePlanActions(input as never)).toEqual(input)
  })

  it('normalizes click with alternative coordinate keys and clamps', () => {
    const out = normalizePlanActions([{ type: 'click', clientX: 1500, normY: -5, button: 'right' }]) as unknown as GameAction[]
    expect(out[0]).toMatchObject({ type: 'click', x: 1000, y: 0, button: 'right' })
  })

  it('normalizes click with x/y defaults', () => {
    const out = normalizePlanActions([{ type: 'click' }]) as unknown as GameAction[]
    expect(out[0]).toMatchObject({ type: 'click', x: 0, y: 0, button: 'left' })
  })

  it('normalizes drag with alternative property naming', () => {
    const out = normalizePlanActions([{
      type: 'drag',
      startX: 10,
      startY: 20,
      endX: 30,
      endY: 40,
    }]) as unknown as GameAction[]
    expect(out[0]).toMatchObject({ type: 'drag', fromX: 10, fromY: 20, toX: 30, toY: 40 })
  })

  it('normalizes drag using nested from/to objects', () => {
    const out = normalizePlanActions([{
      type: 'drag',
      from: { x: 1, y: 2 },
      to: { x: 3, y: 4 },
    }]) as unknown as GameAction[]
    expect(out[0]).toMatchObject({ type: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 })
  })

  it('clamps drag coordinates to 0..1000', () => {
    const out = normalizePlanActions([{
      type: 'drag',
      fromX: -10,
      fromY: 2000,
      toX: 500.6,
      toY: Number.NaN,
    }]) as unknown as GameAction[]
    expect(out[0]).toMatchObject({ type: 'drag', fromX: 0, fromY: 1000, toX: 501, toY: 0 })
  })

  it('handles non-finite click coordinates', () => {
    const out = normalizePlanActions([{ type: 'click', x: Infinity, y: Number.NaN }]) as unknown as GameAction[]
    expect(out[0]).toMatchObject({ type: 'click', x: 0, y: 0 })
  })
})
