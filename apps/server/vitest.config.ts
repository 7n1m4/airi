import { defineConfig } from 'vitest/config'

// Not evaluated by `pnpm test` (what CI runs): that aggregates coverage across
// every project and checks only the root thresholds. These apply to a standalone
// run rooted here, and sit under the measured coverage (statements 42, branches
// 19, functions 45, lines 43) rather than claiming an unenforceable 100%.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/**/*.ts',
      ],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 40,
        functions: 42,
        branches: 17,
        statements: 40,
      },
    },
  },
})
