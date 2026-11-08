// Everything about the verb tense of an AI rewrite: which block types it
// applies to, the `tense` setting's options, the per-rewrite pick for custom
// blocks, and how `byRole` reads an experience entry's end date. No imports,
// so both aiSettings.js (the setting) and rewrite.js (the prompt) build on it.
// The prompt's own wording for each tense is TENSE_RULES in rewrite.js.

// How the tense applies to each rewritable type (rewritableFields.js's
// REWRITABLE_TYPES; resolveTense below). Both are explicit allowlists: a new
// rewritable type gets no tense instruction until it's added to one.
// - TENSE_TYPES follow the `tense` setting. Only experience entries: they
//   are where "Led"/"Lead" drift happens, and `byRole` reads their dates.
// - PICKED_TENSE_TYPES get a tense picked per rewrite in the editor, which
//   starts from the setting (defaultPickedTense). A custom block can be
//   anything from awards to a current side project, so one setting can't
//   fit them all. The editor gets this list from publicAiSettings()
//   (`pickedTenseTypes`).
// Summaries (executive ones too), headings, and skills rows get neither: a
// summary describes who the person is now, and the others are labels and
// lists with no verbs.
export const TENSE_TYPES = new Set(['experience']);
export const PICKED_TENSE_TYPES = new Set(['custom']);

// The `tense` setting's options (stored in the `ai` settings row,
// aiSettings.js). `auto` adds nothing to the prompt (the model follows the
// existing text); `past`/`present` always ask for that tense; `byRole` picks
// per entry from its end date (roleTense). The labels are what the editor
// shows; publicAiSettings() sends them, so it keeps no list of its own.
// Frozen, since PICKED_TENSES shares the past and present entries.
const option = (label) => Object.freeze({ label });
export const AI_TENSES = Object.freeze({
  auto: option('Let the AI decide'),
  past: option('Past tense'),
  present: option('Present tense'),
  byRole: option('By role: present for current jobs, past for finished ones'),
});
export const DEFAULT_TENSE = 'auto';
export const isAiTense = (v) => typeof v === 'string' && Object.hasOwn(AI_TENSES, v);

// The tenses a PICKED_TENSE_TYPES block's rewrite can pick, and what the
// editor's picker starts at: the setting's fixed tense, or 'auto' for `auto`
// and `byRole` (a custom block has no role to read). They reach the editor
// through publicAiSettings(), with PICKED_TENSE_TYPES, so it keeps no copy.
// Past and present share the setting's labels.
export const PICKED_TENSES = Object.freeze({
  auto: option('Any tense'),
  past: AI_TENSES.past,
  present: AI_TENSES.present,
});
const isPickedTense = (v) => typeof v === 'string' && Object.hasOwn(PICKED_TENSES, v);
export function defaultPickedTense(settingTense) {
  return settingTense === 'past' || settingTense === 'present' ? settingTense : 'auto';
}

// Why `picked` can't be used for a `type` block's rewrite, or null when it
// can (including undefined: no pick, so the setting's default applies).
export function pickedTenseError(picked, type) {
  if (picked === undefined) return null;
  if (!isPickedTense(picked)) return `tense must be one of ${Object.keys(PICKED_TENSES).join(', ')}`;
  if (!PICKED_TENSE_TYPES.has(type)) return `A tense can't be chosen for ${type} blocks`;
  return null;
}

