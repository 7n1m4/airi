/**
 * Discord voice gateway — Electron-only, wave 4.
 *
 * The implementation lives in `./electron.ts` (not imported here) because it needs `ipcMain`,
 * `BrowserWindow` and an Opus decoder: Electrobun has no equivalent for any of the three, and
 * `prism-media` drags in a `ffmpeg-static` binary that Bun cannot resolve. Keeping the import
 * graph clean is what lets the Bun main bundle build at all.
 */

import { ElectrobunPortError } from '../../../rpc'

export function setupDiscordService(): void {
  // TODO(port): see docs/design-electrobun-port.md §3.1 — Discord voice needs an Opus decoder
  // and an audio sink, neither of which Electrobun exposes to the main process.
  throw new ElectrobunPortError('not-implemented', 'services:discord')
}
