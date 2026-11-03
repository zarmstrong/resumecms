import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpAuth, MCP_TOKEN_MIN_LENGTH } from './mcpAuth.js';

const TOKEN = 'a'.repeat(MCP_TOKEN_MIN_LENGTH) + 'secret-tail-xyz';

function run(middleware, authorization) {
  const req = { headers: authorization === undefined ? {} : { authorization }, session: { authenticated: false } };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled, req };
}

const silent = { error() {}, warn() {} };

test('404 when no token is configured', () => {
  for (const raw of [undefined, '', '   \n']) {
    const { res, nextCalled } = run(createMcpAuth(raw, { log: silent }), `Bearer ${TOKEN}`);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  }
});

test('a token shorter than the minimum is refused and logged', () => {
  const logged = [];
  const short = 'x'.repeat(MCP_TOKEN_MIN_LENGTH - 1);
  const mw = createMcpAuth(short, { log: { error: (m) => logged.push(m) } });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /shorter than/);
  const { res, nextCalled } = run(mw, `Bearer ${short}`);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
});

test('401 on a missing, malformed, wrong, or wrong-length header', () => {
  const mw = createMcpAuth(TOKEN, { log: silent });
  for (const header of [undefined, '', 'Basic abc', TOKEN, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(0, -1)}`, 'Bearer nope', 'Bearer ']) {
    const { res, nextCalled } = run(mw, header);
    assert.equal(nextCalled, false, `header ${JSON.stringify(header)} should be rejected`);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Not authenticated' });
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer realm="resumecms-mcp"');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('logs each failed attempt, with the client address and reason', () => {
  const warned = [];
  const mw = createMcpAuth(TOKEN, { log: { error() {}, warn: (m) => warned.push(JSON.parse(m)) } });
  // Behind a reverse proxy req.ip is the proxy's address, so the forwarded
  // header is logged as received alongside it.
  const req = { headers: { authorization: 'Bearer nope', 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, ip: '203.0.113.9' };
  const res = { set() { return this; }, status() { return this; }, json() { return this; } };
  mw(req, res, () => assert.fail('must not pass'));
  mw({ headers: {}, ip: '203.0.113.9' }, res, () => assert.fail('must not pass'));
  mw({ headers: { authorization: `Bearer ${TOKEN}` }, ip: '203.0.113.9' }, res, () => {});
  assert.deepEqual(
    warned.map(({ event, ip, forwardedFor, reason }) => [event, ip, forwardedFor, reason]),
    [
      ['mcp_auth_failed', '203.0.113.9', '198.51.100.7, 10.0.0.1', 'wrong token'],
      ['mcp_auth_failed', '203.0.113.9', null, 'no bearer token'],
    ]
  );
});

test('passes on an exact match, case-insensitive scheme, and trims a trailing newline from the env value', () => {
  for (const configured of [TOKEN, `${TOKEN}\n`, `  ${TOKEN}  `]) {
    const mw = createMcpAuth(configured, { log: silent });
    for (const header of [`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `Bearer   ${TOKEN}`]) {
      const { res, nextCalled, req } = run(mw, header);
      assert.equal(nextCalled, true, `${JSON.stringify(configured)} / ${JSON.stringify(header)}`);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(req.session, { authenticated: false }, 'must not touch the session');
    }
  }
});
