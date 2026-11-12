import { shell } from 'electron'

// Model-authored markdown links must never reach OS scheme handlers (ms-msdt:, smb:, file:).
export function openExternalSafely(url: string): void {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  }
  catch {
    console.warn('[Main Process] [openExternalSafely] Dropped unparsable URL')
    return
  }

  if (protocol !== 'https:' && protocol !== 'http:') {
    console.warn(`[Main Process] [openExternalSafely] Dropped URL with disallowed protocol: ${protocol}`)
    return
  }

  shell.openExternal(url)
}
