import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const sharedDir = fileURLToPath(new URL('../src/shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version)
  },
  resolve: {
    alias: {
      // Shared types/agents live in the extension's src/shared directory;
      // the alias keeps the imports stable instead of relative climbs.
      '@shared': sharedDir
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
