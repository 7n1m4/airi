import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { useLive2d } from '@proj-airi/stage-ui-live2d'
import { useModelStore } from '@proj-airi/stage-ui-three'
import { nanoid } from 'nanoid'

const EXPRESSIONS_CONTEXT_ID = 'system:expressions'

/**
 * Creates a context message containing currently active visual expressions, props, and accessories.
 * This allows the LLM to know its current visual state (e.g., "Wearing Glasses", "Blushing").
 */
export function createExpressionsContext(): ContextMessage | null {
  const live2dStore = useLive2d()
  const vrmStore = useModelStore()

  const active = new Set<string>()

  // Collect from Live2D
  if (live2dStore.activeExpressions) {
    for (const [name, weight] of Object.entries(live2dStore.activeExpressions)) {
      if (typeof weight === 'number' && weight > 0.1) {
        active.add(name)
      }
    }
  }

  // Collect from VRM
  if (vrmStore.activeExpressions) {
    for (const [name, weight] of Object.entries(vrmStore.activeExpressions)) {
      if (typeof weight === 'number' && weight > 0.1) {
        active.add(name)
      }
    }
  }

  const list = Array.from(active)
  if (list.length === 0) {
    return null
  }

  return {
    id: nanoid(),
    contextId: EXPRESSIONS_CONTEXT_ID,
    source: 'expressions',
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: `Active Visual Expressions/Props: [${list.join(', ')}]`,
    createdAt: Date.now(),
  }
}
