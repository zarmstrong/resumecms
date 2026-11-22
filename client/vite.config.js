import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';

// The release the editor's top bar shows (TopbarEnd.jsx). release-please
// bumps client/package.json with every release; appVersion.test.js checks it
// against the manifest the image is tagged from.
const { version, dependencies } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The self-hosted site fonts (src/fonts.js, issue #221): fontsource's CSS
// offers every face as woff2 and then woff, and every browser the app
// supports takes woff2, so the woff copy is cut before Vite reads the CSS.
// It then never ships: half the font URLs in the stylesheet, and about 7 MB
// less in the build.
const FONTSOURCE_CSS = /[\\/]node_modules[\\/]@fontsource[\\/][^\\/]+[\\/][^\\/]+\.css$/;
function woff2Only() {
  return {
    name: 'resumecms-fontsource-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!FONTSOURCE_CSS.test(id.split('?')[0])) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, ''), map: null };
    },
  };
}

// The fonts' license ships with them (issue #221). The SIL Open Font License
// asks that its text and each font's copyright notice go with every copy,
// and a woff2 file's own metadata holds only the notice and a link. So the
// build writes every @fontsource dependency's LICENSE into
// dist/font-licenses.txt, served as /font-licenses.txt. It's written after
// the bundle, not emitted into it, so it's never in the build manifest: a
// file there is served immutable, and this one's name has no hash. A
// package without a LICENSE fails the build.
const FONT_LICENSES_FILE = 'font-licenses.txt';
function fontLicenses() {
  let outDir;
  return {
    name: 'resumecms-font-licenses',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const sections = Object.keys(dependencies)
        .filter((name) => name.startsWith('@fontsource/'))
        .sort()
        .map((name) => {
          const dir = new URL(`./node_modules/${name}/`, import.meta.url);
          const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
          const license = readFileSync(new URL('LICENSE', dir), 'utf8').trim();
          return `${'='.repeat(72)}\n${name} ${pkg.version} (${pkg.license})\n${'='.repeat(72)}\n\n${license}\n`;
        });
      const intro =
        'The fonts this site serves come from the npm packages below. Each\n' +
        "one's copyright notice and license follow its name.\n";
      writeFileSync(path.join(outDir, FONT_LICENSES_FILE), [intro, ...sections].join('\n'));
    },
  };
}

export default defineConfig({
  plugins: [woff2Only(), fontLicenses(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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
    // Never inline a font as a data: URL (Vite's default for an asset
    // under 4 KB, which takes in a font's small subsets): it would sit in
    // the main stylesheet, base64 that doesn't compress, for every visitor
    // whether the page uses that font or not (issue #221). Other assets
    // keep the default.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    // Keeps `/*! … */` license comments: Font Awesome's (the button icons,
    // src/landing/actionIcons.js) is the attribution its license asks for.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
