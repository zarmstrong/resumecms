import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieSession from 'cookie-session';
import Database from 'better-sqlite3';
import { isAuthenticated, sessionCookieOptions, useSessionStore } from '../authSessions.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { hashPassword } from '../passwords.js';
import { ensureSchema } from '../schema.js';
import { SESSION_MAX_AGE_MS, createSessionStore } from '../sessionStore.js';
import { generate, generateSecret } from 'otplib';
import { createAuthRouter } from './authRouter.js';

// Logins are revocable (issue #172): served on a real socket with the real
// signed cookie, an in-memory settings map and a session store over
// ':memory:' on a clock the test moves.

const PASSWORD = 'correct horse battery';
const SECRET = 'test-session-secret-'.padEnd(40, 'x');

// `onRead(key, n, settings)` runs before the n-th read (0 first) of a
// setting, to change it under a request between its awaits.
async function start({ store = true, onRead } = {}) {
  const settings = new Map([['credentials', { username: 'admin', passwordHash: hashPassword(PASSWORD) }]]);
  const reads = new Map();
  const db = new Database(':memory:');
  ensureSchema(db);
  const clock = { now: Date.now() };
  const sessions = createSessionStore(db, { now: () => clock.now });
  useSessionStore(store ? sessions : null);

  const app = express();
  app.use(express.json());
  app.use(cookieSession(sessionCookieOptions(SECRET)));
  // A cookie as the server signed them before issue #172.
  app.post('/forge-old-cookie', (req, res) => {
    req.session = { authenticated: true };
    res.json({});
  });
  app.get('/protected', requireAuth, (req, res) => res.json({ ok: true }));
  app.use(
    '/auth',
    createAuthRouter({
      getSetting: (key) => {
        const n = reads.get(key) ?? 0;
        reads.set(key, n + 1);
        onRead?.(key, n, settings);
        return settings.get(key) ?? null;
      },
      setSetting: (key, value) => settings.set(key, value),
    }),
  );
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // A browser: its own cookie jar, kept from each response's Set-Cookie.
  function browser(cookie = '') {
    const jar = new Map(cookie ? cookie.split('; ').map((pair) => pair.split(/=(.*)/s).slice(0, 2)) : []);
    async function call(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split('; ');
        const [name, value] = pair.split(/=(.*)/s);
        if (!value || attrs.some((a) => /^expires=Thu, 01 Jan 1970/i.test(a))) jar.delete(name);
        else jar.set(name, value);
      }
      return { status: res.status, body: await res.json() };
    }
    return {
      get: (path) => call('GET', path),
      post: (path, body) => call('POST', path, body),
      cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      loggedIn: async () => (await call('GET', '/auth/status')).body.authenticated,
    };
  }

  async function login(as = browser()) {
    const res = await as.post('/auth/login', { username: 'admin', password: PASSWORD });
    assert.equal(res.status, 200);
    return as;
  }

  return { settings, sessions, clock, db, browser, login, close: () => server.close() };
}

test('a login is good until logout, and a copy of its cookie stops working with it', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    assert.equal(await tab.loggedIn(), true);
    assert.equal((await tab.get('/protected')).status, 200);
    const copy = app.browser(tab.cookie());
    assert.equal((await copy.get('/protected')).status, 200);

    assert.equal((await tab.post('/auth/logout')).status, 200);
    assert.equal(await tab.loggedIn(), false);
    assert.equal((await copy.get('/protected')).status, 401);
    assert.equal(await copy.loggedIn(), false);
  } finally {
    app.close();
  }
});

test('the cookie holds only a token, never `authenticated`', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    const value = tab.cookie().match(/resume_session=([^;]+)/)[1];
    const session = JSON.parse(Buffer.from(value, 'base64').toString());
    assert.deepEqual(Object.keys(session), ['token']);
  } finally {
    app.close();
  }
});

test('a session replayed after its 30 days is refused, and its row pruned', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    app.clock.now += SESSION_MAX_AGE_MS - 1000;
    assert.equal((await tab.get('/protected')).status, 200);
    app.clock.now += 1000;
    assert.equal((await tab.get('/protected')).status, 401);
    assert.equal(await tab.loggedIn(), false);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  } finally {
    app.close();
  }
});

test('a login prunes expired sessions', async () => {
  const app = await start();
  try {
    await app.login();
    app.clock.now += SESSION_MAX_AGE_MS;
    await app.login();
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  } finally {
    app.close();
  }
});

test('logging in again in the same browser replaces its old session', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    const before = app.browser(tab.cookie());
    await app.login(tab);
    assert.equal(await tab.loggedIn(), true);
    assert.equal(await before.loggedIn(), false);
  } finally {
    app.close();
  }
});

test('a signed cookie from before server-side sessions is not a login', async () => {
  const app = await start();
  try {
    const old = app.browser();
    await old.post('/forge-old-cookie');
    assert.match(old.cookie(), /resume_session\.sig=/);
    assert.equal(await old.loggedIn(), false);
    assert.equal((await old.get('/protected')).status, 401);
    assert.equal((await old.get('/auth/credentials')).status, 401);
  } finally {
    app.close();
  }
});

test('a new password signs out every other session and a copy of this one, and this one stays', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    const other = await app.login();
    const copy = app.browser(tab.cookie());
    const res = await tab.post('/auth/credentials', { currentPassword: PASSWORD, newUsername: 'admin', newPassword: 'a new password' });
    assert.equal(res.status, 200);
    assert.equal(await tab.loggedIn(), true);
    assert.equal((await tab.get('/protected')).status, 200);
    assert.equal(await other.loggedIn(), false);
    // The tab got a new cookie; a copy of its old one (stolen, say) is out.
    assert.notEqual(tab.cookie(), copy.cookie());
    assert.equal(await copy.loggedIn(), false);
  } finally {
    app.close();
  }
});

