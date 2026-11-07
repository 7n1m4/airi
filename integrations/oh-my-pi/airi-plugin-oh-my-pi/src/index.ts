import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent'
import type { WebSocketEventOf } from '@proj-airi/server-shared/types'

import { Client } from '@proj-airi/server-sdk'

import { resolveConfig } from './config'
import { buildPromptEvent, buildTurnSummaryNotify, extractText } from './format'

export interface AiriBridgeDeps { client?: Pick<Client, 'send' | 'onEvent' | 'connect' | 'close'> }

export default function airiBridge(pi: ExtensionAPI, deps?: AiriBridgeDeps): void {
  pi.setLabel('AIRI Bridge')
  const client = deps?.client ?? new Client({ name: 'proj-airi:plugin-oh-my-pi', autoConnect: false, ...resolveConfig(), possibleEvents: ['input:text', 'spark:notify', 'output:gen-ai:chat:message'], onError: (err: unknown) => pi.logger.error(String(err)) })
  const pendingPrompts = new Map<string, number>()

  pi.on('session_start', async () => { void client.connect().catch(() => {}) })

  pi.on('before_agent_start', async (event: unknown, ctx: unknown) => {
    const ev = (event && typeof event === 'object') ? event as { reason?: unknown, prompt?: unknown } : {}
    if (ev.reason !== 'prompt' || typeof ev.prompt !== 'string' || !ev.prompt.trim())
      return
    const prompt = ev.prompt
    const ctxObj = (ctx && typeof ctx === 'object') ? ctx as { cwd?: unknown, model?: { id?: unknown } } : {}
    const modelId = typeof ctxObj.model?.id === 'string' ? ctxObj.model.id : undefined
    const cwd = (typeof ctxObj.cwd === 'string') ? ctxObj.cwd : undefined
    const data = buildPromptEvent(prompt, String(cwd ?? ''), modelId)
    if (pendingPrompts.size >= 16) {
      const oldest = pendingPrompts.keys().next().value
      if (oldest !== undefined)
        pendingPrompts.delete(oldest)
    }
    pendingPrompts.set(prompt, Date.now())
    client.send({ type: 'input:text', data })
  })

  pi.on('agent_end', async (event: unknown, ctx: unknown) => {
    const ev = (event && typeof event === 'object') ? event as { willContinue?: unknown, awaitingAsyncWork?: unknown, messages?: unknown } : {}
    if (ev.willContinue || ev.awaitingAsyncWork)
      return
    const messages = Array.isArray(ev.messages) ? ev.messages as Array<{ role: string, content: unknown }> : []
    const rawCwd = (ctx && typeof ctx === 'object' && 'cwd' in ctx) ? (ctx as { cwd?: unknown }).cwd : undefined
    const cwd = typeof rawCwd === 'string' ? rawCwd : undefined
    const data = buildTurnSummaryNotify({ cwd: String(cwd ?? ''), messages })
    if (data)
      client.send({ type: 'spark:notify', data })
  })

  client.onEvent('output:gen-ai:chat:message', (event: WebSocketEventOf<'output:gen-ai:chat:message'>) => {
    const data = (event.data && typeof event.data === 'object') ? event.data as { textRaw?: unknown, message?: { content?: unknown } } : {}
    const raw = typeof data.textRaw === 'string' ? data.textRaw : ''
    if (!raw || !pendingPrompts.has(raw))
      return
    pendingPrompts.delete(raw)
    const reply = extractText((data.message?.content ?? '') as string | Array<{ type: string, text?: string }>)
    if (!reply.trim())
      return
    void pi.sendMessage(
      { customType: 'airi-reply', content: `AIRI, on “${raw.length > 80 ? `${raw.slice(0, 80)}…` : raw}”:\n\n${reply}`, display: true, attribution: 'agent' },
      { deliverAs: 'nextTurn', triggerTurn: false },
    )
  })

  pi.on('session_shutdown', async () => { client.close() })
}
