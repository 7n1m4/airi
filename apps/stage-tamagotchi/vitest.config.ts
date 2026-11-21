import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const appDir = fileURLToPath(new URL('.', import.meta.url))
const electrobunStub = fileURLToPath(new URL('test-support/electrobun-main.ts', import.meta.url))
const electrobunViewStub = fileURLToPath(new URL('test-support/electrobun-view.ts', import.meta.url))

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
      // No `electron` alias: the shim was deleted and src/main has no runtime `electron`
      // imports left. A test that suddenly needs one is a real port gap, not a stub target.
    ],
  },
  test: {
    root: appDir,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
})