test('a new password never extends the login: the new cookie expires when the old one would', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    app.clock.now += SESSION_MAX_AGE_MS - 1000;
    const res = await tab.post('/auth/credentials', { currentPassword: PASSWORD, newUsername: 'admin', newPassword: 'a new password' });
    assert.equal(res.status, 200);
    assert.equal(await tab.loggedIn(), true);
    app.clock.now += 1000;
    assert.equal(await tab.loggedIn(), false);
  } finally {
    app.close();
  }
});

test('a new username signs out every other session too', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    const other = await app.login();
    const res = await tab.post('/auth/credentials', { currentPassword: PASSWORD, newUsername: 'someone' });
    assert.equal(res.status, 200);
    assert.equal(await tab.loggedIn(), true);
    assert.equal(await other.loggedIn(), false);
  } finally {
    app.close();
  }
});

test('saving the credentials unchanged, or a refused change, signs nobody out', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    const other = await app.login();
    assert.equal((await tab.post('/auth/credentials', { currentPassword: PASSWORD, newUsername: 'admin' })).status, 200);
    assert.equal((await tab.post('/auth/credentials', { currentPassword: 'wrong', newUsername: 'x', newPassword: 'whatever123' })).status, 401);
    assert.equal(await other.loggedIn(), true);
  } finally {
    app.close();
  }
});

test('with no session store nothing is logged in, and a login fails', async () => {
  const app = await start({ store: false });
  try {
    const tab = app.browser();
    const res = await tab.post('/auth/login', { username: 'admin', password: PASSWORD });
    assert.equal(res.status, 500);
    assert.equal(await tab.loggedIn(), false);
    assert.equal((await tab.get('/protected')).status, 401);

    // Not even with a token the store would know.
    const token = app.sessions.create();
    assert.equal(isAuthenticated({ session: { token } }), false);
    useSessionStore(app.sessions);
    assert.equal(isAuthenticated({ session: { token } }), true);
  } finally {
    app.close();
  }
});

const sessionCount = (app) => app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
const changedCredentials = () => ({ username: 'admin', passwordHash: hashPassword('a whole new password') });

test('a password changed while a login waits on its captcha refuses the old one', async () => {
  // Read 0 is the up-front check; read 1, after the captcha's await, sees the change.
  const app = await start({ onRead: (key, n, settings) => key === 'credentials' && n === 1 && settings.set(key, changedCredentials()) });
  try {
    const res = await app.browser().post('/auth/login', { username: 'admin', password: PASSWORD });
    assert.equal(res.status, 401);
    assert.equal(sessionCount(app), 0);
  } finally {
    app.close();
  }
});

test('a password changed while a login checks its 2FA code starts no session', async () => {
  const secret = generateSecret();
  // The totp row's second read is the one after the code's await.
  const app = await start({ onRead: (key, n, settings) => key === 'totp' && n === 1 && settings.set('credentials', changedCredentials()) });
  app.settings.set('totp', { enabled: true, secret });
  try {
    const res = await app.browser().post('/auth/login', { username: 'admin', password: PASSWORD, totpToken: await generate({ secret }) });
    assert.equal(res.status, 401);
    assert.equal(sessionCount(app), 0);
  } finally {
    app.close();
  }
});

test('with no session store a login fails before its 2FA code is spent', async () => {
  const secret = generateSecret();
  const app = await start({ store: false });
  app.settings.set('totp', { enabled: true, secret });
  try {
    const res = await app.browser().post('/auth/login', { username: 'admin', password: PASSWORD, totpToken: await generate({ secret }) });
    assert.equal(res.status, 500);
    assert.equal(app.settings.get('totp').lastUsedStep, undefined);
  } finally {
    app.close();
  }
});

test('a new password is not saved if the other sessions could not be signed out', async () => {
  const app = await start();
  try {
    const tab = await app.login();
    const other = await app.login();
    const before = app.settings.get('credentials');
    app.sessions.removeOthers = () => {
      throw new Error('disk I/O error');
    };
    const res = await tab.post('/auth/credentials', { currentPassword: PASSWORD, newUsername: 'admin', newPassword: 'a new password' });
    assert.equal(res.status, 500);
    assert.deepEqual(app.settings.get('credentials'), before);
    assert.equal(await other.loggedIn(), true);
  } finally {
    app.close();
  }
});

test('a session signed out while its credentials change waited changes nothing and signs nobody out', async () => {
  let armed = false;
  let app;
  // The tab's row is the first one (it logged in first); deleted when the
  // handler reads the credentials, as another tab's change would have.
  app = await start({
    onRead: (key) => {
      if (armed && key === 'credentials') app.db.prepare('DELETE FROM sessions WHERE rowid = (SELECT MIN(rowid) FROM sessions)').run();
    },
  });
  try {
    const tab = await app.login();
    const other = await app.login();
    const before = app.settings.get('credentials');
    armed = true;
    const res = await tab.post('/auth/credentials', { currentPassword: PASSWORD, newUsername: 'admin', newPassword: 'a new password' });
    armed = false;
    assert.equal(res.status, 401);
    assert.deepEqual(app.settings.get('credentials'), before);
    assert.equal(await tab.loggedIn(), false);
    assert.equal(await other.loggedIn(), true);
  } finally {
    app.close();
  }
});
