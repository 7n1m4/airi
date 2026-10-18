import { describe, expect, it, vi } from 'vitest'

import { useAsyncState } from './use-async-state'

describe('useAsyncState', () => {
  it('initializes with undefined state, not loading, no error', () => {
    const fn = vi.fn(async () => 42)
    const { state, isLoading, error } = useAsyncState(fn)
    expect(state.value).toBeUndefined()
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('does not execute immediately unless immediate option is true', async () => {
    const fn = vi.fn(async () => 7)
    const { state, isLoading } = useAsyncState(fn, { immediate: false })
    expect(fn).not.toHaveBeenCalled()
    expect(state.value).toBeUndefined()
    expect(isLoading.value).toBe(false)
  })

  it('executes immediately when immediate is true', async () => {
    const fn = vi.fn(async () => 7)
    const { state, isLoading } = useAsyncState(fn, { immediate: true })
    // loading flips synchronously before await
    expect(isLoading.value).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(fn).toHaveBeenCalled()
    expect(state.value).toBe(7)
    expect(isLoading.value).toBe(false)
  })

  it('execute sets loading, resolves state on success', async () => {
    const fn = vi.fn(async () => 'result')
    const { state, isLoading, error, execute } = useAsyncState(fn)
    const promise = execute()
    expect(isLoading.value).toBe(true)
    expect(error.value).toBeNull()
    await promise
    expect(state.value).toBe('result')
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('execute captures error on failure and clears loading', async () => {
    const err = new Error('boom')
    const fn = vi.fn(async () => { throw err })
    const { state, isLoading, error, execute } = useAsyncState(fn)
    await execute()
    expect(state.value).toBeUndefined()
    expect(isLoading.value).toBe(false)
    expect(error.value).toBe(err)
  })

  it('clears previous error on subsequent execute', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('ok')
    const { error, execute, state } = useAsyncState(fn)
    await execute()
    expect(error.value).toBeInstanceOf(Error)
    await execute()
    expect(error.value).toBeNull()
    expect(state.value).toBe('ok')
  })

  it('handles undefined options', async () => {
    const fn = async () => 1
    const { state, execute } = useAsyncState(fn, undefined)
    await execute()
    expect(state.value).toBe(1)
  })
})
