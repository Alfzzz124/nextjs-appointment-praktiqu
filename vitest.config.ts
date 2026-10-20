/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    setupFiles: ['./tests/setup-env.ts'],
    /**
     * Run test files one at a time.
     *
     * This was first turned off because every billing suite shared one TEST_MARKER id
     * range and each called cleanup(), so concurrently-running files deleted each
     * other's rows. Each integration suite now owns its own id block
     * (tests/helpers/id-blocks.ts), so that reason is gone.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
