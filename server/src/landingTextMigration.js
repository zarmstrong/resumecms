import { createSettings } from './settings.js';
import { escapeInline } from './inlineText.js';
import { httpError } from './httpError.js';

// Text sections and items were plain text before issue #91 gave them links
// and emphasis, so text stored before then that happens to look like the
// syntax ("5 *stars*", "[draft](v2)") would start rendering differently.
// Once, on the first boot that has the syntax, this escapes the markers in
// the stored draft and published snapshot (escapeInline(): only text that
// would read differently is touched), so the page shows exactly what it
// did; from then on, text is always parsed. The caps don't count escaping
// backslashes (inlineLength()), so a draft that saved before this still
// saves after it, however close to its caps it was.
//
// `landing_text_format` records that it ran, in the same transaction, so
// it never escapes anything twice: escaping isn't idempotent on its own
// (escaped text holds escapes). A fresh install sets it with nothing to
// escape. Safe to call on every boot. Returns how many fields it changed.
export const LANDING_TEXT_FORMAT_KEY = 'landing_text_format';
const INLINE_FORMAT = 'inline';

// The same goes for a write from an editor loaded before the upgrade (or
// one whose bundle is older than the server): it PUTs its whole draft after
// the migration has run. So the editor marks what it writes as
// `textFormat: 'inline'` (in PUT /api/landing's body and the rewrite
// route's `landing` copy; splitTextFormat() takes it off before
// validation, and it's never stored), and a write without it is plain
// text, escaped by escapeLandingText() before it's checked. Such an editor
// may hold text it read before the migration (unescaped) or after it (a
// GET on mount or a Discard: already escaped, shown with its backslashes),
// and can't say which. So a field equal to the stored draft's at the same
// place is kept as it is, and only one that differs is escaped: either way
// the saved text reads as that editor showed it, and an echoed field is
// never escaped twice. The MCP tools document the syntax, so their writes
// are always inline.

// `body` as the landing page it carries and the format its text is in.
export function splitTextFormat(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body) || !('textFormat' in body)) {
    return { landing: body, textFormat: 'plain' };
  }
  const { textFormat, ...landing } = body;
  if (textFormat !== INLINE_FORMAT) throw httpError(400, "textFormat must be 'inline'");
  return { landing, textFormat };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// `landing` (a draft, a snapshot or a write, checked or not) with its text
// sections' bodies, items' text and FAQ answers escaped, and how many that
// changed. (FAQ sections came after the syntax, issue #123, so the boot
// migration never finds one; a plain write may still hold one.) Both
// the current shape and the one from before sections (`intro`, which
// upgradeLanding() reads as a text section); anything else is left as it
// is, for validation to judge. With `stored` (the stored draft, for a plain
// write), a field equal to the stored one at its place is kept as it is: a
// text section's body to the body of the stored section with its id, an
// item's text to an item's in that section (keepItem(): so reordering
// items in such an editor doesn't escape them again), and an FAQ answer the
// same way to the answers in its stored section.
// Whether an item's text at `index` in a plain write is an echo of the
// stored section's (`storedItems`, their texts `storedTexts`), in order:
// the stored item at the same place says yes; one equal to it once escaped
// says no (the original, from before the migration, the tab never re-read,
// moved or not); one equal to it as it is says yes (an echo, moved).
// Without the second check, an item that differs only by escapes from
// another's stored text would pass for an echo of that one and change
// meaning. Between two such items, an echo moved onto the other's place
// is the very text that one had before, so it's read as that one's
// original (and escaped): the inputs are the same, so no rule can tell.
const keepItem = (storedItems, storedTexts, index) => (value) => {
  if (Array.isArray(storedItems) && storedItems[index]?.text === value) return true;
  if (storedTexts.has(escapeInline(value))) return false;
  return storedTexts.has(value);
};

export function escapeLandingText(landing, stored = null) {
  if (!isObject(landing)) return { landing, changed: 0 };
  let changed = 0;
  const escape = (value, keep = () => false) => {
    if (typeof value !== 'string' || keep(value)) return value;
    const escaped = escapeInline(value);
    if (escaped !== value) changed++;
    return escaped;
  };
  const storedSections = new Map(
    (isObject(stored) && Array.isArray(stored.sections) ? stored.sections : []).filter(isObject).map((section) => [section.id, section])
  );
  const storedSection = (section, kind) => {
    const match = typeof section.id === 'string' ? storedSections.get(section.id) : undefined;
    return match?.kind === kind ? match : null;
  };
  const out = { ...landing };
  if ('intro' in out) out.intro = escape(out.intro, (value) => isObject(stored) && value === stored.intro);
  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((section) => {
      if (section?.kind === 'text') return { ...section, body: escape(section.body, (value) => value === storedSection(section, 'text')?.body) };
      if (section?.kind === 'items' && Array.isArray(section.items)) {
        const storedItems = storedSection(section, 'items')?.items;
        const storedTexts = new Set((Array.isArray(storedItems) ? storedItems : []).filter(isObject).map((item) => item.text));
        return {
          ...section,
          items: section.items.map((item, i) => (isObject(item) ? { ...item, text: escape(item.text, keepItem(storedItems, storedTexts, i)) } : item)),
        };
      }
      if (section?.kind === 'faq' && Array.isArray(section.entries)) {
        // Answers as keepItem() reads items: by their `text`.
        const storedEntries = storedSection(section, 'faq')?.entries;
        const storedAnswers = Array.isArray(storedEntries) ? storedEntries.map((entry) => ({ text: isObject(entry) ? entry.answer : undefined })) : undefined;
        const storedTexts = new Set((storedAnswers ?? []).map((entry) => entry.text));
        return {
          ...section,
          entries: section.entries.map((entry, i) => (isObject(entry) ? { ...entry, answer: escape(entry.answer, keepItem(storedAnswers, storedTexts, i)) } : entry)),
        };
      }
      return section;
    });
  }
  return { landing: out, changed };
}

export function migrateLandingText(db) {
  const { getSetting, setSetting } = createSettings(db);
  return db.transaction(() => {
    if (getSetting(LANDING_TEXT_FORMAT_KEY) === INLINE_FORMAT) return 0;
    let changed = 0;
    for (const key of ['landing_draft', 'landing_published']) {
      const stored = getSetting(key);
      if (!stored) continue;
      const result = escapeLandingText(stored);
      if (result.changed) setSetting(key, result.landing);
      changed += result.changed;
    }
    setSetting(LANDING_TEXT_FORMAT_KEY, INLINE_FORMAT);
    return changed;
  })();
}
