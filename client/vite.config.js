import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Lets contributed templates (which live outside client/src, so they
      // can't use a stable "./…" relative path) import shared rendering
      // helpers as `@resume/safeUrl.js` etc. regardless of nesting depth.
      '@resume': fileURLToPath(new URL('./src/resume', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
    fs: {
      // templates/ lives at the repo root, outside client/'s root — allow
      // the dev server to resolve it (vite build has no such restriction).
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
  },
});
