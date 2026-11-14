import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generate, generateSecret } from 'otplib';
import { hashPassword } from '../passwords.js';
import { TOTP_STEP_SECONDS } from '../totpConfig.js';
import { CODE_USED_ERROR, createTotpRouter, readTotp } from './totpRouter.js';

// Setting up, replacing and turning off 2FA (issue #173) over an in-memory
// settings map, served on a real socket behind a logged-in session.

const PASSWORD = 'correct horse battery';
const credentials = { username: 'admin', passwordHash: hashPassword(PASSWORD) };

async function start(totp) {
  const settings = new Map([['credentials', credentials]]);
  if (totp) settings.set('totp', totp);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { authenticated: true };
    next();
  });
  app.use(
    '/totp',
    createTotpRouter({
      getSetting: (key) => settings.get(key) ?? null,
      setSetting: (key, value) => settings.set(key, value),
    }),
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/totp${path}`, {
      method: path === '/status' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: path === '/status' ? undefined : JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json() };
  };
  return { settings, post, close: () => server.close() };
}

const code = (secret) => generate({ secret });

test('an old-shape row with a secret and enabled: false reads as a pending setup', () => {
  assert.deepEqual(readTotp({ secret: 'S', enabled: false }), { enabled: false, secret: null, pendingSecret: 'S' });
  assert.deepEqual(readTotp({ secret: 'S', enabled: true }), { secret: 'S', enabled: true, pendingSecret: null });
  assert.deepEqual(readTotp(null), { enabled: false, secret: null, pendingSecret: null });
});

test('setup while 2FA is off needs only the session, and confirm turns it on', async () => {
  const app = await start(null);
  try {
    const setup = await app.post('/setup');
    assert.equal(setup.status, 200);
    assert.equal(app.settings.get('totp').enabled, false);
    assert.equal(app.settings.get('totp').pendingSecret, setup.body.secret);

    const confirm = await app.post('/confirm', { token: await code(setup.body.secret) });
    assert.equal(confirm.status, 200);
    const row = app.settings.get('totp');
    assert.equal(row.enabled, true);
    assert.equal(row.secret, setup.body.secret);
    assert.equal(row.pendingSecret, undefined);
  } finally {
    app.close();
  }
});

test('confirm still works for a setup stored in the old shape', async () => {
  const secret = generateSecret();
  const app = await start({ secret, enabled: false });
  try {
    const confirm = await app.post('/confirm', { token: await code(secret) });
    assert.equal(confirm.status, 200);
    assert.equal(app.settings.get('totp').secret, secret);
    assert.equal(app.settings.get('totp').enabled, true);
  } finally {
    app.close();
  }
});

test('replacing an active factor needs the password and a current code', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active });
  try {
    assert.equal((await app.post('/setup')).status, 401);
    assert.equal((await app.post('/setup', { currentPassword: PASSWORD })).status, 401);
    assert.equal((await app.post('/setup', { totpToken: await code(active) })).status, 401);
    assert.equal((await app.post('/setup', { currentPassword: 'wrong', totpToken: await code(active) })).status, 401);
    assert.deepEqual(app.settings.get('totp'), { enabled: true, secret: active });
  } finally {
    app.close();
  }
});

test('setup while 2FA is on keeps the active factor until confirm, and an abandoned or failed one leaves it', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active });
  try {
    const setup = await app.post('/setup', { currentPassword: PASSWORD, totpToken: await code(active) });
    assert.equal(setup.status, 200);
    let row = app.settings.get('totp');
    assert.equal(row.enabled, true);
    assert.equal(row.secret, active);
    assert.equal(row.pendingSecret, setup.body.secret);
    assert.equal((await app.post('/status')).body.enabled, true);

    // A wrong code, or a code from the active factor, doesn't swap it in.
    assert.equal((await app.post('/confirm', { token: '000000' })).status, 400);
    if ((await code(active)) !== (await code(setup.body.secret))) {
      assert.equal((await app.post('/confirm', { token: await code(active) })).status, 400);
    }
    row = app.settings.get('totp');
    assert.equal(row.enabled, true);
    assert.equal(row.secret, active);

    // Abandoned: nothing else happens, and the active secret is still the one checked.
    assert.equal(readTotp(app.settings.get('totp')).secret, active);
  } finally {
    app.close();
  }
});

test('confirm with a code from the pending secret swaps it in', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active });
  try {
    const setup = await app.post('/setup', { currentPassword: PASSWORD, totpToken: await code(active) });
    const confirm = await app.post('/confirm', { token: await code(setup.body.secret) });
    assert.equal(confirm.status, 200);
    const row = app.settings.get('totp');
    assert.equal(row.enabled, true);
    assert.equal(row.secret, setup.body.secret);
    assert.equal(row.pendingSecret, undefined);
    assert.equal(typeof row.lastUsedStep, 'number');
    assert.equal((await app.post('/confirm', { token: await code(setup.body.secret) })).status, 409);
  } finally {
    app.close();
  }
});

test('disable without the password and a current code is refused', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active });
  try {
    assert.equal((await app.post('/disable')).status, 401);
    assert.equal((await app.post('/disable', { currentPassword: PASSWORD })).status, 401);
    assert.equal((await app.post('/disable', { totpToken: await code(active) })).status, 401);
    assert.equal((await app.post('/disable', { currentPassword: PASSWORD, totpToken: '000000' })).status, 401);
    assert.equal(app.settings.get('totp').enabled, true);
  } finally {
    app.close();
  }
});

test('disable refuses a code already used, and says so only with the right password', async () => {
  const active = generateSecret();
  const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + 1;
  const app = await start({ enabled: true, secret: active, lastUsedStep: step });
  try {
    const res = await app.post('/disable', { currentPassword: PASSWORD, totpToken: await code(active) });
    assert.equal(res.status, 401);
    // Not "incorrect": the code is right, just spent (e.g. by the login).
    assert.equal(res.body.error, CODE_USED_ERROR);
    const wrong = await app.post('/disable', { currentPassword: 'not it', totpToken: await code(active) });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'Incorrect password or code');
    assert.equal(app.settings.get('totp').enabled, true);
  } finally {
    app.close();
  }
});

test('disable with the password and a current code turns 2FA off', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active });
  try {
    const res = await app.post('/disable', { currentPassword: PASSWORD, totpToken: await code(active) });
    assert.equal(res.status, 200);
    assert.equal(app.settings.get('totp'), null);
    assert.equal((await app.post('/status')).body.enabled, false);
  } finally {
    app.close();
  }
});

test('failed attempts are rate-limited like login', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active });
  try {
    for (let i = 0; i < 10; i++) {
      assert.equal((await app.post('/disable', { currentPassword: 'wrong', totpToken: '000000' })).status, 401);
    }
    const limited = await app.post('/disable', { currentPassword: PASSWORD, totpToken: await code(active) });
    assert.equal(limited.status, 429);
    assert.equal(app.settings.get('totp').enabled, true);
  } finally {
    app.close();
  }
});
