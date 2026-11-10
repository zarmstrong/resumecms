// The landing page's date reading (issue #119): readDate(), utcToday() and
// hasPassed(), which the editor's preview uses to tell an expired
// credential. A copy of server/src/dateText.js, which documents the rules;
// the two are kept in step by the cases in server/src/dateText.cases.js,
// which dateText.test.js runs through both.

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
