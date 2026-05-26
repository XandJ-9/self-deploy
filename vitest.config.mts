import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': path.resolve(repoRoot, 'src/renderer'),
      '@shared': path.resolve(repoRoot, 'src/shared'),
      '@domain': path.resolve(repoRoot, 'packages/domain/src'),
      '@ipc-contract': path.resolve(repoRoot, 'packages/ipc-contract/src'),
      '@platform-adapter': path.resolve(repoRoot, 'packages/platform-adapter/src'),
    },
  },
  test: {
    root: '.',
    include: ['tests/**/*.{test,spec}.ts'],
    testTimeout: 30_000,
  },
});
