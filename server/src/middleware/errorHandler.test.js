import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ERROR } from '../cacheHeaders.js';
import { errorHandler } from './errorHandler.js';

// The final error handler (issue #176), behind the same express.json() as
// index.js, served on a real socket so the parser's errors are its own.

const app = express();
app.use(express.json({ limit: '2mb' }));
app.post('/echo', (req, res) => res.json(req.body));
app.get('/boom', () => {
  throw new Error('SqliteError: secret detail');
});
app.get('/async-boom', async () => {
  throw new Error('async failure');
});
app.get('/teapot', () => {
  throw Object.assign(new Error('I refuse'), { statusCode: 418, expose: true });
});
app.get('/hidden-4xx', () => {
  throw Object.assign(new Error('internal wording'), { status: 403, expose: false });
});
app.get('/bad-gateway', () => {
  throw Object.assign(new Error('upstream said no'), { status: 502 });
});
app.use(errorHandler);
const server = app.listen(0);
after(() => server.close());
const base = () => `http://127.0.0.1:${server.address().port}`;

const post = (body) =>
  fetch(`${base()}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

async function assertJsonError(res, status, error) {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.equal(res.headers.get('cache-control'), ERROR);
  assert.deepEqual(await res.json(), { error });
}

test('a body that parses still reaches its route', async () => {
  const res = await post('{"a":1}');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { a: 1 });
});

test('malformed JSON is a 400 in JSON, without quoting the body', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  await assertJsonError(await post('{"a": nope}'), 400, 'The request body is not valid JSON');
  assert.equal(logged.mock.callCount(), 0);
});

test('a body over the limit is a 413 in JSON', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const big = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024 + 1) });
  await assertJsonError(await post(big), 413, 'The request body is too large');
  assert.equal(logged.mock.callCount(), 0);
});

test('another client error keeps its status, and its message only when exposable', async () => {
  await assertJsonError(await fetch(`${base()}/teapot`), 418, 'I refuse');
  await assertJsonError(await fetch(`${base()}/hidden-4xx`), 403, 'Forbidden');
});

test('an unexpected throw is a logged 500 with no message or stack', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  for (const route of ['/boom', '/async-boom', '/bad-gateway']) {
    const res = await fetch(`${base()}${route}`);
    const text = await res.clone().text();
    await assertJsonError(res, 500, 'Internal server error');
    assert.doesNotMatch(text, /secret|failure|upstream|at /);
  }
  assert.equal(logged.mock.callCount(), 3);
  assert.equal(logged.mock.calls[0].arguments[1].message, 'SqliteError: secret detail');
});

test('once headers are sent it hands the error on untouched', () => {
  const err = new Error('mid-stream');
  const res = {
    headersSent: true,
    set() { throw new Error('must not set headers'); },
    status() { throw new Error('must not set a status'); },
  };
  let passed;
  errorHandler(err, {}, res, (e) => { passed = e; });
  assert.equal(passed, err);
});
