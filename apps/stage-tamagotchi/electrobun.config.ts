import type { ElectrobunConfig } from 'electrobun'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')) as { version: string }

// NOTICE: `linux.icon` is resolved inside the *packaged* tree (`buildFolder/<platform>/<app>/`),
// so it must name a path `build.copy` already put there. The desktop icons stay committed under
// build/ (electron-builder's `buildResources`); `resources/` is what this app ships.
const icons = {
  mac: { icons: 'build/icon.icon' },
  win: { icon: 'build/icon.ico' },
  linux: { icon: 'resources/icon-512.png' },
} as const

/**
 * CEF flags replacing the Electron `app.commandLine.appendSwitch` calls that used to live in
 * `src/main/index.ts`. Keys are switch names without `--`; `false` drops an Electrobun default.
 *
 * Dropped, with no CEF equivalent:
 * - `ozone-platform` / `ozone-platform-hint` (Electron Ozone plumbing; CEF picks its own GDK backend)
 * - `enable-features=GlobalShortcutsPortal,UseOzonePlatform,WaylandWindowDecorations` (same)
 * - `enable-dawn-features=vulkan_enable_f16_on_nvidia` (re-add here if WebLLM q4f16 shaders start
 *   rejecting the `f16` extension on NVIDIA Vulkan)
 * - `force-high-performance-gpu` / `enable-gpu-rasterization` / `ignore-gpu-blocklist`
 *   (`AIRI_FORCE_HIGH_PERFORMANCE_GPU=1` opt-in has no CEF switch equivalent)
 */
const chromiumFlags = {
  'enable-unsafe-webgpu': true,
  'enable-features': 'SharedArrayBuffer,Vulkan',
  'disable-gpu': false,
} as const

export default {
  app: {
    name: 'AIRI',
    identifier: 'ai.moeru.airi',
    version: pkg.version,
  },
  build: {
    mainProcess: 'bun',
    bun: {
      entrypoint: 'src/main/index.ts',
      // Workspace packages whose package.json `main` points at a dist bundle need an explicit
      // alias; everything else resolves through pnpm.
      //
      // `electron` → the in-repo shim is the load-bearing one: src/main still has ~40 modules
      // written against Electron's `app`/`ipcMain`/`screen`… (wave 3/4 ports them). Aliasing the
      // specifier to src/main/electron-shim.ts keeps the graph loadable and gives every unmapped
      // call an explicit `not-implemented` error. Bun's `paths` alone is not enough — the root
      // node_modules/electron symlink (another workspace's dep) wins resolution, so the alias must
      // be here, and `electron` must NOT be in `external` (that makes Bun emit a real require).
      alias: {
        '@proj-airi/i18n-bundle': join(appDir, '../../packages/i18n/src/dist-lite/messages.mjs'),
        '@proj-airi/server-runtime': join(appDir, '../../packages/server-runtime/src'),
        'electron': join(appDir, 'src/main/electron-shim.ts'),
        // NOTICE: Bun's bundler applies the `node` export condition, so `h3` resolves to
        // h3/dist/_entries/node.mjs, whose `serve` is srvx's Node adapter (a node:http
        // server). crossws, resolving independently, still picks its Bun adapter — so the Bun
        // plugin ends up on the Node server and every WebSocket upgrade dies with
        // "undefined is not an object (evaluating 'req.runtime.bun.server')", because only
        // srvx's *Bun* adapter defines `request.runtime.bun.server`.
        // Forcing h3 to its bun entry makes both sides Bun. Verified by resolving the bundle
        // and checking which modules land in it. Drop both aliases when Hutch forwards
        // `--conditions=bun` (or when h3/crossws make bun the default).
        'h3': 'h3/bun',
        'crossws/server': 'crossws/server/bun',
      },
      // Only genuinely native modules are external: koffi/active-win are prebuilt .node addons.
      external: ['koffi', 'active-win'],
    },
    // Vite writes the three MPA entries to dist/; one CEF view serves all of them
    // (the renderer routes by location.hash, so the registry can load
    // views://main/{index,splash,beat-sync}.html).
    copy: {
      'dist/index.html': 'views/main/index.html',
      'dist/splash.html': 'views/main/splash.html',
      'dist/beat-sync.html': 'views/main/beat-sync.html',
      'dist/assets': 'views/main/assets',
      'resources': 'resources',
    },
    watch: ['src/main', 'src/shared', 'resources'],
    watchIgnore: ['dist/**', 'out/**', '.hutch/**'],
    mac: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      chromiumFlags,
      ...icons.mac,
    },
    win: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      chromiumFlags,
      ...icons.win,
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      chromiumFlags,
      ...icons.linux,
    },
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig
