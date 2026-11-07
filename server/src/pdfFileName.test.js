import test from 'node:test';
import assert from 'node:assert/strict';
import { letterPdfFileName, pdfFileName } from './pdfFileName.js';

test('a name becomes a dashed ASCII filename', () => {
  assert.equal(pdfFileName('Ada Lovelace'), 'Resume-of-Ada-Lovelace.pdf');
  assert.equal(pdfFileName("  Zoë O'Brien-Smith, PhD "), 'Resume-of-Zo-O-Brien-Smith-PhD.pdf');
});

test('no usable name falls back to "Resume"', () => {
  for (const name of [null, undefined, '', '   ', '李明', '—']) {
    assert.equal(pdfFileName(name), 'Resume-of-Resume.pdf', JSON.stringify(name));
  }
});

test('a non-string name (the header is not type-checked) does not throw', () => {
  for (const name of [123, { first: 'Ada' }, ['Ada'], true]) {
    assert.equal(pdfFileName(name), 'Resume-of-Resume.pdf', JSON.stringify(name));
  }
});

test("a cover letter's name says who signed it and, if known, which company it's for", () => {
  assert.equal(letterPdfFileName('Ada Lovelace', 'Acme, Inc.'), 'Cover-Letter-of-Ada-Lovelace-for-Acme-Inc.pdf');
  assert.equal(letterPdfFileName('Ada Lovelace', ''), 'Cover-Letter-of-Ada-Lovelace.pdf');
  assert.equal(letterPdfFileName(null, '—'), 'Cover-Letter-of-Applicant.pdf');
});
