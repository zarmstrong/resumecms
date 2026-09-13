import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js'; // ensures schema + seed run on boot
import { accessLogger } from './logger.js';
import { renderResumePdf } from './pdfRenderer.js';

import authRoutes from './routes/auth.js';
import blockRoutes from './routes/blocks.js';
import publicRoutes from './routes/public.js';
import pdfRoutes, { PDF_PATH } from './routes/pdf.js';
import publishRoutes from './routes/publish.js';
import totpRoutes from './routes/totp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const SESSION_SECRET = process.env.RESUMECMS_SESSION_SECRET || 'dev-secret-change-me';

app.use(accessLogger);
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
// so more specific routes ('/api/public', '/api/auth/totp') must be
// registered before the broader '/api' mount below — otherwise those
// requests would first hit blockRoutes' unconditional requireAuth
// middleware (which runs for anything under '/api' regardless of whether a
// route further down actually matches) and get rejected there instead.
app.use('/api/auth', authRoutes);
app.use('/api/auth/totp', totpRoutes); // /api/auth/totp/status, /setup, /confirm, /disable (auth-gated)
app.use('/api/public', publicRoutes); // /api/public/resume
app.use('/api/public', pdfRoutes); // /api/public/resume.pdf
app.use('/api', blockRoutes); // /api/header, /api/site, /api/blocks... (auth-gated)
app.use('/api', publishRoutes); // /api/publish, /api/publish/status, /api/discard-draft (auth-gated)

// Serve the built client (Vite output) for everything else, including
// client-side routes like /editor and /print — the SPA router handles them.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`resume server listening on port ${PORT}`);
  if (!process.env.RESUMECMS_APP_PASSWORD) {
    console.warn('WARNING: RESUMECMS_APP_PASSWORD is not set. The editor login will not work until it is.');
  }

  // A published snapshot can exist (seeded from pre-existing draft content
  // on first boot after this feature shipped) without a PDF file ever
  // having been generated for it yet — render one now so the download link
  // isn't broken until someone happens to click Publish.
  if (!fs.existsSync(PDF_PATH)) {
    renderResumePdf()
      .then((buffer) => fs.writeFileSync(PDF_PATH, buffer))
      .catch((err) => console.error('Initial PDF generation failed:', err));
  }
});
