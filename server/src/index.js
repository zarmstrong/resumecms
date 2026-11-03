import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting } from './db.js'; // also ensures schema + seed run on boot
import { accessLogger } from './logger.js';
import { store } from './store.js';

import aiRoutes from './routes/ai.js';
import authRoutes from './routes/auth.js';
import blockRoutes from './routes/blocks.js';
import mcpRoutes from './routes/mcp.js';
import publicRoutes from './routes/public.js';
import pdfRoutes from './routes/pdf.js';
import publishRoutes from './routes/publish.js';
import totpRoutes from './routes/totp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const SESSION_SECRET = process.env.RESUMECMS_SESSION_SECRET || 'dev-secret-change-me';

app.use(accessLogger);

// MCP endpoint (bearer-token gated, see routes/mcp.js). Mounted ahead of
// express.json() and the session so an unauthenticated request is turned
// away before any body is parsed; the router brings its own parser. It
// lives outside /api so blockRoutes' session check never sees it, and it
// must precede the static/SPA handlers below or they'd answer it with
// index.html.
app.use('/mcp', mcpRoutes);

app.use(express.json({ limit: '2mb' }));
app.use(
  cookieSession({
    name: 'resume_session',
    secret: SESSION_SECRET,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  })
);

// NOTE: mount order matters here. Express matches app.use() by path prefix,
// so more specific routes ('/api/public', '/api/auth/totp', '/api/ai') must be
// registered before the broader '/api' mount below — otherwise those
// requests would first hit blockRoutes' unconditional requireAuth
// middleware (which runs for anything under '/api' regardless of whether a
// route further down actually matches) and get rejected there instead.
app.use('/api/auth', authRoutes);
app.use('/api/auth/totp', totpRoutes); // /api/auth/totp/status, /setup, /confirm, /disable (auth-gated)
app.use('/api/public', publicRoutes); // /api/public/resume
app.use('/api/public', pdfRoutes); // /api/public/resume.pdf
app.use('/api/ai', aiRoutes); // /api/ai/settings, /api/ai/rewrite (auth-gated)
app.use('/api', blockRoutes); // /api/header, /api/site, /api/blocks... (auth-gated)
app.use('/api', publishRoutes); // /api/publish, /api/publish/status, /api/discard-draft (auth-gated)

// An /api/* request that reached here matched none of the routes above —
// 404 it explicitly rather than letting it fall through to the SPA
// catch-all below, which would otherwise mask a bad API path behind a
// misleading 200 index.html response.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve the built client (Vite output) for everything else, including
// client-side routes like /editor and /print — the SPA router handles them.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`resume server listening on port ${PORT}`);
  if (!getSetting('credentials')) {
    console.warn(
      'WARNING: No login credentials configured. Set RESUMECMS_ADMIN_USERNAME/RESUMECMS_APP_PASSWORD before ' +
        'first boot to seed the initial login (the editor login will not work until it is).'
    );
  }

  // A published snapshot can exist (seeded from pre-existing draft content
  // on first boot after this feature shipped) without a PDF file ever
  // having been generated for it yet — render one now so the download link
  // isn't broken until someone happens to click Publish. The store queues
  // this behind any publish that's already running, so the two can't race
  // on the output file.
  store.ensurePdf().catch((err) => console.error('Initial PDF generation failed:', err));
});
