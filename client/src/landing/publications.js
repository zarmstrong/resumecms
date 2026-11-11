// The landing page's publications rules (issue #127): which kinds an entry
// may be, what a DOI looks like and where it links, and how `order` and
// `group` arrange the entries, for the editor's preview and its DOI field.
// A copy of server/src/publications.js, which documents them; the two are
// kept in step by the cases in server/src/publications.cases.js, which
// publications.test.js runs through both.

import { readDate } from './dateText.js';

export const PUBLICATION_KINDS = ['article', 'paper', 'book', 'chapter', 'talk', 'podcast', 'press'];
export const PUBLICATION_ORDERS = ['manual', 'newest'];

const DOI = /^10\.\d{4,9}(?:\.\d+)*\/\S+$/;
const DOI_TYPED_SO_FAR = /^(?:1|10|10\.\d{0,9}|10\.\d{4,9}(?:\.\d+)*[./]?)$/;
const DOI_LINK = /^\s*(?:(?:https?:\/\/)?(?:dx\.)?doi\.org\/|doi:\s*)/i;

export function isDoi(text) {
  return typeof text === 'string' && DOI.test(text.trim());
}

export function isDraftDoi(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim();
  return value === '' || DOI.test(value) || DOI_TYPED_SO_FAR.test(value);
}

// The characters a DOI may hold that would end or break a URL's path are
// percent-encoded; doi.org reads them back.
export function doiUrl(doi) {
  if (!isDoi(doi)) return '';
  return `https://doi.org/${doi.trim().replace(/[%"#?<>\\^`{|}]/g, (c) => encodeURIComponent(c))}`;
}

export function cleanDoi(text) {
  return typeof text === 'string' ? text.replace(DOI_LINK, '') : '';
}

function dateKey(text) {
  const date = readDate(text);
  return date ? date.year * 10000 + (date.month ?? 0) * 100 + (date.day ?? 0) : null;
}

export function newestFirst(entries) {
  const keyed = entries.map((entry) => ({ entry, key: dateKey(entry.date) }));
  const sorted = keyed.filter(({ key }) => key !== null).sort((a, b) => b.key - a.key);
  let next = 0;
  return keyed.map(({ entry, key }) => (key === null ? entry : sorted[next++].entry));
}

export function arrangePublications(entries, { order, group }) {
  const ordered = order === 'newest' ? newestFirst(entries) : entries;
  if (!group) return { entries: ordered };
  return {
    groups: PUBLICATION_KINDS.map((kind) => ({ kind, entries: ordered.filter((entry) => entry.kind === kind) })).filter(
      (g) => g.entries.length > 0
    ),
  };
}
