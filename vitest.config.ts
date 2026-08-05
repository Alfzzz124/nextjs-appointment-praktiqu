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
     * Every billing suite shares one TEST_MARKER id range in tests/billing/fixtures.ts
     * and each calls cleanup(), so concurrently-running files delete each other's rows.
     * That is why the failure count drifted between runs of identical code while every
     * suite passed in isolation.
     *
     * The principled fix is a distinct id range per suite, but that means reworking
     * fixtures.ts and every billing suite. Serialising costs wall-clock time and buys a
     * deterministic suite, which is the more valuable property while a data-layer
     * migration is in flight.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
