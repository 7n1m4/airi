import type { RouteTargetExpression, WebSocketEvent } from '@proj-airi/server-shared/types'

import type { AuthenticatedPeer } from '../types'

import { matchesDestinations, matchesLabelSelectors } from './route/match-expression'

export type RouteDecision
  = | { type: 'drop' }
    | { type: 'broadcast' }
    | { type: 'targets', targetIds: Set<string> }

export interface RoutingPolicy {
  allowPlugins?: string[]
  denyPlugins?: string[]
  allowLabels?: string[]
  denyLabels?: string[]
}

export interface RouteContext {
  event: WebSocketEvent
  fromPeer: AuthenticatedPeer
  peers: Map<string, AuthenticatedPeer>
  destinations?: Array<string | RouteTargetExpression>
}

export type RouteMiddleware = (context: RouteContext) => RouteDecision | void

function getPeerLabels(peer: AuthenticatedPeer) {
  return {
    ...peer.identity?.plugin?.labels,
    ...peer.identity?.labels,
  }
}

// Devtools bypass is operator-configured, never self-claimed: AIRI_DEVTOOLS_PEERS
// is a comma-separated list of peer names and/or peer ids allowed to request a
// route.bypass. Unset or empty means no devtools bypass at all.
export function isDevtoolsPeer(peer: AuthenticatedPeer) {
  const allowed = (process.env.AIRI_DEVTOOLS_PEERS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

  if (allowed.length === 0)
    return false

  return allowed.includes(peer.name) || allowed.includes(peer.peer.id)
}

export function peerMatchesPolicy(peer: AuthenticatedPeer, policy: RoutingPolicy) {
  const pluginId = peer.identity?.plugin?.id ?? ''

  if (policy.allowPlugins?.length && !policy.allowPlugins.includes(pluginId)) {
    return false
  }

  if (policy.denyPlugins?.length && policy.denyPlugins.includes(pluginId)) {
    return false
  }

  const labels = getPeerLabels(peer)
  if (policy.allowLabels?.length && !matchesLabelSelectors(policy.allowLabels, labels)) {
    return false
  }

  if (policy.denyLabels?.length && matchesLabelSelectors(policy.denyLabels, labels)) {
    return false
  }

  return true
}

// NOTICE: route.bypass never skips this middleware — it only lets index.ts skip
// destination collection, so policy still applies to bypassed events.
export function createPolicyMiddleware(policy: RoutingPolicy): RouteMiddleware {
  return ({ peers }) => {
    const targetIds = new Set<string>()
    for (const [id, peer] of peers.entries()) {
      if (!peer.authenticated)
        continue
      if (peerMatchesPolicy(peer, policy)) {
        targetIds.add(id)
      }
    }

    return { type: 'targets', targetIds }
  }
}

export function collectDestinations(event: WebSocketEvent | (Omit<WebSocketEvent, 'metadata'> & Partial<Pick<WebSocketEvent, 'metadata'>>)) {
  if (event.route && 'destinations' in event.route) {
    return event.route.destinations
  }

  const data = event.data as { destinations?: Array<string | RouteTargetExpression> } | undefined
  if (data?.destinations?.length) {
    return data.destinations
  }

  return undefined
}

export { matchesDestinations }
