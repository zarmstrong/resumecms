import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateSecret } from 'otplib';
import { TOTP_STEP_SECONDS } from './totpConfig.js';
import { verifyCode } from './totpCode.js';

test('a malformed code is null, never a throw', async () => {
  const secret = generateSecret();
  for (const token of ['', '12345', '1234567', 'abcdef', '123 45', undefined, null, 123456]) {
    assert.equal(await verifyCode(secret, token), null, JSON.stringify(token));
  }
  assert.equal(await verifyCode('', '123456'), null);
});

test('a valid code gives the step it was made for', async () => {
  const secret = generateSecret();
  const before = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const step = await verifyCode(secret, await generate({ secret }));
  const after = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  assert.ok(step >= before && step <= after, `${step} within ${before}..${after}`);
});
