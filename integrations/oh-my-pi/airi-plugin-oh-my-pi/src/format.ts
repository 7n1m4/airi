import type { WebSocketEventOf } from '@proj-airi/server-shared/types'

export type SparkNotifyData = WebSocketEventOf<'spark:notify'>['data']

export function basenamePath(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

export function extractText(content: string | Array<{ type: string, text?: string }>): string {
  if (typeof content === 'string')
    return content
  return content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n\n')
}

export interface PromptEvent { text: string, textRaw: string, overrides: { messagePrefix: string } }

export function buildPromptEvent(prompt: string, cwd: string, modelId?: string): PromptEvent {
  const messagePrefix = `[oh-my-pi · ${basenamePath(cwd)}${modelId ? ` · ${modelId}` : ''}] `
  return { text: prompt, textRaw: prompt, overrides: { messagePrefix } }
}

export interface TurnSummaryOpts { cwd: string, messages: Array<{ role: string, content: unknown }> }

export function buildTurnSummaryNotify(opts: TurnSummaryOpts): SparkNotifyData | null {
  const texts = opts.messages
    .filter(m => m.role === 'assistant')
    .map(m => extractText(m.content as string | Array<{ type: string, text?: string }>))
    .filter(t => t.trim() !== '')
  if (texts.length === 0)
    return null
  const last = texts[texts.length - 1]
  const note = last.length > 400 ? `${last.slice(0, 400)}…` : last
  return {
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    kind: 'ping',
    urgency: 'later',
    headline: `oh-my-pi finished working in ${basenamePath(opts.cwd)}`,
    note,
    // NOTICE: destinations use the exact plain peer names (no 'plugin:'/'module:' prefix).
    // (1) No production peer is named 'character' — the character orchestrator
    //     listens on the shared stage client (packages/stage-ui/src/stores/mods/api/channel-server.ts:142),
    //     whose announced names are 'proj-airi:stage-web' / 'proj-airi:stage-tamagotchi'.
    // (2) Prefixed forms ('plugin:<id>', 'module:<name>') previously truncated at the second
    //     colon in packages/server-runtime/src/middlewares/route/match-expression.ts; that
    //     prefix-parsing was fixed in this change (split on first colon only). Plain peer
    //     names are still used because the character orchestrator listens on the shared stage
    //     client, and they match peer.name directly.
    destinations: ['proj-airi:stage-web', 'proj-airi:stage-tamagotchi'],
  }
}
