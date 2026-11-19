import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationHref, publicationKindLabel } from './publications.js';

test('a publication kind is labelled, and anything else is an article', () => {
  assert.equal(publicationKindLabel('article'), 'Article');
  assert.equal(publicationKindLabel('paper'), 'Paper');
  assert.equal(publicationKindLabel('book'), 'Book');
  assert.equal(publicationKindLabel('chapter'), 'Chapter');
  assert.equal(publicationKindLabel('talk'), 'Talk');
  assert.equal(publicationKindLabel('podcast'), 'Podcast');
  assert.equal(publicationKindLabel('press'), 'Press');
  for (const kind of ['unknown', undefined, 'toString']) assert.equal(publicationKindLabel(kind), 'Article', String(kind));
});

test('a publication links to its absolute http(s) URL, as written by the parser', () => {
  assert.equal(publicationHref({ url: 'https://example.com/paper' }), 'https://example.com/paper');
  assert.equal(publicationHref({ url: 'http://example.com/talk' }), 'http://example.com/talk');
  assert.equal(publicationHref({ url: 'HTTPS://Example.com/Paper' }), 'https://example.com/Paper');
});

test('a publication URL wins over its DOI', () => {
  assert.equal(publicationHref({ url: 'https://example.com/paper', doi: '10.1234/abcd' }), 'https://example.com/paper');
});

test('a publication without a safe URL links to its DOI', () => {
  for (const url of ['javascript:alert(1)', '/x', 'tel:1', '']) {
    assert.equal(publicationHref({ url, doi: '10.1234/abcd' }), 'https://doi.org/10.1234/abcd', url);
  }
});

test('a publication with no URL and no valid DOI has no link', () => {
  assert.equal(publicationHref({ url: '', doi: 'abc' }), null);
  assert.equal(publicationHref({ url: '/x', doi: 'abc' }), null);
  assert.equal(publicationHref({}), null);
  assert.equal(publicationHref(undefined), null);
});
