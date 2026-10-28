import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustProxy } from './trustProxy.js';

test('unset, empty, or "false" disables trust proxy', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('  '), false);
  assert.equal(parseTrustProxy('false'), false);
});

test('an integer is a hop count', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 2 '), 2);
});

test('addresses and subnet names pass through as a string', () => {
  assert.equal(parseTrustProxy('172.18.0.1'), '172.18.0.1');
  assert.equal(parseTrustProxy('loopback, uniquelocal'), 'loopback, uniquelocal');
});

test('"true" is rejected as spoofable', () => {
  assert.throws(() => parseTrustProxy('true'), /RESUMECMS_TRUST_PROXY/);
});
