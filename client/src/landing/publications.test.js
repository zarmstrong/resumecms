import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLICATION_KINDS, PUBLICATION_ORDERS, arrangePublications, cleanDoi, doiUrl, isDoi, isDraftDoi, newestFirst } from './publications.js';
// The server's copy, which this one mirrors, and the cases both must pass.
// Node builtins only, so they load without the server's dependencies.
import * as server from '../../../server/src/publications.js';
import { CLEAN_DOI_CASES, DOI_CASES, NEWEST_CASES } from '../../../server/src/publications.cases.js';

test('tells a DOI exactly as the server does', () => {
  for (const [text, doi, draft, url] of DOI_CASES) {
    const what = JSON.stringify(text);
    for (const copy of [{ isDoi, isDraftDoi, doiUrl }, server]) {
      assert.equal(copy.isDoi(text), doi, what);
      assert.equal(copy.isDraftDoi(text), draft, what);
      assert.equal(copy.doiUrl(text), url, what);
    }
  }
  for (const [pasted, kept] of CLEAN_DOI_CASES) {
    assert.equal(cleanDoi(pasted), kept, pasted);
    assert.equal(server.cleanDoi(pasted), kept, pasted);
  }
});

test('sorts newest first exactly as the server does', () => {
  for (const [dates, order] of NEWEST_CASES) {
    const entries = dates.map((date, i) => ({ i, date }));
    assert.deepEqual(newestFirst(entries).map((entry) => entry.i), order, JSON.stringify(dates));
    assert.deepEqual(server.newestFirst(entries).map((entry) => entry.i), order, JSON.stringify(dates));
  }
});

test('groups exactly as the server does', () => {
  const entries = ['talk', 'paper', 'talk', 'press', 'book'].map((kind, i) => ({ kind, title: String(i), date: String(2010 + i) }));
  for (const order of PUBLICATION_ORDERS) {
    for (const group of [true, false]) {
      assert.deepEqual(arrangePublications(entries, { order, group }), server.arrangePublications(entries, { order, group }));
    }
  }
  assert.deepEqual(PUBLICATION_KINDS, server.PUBLICATION_KINDS);
});

test('is a copy of the server module below its header', () => {
  const body = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^(\/\/.*\n)+\n/, '');
  assert.equal(body('./publications.js'), body('../../../server/src/publications.js'));
});
