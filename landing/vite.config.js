import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built page works as a Claude artifact (files served next to index.html).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsInlineLimit: 0, cssCodeSplit: false },
});
