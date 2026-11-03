import test from 'node:test';
import assert from 'node:assert/strict';
import { sendError } from './sendError.js';

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
