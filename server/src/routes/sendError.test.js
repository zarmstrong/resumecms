import test from 'node:test';
import assert from 'node:assert/strict';
import { sendError, handle } from './sendError.js';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('a store error with a status is passed through as-is', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const res = fakeRes();
  const err = Object.assign(new Error('Block not found'), { status: 404 });
  sendError(res, err);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Block not found' });
  assert.equal(logged.mock.callCount(), 0);
});

test('a status error with a cause passes its message through and logs the cause', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const res = fakeRes();
  const cause = new Error('chromium exploded');
  const err = Object.assign(new Error('Published, but the PDF render failed'), { status: 500, cause });
  sendError(res, err);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Published, but the PDF render failed' });
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(logged.mock.calls[0].arguments[1], cause);
});

test('an error without a status is logged and answered generically', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const res = fakeRes();
  sendError(res, new Error('SqliteError: NOT NULL constraint failed: blocks.type'));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Internal server error' });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[1]), /NOT NULL constraint/);
});

test('handle routes sync and async throws through sendError', async () => {
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const r1 = res();
  await handle(() => { const e = new Error('nope'); e.status = 404; throw e; })({}, r1);
  assert.deepEqual([r1.statusCode, r1.body], [404, { error: 'nope' }]);
  const r2 = res();
  await handle(async () => { const e = new Error('later'); e.status = 409; throw e; })({}, r2);
  assert.deepEqual([r2.statusCode, r2.body], [409, { error: 'later' }]);
  const r3 = res();
  await handle(async (req, res) => { res.json({ ok: true }); })({}, r3);
  assert.deepEqual([r3.statusCode, r3.body], [200, { ok: true }]);
});
