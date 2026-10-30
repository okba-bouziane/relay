import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          env: { LOG_LEVEL: 'silent' },
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
