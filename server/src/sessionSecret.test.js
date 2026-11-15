import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSessionSecret,
  PLACEHOLDER_SECRETS,
  SESSION_SECRET_MIN_LENGTH,
  SessionSecretError,
} from './sessionSecret.js';

test('a missing secret is refused', () => {
  assert.throws(() => checkSessionSecret(undefined), SessionSecretError);
  assert.throws(() => checkSessionSecret(undefined), /not set/);
});

test('a blank secret is refused', () => {
  assert.throws(() => checkSessionSecret(''), /not set/);
  assert.throws(() => checkSessionSecret('   \n'), /not set/);
});

test('every published placeholder is refused, whatever its case or padding', () => {
  for (const placeholder of PLACEHOLDER_SECRETS) {
    assert.throws(() => checkSessionSecret(placeholder), /placeholder/);
    assert.throws(() => checkSessionSecret(` ${placeholder.toUpperCase()}\n`), /placeholder/);
  }
});

test('a secret shorter than the minimum is refused', () => {
  const short = 'a'.repeat(SESSION_SECRET_MIN_LENGTH - 1);
  assert.throws(() => checkSessionSecret(short), /shorter than 32/);
  // Padding doesn't count towards the length.
  assert.throws(() => checkSessionSecret(`  ${short}  `), /shorter than 32/);
});

test('every refusal says how to make one', () => {
  for (const value of [undefined, 'devsecret', 'short']) {
    assert.throws(() => checkSessionSecret(value), /openssl rand -hex 32/);
  }
});

test('a long random secret is returned as given', () => {
  const minimal = 'a'.repeat(SESSION_SECRET_MIN_LENGTH);
  assert.equal(checkSessionSecret(minimal), minimal);
  const hex = '3f'.repeat(32);
  assert.equal(checkSessionSecret(hex), hex);
});
