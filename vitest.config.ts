import { defineConfig } from 'vitest/config'

// Thresholds are evaluated only here, over the aggregate of every project below.
// Measured aggregate: statements 45, branches 39, functions 45, lines 47.
export default defineConfig({
  test: {
    projects: [
      'apps/server',
      'apps/stage-tamagotchi',
      'packages/stage-ui',
      'packages/stage-pages',
      'packages/stage-shared',
      'packages/plugin-sdk',
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
      'integrations/oh-my-pi/airi-plugin-oh-my-pi',
      'packages/nan0-runtime',
      'packages/speech-transformer-chem',
      'packages/speech-transformer-math',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 43,
        branches: 37,
        functions: 43,
        lines: 45,
      },
    },
  },
})
