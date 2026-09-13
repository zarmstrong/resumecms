import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js'; // ensures schema + seed run on boot
import { accessLogger } from './logger.js';

import authRoutes from './routes/auth.js';
import blockRoutes from './routes/blocks.js';
import publicRoutes from './routes/public.js';
import pdfRoutes from './routes/pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const SESSION_SECRET = process.env.RESUMECMS_SESSION_SECRET || 'dev-secret-change-me';

app.use(accessLogger);
app.use(express.json({ limit: '2mb' }));
app.use(
  cookieSession({
    name: 'zresume_session',
    secret: SESSION_SECRET,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  })
);

// NOTE: mount order matters here. Express matches app.use() by path prefix,
// so the more specific '/api/public' routes must be registered before the
// broader '/api' mount below — otherwise every /api/public/* request would
// first hit blockRoutes' requireAuth middleware and get rejected.
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes); // /api/public/resume
app.use('/api/public', pdfRoutes); // /api/public/resume.pdf
app.use('/api', blockRoutes); // /api/header, /api/site, /api/blocks... (auth-gated)

// Serve the built client (Vite output) for everything else, including
// client-side routes like /editor and /print — the SPA router handles them.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`zresume server listening on port ${PORT}`);
  if (!process.env.RESUMECMS_APP_PASSWORD) {
    console.warn('WARNING: RESUMECMS_APP_PASSWORD is not set. The editor login will not work until it is.');
  }
});
