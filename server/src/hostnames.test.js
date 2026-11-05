import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HOSTNAMES, normalizeHostname, normalizeHostnames, requestHostKey } from './hostnames.js';

const statusOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('a domain is stored lowercase, without a trailing dot, internationalized names as xn--', () => {
  assert.equal(normalizeHostname(' Sales.Example.COM. '), 'sales.example.com');
  assert.equal(normalizeHostname('sales.localhost'), 'sales.localhost');
  assert.equal(normalizeHostname('münchen.example'), 'xn--mnchen-3ya.example');
  assert.equal(normalizeHostname('a-b.c-d.example'), 'a-b.c-d.example');
  assert.equal(normalizeHostname('example.com\u3002'), 'example.com', 'an ideographic full stop at the end is a trailing dot too');
});

test('anything that is not a bare domain name is a 400', () => {
  for (const bad of [
    '',
    'localhost',
    'https://sales.example.com',
    'sales.example.com:8080',
    'sales.example.com/path',
    '*.example.com',
    'user@example.com',
    'sales..example.com',
    '-sales.example.com',
    'sales_x.example.com',
    '127.0.0.1',
    '0x7f.1',
    'example.com.\u3002',
    'a b.example.com',
    `${'a'.repeat(64)}.example.com`,
    `${'abc.'.repeat(64)}com`,
    42,
    null,
  ]) {
    assert.equal(statusOf(() => normalizeHostname(bad)), 400, String(bad));
  }
});

test('a list is normalized, deduplicated, sorted and capped', () => {
  assert.deepEqual(normalizeHostnames(['b.example.com', 'A.example.com', 'a.example.com.']), ['a.example.com', 'b.example.com']);
  assert.deepEqual(normalizeHostnames([]), []);
  assert.equal(statusOf(() => normalizeHostnames('a.example.com')), 400);
  assert.equal(statusOf(() => normalizeHostnames(['ok.example.com', 'not ok'])), 400);
  const tooMany = Array.from({ length: MAX_HOSTNAMES + 1 }, (_, i) => `h${i}.example.com`);
  assert.equal(statusOf(() => normalizeHostnames(tooMany)), 400);
  assert.equal(normalizeHostnames(tooMany.slice(1)).length, MAX_HOSTNAMES);
});

test("a request's host is looked up lowercased and without a trailing dot, and never throws", () => {
  assert.equal(requestHostKey('Sales.Example.com.'), 'sales.example.com');
  assert.equal(requestHostKey('127.0.0.1'), '127.0.0.1');
  assert.equal(requestHostKey('MÜNCHEN.example'), normalizeHostname('münchen.example'), 'a Unicode host matches its stored xn-- form');
  assert.equal(requestHostKey('[::1]'), '[::1]', 'what the URL parser rejects is looked up as is');
  assert.equal(requestHostKey(''), null);
  assert.equal(requestHostKey(undefined), null);
});
