// @ts-check
import { createHash } from 'node:crypto';

// A resume's site settings are saved as a whole object (issue #234), so a
// write has to say which version it was made from, or it undoes whatever
// another tab, an MCP client or the landing editor saved since. The
// revision is a hash of the stored row, computed when asked and never
// stored: every writer of the row (a PUT, a merge, a discard, a copy)
// moves it without having to remember to, and it's in neither the site
// settings' own keys nor the published snapshot. Two rows that read the
// same have the same revision, which is right: a write made against one
// loses nothing of the other.

/**
 * @param {unknown} site the stored site settings (null when there are none)
 * @returns {string}
 */
export function siteRevision(site) {
  return createHash('sha256')
    .update(JSON.stringify(site ?? null))
    .digest('base64url')
    .slice(0, 22);
}

/**
 * The revisions an `If-Match` header names, quotes (and a weak `W/`) taken
 * off; undefined when it's absent, empty or `*`, which ask for no check.
 * @param {string | string[] | undefined} header
 * @returns {string[] | undefined}
 */
export function revisionsFromIfMatch(header) {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (typeof value !== 'string') return undefined;
  const tags = value
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  if (!tags.length || tags.includes('*')) return undefined;
  return tags;
}
