import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLICATION_KINDS, arrangePublications, cleanDoi, doiUrl, isDoi, newestFirst } from './publications.js';
import { CLEAN_DOI_CASES, DOI_CASES, NEWEST_CASES } from './publications.cases.js';

test('tells a DOI by its pattern', () => {
  for (const [text, doi, url] of DOI_CASES) {
    const what = JSON.stringify(text);
    assert.equal(isDoi(text), doi, what);
    assert.equal(doiUrl(text), url, what);
  }
});

test('reads a pasted DOI link as the DOI', () => {
  for (const [pasted, kept] of CLEAN_DOI_CASES) assert.equal(cleanDoi(pasted), kept, pasted);
});

test('sorts the dates it can read newest first, and leaves the others in place', () => {
  for (const [dates, order] of NEWEST_CASES) {
    const entries = dates.map((date, i) => ({ i, date }));
    assert.deepEqual(newestFirst(entries).map((entry) => entry.i), order, JSON.stringify(dates));
  }
});

test('groups by kind in a fixed order, each group in the order asked for', () => {
  const entries = [
    { kind: 'talk', title: 'Talk 2019', date: '2019' },
    { kind: 'paper', title: 'Paper 2020', date: '2020' },
    { kind: 'talk', title: 'Talk 2023', date: '2023' },
    { kind: 'article', title: 'Article', date: 'Forthcoming' },
    { kind: 'paper', title: 'Paper 2024', date: '2024' },
  ];
  const titles = (out) => out.groups.map((g) => [g.kind, g.entries.map((e) => e.title)]);
  assert.deepEqual(titles(arrangePublications(entries, { order: 'manual', group: true })), [
    ['article', ['Article']],
    ['paper', ['Paper 2020', 'Paper 2024']],
    ['talk', ['Talk 2019', 'Talk 2023']],
  ]);
  assert.deepEqual(titles(arrangePublications(entries, { order: 'newest', group: true })), [
    ['article', ['Article']],
    ['paper', ['Paper 2024', 'Paper 2020']],
    ['talk', ['Talk 2023', 'Talk 2019']],
  ]);
  assert.deepEqual(arrangePublications(entries, { order: 'manual', group: false }), { entries });
  assert.deepEqual(
    arrangePublications(entries, { order: 'newest', group: false }).entries.map((e) => e.title),
    ['Paper 2024', 'Talk 2023', 'Paper 2020', 'Article', 'Talk 2019']
  );
  // The group order is the kinds' own.
  const one = PUBLICATION_KINDS.map((kind) => ({ kind, title: kind, date: '' })).reverse();
  assert.deepEqual(arrangePublications(one, { order: 'manual', group: true }).groups.map((g) => g.kind), PUBLICATION_KINDS);
});
