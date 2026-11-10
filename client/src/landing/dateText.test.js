import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasPassed, readDate, utcToday } from './dateText.js';
// The server's copy, which this one mirrors, and the cases both must pass.
// Node builtins only, so they load without the server's dependencies.
import * as server from '../../../server/src/dateText.js';
import { PASSED_CASES, READ_CASES } from '../../../server/src/dateText.cases.js';

test('reads the shared cases exactly as the server does', () => {
  for (const [input, expected] of READ_CASES) {
    assert.deepEqual(readDate(input), expected, JSON.stringify(input));
    assert.deepEqual(server.readDate(input), expected, JSON.stringify(input));
  }
});

test('tells a date that has passed exactly as the server does', () => {
  for (const [expires, today, expected] of PASSED_CASES) {
    const what = `${JSON.stringify(expires)} on ${JSON.stringify(today)}`;
    assert.equal(hasPassed(expires, today), expected, what);
    assert.equal(server.hasPassed(expires, today), expected, what);
  }
});

test('computes today the way the server does', () => {
  for (const now of [new Date('2026-11-30T23:30:00-05:00'), new Date('2026-12-01T00:30:00+02:00'), new Date()]) {
    assert.equal(utcToday(now), server.utcToday(now));
  }
});

test('is a copy of the server module below its header', () => {
  const body = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^(\/\/.*\n)+\n/, '');
  assert.equal(body('./dateText.js'), body('../../../server/src/dateText.js'));
});
