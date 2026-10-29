import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { applyTrustProxy, parseTrustProxy } from './trustProxy.js';

test('unset, empty, or "false" disables trust proxy', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('  '), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('FALSE'), false);
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
  assert.throws(() => parseTrustProxy('TRUE'), /RESUMECMS_TRUST_PROXY/);
  assert.throws(() => parseTrustProxy('True'), /RESUMECMS_TRUST_PROXY/);
});

test('catch-all subnets are rejected as spoofable', () => {
  for (const raw of ['0.0.0.0/0', '::/0', 'loopback, 0.0.0.0/0', '0.0.0.0/0.0.0.0']) {
    assert.throws(() => parseTrustProxy(raw), /matches every address/, raw);
  }
});

test('applyTrustProxy sets the value on the app', () => {
  const app = express();
  applyTrustProxy(app, '172.18.0.1');
  assert.equal(app.get('trust proxy'), '172.18.0.1');
});

test('applyTrustProxy names the variable when Express rejects the value', () => {
  assert.throws(() => applyTrustProxy(express(), 'yes'), /RESUMECMS_TRUST_PROXY value "yes"/);
});
