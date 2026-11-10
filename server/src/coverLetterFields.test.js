import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  COVER_LETTER_DATA_VALIDATOR,
  LETTER_RENDER_VERSION,
  MAX_TITLE_LENGTH,
  assertCoverLetterData,
  copyTitle,
  initialCoverLetterData,
  letterPdfKey,
  letterToday,
  validateTitle,
} from './coverLetterFields.js';
import { COVER_LETTER_SCHEMA } from './mcp/blockSchemas.js';

test('the validator and the MCP docs list the same keys, and the example passes', () => {
  assert.deepEqual(Object.keys(COVER_LETTER_DATA_VALIDATOR.shape).sort(), Object.keys(COVER_LETTER_SCHEMA.properties).sort());
  assertCoverLetterData(COVER_LETTER_SCHEMA.example);
  assertCoverLetterData(initialCoverLetterData());
  assertCoverLetterData({});
  assertCoverLetterData({ extra: 1, date: null });
});

test('a key of the wrong kind is a 400 that names it', () => {
  const fail = (data, re) => assert.throws(() => assertCoverLetterData(data), (e) => e.status === 400 && re.test(e.message), JSON.stringify(data));
  fail({ paragraphs: 'one long paragraph' }, /^data\.paragraphs: /);
  fail({ paragraphs: ['ok', 2] }, /^data\.paragraphs\.1: /);
  fail({ date: 20260301 }, /^data\.date: /);
  fail(['not', 'an', 'object'], /^data must be an object/);
  fail(null, /^data must be an object/);
});

test('titles are required, trimmed and capped; a copy says so and still fits', () => {
  assert.equal(validateTitle('  Acme SRE '), 'Acme SRE');
  for (const bad of ['', '   ', null, 5]) assert.throws(() => validateTitle(bad), (e) => e.status === 400);
  assert.throws(() => validateTitle('x'.repeat(MAX_TITLE_LENGTH + 1)), /limited/);
  assert.equal(copyTitle('Acme'), 'Acme (copy)');
  const long = copyTitle('x'.repeat(MAX_TITLE_LENGTH));
  assert.equal(long.length, MAX_TITLE_LENGTH);
  assert.ok(long.endsWith(' (copy)'));
});

test("today's date is US style, whatever the locale", () => {
  assert.equal(letterToday(new Date(2026, 10, 6, 12)), 'November 6, 2026');
});

test('the PDF key changes with anything the PDF shows, and with the day only when the letter shows it', () => {
  const base = { data: { date: '', paragraphs: ['Hi'] }, header: { name: 'Ada' }, site: { font: 'inter' }, today: 'November 6, 2026' };
  const key = letterPdfKey(base);
  assert.equal(letterPdfKey({ ...base }), key);
  assert.notEqual(letterPdfKey({ ...base, data: { date: '', paragraphs: ['Hello'] } }), key);
  assert.notEqual(letterPdfKey({ ...base, header: { name: 'Ada L.' } }), key);
  assert.notEqual(letterPdfKey({ ...base, site: { font: 'lora' } }), key);
  assert.notEqual(letterPdfKey({ ...base, today: 'November 7, 2026' }), key);

  const dated = { ...base, data: { date: 'March 3, 2026', paragraphs: ['Hi'] } };
  assert.equal(letterPdfKey({ ...dated, today: 'November 7, 2026' }), letterPdfKey(dated));
});

test('a PDF cached before the on-color text change (issue #142) is rendered again', () => {
  const base = { data: { date: '', paragraphs: ['Hi'] }, header: { name: 'Ada' }, site: { colors: { accent: '#ff6600' } }, today: 'November 6, 2026' };
  const { data, header, site, today } = base;
  const unversioned = createHash('sha256').update(JSON.stringify({ data, header, site, today })).digest('hex');
  assert.notEqual(letterPdfKey(base), unversioned);
  assert.ok(LETTER_RENDER_VERSION >= 2);
});
