import { doiUrl } from '../landing/publications.js';
import { credentialHref } from './credentials.js';

// A publications block (issue #214): one published work or appearance,
// the resume's counterpart of an entry in the landing page's publications
// section (landing/publications.js), whose kinds and DOI rules it shares.
export const PUBLICATION_LABELS = { article: 'Article', paper: 'Paper', book: 'Book', chapter: 'Chapter', talk: 'Talk', podcast: 'Podcast', press: 'Press' };

export function publicationKindLabel(kind) {
  return Object.hasOwn(PUBLICATION_LABELS, kind) ? PUBLICATION_LABELS[kind] : PUBLICATION_LABELS.article;
}

// The title's link: the URL when it's an absolute http(s) one (as a
// credential's, credentialHref()), else the DOI's doi.org address, else
// none.
export function publicationHref(data) {
  return credentialHref(data?.url) ?? (doiUrl(data?.doi) || null);
}