// The tense an experience block's free-text end date calls for: 'present'
// for a current role, 'past' for a finished one, or null when it doesn't say.
// Only the end of a range counts ("Dec 2023 – Present" → "Present"; also
// "2024-present", "2019-2021", "Jan 2020 to Dec 2023", but not an ISO
// date's own hyphens). Then:
// - 'present' when it is a usual word for "still here" ("Present",
//   "Current", "Till date", "Today", a few common non-English ones), alone,
//   with a qualifier ("Present day", "Current role"), with a note on the
//   kind or length of the job ("Present (contract)", "Present · 2 yrs"),
//   with a trailing "!" ("Now!"), or after a plain date and a connective ("Jan 2022 to Present", "2020 till
//   date", "2022 bis heute") — and the range doesn't start with one too
//   ("Present – 2021" says both);
// - 'past' when it is a plain date — a year, optionally with a month name
//   or number ("2024", "Mar 2024", "03/2024", "'19", "2019-06-30") — whose
//   whole period has been over for a day (so "2026" isn't until 2 January
//   2027; see isNotOver);
// - null for anything else: blank (new blocks start blank, and a past job
//   whose dates were never filled in looks the same), an open "Dec 2023 –",
//   a date not over yet (a planned end, or one that ended only yesterday or
//   today), and any other text ("Not current",
//   "TBD", "Since 2021", "Spring 2024", "Mar 2024 now at Acme"), so an
//   unclear end date never gets a guessed tense.
// Longer isn't a date. The cap keeps the regexes below cheap only because
// none has a repetition whose body can match the same text more than one way
// (like `(?:\s*,?\s*word)*`, which is exponential); what's left is at worst
// quadratic, which is microseconds at 100 characters. A cap alone doesn't
// stop exponential backtracking. The timing test in tense.test.js holds
// them to that.
const MAX_END_DATE_LENGTH = 100;
const MONTH_WORDS = [
  ['jan', 'january', 'januar', 'janv', 'janvier', 'ene', 'enero', 'gen', 'gennaio', 'janeiro'],
  ['feb', 'february', 'febr', 'februar', 'fév', 'févr', 'février', 'fevrier', 'febrero', 'febbraio', 'fev', 'fevereiro'],
  ['mar', 'march', 'mär', 'märz', 'mrz', 'mars', 'marzo', 'março'],
  ['apr', 'april', 'avr', 'avril', 'abr', 'abril', 'aprile'],
  ['may', 'mai', 'mayo', 'mag', 'maggio', 'maio'],
  ['jun', 'june', 'juni', 'juin', 'junio', 'giu', 'giugno', 'junho'],
  ['jul', 'july', 'juli', 'juil', 'juillet', 'julio', 'lug', 'luglio', 'julho'],
  ['aug', 'august', 'août', 'aout', 'ago', 'agosto'],
  ['sep', 'sept', 'september', 'septembre', 'septiembre', 'set', 'settembre', 'setembro'],
  ['oct', 'october', 'okt', 'oktober', 'octobre', 'octubre', 'ott', 'ottobre', 'out', 'outubro'],
  ['nov', 'november', 'novembre', 'noviembre', 'novembro'],
  ['dec', 'december', 'dez', 'dezember', 'déc', 'décembre', 'decembre', 'dic', 'diciembre', 'dicembre', 'dezembro'],
];
const MONTH_INDEX = new Map(MONTH_WORDS.flatMap((words, i) => words.map((w) => [w, i])));
const MONTH = String.raw`(?:${[...MONTH_INDEX.keys()].sort((a, b) => b.length - a.length).join('|')})\.?`;
const MONTH_YEAR = String.raw`(?:${MONTH}(?:\s+|[-/]))?(?:\d{4}|['’]\d{2})`; // "Mar 2024", "Mar-2024", "2024", "'19"
const NUMERIC = String.raw`(?:\d{1,2}[/.]){1,2}\d{4}`; // "03/2024", "12/01/2026"
const ISO = String.raw`\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?`; // "2019-06-30", "2024/03"
const PLAIN_DATE = String.raw`(?:${ISO}|${NUMERIC}|${MONTH_YEAR})`;
const DASHES = String.raw`[‒-―−]`; // figure, en, em dash, bar, minus
const HYPHENS = String.raw`[-‐‑]`;
const RANGE_SEPARATOR = new RegExp(
  [
    String.raw`\s*${DASHES}\s*`,
    String.raw`\s+${HYPHENS}\s*`,
    String.raw`${HYPHENS}\s+`,
    String.raw`(?<=\d)${HYPHENS}(?=\p{L}|\d{4}|\d{1,2}[/.]\d{4})`, // "2024-present", "2019-2021", "03/2020-03/2024"
    String.raw`\s+(?:to|until|till)\s+(?=${PLAIN_DATE}$)`, // "Jan 2020 to Dec 2023"
  ].join('|'),
  'iu'
);
const CONNECTIVE = String.raw`(?:(?:up\s+)?to|until|till|as\s+of|bis|hasta(?:\s+la)?|fino\s+ad?|ad|até|à)\s+`;
const CURRENT = String.raw`(?:current(?:ly)?|present(?:ly)?|now|ongoing|to\s+date|till?\s+date|today|actuel(?:lement)?|ce\s+jour|aujourd['’]hui|aktuell|heute|jetzt|presente|actualidad|actualmente|atual(?:mente)?|hoje|hoy|oggi|attuale)`;
// After the word: nothing, a known qualifier, or a note saying only what
// kind of job it is or how long it has run ("(contract)", "· 2 yrs 3 mos",
// ", full time"). Any other note is left unread — "Now defunct", "Present,
// resigned", "Now (left in 2022)" could each mean the role ended.
const NOTE_WORD = String.raw`(?:contract(?:or)?|freelance|full[- ]?time|part[- ]?time|remote|hybrid|on[- ]?site|interim|temporary|permanent|\d{1,2}\s*(?:yrs?|years?|mos?|months?))`;
// Between note words: a delimiter with optional spaces, or spaces alone —
// never both optional, so a gap can only be matched one way.
const NOTES = String.raw`${NOTE_WORD}(?:(?:\s*[,·•]\s*|\s+)${NOTE_WORD})*`;
const NOTE = String.raw`(?:\s*\(\s*${NOTES}\s*\)|\s*[,·•|]\s*${NOTES})`;
const CURRENT_TAIL = String.raw`(?:(?:\s+|-)(?:day|role|position|job|employer|employed))?(?:${NOTE})?\s*!?\s*$`;
const IS_CURRENT = new RegExp(
  String.raw`^(?:${PLAIN_DATE}\s+)?(?:${CONNECTIVE})?${CURRENT}(?![\p{L}\p{N}])${CURRENT_TAIL}`,
  'iu'
);

