import { readCaptchaConfig } from './captchaConfig.js';

// Read once, at import: index.js loads this through routes/auth.js, so a
// misconfigured captcha throws (and the server exits non-zero) before it
// ever listens, never on the first login.
const selected = readCaptchaConfig(process.env);
export const captchaEnabled = selected !== null;

// Safe to expose to anyone — captcha site keys are public by design.
export function publicCaptchaConfig() {
  if (!captchaEnabled) return { provider: null, siteKey: null };
  return { provider: selected.provider, siteKey: selected.siteKey };
}

export async function verifyCaptcha(token, remoteIp) {
  if (!captchaEnabled) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret: selected.secretKey, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(selected.verifyUrl, { method: 'POST', body });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('Captcha verification request failed:', err);
    return false;
  }
}
