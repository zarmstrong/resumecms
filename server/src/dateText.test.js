import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPassed, readDate, utcToday } from './dateText.js';
import { PASSED_CASES, READ_CASES } from './dateText.cases.js';

test('reads the shared cases', () => {
  for (const [input, expected] of READ_CASES) assert.deepEqual(readDate(input), expected, JSON.stringify(input));
});

test('a date has passed once today is past the end of the period it names', () => {
  for (const [expires, today, expected] of PASSED_CASES) {
    assert.equal(hasPassed(expires, today), expected, `${JSON.stringify(expires)} on ${JSON.stringify(today)}`);
  }
});

test("today is the UTC date, whatever the clock's time zone", () => {
  assert.equal(utcToday(new Date('2026-11-30T23:30:00-05:00')), '2026-12-01');
  assert.equal(utcToday(new Date('2026-12-01T00:30:00+02:00')), '2026-11-30');
  assert.match(utcToday(), /^\d{4}-\d{2}-\d{2}$/);
});
