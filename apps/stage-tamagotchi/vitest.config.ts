import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const appDir = fileURLToPath(new URL('.', import.meta.url))
const electrobunStub = fileURLToPath(new URL('test-support/electrobun-main.ts', import.meta.url))
const electrobunViewStub = fileURLToPath(new URL('test-support/electrobun-view.ts', import.meta.url))
const electronShim = fileURLToPath(new URL('src/main/electron-shim.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // `node_modules/electrobun` is a 2.x stub whose module body throws on import,
      // and the real SDK in `.hutch/devkit` calls Bun native FFI at module load, which
      // cannot work under Node where Vitest runs. Point main-process modules at an
      // inert test double so their imports resolve without reaching the native bridge.
      { find: /^electrobun$/, replacement: electrobunStub },
      { find: /^electrobun\/main$/, replacement: electrobunStub },
      { find: /^electrobun\/view$/, replacement: electrobunViewStub },
      // The real `electron` package cannot be imported here: its postinstall binary
      // was never downloaded, and the app aliases the specifier to the in-repo shim
      // for runtime (see electrobun.config.ts). Mirror that for tests.
      { find: /^electron$/, replacement: electronShim },
    ],
  },
  test: {
    root: appDir,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
})
