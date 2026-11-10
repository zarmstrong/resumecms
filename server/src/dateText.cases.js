// What readDate() and hasPassed() make of some dates (issue #119), shared
// by the server's copy (dateText.test.js) and the client's
// (client/src/landing/dateText.test.js), so the two can't drift apart.
// Node builtins only, so the client's tests can import it.

export const READ_CASES = [
  ['2027', { year: 2027 }],
  ['  2027 ', { year: 2027 }],
  ['2027-03', { year: 2027, month: 3 }],
  ['2027-3', { year: 2027, month: 3 }],
  ['03/2027', { year: 2027, month: 3 }],
  ['3/2027', { year: 2027, month: 3 }],
  ['Mar 2027', { year: 2027, month: 3 }],
  ['mar. 2027', { year: 2027, month: 3 }],
  ['March 2027', { year: 2027, month: 3 }],
  ['MARCH 2027', { year: 2027, month: 3 }],
  ['Sept 2026', { year: 2026, month: 9 }],
  ['Sep 2026', { year: 2026, month: 9 }],
  ['december   2026', { year: 2026, month: 12 }],
  ['2027-03-31', { year: 2027, month: 3, day: 31 }],
  ['2028-02-29', { year: 2028, month: 2, day: 29 }],

  // Anything else is shown as written.
  ['', null],
  ['Present', null],
  ['No expiry', null],
  ['27', null],
  ['20270', null],
  ['2027-13', null],
  ['2027-00', null],
  ['13/2027', null],
  ['0/2027', null],
  ['Mars 2027', null],
  ['Ma 2027', null],
  ['Marc 2027', null],
  ['March, 2027', null],
  ['2027 March', null],
  ['31/03/2027', null],
  ['03/31/2027', null],
  ['2027-02-30', null],
  ['2027-3-31', null],
  ['Spring 2027', null],
  ['2027–2029', null],
  [null, null],
  [2027, null],
];

// [expires, today, whether it has passed]
export const PASSED_CASES = [
  // A bare year lasts until it's over.
  ['2026', '2026-12-31', false],
  ['2026', '2027-01-01', true],
  ['2025', '2026-11-10', true],
  // A month lasts until the next one starts.
  ['2026-11', '2026-11-30', false],
  ['2026-11', '2026-12-01', true],
  ['11/2026', '2026-11-10', false],
  ['10/2026', '2026-11-01', true],
  ['Feb 2028', '2028-02-29', false],
  ['Feb 2028', '2028-03-01', true],
  ['December 2026', '2026-12-31', false],
  ['December 2026', '2027-01-01', true],
  ['Jan 2027', '2026-12-31', false],
  // A day lasts until it's over.
  ['2026-11-10', '2026-11-10', false],
  ['2026-11-10', '2026-11-11', true],
  ['2026-11-30', '2026-12-01', true],
  // A date it can't read never has, and neither does anything without a today.
  ['Present', '2099-01-01', false],
  ['31/03/2020', '2026-11-10', false],
  ['', '2026-11-10', false],
  ['2020', '', false],
  ['2020', '2026-11', false],
  ['2020', null, false],
];
