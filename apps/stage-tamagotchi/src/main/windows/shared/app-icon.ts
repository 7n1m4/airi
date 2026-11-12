import type { BrowserWindow } from 'electrobun/main'

import type { globalAppConfigSchema } from '../../configs/global'
import type { Config } from '../../libs/electron/persistence'

import { all } from '../registry'

/**
 * Shows a window on all workspaces.
 *
 * TODO(port): Electron's `{ skipTransformProcessType }` variant kept the macOS Dock icon hidden;
 * Electrobun's `setVisibleOnAllWorkspaces(bool)` has no such option, so a hidden Dock icon may
 * reappear on the first call — see docs/design-electrobun-port.md §3.1.
 */
export function showWindowOnAllWorkspaces(window: Pick<BrowserWindow, 'setVisibleOnAllWorkspaces'>): void {
  window.setVisibleOnAllWorkspaces(true)
}

/**
 * Applies the `hideAppIcon` preference to the macOS Dock.
 *
 * TODO(port): Windows has no per-window `setSkipTaskbar` in Electrobun and there is no
 * `browser-window-created` event, so the taskbar half of this preference is a no-op until the
 * native layer exposes it. The Dock half maps to `Utils.setDockIconVisible` (not yet declared).
 */
export class AppIconVisibility {
  constructor(private readonly config: Config<typeof globalAppConfigSchema>) {
    if (this.hidden)
      void this.apply(true)
  }

  get hidden(): boolean {
    return this.config.get()?.hideAppIcon ?? true
  }

  /** Applies the preference to current and later windows, then saves it. */
  async setHidden(hidden: boolean): Promise<void> {
    if (this.hidden === hidden)
      return

    await this.apply(hidden)
    const current = this.config.get()
    if (current) {
      this.config.update({
        ...current,
        hideAppIcon: hidden,
      })
    }
  }

  private async apply(hidden: boolean): Promise<void> {
    void hidden
    // NOTICE: the registry replaces `BrowserWindow.getAllWindows()`.
    for (const window of all())
      void window
  }
}
