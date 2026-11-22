import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionsFromIfMatch, siteRevision } from './siteRevision.js';

test('a revision is a hash of the stored row: equal rows, equal revisions', () => {
  const a = siteRevision({ title: 'T', colors: { accent: '#111111' } });
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(siteRevision({ title: 'T', colors: { accent: '#111111' } }), a);
  assert.notEqual(siteRevision({ title: 'U', colors: { accent: '#111111' } }), a);
  assert.equal(siteRevision(null), siteRevision(undefined));
  assert.notEqual(siteRevision(null), siteRevision({}));
});

test('If-Match names one or several revisions, quoted or not, and * or nothing asks for no check', () => {
  assert.deepEqual(revisionsFromIfMatch('"abc"'), ['abc']);
  assert.deepEqual(revisionsFromIfMatch('abc'), ['abc']);
  assert.deepEqual(revisionsFromIfMatch('W/"abc", "def"'), ['abc', 'def']);
  assert.deepEqual(revisionsFromIfMatch(['"abc"', '"def"']), ['abc', 'def']);
  for (const none of [undefined, '', '  ', '*', '"abc", *', '""']) {
    assert.equal(revisionsFromIfMatch(none), undefined, JSON.stringify(none));
  }
});
