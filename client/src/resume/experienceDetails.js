// The labelled details line of an experience entry (issue #223), for a US
// federal (USAJOBS) or other formal resume: plain text with its labels, so
// a resume parser reads "Hours per week: 40" as written. Only the filled
// fields, in this order. EXPERIENCE_DETAIL_KEYS mirrors the server's
// (server/src/experienceDetails.js), which publicBlocks.js strips from a
// surface the entry's flag hides them on.
export const EXPERIENCE_DETAIL_FIELDS = [
  { key: 'hoursPerWeek', label: 'Hours per week' },
  { key: 'grade', label: 'Series and grade' },
  { key: 'salary', label: 'Salary' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'contactSupervisor', label: 'May contact supervisor' },
];
export const EXPERIENCE_DETAIL_KEYS = EXPERIENCE_DETAIL_FIELDS.map((field) => field.key);
// The two flags that hide the line per surface (only `false` hides).
export const EXPERIENCE_DETAIL_FLAGS = ['detailsVisibleWeb', 'detailsVisiblePrint'];
const CONTACT_LABELS = new Map([['yes', 'Yes'], ['no', 'No']]);

// A stored contactSupervisor as 'yes', 'no' or '' (not stated). Anything else
// reads as not stated, and so does a non-string: blockData.js takes any
// string, so the value is only ever compared, never used to look something up
// by name (an object's inherited keys, "__proto__" or "constructor", would
// answer with something that isn't text).
export function contactAnswer(raw) {
  if (typeof raw !== 'string') return '';
  const answer = raw.trim().toLowerCase();
  return CONTACT_LABELS.has(answer) ? answer : '';
}

// [{ key, label, value }] for the fields with something to show, values
// trimmed; contactSupervisor only as 'yes'/'no' ('Yes'/'No').
export function experienceDetails(data) {
  const out = [];
  for (const { key, label } of EXPERIENCE_DETAIL_FIELDS) {
    const raw = data?.[key];
    if (typeof raw !== 'string') continue;
    const value = key === 'contactSupervisor' ? CONTACT_LABELS.get(contactAnswer(raw)) : raw.trim();
    if (value) out.push({ key, label, value });
  }
  return out;
}

// Whether any detail is filled in (the editor's group summary).
export function hasExperienceDetails(data) {
  return experienceDetails(data).length > 0;
}

// The details line as one surface draws it: `{ details, dimmed, printHidden }`.
// A flag hides the line only when it is `false` (missing means shown), as in
// the server's publicBlocks.js, which has already taken the keys out of a
// snapshot for a surface that hides them; the flags are read again here so
// data that didn't come through it (a preview, a sample) draws the same.
// - 'preview' (the editor) always draws the line, `dimmed` while either
//   surface hides it, like a hidden bullet.
// - 'web' draws it unless the web flag hides it, `printHidden` while the print
//   flag does: the page's Print button prints this same page, so the line has
//   to leave the paper there too.
// - 'print' (the PDF) draws it unless the print flag hides it.
export function experienceDetailsLine(data, mode = 'web') {
  const details = experienceDetails(data);
  const onWeb = data?.detailsVisibleWeb !== false;
  const onPrint = data?.detailsVisiblePrint !== false;
  const none = { details: [], dimmed: false, printHidden: false };
  if (!details.length) return none;
  if (mode === 'preview') return { details, dimmed: !(onWeb && onPrint), printHidden: false };
  if (mode === 'print') return onPrint ? { details, dimmed: false, printHidden: false } : none;
  return onWeb ? { details, dimmed: false, printHidden: !onPrint } : none;
}
