import test from 'node:test';
import assert from 'node:assert/strict';
import { letterParts, letterText, letterToday, moveParagraph } from './letterParts.js';

const header = { name: 'Ada Lovelace' };
const today = 'November 6, 2026';

test('blanks drop out; a blank date is today and a blank signature the header name', () => {
  const parts = letterParts(
    {
      date: ' ',
      recipientName: 'Jane Smith',
      recipientTitle: '',
      company: 'Acme',
      address: '1 Main St\n\n  Springfield  \n',
      salutation: 'Dear Jane,',
      paragraphs: ['One', '  ', 'Two'],
      closing: 'Sincerely,',
      signature: '',
    },
    header,
    today
  );
  assert.deepEqual(parts, {
    date: today,
    recipient: ['Jane Smith', 'Acme', '1 Main St', 'Springfield'],
    salutation: 'Dear Jane,',
    paragraphs: ['One', 'Two'],
    closing: 'Sincerely,',
    signature: 'Ada Lovelace',
  });
  assert.equal(letterParts({ date: 'March 3', signature: 'A. L.' }, header, today).date, 'March 3');
  assert.equal(letterParts({ signature: 'A. L.' }, header, today).signature, 'A. L.');
});

test('odd data (missing, wrong kinds) still gives something to show', () => {
  assert.deepEqual(letterParts(null, null, today), {
    date: today,
    recipient: [],
    salutation: '',
    paragraphs: [],
    closing: '',
    signature: '',
  });
  assert.deepEqual(letterParts({ paragraphs: 'x', address: 5 }, header, today).paragraphs, []);
});

test('the text runs from the salutation to the signature', () => {
  const data = { company: 'Acme', salutation: 'Dear Jane,', paragraphs: ['One', 'Two'], closing: 'Best,' };
  assert.equal(letterText(data, header, today), 'Dear Jane,\n\nOne\n\nTwo\n\nBest,\nAda Lovelace');
  assert.equal(letterText({ paragraphs: ['Only'] }, {}, today), 'Only');
});

test("today's date is US style", () => {
  assert.equal(letterToday(new Date(2026, 10, 6, 12)), 'November 6, 2026');
});

test('a paragraph moves among the others, unless the list changed mid-drag', () => {
  assert.deepEqual(moveParagraph(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveParagraph(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.equal(moveParagraph(['a', 'b', 'c'], 1, 1), null);
  assert.equal(moveParagraph(['a', 'b', 'c'], 0, 3), null);
  assert.equal(moveParagraph(['a', 'b', 'c'], 0, -1), null);
  assert.equal(moveParagraph(['a', 'B', 'c'], 0, 2, ['a', 'b', 'c']), null);
});
