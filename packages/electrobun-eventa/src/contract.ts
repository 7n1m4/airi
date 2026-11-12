/**
 * Wire + contract types for the Electrobun eventa transport.
 *
 * `ElectrobunEventaFrame` is eventa's electron payload envelope verbatim —
 * `{ id, type, payload }` as produced by `@moeru/eventa`'s `generatePayload` —
 * so a payload captured on Electron replays here unchanged.
 */

import type { Eventa } from '@moeru/eventa'

import { defineEventa } from '@moeru/eventa'

/** The single RPC request/message name eventa traffic rides on. */
export const EVENTA_EMIT = 'eventa:emit'

/**
 * Emitted by both adapters when a frame cannot be put on the wire or parsed.
 *
 * The electron adapters share one anonymous `defineEventa()` for this; eventa
 * does not export it, so this is this package's own stable stand-in.
 */
export const errorEvent: Eventa<{ error: unknown }> = defineEventa<{ error: unknown }>('eventa:electrobun:error')

/** eventa's electron payload envelope, as it appears on the wire. */
export interface ElectrobunEventaPayload {
  id: string
  type: string
  _flowDirection?: 'inbound' | 'outbound'
  body?: unknown
  /**
   * Webview id of the emitting side. Electron resolves the sender from the
   * transport; an Electrobun RPC packet carries no sender identity, so it rides
   * in-band.
   */
  from?: number
  invokeType?: number
}

/** eventa's envelope plus its request id: `generatePayload(event.id, event)`. */
export interface ElectrobunEventaFrame {
  id: string
  type: string
  payload: ElectrobunEventaPayload
}

/** A frame as received: unvalidated, straight off the RPC wire. */
export type ElectrobunEventaInbound = Partial<ElectrobunEventaFrame>

/** Stands in for Electron's `IpcMainEvent` / `IpcRendererEvent`. */
export interface ElectrobunEventaRaw {
  /** `BrowserView.id` of the view that produced the event. */
  viewId: number
}

export interface ElectrobunEventaEmitOptions {
  raw: ElectrobunEventaRaw
}

/** Narrow an unvalidated RPC frame before reading its type/body. */
export function isElectrobunEventaFrame(value: unknown): value is ElectrobunEventaFrame {
  if (value == null || typeof value !== 'object')
    return false
  const frame = value as Partial<ElectrobunEventaFrame>
  return typeof frame.type === 'string' && frame.payload != null && typeof frame.payload === 'object'
}

/**
 * Errors cross the RPC boundary as JSON, and `JSON.stringify(new Error(...))` is
 * `{}` — the message would be lost. eventa puts errors in the invoke payload
 * (`content: { error }` on a receive-error, `content` itself on an abort), so
 * those two positions are encoded here and revived on the receiving side.
 */
interface SerializedError {
  __eventaError: true
  name: string
  message: string
  stack?: string
}

function isSerializedError(value: unknown): value is SerializedError {
  return typeof value === 'object' && value !== null && (value as { __eventaError?: unknown }).__eventaError === true
}

function toSerializedError(error: Error): SerializedError {
  return { __eventaError: true, name: error.name, message: error.message, stack: error.stack }
}

function encodeContent(content: unknown): unknown {
  if (content instanceof Error)
    return toSerializedError(content)
  if (content != null && typeof content === 'object' && !Array.isArray(content) && 'error' in content) {
    const record = content as { error?: unknown }
    if (record.error instanceof Error)
      return { ...record, error: toSerializedError(record.error) }
  }
  return content
}

function reviveContent(content: unknown): unknown {
  if (isSerializedError(content)) {
    const revived = new Error(content.message)
    revived.name = content.name
    revived.stack = content.stack
    return revived
  }
  if (content != null && typeof content === 'object' && !Array.isArray(content) && 'error' in content) {
    const record = content as { error?: unknown }
    if (isSerializedError(record.error))
      return { ...record, error: reviveContent(record.error) }
  }
  return content
}

function mapContent(body: unknown, map: (content: unknown) => unknown): unknown {
  if (body == null || typeof body !== 'object')
    return body
  const record = body as { content?: unknown }
  if (!('content' in record))
    return body
  return { ...record, content: map(record.content) }
}

/** Encode the error positions of an eventa invoke body for the JSON wire. */
export function encodeErrorBody(body: unknown): unknown {
  return mapContent(body, encodeContent)
}

/** Inverse of {@link encodeErrorBody}. */
export function decodeErrorBody(body: unknown): unknown {
  return mapContent(body, reviveContent)
}
