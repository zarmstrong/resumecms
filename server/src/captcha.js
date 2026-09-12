const RAW_PROVIDER = (process.env.RESUMECMS_CAPTCHA_PROVIDER || '').trim().toLowerCase();

const PROVIDER_CONFIGS = {
  turnstile: {
    siteKey: process.env.RESUMECMS_TURNSTILE_SITE_KEY,
    secretKey: process.env.RESUMECMS_TURNSTILE_SECRET_KEY,
    verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  },
  recaptcha: {
    siteKey: process.env.RESUMECMS_RECAPTCHA_SITE_KEY,
    secretKey: process.env.RESUMECMS_RECAPTCHA_SECRET_KEY,
    verifyUrl: 'https://www.google.com/recaptcha/api/siteverify',
  },
};

const selected = PROVIDER_CONFIGS[RAW_PROVIDER];
export const captchaEnabled = Boolean(selected && selected.siteKey && selected.secretKey);

if (RAW_PROVIDER && !captchaEnabled) {
  const reason = !selected
    ? `unknown provider "${RAW_PROVIDER}" (expected "turnstile" or "recaptcha")`
    : 'its site/secret key env vars are not both set';
  console.warn(`WARNING: RESUMECMS_CAPTCHA_PROVIDER is set but ${reason} — captcha login protection is disabled.`);
}

// Safe to expose to anyone — captcha site keys are public by design.
export function publicCaptchaConfig() {
  if (!captchaEnabled) return { provider: null, siteKey: null };
  return { provider: RAW_PROVIDER, siteKey: selected.siteKey };
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
