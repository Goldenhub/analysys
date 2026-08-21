import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  worker: {
    format: 'es',
    plugins: () => [],
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
