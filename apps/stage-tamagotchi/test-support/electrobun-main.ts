/**
 * Vitest-only test double for the `electrobun/main` SDK.
 *
 * The real SDK lives in `.hutch/devkit` and cannot be imported under Node: at module
 * load it calls Bun's native FFI (`bun:ffi`), probes for native libraries and throws
 * "Electrobun FFI is unavailable" when they are absent. Unit tests in this project
 * exercise pure logic (URL routing, display math, protocol filtering, companion state)
 * that never touches the native runtime, so they need the module to *load*, not work.
 *
 * Every native operation throws when called, so a test that accidentally reaches the
 * bridge fails loudly instead of receiving fabricated data. `Utils.paths` is the one
 * exception: config persistence reads a path synchronously, so it reports the OS temp
 * directory (tests override it when they need isolation).
 */

import { tmpdir } from 'node:os'

function nativeOnly(name: string): (...args: unknown[]) => never {
  return (..._args: unknown[]) => {
    throw new Error(`[test double] electrobun.${name} requires the native runtime`)
  }
}

export const Utils = {
  paths: new Proxy<Record<string, string>>({}, {
    get: () => tmpdir(),
  }),
  quit: nativeOnly('Utils.quit'),
  openExternal: nativeOnly('Utils.openExternal'),
  openPath: nativeOnly('Utils.openPath'),
  showMessageBox: nativeOnly('Utils.showMessageBox'),
}

export const Screen = {
  getAllDisplays: nativeOnly('Screen.getAllDisplays'),
  getPrimaryDisplay: nativeOnly('Screen.getPrimaryDisplay'),
  getCursorScreenPoint: nativeOnly('Screen.getCursorScreenPoint'),
  getDisplayMatching: nativeOnly('Screen.getDisplayMatching'),
  getDisplayNearestPoint: nativeOnly('Screen.getDisplayNearestPoint'),
}

export const BuildConfig = {
  mainDirname: tmpdir(),
  isDev: true,
}

export class BrowserWindow {
  constructor(..._args: unknown[]) {}
}

export class BrowserView {
  constructor(..._args: unknown[]) {}
}

export default {
  events: { on: nativeOnly('Electrobun.events.on') },
}
