import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    testTimeout: 30000,
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    reporter: 'verbose',
  },
});
