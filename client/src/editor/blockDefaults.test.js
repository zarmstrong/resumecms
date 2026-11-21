import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPE_LABELS, NESTABLE_TYPES, defaultDataForType } from './blockDefaults.js';

// That NESTABLE_TYPES matches the server's is checked in
// server/src/resumeStore.test.js: importing resumeStore.js here would need
// the server's npm packages, which the client's CI job doesn't install.
test('a credential is nestable, labelled, and starts as a certification', () => {
  assert.ok(NESTABLE_TYPES.has('credentials'));
  assert.equal(BLOCK_TYPE_LABELS.credentials, 'Credential');
  assert.deepEqual(defaultDataForType('credentials'), { kind: 'certification', name: 'Credential name', issuer: '', number: '', issued: '', expires: '', url: '' });
});

test('a languages block is nestable, labelled, and starts with one language', () => {
  assert.ok(NESTABLE_TYPES.has('languages'));
  assert.equal(BLOCK_TYPE_LABELS.languages, 'Languages');
  assert.deepEqual(defaultDataForType('languages'), { entries: [{ language: 'Language', level: '' }] });
});
