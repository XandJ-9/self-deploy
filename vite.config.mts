import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'apps/shared-renderer/src',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': path.resolve(repoRoot, 'apps/shared-renderer/src'),
      '@shared': path.resolve(repoRoot, 'src/shared'),
      '@domain': path.resolve(repoRoot, 'packages/domain/src'),
      '@ipc-contract': path.resolve(repoRoot, 'packages/ipc-contract/src'),
      '@platform-adapter': path.resolve(repoRoot, 'packages/platform-adapter/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(repoRoot, 'dist/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
