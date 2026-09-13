import { Router } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { getSetting, setSetting } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.use(requireAuth);

router.get('/status', (req, res) => {
  const totp = getSetting('totp');
  res.json({ enabled: totp?.enabled === true });
});

router.post('/setup', async (req, res) => {
  const secret = authenticator.generateSecret();
  setSetting('totp', { secret, enabled: false });

  const username = process.env.RESUMECMS_ADMIN_USERNAME || 'admin';
  const otpauthUrl = authenticator.keyuri(username, 'ResumeCMS', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  res.json({ secret, otpauthUrl, qrDataUrl });
});

router.post('/confirm', (req, res) => {
  const { token } = req.body || {};
  const totp = getSetting('totp');
  if (!totp?.secret) {
    return res.status(409).json({ error: 'No 2FA setup in progress' });
  }
  if (typeof token !== 'string' || !authenticator.check(token, totp.secret)) {
    return res.status(400).json({ error: 'Incorrect code' });
  }
  setSetting('totp', { secret: totp.secret, enabled: true });
  res.json({ enabled: true });
});

router.post('/disable', (req, res) => {
  setSetting('totp', null);
  res.json({ enabled: false });
});

export default router;
