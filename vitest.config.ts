import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      obsidian: './tests/__mocks__/obsidian.ts',
    },
  },
});
