import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { useDatingSimStore } from '../dating-sim'

export interface PositionScale {
  x: number
  y: number
  scale: number
}

export const usePositioningStore = defineStore('positioning', () => {
  const positions = useLocalStorageManualReset<Record<string, PositionScale>>('settings/positioning/models', {})

  function getPosition(key: string): PositionScale {
    try {
      const datingSimStore = useDatingSimStore()
      if (datingSimStore.enabled) {
        return positions.value[`${key}:dating-sim`] || { x: 0, y: 0, scale: 1 }
      }
    }
    catch {
      // Fallback if datingSimStore is not yet initialized or loaded
    }
    return positions.value[key] || { x: 0, y: 0, scale: 1 }
  }

  function setPosition(key: string, data: PositionScale) {
    try {
      const datingSimStore = useDatingSimStore()
      if (datingSimStore.enabled) {
        positions.value = { ...positions.value, [`${key}:dating-sim`]: data }
        return
      }
    }
    catch {
      // Fallback
    }
    positions.value = { ...positions.value, [key]: data }
  }

  function resetState() {
    positions.reset()
  }

  return {
    positions,
    getPosition,
    setPosition,
    resetState,
  }
})
