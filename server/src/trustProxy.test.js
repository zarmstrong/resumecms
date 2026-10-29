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

test('a hop count mixed into an address list is rejected', () => {
  assert.throws(() => parseTrustProxy('1, loopback'), /mixes a hop count/);
});

test('subnet names are lowercased for proxy-addr', () => {
  assert.equal(parseTrustProxy('Loopback, UniqueLocal'), 'loopback, uniquelocal');
});

test('applyTrustProxy rejects settings that trust arbitrary addresses', () => {
  for (const raw of ['::ffff:0:0/96', '0.0.0.0/1, 128.0.0.0/1', '::/1, 8000::/1']) {
    assert.throws(() => applyTrustProxy(express(), raw), /trusts arbitrary addresses/, raw);
  }
});

test('applyTrustProxy accepts real proxy ranges and named subnets', () => {
  for (const raw of ['172.18.0.1', 'LOOPBACK', 'loopback, uniquelocal', '173.245.48.0/20', '::FFFF:AC12:1']) {
    assert.doesNotThrow(() => applyTrustProxy(express(), raw), raw);
  }
});

test('applyTrustProxy leaves trust proxy off when unset, and accepts hop counts', () => {
  const off = express();
  applyTrustProxy(off, undefined);
  assert.equal(off.get('trust proxy'), false);
  const hops = express();
  applyTrustProxy(hops, '1');
  assert.equal(hops.get('trust proxy'), 1);
});

test('applyTrustProxy sets the value on the app', () => {
  const app = express();
  applyTrustProxy(app, '172.18.0.1');
  assert.equal(app.get('trust proxy'), '172.18.0.1');
});

test('applyTrustProxy names the variable when Express rejects the value', () => {
  assert.throws(() => applyTrustProxy(express(), ' yes '), /RESUMECMS_TRUST_PROXY value "yes"/);
  // Express itself refuses /0 ranges; make sure that still surfaces with our name on it.
  assert.throws(() => applyTrustProxy(express(), '0.0.0.0/0'), /RESUMECMS_TRUST_PROXY value "0.0.0.0\/0"/);
});