// The readings of a plain date as [year, month?, day?], or null when `end`
// isn't one: wrong shape, a word that isn't a month, an impossible month or
// day, a year before 1900. "12/01/2026" has two readings, since either day
// order is common.
function parsePlainDate(end, now) {
  const valid = ([y, m, d]) =>
    y >= 1900 &&
    (m === undefined || (m >= 1 && m <= 12)) &&
    (d === undefined || (d >= 1 && new Date(y, m - 1, d).getDate() === d));
  const nums = (...xs) => xs.map((x) => (x === undefined ? undefined : Number(x)));
  let match;
  let readings;
  if ((match = end.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/))) readings = [nums(match[1], match[2], match[3])];
  else if ((match = end.match(/^(\d{1,2})[/.](\d{4})$/))) readings = [nums(match[2], match[1])];
  else if ((match = end.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) {
    const [a, b, y] = nums(match[1], match[2], match[3]);
    readings = [[y, a, b], [y, b, a]];
  } else if ((match = end.match(/^(?:(\p{L}+)\.?(?:\s+|[-/]))?(?:(\d{4})|['’](\d{2}))$/u))) {
    const month = match[1] === undefined ? undefined : MONTH_INDEX.get(match[1].toLowerCase());
    if (match[1] !== undefined && month === undefined) return null;
    // A two-digit year is this century unless that's more than ten years out.
    let year = Number(match[2] ?? 2000 + Number(match[3]));
    if (match[3] !== undefined && year > now.getFullYear() + 10) year -= 100;
    readings = [[year, month === undefined ? undefined : month + 1]];
  } else return null;
  readings = readings.map((r) => r.filter((x) => x !== undefined)).filter(valid);
  return readings.length ? readings : null;
}

// Whether the period a reading names isn't over yet: a year, month, or day
// until it ends. Judged a day late, against the server's yesterday, because
// the server's date can be a day ahead of the person's (time zones span about
// a day either way): a date counts as over only once it's over everywhere.
function isNotOver([y, m, d], now) {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const today = [yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate()];
  if (y !== today[0]) return y > today[0];
  if (m === undefined) return true;
  if (m !== today[1]) return m > today[1];
  return d === undefined || d >= today[2];
}

export function roleTense(data, now = new Date()) {
  const text = typeof data?.endDate === 'string' ? data.endDate.trim() : '';
  if (text.length > MAX_END_DATE_LENGTH) return null;
  // NFC so a pasted decomposed "März" matches; a final "." is never meaningful.
  const raw = text.normalize('NFC').replace(/\.$/, '');
  // A spaced dash is always a range: "Aug – 2026" could be August 2026 or
  // "August through 2026", so only "2026" is read, which is right either way
  // once 2026 is over and unclear (null) before then.
  const parts = raw.split(RANGE_SEPARATOR).map((part) => part.trim());
  const end = parts.at(-1);
  if (parts.slice(0, -1).some((part) => IS_CURRENT.test(part))) return null;
  if (IS_CURRENT.test(end)) return 'present';
  const readings = parsePlainDate(end, now);
  if (!readings || readings.some((r) => isNotOver(r, now))) return null;
  return 'past';
}

// The tense to ask for on this request: 'past', 'present', or null for no
// instruction. Experience entries follow the `tense` setting (AI_TENSES),
// where `byRole` reads the end date (roleTense) and a blank or
// unclear one is left to the model, like `auto`. Custom blocks use `picked`,
// the tense chosen next to the editor's Rewrite button, or the setting's
// default (defaultPickedTense) when a request didn't send one. Other types get none.
export function resolveTense(tense, type, data, picked) {
  if (PICKED_TENSE_TYPES.has(type)) {
    const choice = picked === undefined ? defaultPickedTense(tense) : picked;
    return choice === 'auto' ? null : choice;
  }
  if (!TENSE_TYPES.has(type)) return null;
  if (tense === 'past' || tense === 'present') return tense;
  if (tense === 'byRole') return roleTense(data);
  return null;
}
