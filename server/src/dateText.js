// Dates as people type them on the landing page (issue #119): a free-form
// string, read only when it plainly names a year, a month or a day, and
// otherwise shown as written. readDate(text) understands
//   2027            a year
//   2027-03         a month (also 2027-3)
//   03/2027         a month (also 3/2027)
//   Mar 2027        a month by its English name or first three letters,
//   March 2027      any case, a dot after it allowed ("Sept" too)
//   2027-03-31      a day (ISO only: 03/04/2027 reads differently by country)
// and returns { year }, { year, month } or { year, month, day }, month and
// day counting from 1, or null for anything else.
//
// hasPassed(text, today) is whether `today` (a 'YYYY-MM-DD' string, see
// utcToday()) is past the end of the period `text` names: a year once it's
// over, a month once the next one starts, a day the day after. A date it
// can't read never has. Nothing here reads the clock, so callers pass
// today in and tests stay deterministic.
//
// client/src/landing/dateText.js is a copy of this file, kept in step by
// the shared cases in dateText.cases.js (client/src/landing/dateText.test.js
// runs both).

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthNumber(name) {
  const word = name.toLowerCase();
  if (word === 'sept') return 9;
  const i = MONTHS.findIndex((month) => month === word || month.slice(0, 3) === word);
  return i + 1;
}

function monthOf(year, month) {
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function readDate(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  let m;
  if ((m = /^(\d{4})$/.exec(value))) return { year: Number(m[1]) };
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(value))) return monthOf(Number(m[1]), Number(m[2]));
  if ((m = /^(\d{1,2})\/(\d{4})$/.exec(value))) return monthOf(Number(m[2]), Number(m[1]));
  if ((m = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(value))) return monthOf(Number(m[2]), monthNumber(m[1]));
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value))) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
  }
  return null;
}

// Today as hasPassed() reads it: the UTC date, so the server and every
// visitor's browser agree on it whatever their time zone.
export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function hasPassed(text, today) {
  const date = readDate(text);
  const now = readDate(today);
  if (!date || !now?.day) return false;
  // The last day of the period, as far as comparing goes: no month has a
  // day after the 31st.
  const end = [date.year, date.month ?? 12, date.day ?? 31];
  const current = [now.year, now.month, now.day];
  for (let i = 0; i < 3; i++) {
    if (current[i] !== end[i]) return current[i] > end[i];
  }
  return false;
}
