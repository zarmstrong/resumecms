import test from 'node:test';
import assert from 'node:assert/strict';
import { PDF_BASE_OPTIONS, SANS_FONT_IDS, pdfMarginColor, pdfPageOptions } from './pdfFooter.js';
import { inkFor } from './favicon.js';
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

test("the footer is drawn in the resume's text color while it reads on a white margin, the default otherwise", () => {
  const ink = (text) => pdfPageOptions({ pdfPageNumbers: true, colors: { text } }).footerTemplate.match(/color: ([^;]+);/)[1];
  assert.equal(ink(undefined), '#14181c');
  assert.equal(ink('#334155'), '#334155');
  assert.equal(ink('#767676'), '#767676'); // 4.54:1 on white, just over AA
  assert.equal(ink('#777777'), '#14181c'); // 4.48:1, just under
  assert.equal(ink('#D5DBE1'), '#14181c'); // a light text on a white page
  for (const text of ['red', '#fff', 'red;"><script>alert(1)</script>', '#14181c"; x', 42, null]) {
    const { footerTemplate } = pdfPageOptions({ pdfPageNumbers: true, colors: { text } });
    assert.match(footerTemplate, /color: #14181c;/, String(text));
    assert.doesNotMatch(footerTemplate, /script|red|x;/);
  }
});

test("the margin is the page's #rrggbb background, white when it has none", () => {
  for (const site of [undefined, null, 'x', {}, { colors: null }, { colors: {} }, { colors: { background: '' } }]) {
    assert.equal(pdfMarginColor(site), '#ffffff', JSON.stringify(site));
  }
  assert.equal(pdfMarginColor({ colors: { background: '#15191d' } }), '#15191d');
  assert.equal(pdfMarginColor({ colors: { background: '#15191D' } }), '#15191D');
  for (const background of ['navy', '#fff', '#15191d; x', 'rgb(0,0,0)', 42]) {
    assert.equal(pdfMarginColor({ colors: { background } }), '#ffffff', String(background));
  }
});

test("on a colored margin (issue #213) the footer keeps the text color while it reads there, else the margin's own ink", () => {
  const ink = (colors) => pdfPageOptions({ pdfPageNumbers: true, colors }).footerTemplate.match(/color: ([^;]+);/)[1];
  // A dark resume's light text reads on its own background.
  assert.equal(ink({ background: '#15191d', text: '#d5dbe1' }), '#d5dbe1');
  // Dark text on a dark page doesn't, nor does a missing one.
  assert.equal(ink({ background: '#15191d', text: '#14181c' }), '#ffffff');
  assert.equal(ink({ background: '#15191d' }), '#ffffff');
  assert.equal(ink({ background: '#15191d', text: 'red' }), '#ffffff');
  // A mid-tone page whose text is too faint there gets inkFor()'s choice.
  assert.equal(ink({ background: '#2f6f4e', text: '#8fae9b' }), inkFor('#2f6f4e'));
  assert.equal(ink({ background: '#ffd166', text: '#ffffff' }), '#14181c');
  // A pale page keeps working like white.
  assert.equal(ink({ background: '#f7f3e8', text: '#334155' }), '#334155');
  // A background the margin isn't painted in reads as white.
  assert.equal(ink({ background: 'navy', text: '#d5dbe1' }), '#14181c');
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
