import { randomUUID } from 'node:crypto';
import { httpError } from './httpError.js';

// Pure helpers for the resume-management operations in resumeStore.js:
// validating a resume's name and slug, and copying one resume's block rows
// into another. Kept apart so resumeFields.test.js can cover them without
// a database.

export const MAX_NAME_LENGTH = 100;
export const MAX_SLUG_LENGTH = 60;

// A slug ends up in a URL path (/r/<slug>, issue #53), so it's lowercase
// kebab-case: no dots (clientStatic.js 404s any SPA path whose last segment
// looks like a file), no slashes, nothing that needs escaping.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) throw httpError(400, 'name is required');
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) throw httpError(400, `name is limited to ${MAX_NAME_LENGTH} characters`);
  return trimmed;
}

export function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw httpError(400, 'slug must be lowercase letters, digits and single dashes (e.g. "sales-2026")');
  }
  if (slug.length > MAX_SLUG_LENGTH) throw httpError(400, `slug is limited to ${MAX_SLUG_LENGTH} characters`);
  return slug;
}

// A slug derived from a name, for when none is given: "Sales — EMEA" ->
// "sales-emea". Only ASCII letters and digits survive, so a name with none
// falls back to "resume". The caller still has to make it unique.
export function slugify(name) {
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug || 'resume';
}

// `base`, or the first of base-2, base-3, ... that `isTaken` rejects,
// trimmed so the suffix still fits MAX_SLUG_LENGTH.
export function uniqueSlug(base, isTaken) {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}

// Copies of `rows` (raw `blocks` rows of one resume) for another resume:
// every block gets a fresh id, and parent_id is remapped to the copy of its
// heading, so nesting survives and nothing points back into the source. A
// parent_id that doesn't resolve within `rows` (a dangling one from
// hand-edited data) becomes top-level rather than pointing at nothing.
export function cloneBlockRows(rows, resumeId, now, newId = randomUUID) {
  const idMap = new Map(rows.map((row) => [row.id, newId()]));
  return rows.map((row) => ({
    ...row,
    id: idMap.get(row.id),
    resume_id: resumeId,
    parent_id: row.parent_id == null ? null : idMap.get(row.parent_id) ?? null,
    created_at: now,
    updated_at: now,
  }));
}
