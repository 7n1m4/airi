import type { Plugin } from 'vite'

import process from 'node:process'

import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import Vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'unplugin-vue-router/vite'
import Yaml from 'unplugin-yaml/vite'
import Layouts from 'vite-plugin-vue-layouts'
import VueMacros from 'vue-macros/vite'

import { Download } from '@proj-airi/unplugin-fetch'
import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk'
import { defineConfig } from 'vite'

/**
 * Helper to retry an async function multiple times with optional backoff.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn()
  }
  catch (error) {
    if (retries <= 0)
      throw error
    console.warn(`[Retry] Action failed, retrying in ${delay}ms... (${retries} retries left)`)
    const { promise, resolve: sleep } = Promise.withResolvers<void>()
    setTimeout(sleep, delay)
    await promise
    return withRetry(fn, retries - 1, delay * 2)
  }
}

/**
 * Wraps a Vite plugin's configResolved hook to make it resilient to failures.
 * If the hook fails (e.g. download error), it will retry and ultimately let the build proceed.
 */
function resilient(plugin: Plugin) {
  const originalHook = plugin.configResolved
  if (!originalHook)
    return plugin

  plugin.configResolved = async (config) => {
    try {
      await withRetry(() => originalHook.call(plugin, config), 3, 2000)
    }
    catch (error) {
      console.error(`[ResilientPlugin] ${plugin.name} failed after all retries:`, error instanceof Error ? error.message : error)
      console.warn(`[ResilientPlugin] Proceeding without ${plugin.name} assets.`)
    }
  }
  return plugin
}

const stageUIAssetsRoot = resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src', 'assets'))
const sharedCacheDir = resolve(join(import.meta.dirname, '..', '..', '.cache'))
const require = createRequire(import.meta.url)

