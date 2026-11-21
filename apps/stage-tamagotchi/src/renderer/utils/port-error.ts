/**
 * Renderer-side boundary for capabilities the Electrobun port deliberately does not
 * implement. Mirrors `ElectrobunPortError` from `src/main/rpc` without importing main code.
 *
 * These errors are thrown at the moment a missing capability is *used*, never at module
 * load, so the shell can boot and the rest of a settings page stays interactive. No silent
 * no-ops: a caller that reaches one of these gets a stack trace naming the exact Electron
 * API and the design-doc reason.
 */

export class ElectrobunPortError extends Error {
  constructor(
    readonly reason: 'not-implemented' | 'unsupported',
    readonly target: string,
  ) {
    super(`[electrobun-port] ${target}: ${reason} (see docs/design-electrobun-port.md §3.1)`)
    this.name = 'ElectrobunPortError'
  }
}

export function notImplemented(target: string): never {
  throw new ElectrobunPortError('not-implemented', target)
}
