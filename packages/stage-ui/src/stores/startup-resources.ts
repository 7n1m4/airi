import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type StartupResourceStatus = 'queued' | 'loading' | 'ready' | 'failed' | 'skipped'

export interface StartupResource {
  id: string
  status: StartupResourceStatus
  error?: string
}

export const useStartupResourcesStore = defineStore('startup-resources', () => {
  const resources = ref<StartupResource[]>([])

  const progress = computed(() => {
    if (resources.value.length === 0)
      return 0
    const finishedCount = resources.value.filter(
      r => r.status === 'ready' || r.status === 'skipped',
    ).length
    return Math.round((finishedCount / resources.value.length) * 100)
  })

  const failed = computed(() => resources.value.find(r => r.status === 'failed'))

  const ready = computed(() =>
    resources.value.length > 0
    && resources.value.every(r => r.status === 'ready' || r.status === 'skipped'),
  )

  function register(ids: readonly string[]) {
    if (resources.value.length > 0)
      throw new Error('Startup resources are already registered')
    if (new Set(ids).size !== ids.length)
      throw new Error('Startup resource IDs must be unique')
    resources.value = ids.map(id => ({ id, status: 'queued' as StartupResourceStatus }))
  }

  function start(id: string) {
    const item = resources.value.find(r => r.id === id)
    if (item && (item.status === 'queued' || item.status === 'failed')) {
      item.status = 'loading'
      item.error = undefined
    }
  }

  function complete(id: string) {
    const item = resources.value.find(r => r.id === id)
    if (item && item.status === 'loading') {
      item.status = 'ready'
      item.error = undefined
    }
  }

  function skip(id: string) {
    const item = resources.value.find(r => r.id === id)
    if (item && (item.status === 'queued' || item.status === 'loading' || item.status === 'failed')) {
      item.status = 'skipped'
      item.error = undefined
    }
  }

  function fail(id: string, error: unknown) {
    const item = resources.value.find(r => r.id === id)
    if (item) {
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : String(error)
    }
  }

  async function run(id: string, load: () => Promise<unknown> | unknown) {
    start(id)
    try {
      await load()
      complete(id)
    }
    catch (error) {
      fail(id, error)
      throw error
    }
  }

  function reset() {
    resources.value = []
  }

  return { resources, progress, failed, ready, register, start, complete, skip, fail, run, reset }
})