export default defineConfig({
  // Electrobun serves prod builds from views://<view>/, so every asset URL must be relative.
  base: './',

  root: 'src/renderer',

  build: {
    target: 'esnext',
    // Relative to `root`, so the MPA output lands in <app>/dist where electrobun.config.ts copies it.
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'main': resolve(join(import.meta.dirname, 'src', 'renderer', 'index.html')),
        'beat-sync': resolve(join(import.meta.dirname, 'src', 'renderer', 'beat-sync.html')),
        'splash': resolve(join(import.meta.dirname, 'src', 'renderer', 'splash.html')),
      },
    },
  },

  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    include: [
      'tslib',
      '@vueuse/motion',
      'popmotion',
      'uncrypto',
      'three',
      'jszip',
      '@pixiv/three-vrm',
    ],
    exclude: [
      // Internal Packages
      '@proj-airi/stage-ui',
      '@proj-airi/stage-ui/*',
      '@proj-airi/stage-ui-three',
      '@proj-airi/stage-ui-three/*',
      '@proj-airi/electron-screen-capture',

      // wasm-bindgen package: esbuild's dep pre-bundle mangles the wasm glue
      // (Firefox: NS_ERROR_CORRUPTED_CONTENT on the optimized module), which
      // kills the web-rwkv worker before it registers its load handler. Serve
      // the original ESM so the `?url` wasm asset resolves correctly.
      '@cryscan/web-rwkv-wasm',

      // Static Assets: Models, Images, etc.
      'src/renderer/public/assets/*',

      // Live2D SDK
      '@framework/live2dcubismframework',
      '@framework/math/cubismmatrix44',
      '@framework/type/csmvector',
      '@framework/math/cubismviewmatrix',
      '@framework/cubismdefaultparameterid',
      '@framework/cubismmodelsettingjson',
      '@framework/effect/cubismbreath',
      '@framework/effect/cubismeyeblink',
      '@framework/model/cubismusermodel',
      '@framework/motion/acubismmotion',
      '@framework/motion/cubismmotionqueuemanager',
      '@framework/type/csmmap',
      '@framework/utils/cubismdebug',
      '@framework/model/cubismmoc',
    ],
  },

  resolve: {
    conditions: ['browser', 'import', 'default'],
    alias: [
      { find: '@proj-airi/server-sdk', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'server-sdk', 'src')) },
      // Headless DSL runtime ships TS source only (no build step); alias to source for dev HMR.
      { find: '@proj-airi/live2d-runtime', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'live2d-runtime', 'src')) },
      { find: '@proj-airi/i18n', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')) },
      { find: '@proj-airi/stage-ui', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src')) },
      { find: '@proj-airi/stage-ui-three', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui-three', 'src')) },
      { find: '@proj-airi/stage-pages', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src')) },
      { find: '@proj-airi/stage-shared', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-shared', 'src')) },
      { find: '@proj-airi/electron-vueuse', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'electron-vueuse', 'src')) },
      { find: '@proj-airi/stage-layouts', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src')) },
      { find: '@proj-airi/model-driver-magic-live2d', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'model-driver-magic-live2d', 'src')) },
      { find: '@proj-airi/motion-driver-magic', replacement: resolve(join(import.meta.dirname, '..', '..', 'packages', 'motion-driver-magic', 'src')) },
      { find: 'node:crypto', replacement: resolve(join(import.meta.dirname, 'src', 'renderer', 'shims', 'node-crypto.ts')) },
      { find: 'crypto', replacement: resolve(join(import.meta.dirname, 'src', 'renderer', 'shims', 'node-crypto.ts')) },
      { find: 'tslib', replacement: require.resolve('tslib/tslib.es6.js') },
      { find: 'three/addons', replacement: resolve(join(import.meta.dirname, 'node_modules', 'three', 'examples', 'jsm')) },
      { find: 'three', replacement: resolve(join(import.meta.dirname, 'node_modules', 'three')) },
      // NOTICE: `node_modules/electrobun` is a stub whose module body throws; the real SDK
      // is projected into .hutch by `hutch electrobun prepare`. The web program gets types
      // from src/renderer/electrobun-view.d.ts instead; this alias is for the bundler only.
      { find: 'electrobun/view', replacement: resolve(join(import.meta.dirname, '.hutch', 'devkit', 'api', 'browser', 'index.ts')) },
      // .../devkit/api/browser/index.ts side-effect-imports `./global.d.ts` (ambient types, no
      // runtime form); route it at an empty module so the bundle doesn't try to parse it.
      { find: /^\.\/global\.d\.ts$/, replacement: resolve(join(import.meta.dirname, 'src', 'renderer', 'shims', 'empty.ts')) },
    ],
  },
  ssr: {
    noExternal: ['tslib', 'uncrypto', '@noble/hashes'],
  },

  server: {
    fs: {
      strict: true,
    },
    // Prefer a dedicated renderer dev port override so unrelated services
    // like the AIRI channel server do not accidentally inherit it.
    port: Number.parseInt(process.env.AIRI_RENDERER_PORT || process.env.PORT || '5173'),
    strictPort: true,
    warmup: {
      clientFiles: [
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src'))}/*.vue`,
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src'))}/*.vue`,
      ],
    },
  },

  worker: {
    format: 'es',
    plugins: () => [
      {
        name: 'sanitize-worker-modules',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (id.includes('@mlc-ai/web-llm')) {
            return {
              code: code
                .replaceAll('new Worker', 'createWorkerInstance')
                .replaceAll('import.meta.url', 'import_meta_url'),
              map: null,
            }
          }
        },
      },
    ],
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
      },
    },
  },

  plugins: [
    {
      name: 'sanitize-renderer-modules',
      enforce: 'pre',
      transform(code: string, id: string) {
        if (id.includes('@mlc-ai/web-llm')) {
          return {
            code: code
              .replaceAll('new Worker', 'createWorkerInstance')
              .replaceAll('import.meta.url', 'import_meta_url'),
            map: null,
          }
        }
      },
    },
    {
      name: 'force-node-crypto-shim',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'node:crypto' || id === 'crypto') {
          return resolve(join(import.meta.dirname, 'src', 'renderer', 'shims', 'node-crypto.ts'))
        }
        if (id.startsWith('node:') || ['process', 'module', 'path', 'fs'].includes(id)) {
          return '\0virtual:node-shim'
        }
        return null
      },
      load(id) {
        if (id === '\0virtual:node-shim') {
          return `
            export default {};
            export const readFileSync = () => '';
            export const writeFileSync = () => {};
            export const existsSync = () => false;
            export const statSync = () => ({ isDirectory: () => false, isFile: () => false });
            export const promises = { readFile: async () => '', writeFile: async () => {} };
            export const join = (...args) => args.filter(Boolean).join('/');
            export const resolve = (...args) => args.filter(Boolean).join('/');
            export const constants = {};
            export const gunzipSync = (data) => data;
            export const gzipSync = (data) => data;
            export const inflateSync = (data) => data;
            export const deflateSync = (data) => data;
            export const dirname = (p) => (p ? p.split('/').slice(0, -1).join('/') : '');
            export const basename = (p) => (p ? p.split('/').pop() : '');
            export const extname = (p) => (p && p.includes('.') ? '.' + p.split('.').pop() : '');
          `
        }
        return null
      },
    },
    Info(),

    {
      name: 'proj-airi:defines',
      config(ctx) {
        const define: Record<string, any> = {
          // NOTICE: `RUNTIME_ENVIRONMENT` must stay 'electron' — `isStageTamagotchi()` in
          // packages/stage-shared/src/environment.ts gates ~56 desktop call sites on that
          // exact string, and the Electrobun shell is a tamagotchi runtime. See
          // docs/design-electrobun-port.md §2.1 for the follow-up that renames it properly.
          'import.meta.env.RUNTIME_ENVIRONMENT': '\'electron\'',
        }
        if (ctx.mode === 'development') {
          define['import.meta.env.URL_MODE'] = '\'server\''
        }
        if (ctx.mode === 'production') {
          define['import.meta.env.URL_MODE'] = '\'file\''
        }

        return { define }
      },
    },

    // Inspect(),

    Yaml(),

    VueMacros({
      plugins: {
        vue: Vue({
          include: [/\.vue$/, /\.md$/],
          template: {
            compilerOptions: {
              isCustomElement: (tag: string) => tag.startsWith('Tres') && tag !== 'TresCanvas',
            },
          },
        }),
        vueJsx: false,
      },
      betterDefine: false,
    }),

    VueRouter({
      dts: resolve(import.meta.dirname, 'src/renderer/typed-router.d.ts'),
      importMode: 'async',
      routesFolder: [
        {
          src: resolve(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src', 'pages'),
          exclude: base => [
            ...base,
            '**/settings/connection/index.vue',
            '**/settings/system/general.vue',
            '**/settings/modules/mcp.vue',
            '**/settings/system/connection.vue',
          ],
        },
        resolve(import.meta.dirname, 'src', 'renderer', 'pages'),
      ],
      exclude: ['**/components/**'],
    }),

    // VitePluginVueDevTools(),

    // https://github.com/JohnCampionJr/vite-plugin-vue-layouts
    Layouts({
      layoutsDirs: [
        resolve(import.meta.dirname, 'src', 'renderer', 'layouts'),
        resolve(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src', 'layouts'),
      ],
      pagesDirs: [resolve(import.meta.dirname, 'src', 'renderer', 'pages')],
    }),

    UnoCss(),

    // https://github.com/intlify/bundle-tools/tree/main/packages/unplugin-vue-i18n
    VueI18n({
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
    }),

    ...(!process.env.SKIP_DOWNLOADS
      ? [
          resilient(DownloadLive2DSDK()),
          resilient(Download('https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip', 'hiyori_free_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir })),
          resilient(Download('https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip', 'hiyori_pro_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir })),
          resilient(Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm', 'AvatarSample_A.vrm', 'vrm/models/AvatarSample-A', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir })),
          resilient(Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm', 'AvatarSample_B.vrm', 'vrm/models/AvatarSample-B', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir })),
        ]
      : []),
  ],
})
