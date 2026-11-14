import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generate, generateSecret } from 'otplib';
import { hashPassword } from '../passwords.js';
import { TOTP_STEP_SECONDS } from '../totpConfig.js';
import { FACTOR_ERROR, PASSWORD_ERROR, createTotpRouter, readTotp } from './totpRouter.js';

// Setting up, replacing and turning off 2FA (issue #173) over an in-memory
// settings map, served on a real socket behind a logged-in session.

const PASSWORD = 'correct horse battery';
const credentials = { username: 'admin', passwordHash: hashPassword(PASSWORD) };

// `hooks.onTotpRead(n)` runs before the n-th read of the totp row (0
// first), to change it under a request between its check and its write.
async function start(totp, hooks = {}) {
  const settings = new Map([['credentials', credentials]]);
  let totpReads = 0;
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
      getSetting: (key) => {
        if (key === 'totp') hooks.onTotpRead?.(totpReads++, settings);
        return settings.get(key) ?? null;
      },
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
  const none = { lastUsedStep: null };
  assert.deepEqual(readTotp({ secret: 'S', enabled: false }), { enabled: false, secret: null, pendingSecret: 'S', ...none });
  assert.deepEqual(readTotp({ secret: 'S', enabled: true }), { enabled: true, secret: 'S', pendingSecret: null, ...none });
  assert.deepEqual(readTotp(null), { enabled: false, secret: null, pendingSecret: null, ...none });
});

test('enabled reads as login reads it (truthy), keeping only the known fields', () => {
  assert.deepEqual(readTotp({ secret: 'S', enabled: 'true', stray: 1, lastUsedStep: 7 }), {
    enabled: true,
    secret: 'S',
    pendingSecret: null,
    lastUsedStep: 7,
  });
});

test('setup while 2FA is off needs the password, and confirm turns it on', async () => {
  const app = await start(null);
  try {
    for (const body of [{}, { currentPassword: 'wrong' }]) {
      const refused = await app.post('/setup', body);
      assert.equal(refused.status, 401);
      assert.equal(refused.body.error, PASSWORD_ERROR);
    }
    assert.equal(app.settings.get('totp'), undefined);
    const setup = await app.post('/setup', { currentPassword: PASSWORD });
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
    // The confirm code isn't recorded as a login's, so the first login with
    // the new app can use the code still on screen.
    assert.equal(row.lastUsedStep, undefined);
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

test('disable refuses a code already used, with the same message as a wrong password', async () => {
  const active = generateSecret();
  const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + 1;
  const app = await start({ enabled: true, secret: active, lastUsedStep: step });
  try {
    const res = await app.post('/disable', { currentPassword: PASSWORD, totpToken: await code(active) });
    assert.equal(res.status, 401);
    // One message, so it never confirms the password; it says a code
    // works only once.
    assert.equal(res.body.error, FACTOR_ERROR);
    const wrong = await app.post('/disable', { currentPassword: 'not it', totpToken: await code(active) });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, FACTOR_ERROR);
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

test('disable writes nothing if the factor changed while it was checking', async () => {
  const active = generateSecret();
  const replaced = { enabled: true, secret: generateSecret() };
  const app = await start({ enabled: true, secret: active }, {
    onTotpRead: (n, settings) => {
      if (n === 1) settings.set('totp', replaced);
    },
  });
  try {
    const res = await app.post('/disable', { currentPassword: PASSWORD, totpToken: await code(active) });
    assert.equal(res.status, 409);
    assert.equal(app.settings.get('totp'), replaced);
  } finally {
    app.close();
  }
});

test('a code spent by another request while checking is refused, and nothing is written', async () => {
  const active = generateSecret();
  const spent = { enabled: true, secret: active, lastUsedStep: Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + 1 };
  for (const path of ['/disable', '/setup']) {
    const app = await start({ enabled: true, secret: active }, {
      onTotpRead: (n, settings) => {
        if (n === 1) settings.set('totp', spent);
      },
    });
    try {
      const res = await app.post(path, { currentPassword: PASSWORD, totpToken: await code(active) });
      assert.equal(res.status, 401, path);
      assert.equal(res.body.error, FACTOR_ERROR, path);
      assert.equal(app.settings.get('totp'), spent, path);
    } finally {
      app.close();
    }
  }
});

test('setup writes nothing if the row changed while it was checking (2FA turned on elsewhere)', async () => {
  const other = { enabled: true, secret: generateSecret() };
  const app = await start(null, {
    onTotpRead: (n, settings) => {
      if (n === 1) settings.set('totp', other);
    },
  });
  try {
    const res = await app.post('/setup', { currentPassword: PASSWORD });
    assert.equal(res.status, 409);
    assert.equal(app.settings.get('totp'), other);
  } finally {
    app.close();
  }
});

test('a code that is not six digits is a wrong code, not a 500', async () => {
  const active = generateSecret();
  const app = await start({ enabled: true, secret: active, pendingSecret: generateSecret() });
  try {
    // Three tokens x three routes = 9 failures, under the limiter's 10.
    for (const totpToken of ['12345', 'abcdef', '123 45']) {
      for (const path of ['/disable', '/setup']) {
        const res = await app.post(path, { currentPassword: PASSWORD, totpToken });
        assert.equal(res.status, 401, `${path} ${JSON.stringify(totpToken)}`);
        assert.equal(res.body.error, FACTOR_ERROR);
      }
      assert.equal((await app.post('/confirm', { token: totpToken })).status, 400);
    }
    assert.equal(app.settings.get('totp').secret, active);
  } finally {
    app.close();
  }
});
