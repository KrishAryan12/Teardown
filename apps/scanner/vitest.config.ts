import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          env: { NODE_ENV: 'test', ALLOW_PRIVATE_TARGETS: 'true' },
          testTimeout: 240_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
