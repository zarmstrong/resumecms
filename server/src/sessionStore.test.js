import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { SESSION_MAX_AGE_MS, createSessionStore } from './sessionStore.js';

// The server-side login records (issue #172) over ':memory:', on a clock
// the test moves.
function setup() {
  const db = new Database(':memory:');
  ensureSchema(db);
  const clock = { now: 1_000_000 };
  const sessions = createSessionStore(db, { now: () => clock.now });
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  return { db, clock, sessions, count };
}

test('a new session is valid, and only its hash is stored', () => {
  const { db, sessions } = setup();
  const token = sessions.create();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessions.isValid(token), true);
  const rows = db.prepare('SELECT * FROM sessions').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.equal(rows[0].expires_at - rows[0].created_at, SESSION_MAX_AGE_MS);
});

test('tokens are unguessable: unknown, malformed and non-string ones are refused', () => {
  const { sessions } = setup();
  const token = sessions.create();
  assert.notEqual(sessions.create(), token);
  for (const bad of [undefined, null, '', 'x', token.slice(1), `${token}=`, 42, { token }, 'A'.repeat(43)]) {
    assert.equal(sessions.isValid(bad), false, String(bad));
  }
});

test('a session expires 30 days after it was made, however much it was used, and is deleted then', () => {
  const { clock, sessions, count } = setup();
  const token = sessions.create();
  clock.now += SESSION_MAX_AGE_MS - 1;
  assert.equal(sessions.isValid(token), true);
  clock.now += 1;
  assert.equal(sessions.isValid(token), false);
  assert.equal(count(), 0);
});

test('replace gives a new token for the same login, expiring when the old one would', () => {
  const { db, clock, sessions } = setup();
  const token = sessions.create();
  clock.now += SESSION_MAX_AGE_MS - 10;
  const next = sessions.replace(token);
  assert.match(next, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(next, token);
  // Both live until the caller removes the old one.
  assert.equal(sessions.isValid(token), true);
  assert.equal(sessions.isValid(next), true);
  const rows = db.prepare('SELECT created_at, expires_at FROM sessions').all();
  assert.deepEqual(rows[0], rows[1]);
  clock.now += 10;
  assert.equal(sessions.isValid(next), false);
});

test('replace refuses anything but a live session', () => {
  const { clock, sessions, count } = setup();
  for (const bad of [undefined, null, '', 'x', 'A'.repeat(43)]) assert.equal(sessions.replace(bad), null, String(bad));
  const token = sessions.create();
  clock.now += SESSION_MAX_AGE_MS;
  assert.equal(sessions.replace(token), null);
  assert.equal(count(), 0);
});

test('remove ends one session, removeOthers every other one', () => {
  const { sessions } = setup();
  const [a, b, c] = [sessions.create(), sessions.create(), sessions.create()];
  sessions.remove(a);
  assert.equal(sessions.isValid(a), false);
  assert.equal(sessions.isValid(b), true);
  sessions.removeOthers(b);
  assert.equal(sessions.isValid(b), true);
  assert.equal(sessions.isValid(c), false);
});

test('removeOthers without a usable token of its own removes them all', () => {
  const { sessions, count } = setup();
  sessions.create();
  sessions.create();
  sessions.removeOthers(null);
  assert.equal(count(), 0);
});

test('prune deletes only the expired rows', () => {
  const { clock, sessions, count } = setup();
  sessions.create();
  clock.now += SESSION_MAX_AGE_MS / 2;
  const fresh = sessions.create();
  clock.now += SESSION_MAX_AGE_MS / 2;
  sessions.prune();
  assert.equal(count(), 1);
  assert.equal(sessions.isValid(fresh), true);
});
