import test from 'node:test';
import assert from 'node:assert/strict';
import { PDF_BASE_OPTIONS, SANS_FONT_IDS, pdfPageOptions } from './pdfFooter.js';
import { FONT_IDS } from './landingStyle.js';
import { FONT_OPTIONS } from '../../client/src/resume/siteColors.js';

test('off unless the setting is exactly true', () => {
  for (const site of [undefined, null, 'x', {}, { pdfPageNumbers: false }, { pdfPageNumbers: 'true' }, { pdfPageNumbers: 1 }]) {
    assert.deepEqual(pdfPageOptions(site), {}, JSON.stringify(site));
  }
});

test('on: an empty header and a footer Chromium fills with the page numbers', () => {
  const options = pdfPageOptions({ pdfPageNumbers: true });
  assert.equal(options.displayHeaderFooter, true);
  assert.equal(options.headerTemplate, '<span></span>');
  assert.match(options.footerTemplate, /Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/);
  assert.match(options.footerTemplate, /font-size: 8pt/);
});

test("the footer is drawn in the resume's text color while it reads on the white margin, the default otherwise", () => {
  const ink = (text) => pdfPageOptions({ pdfPageNumbers: true, colors: { text } }).footerTemplate.match(/color: ([^;]+);/)[1];
  assert.equal(ink(undefined), '#14181c');
  assert.equal(ink('#334155'), '#334155');
  assert.equal(ink('#767676'), '#767676'); // 4.54:1 on white, just over AA
  assert.equal(ink('#777777'), '#14181c'); // 4.48:1, just under
  assert.equal(ink('#D5DBE1'), '#14181c'); // a dark resume's light text
  for (const text of ['red', '#fff', 'red;"><script>alert(1)</script>', '#14181c"; x', 42, null]) {
    const { footerTemplate } = pdfPageOptions({ pdfPageNumbers: true, colors: { text } });
    assert.match(footerTemplate, /color: #14181c;/, String(text));
    assert.doesNotMatch(footerTemplate, /script|red|x;/);
  }
});

test("the footer's family follows the resume's font, a missing or unknown one reading as the default serif", () => {
  const family = (font) => pdfPageOptions({ pdfPageNumbers: true, font }).footerTemplate.match(/font-family: ([^;]+);/)[1];
  assert.match(family('lora'), /serif$/);
  assert.doesNotMatch(family('lora'), /sans-serif/);
  assert.doesNotMatch(family(undefined), /sans-serif/);
  assert.doesNotMatch(family('comic-sans'), /sans-serif/);
  assert.match(family('inter'), /sans-serif$/);
});

test("SANS_FONT_IDS are the client's sans-serif FONT_OPTIONS, all of them server font ids", () => {
  const clientSans = FONT_OPTIONS.filter((f) => /sans-serif$/.test(f.css)).map((f) => f.value);
  assert.deepEqual([...SANS_FONT_IDS], clientSans);
  for (const id of SANS_FONT_IDS) assert.ok(FONT_IDS.includes(id), id);
});

test('the base options are Letter with half-inch margins and backgrounds printed', () => {
  assert.deepEqual(PDF_BASE_OPTIONS, {
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  });
});
