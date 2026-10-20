import type { ProgressPayload } from '../libs/inference/protocol'

import { describe, expect, it } from 'vitest'

import { removeInferenceStatus, updateInferenceStatus, useInferenceStatus } from './use-inference-status'

describe('use-inference-status', () => {
  it('creates status with defaults when missing', () => {
    updateInferenceStatus('m1', { state: 'downloading' })
    const { models } = useInferenceStatus()
    const m = models.value.find(x => x.modelId === 'm1')
    expect(m).toBeDefined()
    expect(m!.state).toBe('downloading')
    expect(m!.device).toBe('unknown')
  })

  it('updates existing status in place', () => {
    updateInferenceStatus('m2', { state: 'idle', device: 'cpu' })
    const progress: ProgressPayload = { percent: 100 } as ProgressPayload
    updateInferenceStatus('m2', { state: 'ready', progress })
    const { models } = useInferenceStatus()
    const m = models.value.find(x => x.modelId === 'm2')!
    expect(m.state).toBe('ready')
    expect(m.device).toBe('cpu')
    expect(m.progress?.percent).toBe(100)
  })

  it('removes status', () => {
    updateInferenceStatus('m3', { state: 'idle' })
    removeInferenceStatus('m3')
    const { models } = useInferenceStatus()
    expect(models.value.find(x => x.modelId === 'm3')).toBeUndefined()
  })

  it('computes isAnyLoading and totalProgress', () => {
    updateInferenceStatus('a', { state: 'downloading', progress: { percent: 50 } as ProgressPayload })
    updateInferenceStatus('b', { state: 'ready' })
    const { isAnyLoading } = useInferenceStatus()
    expect(isAnyLoading.value).toBe(true)
  })
  it('returns 100 totalProgress when no models are loading', () => {
    updateInferenceStatus('a', { state: 'ready' })
    updateInferenceStatus('b', { state: 'ready' })
    updateInferenceStatus('m1', { state: 'ready' })
    updateInferenceStatus('m2', { state: 'ready' })
    const { totalProgress, isAnyLoading } = useInferenceStatus()
    expect(isAnyLoading.value).toBe(false)
    expect(totalProgress.value).toBe(100)
  })

  it('clamps negative progress to zero in totalProgress', () => {
    updateInferenceStatus('d', { state: 'downloading', progress: { percent: -5 } as ProgressPayload })
    const { totalProgress } = useInferenceStatus()
    expect(totalProgress.value).toBe(0)
  })
  it('handles downloading model without progress', () => {
    updateInferenceStatus('e', { state: 'downloading' })
    const { totalProgress } = useInferenceStatus()
    expect(totalProgress.value).toBe(0)
  })
})
