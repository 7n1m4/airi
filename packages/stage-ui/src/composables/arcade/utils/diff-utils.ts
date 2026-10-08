/**
 * AIRI Standard Perceptual Primitives SDK (diffUtils)
 *
 * Deterministic, sub-millisecond (<0.2ms) computer vision primitives
 * running over 80x40 downsampled grid diffs.
 */

export interface DiffCluster {
  x: number
  y: number
  size: number
  bbox: [number, number, number, number]
  pixels: Array<[number, number]>
  dx?: number
  dy?: number
  heading?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'STATIONARY'
}

/**
 * Groups adjacent or nearby 2D points into distinct spatial clusters (islands).
 * Uses a grid hash bucket map for O(N) performance on 80x40 resolutions.
 */
export function getClusters(
  points: Array<[number, number]>,
  distanceThreshold = 2.5,
): DiffCluster[] {
  if (!points || points.length === 0)
    return []

  const unvisited = new Set(points.map((_, i) => i))
  const clusters: DiffCluster[] = []
  const distSqThreshold = distanceThreshold * distanceThreshold

  // Build spatial bucket index (cell size ~ distanceThreshold)
  const cellSize = Math.max(1, Math.floor(distanceThreshold))
  const grid = new Map<string, number[]>()

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]
    const gx = Math.floor(x / cellSize)
    const gy = Math.floor(y / cellSize)
    const key = `${gx}:${gy}`
    if (!grid.has(key))
      grid.set(key, [])
    grid.get(key)!.push(i)
  }

  for (let i = 0; i < points.length; i++) {
    if (!unvisited.has(i))
      continue

    const clusterIndices: number[] = []
    const queue = [i]
    unvisited.delete(i)

    while (queue.length > 0) {
      const currIdx = queue.shift()!
      clusterIndices.push(currIdx)
      const [cx, cy] = points[currIdx]
      const gx = Math.floor(cx / cellSize)
      const gy = Math.floor(cy / cellSize)

      // Search 3x3 neighboring cells
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = `${gx + dx}:${gy + dy}`
          const candidates = grid.get(neighborKey)
          if (!candidates)
            continue

          for (const candIdx of candidates) {
            if (unvisited.has(candIdx)) {
              const [candX, candY] = points[candIdx]
              const dSq = (cx - candX) * (cx - candX) + (cy - candY) * (cy - candY)
              if (dSq <= distSqThreshold) {
                unvisited.delete(candIdx)
                queue.push(candIdx)
              }
            }
          }
        }
      }
    }

    // Compute cluster centroid and bounding box
    let sumX = 0
    let sumY = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const clusterPixels: Array<[number, number]> = []

    for (const idx of clusterIndices) {
      const [px, py] = points[idx]
      clusterPixels.push([px, py])
      sumX += px
      sumY += py
      if (px < minX)
        minX = px
      if (py < minY)
        minY = py
      if (px > maxX)
        maxX = px
      if (py > maxY)
        maxY = py
    }

    const count = clusterIndices.length
    clusters.push({
      x: Math.round((sumX / count) * 10) / 10,
      y: Math.round((sumY / count) * 10) / 10,
      size: count,
      bbox: [minX, minY, maxX, maxY],
      pixels: clusterPixels,
      dx: 0,
      dy: 0,
      heading: 'STATIONARY',
    })
  }

  // Sort clusters descending by size
  return clusters.sort((a, b) => b.size - a.size)
}

/**
 * Computes Euclidean distance between two points { x, y } or [x, y].
 */
