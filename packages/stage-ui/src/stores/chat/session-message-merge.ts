import type { ChatHistoryItem } from '../../types/chat'

export function extractMessageContent(message: ChatHistoryItem) {
  if (typeof message.content === 'string')
    return message.content

  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (typeof part === 'string')
        return part
      if (part && typeof part === 'object' && 'text' in part)
        return String(part.text ?? '')
      return ''
    }).join('')
  }

  return ''
}

/**
 * Union two id-keyed entity lists: everything in `current` (in-memory, wins on
 * id clash), plus stored items whose ids are neither overlaid nor tombstoned in
 * `removedIds` (persist paths pass locally deleted ids so a re-read cannot
 * resurrect them). Stored items without an id are carried over as-is since
 * there is nothing to dedupe them against.
 */
export function mergeById<T extends { id?: string | number }>(stored: T[] | null | undefined, current: T[], removedIds?: Set<string>): T[] {
  const currentIds = new Set(current.map(item => item?.id).filter(id => id !== undefined && id !== null).map(String))
  const storedOnly = (stored ?? []).filter(item => item && (item.id === undefined || item.id === null
    || (!removedIds?.has(String(item.id)) && !currentIds.has(String(item.id)))))
  return [...current, ...storedOnly]
}

function getMessageFingerprint(message: ChatHistoryItem) {
  return [
    message.role,
    message.createdAt ?? '',
    extractMessageContent(message),
  ].join('\u001F')
}

export function mergeLoadedSessionMessages(storedMessages: ChatHistoryItem[], currentMessages: ChatHistoryItem[]) {
  if (currentMessages.length === 0)
    return storedMessages

  const storedIds = new Set(storedMessages.map(m => m.id).filter(Boolean))
  const storedFingerprints = new Set(storedMessages.map(getMessageFingerprint))

  // Index stored messages by role+content so the 2s-jitter check stays O(1) per new message.
  const storedTimesByRoleContent = new Map<string, number[]>()
  for (const stored of storedMessages) {
    const content = extractMessageContent(stored)
    if (!content.trim())
      continue
    const key = `${stored.role}\u001F${content}`
    const storedTime = stored.createdAt || 0
    if (!storedTime)
      continue
    const times = storedTimesByRoleContent.get(key)
    if (times)
      times.push(storedTime)
    else
      storedTimesByRoleContent.set(key, [storedTime])
  }

  const uniqueNewMessages = currentMessages.filter((message) => {
    if (message.id && storedIds.has(message.id))
      return false
    const fingerprint = getMessageFingerprint(message)
    if (storedFingerprints.has(fingerprint))
      return false

    // Jitter & ID-mismatch tolerance: if storedMessages already contains an entry with the same role and non-empty content
    // whose createdAt timestamp is within 2 seconds, treat it as the same message
    const content = extractMessageContent(message)
    if (content.trim()) {
      const msgTime = message.createdAt || 0
      const times = msgTime ? storedTimesByRoleContent.get(`${message.role}\u001F${content}`) : undefined
      if (times?.some(storedTime => Math.abs(msgTime - storedTime) <= 2000))
        return false
    }

    return true
  })

  if (uniqueNewMessages.length === 0)
    return storedMessages

  // If storedMessages already has a system message, avoid adding redundant ones from uniqueNewMessages
  // unless they are significantly different (e.g. environmental context).
  const hasStoredPersona = storedMessages.some(m => m.role === 'system' && !extractMessageContent(m).includes('[ENVIRONMENTAL AWARENESS]'))

  const finalNewMessages = uniqueNewMessages.filter((m) => {
    if (m.role === 'system') {
      const content = extractMessageContent(m)
      const isContext = content.includes('[ENVIRONMENTAL AWARENESS]') || content.includes('contextual information')
      if (!isContext && hasStoredPersona) {
        // Avoid duplicate persona blocks during merge
        return false
      }
    }
    return true
  })

  return [...storedMessages, ...finalNewMessages]
}
