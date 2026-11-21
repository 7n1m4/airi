import type { SettingsTopology, TopologyTransition } from './types'

export { resolvePath, resolvePathFromRoute, resolveSettingsBackRoute } from '@proj-anima/stage-ui/constants'

/**
 * Classifies the semantic navigation transition delta between previous path and next path.
 */
export function classifyTransition(prevPath: string[], nextPath: string[]): TopologyTransition {
  if (!prevPath || prevPath.length === 0) {
    return { type: 'initial', nextPath }
  }

  if (!nextPath || nextPath.length === 0) {
    return { type: 'unresolved' }
  }

  if (prevPath.join('/') === nextPath.join('/')) {
    return { type: 'initial', nextPath }
  }

  // Find length of common prefix
  let commonDepth = 0
  const minLen = Math.min(prevPath.length, nextPath.length)
  while (commonDepth < minLen && prevPath[commonDepth] === nextPath[commonDepth]) {
    commonDepth++
  }

  // Sibling transition: same parent, same path length, 1 segment changed at end
  if (commonDepth === prevPath.length - 1 && nextPath.length === prevPath.length) {
    return {
      type: 'sibling',
      commonDepth,
      from: prevPath[prevPath.length - 1],
      to: nextPath[nextPath.length - 1],
    }
  }

  // Descend: nextPath extends prevPath
  if (commonDepth === prevPath.length && nextPath.length > prevPath.length) {
    return {
      type: 'descend',
      commonDepth,
      added: nextPath.slice(commonDepth),
    }
  }

  // Ascend: nextPath is ancestor prefix of prevPath
  if (commonDepth === nextPath.length && prevPath.length > nextPath.length) {
    return {
      type: 'ascend',
      commonDepth,
      removed: prevPath.slice(commonDepth),
    }
  }

  // Branch switch: diverge at commonDepth
  return {
    type: 'branch',
    commonDepth,
    removed: prevPath.slice(commonDepth),
    added: nextPath.slice(commonDepth),
  }
}

/**
 * Gets sibling node IDs for a given node (including itself), in order.
 */
export function getSiblings(topology: SettingsTopology, nodeId: string): string[] {
  const node = topology.nodesById[nodeId]
  if (!node)
    return []
  if (node.parentId === null) {
    return [node.id] // Root has no siblings
  }
  const parent = topology.nodesById[node.parentId]
  return parent ? [...parent.children] : [node.id]
}

/**
 * Gets sibling index and total count for a given node.
 */
export function getSiblingPosition(topology: SettingsTopology, nodeId: string): { index: number, total: number } {
  const siblings = getSiblings(topology, nodeId)
  const index = siblings.indexOf(nodeId)
  return {
    index: index >= 0 ? index : 0,
    total: siblings.length,
  }
}
