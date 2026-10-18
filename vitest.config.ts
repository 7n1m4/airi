import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/server',
      'apps/stage-tamagotchi',
      'packages/stage-ui',
      'packages/stage-pages',
      'packages/stage-shared',
      'packages/plugin-sdk',
      'packages/cap-vite',
      'packages/vite-plugin-warpdrive',
      'packages/audio-pipelines-transcribe',
      'packages/pipelines-audio',
      'packages/server-runtime',
      'packages/live2d-runtime',
      'packages/i18n',
      'packages/ui',
      'packages/stage-ui-live2d',
      'packages/stage-ui-mmd',
      'packages/stage-ui-spine',
      'packages/stage-ui-three',
      'packages/electron-vueuse',
      'packages/model-driver-magic-live2d',
      'packages/server-sdk',
      'packages/motion-driver-magic',
      'packages/electron-screen-capture',
      'packages/server-shared',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 32,
        branches: 24,
        functions: 31,
        lines: 33,
      },
    },
  },
})
