/**
 * Loud boundary for the desktop screen-source list in the Electrobun shell.
 *
 * Electron's `desktopCapturer.getSources` (and the `setDisplayMediaRequestHandler` that
 * picks a source for `getDisplayMedia`) has no Electrobun equivalent — see design doc §1.2
 * and §3.1. `@proj-anima/electron-screen-capture`'s Vue composable is built on that API and
 * on a raw `ipcRenderer`, so it cannot be reused without the retired shim. These functions
 * deliberately throw instead of returning an empty list or a fake source: a caller learns
 * immediately that the feature is unavailable, and the stack names the dropped API.
 */

import type { ScreenCaptureSetSourceRequest, SerializableDesktopCapturerSource } from '@proj-anima/electron-screen-capture'

import { notImplemented } from './port-error'

/** The subset of Electron's `SourcesOptions` the devtools pages actually pass. */
export interface ScreenCaptureSourcesOptions {
  types: Array<'screen' | 'window'>
  fetchWindowIcons?: boolean
}

export interface ScreenCaptureSourceSelection {
  id: string
}

function unsupportedSelect<R>(): Promise<R> {
  return notImplemented('screenCapture.selectWithSource')
}

export function useUnsupportedScreenCapture(): {
  getSources: () => Promise<SerializableDesktopCapturerSource[]>
  setSource: (request: ScreenCaptureSetSourceRequest) => Promise<string>
  resetSource: (handle: string) => Promise<void>
  selectWithSource: <R>(
    select: (sources: SerializableDesktopCapturerSource[]) => string,
    use: () => Promise<R>,
    request?: Omit<ScreenCaptureSetSourceRequest, 'options' | 'sourceId'>,
  ) => Promise<R>
  checkMacOSPermission: () => Promise<string>
  requestMacOSPermission: () => Promise<void>
} {
  return {
    getSources: () => notImplemented('desktopCapturer.getSources (screen source list)'),
    setSource: _request => notImplemented('screenCapture.setSource'),
    resetSource: _handle => notImplemented('screenCapture.resetSource'),
    selectWithSource: unsupportedSelect,
    checkMacOSPermission: () => notImplemented('systemPreferences.getMediaAccessStatus (macOS screen-capture permission)'),
    requestMacOSPermission: () => notImplemented('systemPreferences.askForMediaAccess (macOS screen-capture permission)'),
  }
}
