import test from 'node:test';
import assert from 'node:assert/strict';
import { shownLanguages } from './languages.js';

test('shownLanguages drops entries without a usable language, keeping order', () => {
  const shown = shownLanguages({
    entries: [
      { language: 'English', level: 'Native' },
      { language: '', level: 'Fluent' },
      { language: '   ', level: 'Fluent' },
      { level: 'Basic' },
      { language: 42, level: 'Basic' },
      null,
      { language: 'Spanish', level: 'B2' },
    ],
  });
  assert.deepEqual(shown, [
    { language: 'English', level: 'Native' },
    { language: 'Spanish', level: 'B2' },
  ]);
});

test('shownLanguages trims both fields', () => {
  assert.deepEqual(shownLanguages({ entries: [{ language: '  French ', level: ' Fluent  ' }] }), [
    { language: 'French', level: 'Fluent' },
  ]);
});

test('shownLanguages gives an empty level when it is missing or not a string', () => {
  assert.deepEqual(shownLanguages({ entries: [{ language: 'German' }, { language: 'Dutch', level: 3 }] }), [
    { language: 'German', level: '' },
    { language: 'Dutch', level: '' },
  ]);
});

test('shownLanguages handles missing data and entries that are not an array', () => {
  assert.deepEqual(shownLanguages(undefined), []);
  assert.deepEqual(shownLanguages(null), []);
  assert.deepEqual(shownLanguages({}), []);
  assert.deepEqual(shownLanguages({ entries: 'Spanish' }), []);
});
