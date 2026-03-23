import { defineConfig } from 'vitest/config'
import path from 'path'

const enforceCoverage =
  process.env.CI === 'true' || process.env.CI === '1' || process.env.ENFORCE_COVERAGE === 'true'

export default defineConfig({
  test: {
    name: 'server',
    globals: true,
    environment: 'node',
    setupFiles: ['./server/__tests__/setup.ts'],
    include: ['server/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build', 'client'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['server/**/*.ts'],
      exclude: [
        'server/__tests__/**',
        'server/**/*.test.ts',
        'server/**/*.spec.ts',
        'server/types/**',
        'server/index.ts', // Entry point, tested via integration tests
        'server/worker.ts', // Worker entry point
        'server/queue/workers/**' // Workers tested via integration
      ],
      thresholds: enforceCoverage
        ? {
            lines: 80,
            functions: 80,
            branches: 75,
            statements: 80
          }
        : undefined
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './server'),
      '@public-records/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@public-records/core/database': path.resolve(__dirname, './packages/core/src/database.ts'),
      '@public-records/core/identity': path.resolve(__dirname, './packages/core/src/identity.ts')
    }
  }
})
