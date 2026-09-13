import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { publicCaptchaConfig, verifyCaptcha } from '../captcha.js';

const router = Router();

const APP_PASSWORD = process.env.RESUMECMS_APP_PASSWORD;

// Hashing both sides to a fixed length before comparing means a mismatched
// password length can't itself leak an early exit, and timingSafeEqual
// keeps the comparison itself from leaking how many leading bytes matched.
function passwordMatches(candidate) {
  const a = createHash('sha256').update(String(candidate)).digest();
  const b = createHash('sha256').update(APP_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

// Brute-force protection: only failed attempts count against the limit, so
// a legitimate user who logs in successfully is never penalized.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again later.' },
});

router.get('/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

router.get('/captcha-config', (req, res) => {
  res.json(publicCaptchaConfig());
});

router.post('/login', loginLimiter, async (req, res) => {
  const { password, captchaToken } = req.body || {};
  if (!APP_PASSWORD) {
    return res.status(500).json({
      error: 'Server misconfigured: RESUMECMS_APP_PASSWORD is not set. See README for setup.',
    });
  }

  const captchaOk = await verifyCaptcha(captchaToken, req.ip);
  if (!captchaOk) {
    return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }

  if (typeof password === 'string' && passwordMatches(password)) {
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
