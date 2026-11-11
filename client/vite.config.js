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
      // The same for a landing page template's helpers (issue #130).
      '@landing': fileURLToPath(new URL('./src/landing', import.meta.url)),
      // Rolldown (vite 8+) resolves a file's imports — including the
      // auto-injected `react/jsx-runtime` import from JSX syntax — relative
      // to that file's own location rather than the vite project root, so
      // templates/ (outside client/, with no node_modules of its own) can't
      // resolve react at all without this. esbuild/Rollup (vite <8) didn't
      // have this restriction.
      'react/jsx-runtime': fileURLToPath(new URL('./node_modules/react/jsx-runtime.js', import.meta.url)),
      'react/jsx-dev-runtime': fileURLToPath(new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url)),
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // The site's icon is drawn by the server too (server/src/routes/favicon.js).
      '/favicon.svg': { target: 'http://localhost:4000', changeOrigin: true },
      '/apple-touch-icon.png': { target: 'http://localhost:4000', changeOrigin: true },
    },
    fs: {
      // templates/ lives at the repo root, outside client/'s root — allow
      // the dev server to resolve it (vite build has no such restriction).
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    // dist/.vite/manifest.json lists every hashed chunk/stylesheet/asset
    // Vite emitted. The server reads it to decide which files are safe to
    // serve as immutable (server/src/cacheHeaders.js); without it nothing
    // is, so keep this on.
    manifest: true,
    // Keeps `/*! … */` license comments: Font Awesome's (the button icons,
    // src/landing/actionIcons.js) is the attribution its license asks for.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
