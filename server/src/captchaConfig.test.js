import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCaptchaConfig } from './captchaConfig.js';

test('unset or blank provider turns captcha off', () => {
  assert.equal(readCaptchaConfig({}), null);
  assert.equal(readCaptchaConfig({ RESUMECMS_CAPTCHA_PROVIDER: '' }), null);
  assert.equal(readCaptchaConfig({ RESUMECMS_CAPTCHA_PROVIDER: '   ' }), null);
  // Keys alone don't turn it on.
  assert.equal(
    readCaptchaConfig({ RESUMECMS_TURNSTILE_SITE_KEY: 's', RESUMECMS_TURNSTILE_SECRET_KEY: 'k' }),
    null
  );
});

test('an unknown provider throws, naming the variable and the value', () => {
  for (const value of ['turnstyle', 'hcaptcha', 'constructor', '__proto__']) {
    assert.throws(
      () => readCaptchaConfig({ RESUMECMS_CAPTCHA_PROVIDER: value }),
      (err) => err.message.includes('RESUMECMS_CAPTCHA_PROVIDER') && err.message.includes(`"${value}"`)
    );
  }
});

for (const [provider, siteVar, secretVar] of [
  ['turnstile', 'RESUMECMS_TURNSTILE_SITE_KEY', 'RESUMECMS_TURNSTILE_SECRET_KEY'],
  ['recaptcha', 'RESUMECMS_RECAPTCHA_SITE_KEY', 'RESUMECMS_RECAPTCHA_SECRET_KEY'],
]) {
  test(`${provider}: a missing site key throws, naming it`, () => {
    const env = { RESUMECMS_CAPTCHA_PROVIDER: provider, [secretVar]: 'secret' };
    assert.throws(() => readCaptchaConfig(env), (err) => err.message.includes(siteVar) && !err.message.includes(secretVar));
    assert.throws(() => readCaptchaConfig({ ...env, [siteVar]: '  ' }), new RegExp(siteVar));
  });

  test(`${provider}: a missing secret key throws, naming it`, () => {
    const env = { RESUMECMS_CAPTCHA_PROVIDER: provider, [siteVar]: 'site' };
    assert.throws(() => readCaptchaConfig(env), (err) => err.message.includes(secretVar) && !err.message.includes(siteVar));
  });

  test(`${provider}: both keys missing throws, naming both`, () => {
    assert.throws(
      () => readCaptchaConfig({ RESUMECMS_CAPTCHA_PROVIDER: provider }),
      (err) => err.message.includes(siteVar) && err.message.includes(secretVar)
    );
  });

  test(`${provider}: a complete config is enabled`, () => {
    const config = readCaptchaConfig({
      RESUMECMS_CAPTCHA_PROVIDER: ` ${provider.toUpperCase()} `,
      [siteVar]: 'site',
      [secretVar]: 'secret',
    });
    assert.equal(config.provider, provider);
    assert.equal(config.siteKey, 'site');
    assert.equal(config.secretKey, 'secret');
    assert.match(config.verifyUrl, /^https:\/\//);
  });
}
