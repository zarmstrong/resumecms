import { Router } from 'express';

const router = Router();

const APP_PASSWORD = process.env.RESUMECMS_APP_PASSWORD;

router.get('/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!APP_PASSWORD) {
    return res.status(500).json({
      error: 'Server misconfigured: RESUMECMS_APP_PASSWORD is not set. See README for setup.',
    });
  }
  if (password === APP_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ authenticated: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ authenticated: false });
});

export default router;
