// The landing page's publications section (issue #127): the rules both
// resolvers apply to its entries, so the editor's preview arranges them
// exactly as the public page does.
//   PUBLICATION_KINDS    what an entry is, in the order `group` shows them
//   isDoi(text)          10.<registrant>/<suffix>: the registrant 4 to 9
//                        digits (with optional .<digits> subdivisions), the
//                        suffix anything without a space
//   doiUrl(doi)          https://doi.org/<doi>, or '' when it isn't a DOI
//   cleanDoi(text)       a pasted https://doi.org/… link (its %-escapes
//                        decoded) or doi:… as the bare DOI (the editor's
//                        field)
//   newestFirst(entries) the entries whose `date` readDate() reads, newest
//                        first, each in a slot one of them held; an entry
//                        with any other date keeps its place. A year alone
//                        sorts after the months of that year, a month
//                        after its days; equal dates keep their order.
//   arrangePublications(entries, { order, group })
//                        { entries } in that order ('manual' as given,
//                        'newest' by newestFirst()), or with `group`
//                        { groups: [{ kind, entries }] }, one per kind
//                        that has any, in PUBLICATION_KINDS' order
// Everything else about an entry is plain text, shown as written.
//
// client/src/landing/publications.js is a copy of this file, kept in step
// by the shared cases in publications.cases.js
// (client/src/landing/publications.test.js runs both).

import { readDate } from './dateText.js';

export const PUBLICATION_KINDS = ['article', 'paper', 'book', 'chapter', 'talk', 'podcast', 'press'];
export const PUBLICATION_ORDERS = ['manual', 'newest'];

const DOI = /^10\.\d{4,9}(?:\.\d+)*\/\S+$/;
const DOI_LINK = /^\s*(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\//i;
const DOI_LABEL = /^\s*doi(?::|\s)\s*/i;

export function isDoi(text) {
  return typeof text === 'string' && DOI.test(text.trim());
}

// The characters a DOI may hold that would end or break a URL's path are
// percent-encoded; doi.org reads them back.
export function doiUrl(doi) {
  if (!isDoi(doi)) return '';
  return `https://doi.org/${doi.trim().replace(/[%"#?<>\\^`{|}]/g, (c) => encodeURIComponent(c))}`;
}

// A link's path is percent-encoded (doiUrl() encodes it again), so it's
// decoded; one that doesn't decode is kept as pasted.
export function cleanDoi(text) {
  if (typeof text !== 'string') return '';
  if (!DOI_LINK.test(text)) return text.replace(DOI_LABEL, '');
  const path = text.replace(DOI_LINK, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
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