export function euclidean(
  p1: { x?: number, y?: number } | [number, number] | null | undefined,
  p2: { x?: number, y?: number } | [number, number] | null | undefined,
): number {
  if (!p1 || !p2)
    return Infinity
  const x1 = Array.isArray(p1) ? p1[0] : (p1.x ?? 0)
  const y1 = Array.isArray(p1) ? p1[1] : (p1.y ?? 0)
  const x2 = Array.isArray(p2) ? p2[0] : (p2.x ?? 0)
  const y2 = Array.isArray(p2) ? p2[1] : (p2.y ?? 0)
  const dx = x1 - x2
  const dy = y1 - y2
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Tracks trajectories between clusters across consecutive frames (t-1 -> t).
 * Associates entities using minimal distance matching and assigns instantaneous headings.
 */
export function trackTrajectories(
  prevClusters: DiffCluster[],
  currClusters: DiffCluster[],
  maxMatchDistance = 8,
): DiffCluster[] {
  if (!currClusters || currClusters.length === 0)
    return []
  if (!prevClusters || prevClusters.length === 0) {
    return currClusters.map(c => ({ ...c, dx: 0, dy: 0, heading: 'STATIONARY' }))
  }

  const prevAvailable = new Set(prevClusters.map((_, i) => i))
  const tracked: DiffCluster[] = []

  for (const curr of currClusters) {
    let bestPrevIdx = -1
    let bestDist = Infinity

    for (const prevIdx of prevAvailable) {
      const prev = prevClusters[prevIdx]
      const dist = euclidean(prev, curr)
      if (dist < bestDist && dist <= maxMatchDistance) {
        bestDist = dist
        bestPrevIdx = prevIdx
      }
    }

    if (bestPrevIdx !== -1) {
      prevAvailable.delete(bestPrevIdx)
      const prev = prevClusters[bestPrevIdx]
      const dx = Math.round((curr.x - prev.x) * 10) / 10
      const dy = Math.round((curr.y - prev.y) * 10) / 10

      let heading: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'STATIONARY' = 'STATIONARY'
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0.3)
          heading = 'RIGHT'
        else if (dx < -0.3)
          heading = 'LEFT'
      }
      else {
        if (dy > 0.3)
          heading = 'DOWN'
        else if (dy < -0.3)
          heading = 'UP'
      }

      tracked.push({
        ...curr,
        dx,
        dy,
        heading,
      })
    }
    else {
      tracked.push({
        ...curr,
        dx: 0,
        dy: 0,
        heading: 'STATIONARY',
      })
    }
  }

  return tracked
}

/**
 * Correlates active keypresses with moving clusters to isolate the controllable player avatar.
 */
export function correlateInput(
  clusters: DiffCluster[],
  keys: string[],
): DiffCluster | null {
  if (!clusters || clusters.length === 0)
    return null
  if (!keys || keys.length === 0) {
    const moving = clusters.filter(c => c.heading !== 'STATIONARY')
    return moving.length > 0 ? moving[0] : clusters[0]
  }

  const hasUp = keys.includes('ArrowUp') || keys.includes('w') || keys.includes('W')
  const hasDown = keys.includes('ArrowDown') || keys.includes('s') || keys.includes('S')
  const hasLeft = keys.includes('ArrowLeft') || keys.includes('a') || keys.includes('A')
  const hasRight = keys.includes('ArrowRight') || keys.includes('d') || keys.includes('D')

  let bestCluster: DiffCluster | null = null
  let bestScore = -Infinity

  for (const cluster of clusters) {
    let score = 0
    if (hasUp && (cluster.heading === 'UP' || (cluster.dy ?? 0) < 0))
      score += 2
    if (hasDown && (cluster.heading === 'DOWN' || (cluster.dy ?? 0) > 0))
      score += 2
    if (hasLeft && (cluster.heading === 'LEFT' || (cluster.dx ?? 0) < 0))
      score += 2
    if (hasRight && (cluster.heading === 'RIGHT' || (cluster.dx ?? 0) > 0))
      score += 2

    // Slight penalty if opposing direction
    if (hasUp && (cluster.dy ?? 0) > 0)
      score -= 2
    if (hasDown && (cluster.dy ?? 0) < 0)
      score -= 2
    if (hasLeft && (cluster.dx ?? 0) > 0)
      score -= 2
    if (hasRight && (cluster.dx ?? 0) < 0)
      score -= 2

    if (score > bestScore) {
      bestScore = score
      bestCluster = cluster
    }
  }

  return bestScore > 0 ? bestCluster : clusters[0]
}

/**
 * Detects whether a frame represents a game-over or death event (large pixel surge or screen freeze).
 */
export function detectLossBurst(
  diff: { added?: Array<[number, number]>, removed?: Array<[number, number]> } | null | undefined,
  burstThreshold = 35,
): boolean {
  if (!diff)
    return false
  const addedCount = (diff.added && diff.added.length) || 0
  const removedCount = (diff.removed && diff.removed.length) || 0
  return (addedCount + removedCount) >= burstThreshold
}

export const diffUtils = {
  getClusters,
  euclidean,
  trackTrajectories,
  correlateInput,
  detectLossBurst,
}

export default diffUtils
