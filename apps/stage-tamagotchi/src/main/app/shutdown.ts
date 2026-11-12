/**
 * Electrobun port: quit-time teardown coordinator.
 *
 * Electron's `before-quit` is an async, `preventDefault`-able event, so the original
 * handler could stop the quit, await the whole teardown, then `app.quit()`.
 * Electrobun's `before-quit` carries only an `{ allow }` response, so teardown runs
 * once, idempotently, and the quit it was triggered by is allowed to proceed.
 */

import { emitAppBeforeQuit } from '../libs/bootkit/lifecycle'

type ShutdownStep = () => Promise<void> | void

const hooks: ShutdownStep[] = []
let running: Promise<void> | null = null

export function onBeforeQuit(fn: ShutdownStep): void {
  hooks.push(fn)
}

/** Idempotent: every caller observes the same single teardown pass. */
export function runShutdown(): Promise<void> {
  if (running)
    return running

  console.info('[@proj-airi/stage-tamagotchi] Shutdown sequence started...')
  running = (async () => {
    for (const hook of hooks) {
      try {
        await hook()
      }
      catch (err) {
        console.error('[@proj-airi/stage-tamagotchi] Shutdown step failed:', err)
      }
    }
    console.info('[@proj-airi/stage-tamagotchi] Shutdown complete.')
  })()

  return running
}

export function isShuttingDown(): boolean {
  return running !== null
}

/** Fired by the DI `invoke` callback; registered as a step so ordering stays explicit. */
onBeforeQuit(async () => {
  await emitAppBeforeQuit()
})
