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

// WCAG contrast ratio, worked out apart from pdfFooter.js's own.
const luminance = (hex) => {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('on a mid-tone margin where neither near-black nor white reaches 4.5:1, the footer is pure black or white', () => {
  const ink = (colors) => pdfPageOptions({ pdfPageNumbers: true, colors }).footerTemplate.match(/color: ([^;]+);/)[1];
  // inkFor() picks near-black here, at 4.27:1; white has 4.17:1.
  assert.equal(inkFor('#7c7c7c'), '#14181c');
  assert.ok(ratio('#14181c', '#7c7c7c') < 4.5);
  assert.equal(ink({ background: '#7c7c7c', text: '#ffffff' }), '#000000');
  assert.equal(ink({ background: '#7c7c7c' }), '#000000');
  // And white here, at 4.48:1.
  assert.equal(inkFor('#777777'), '#ffffff');
  assert.equal(ink({ background: '#777777', text: '#14181c' }), '#000000');
  // A text color that reads there is still kept.
  assert.equal(ink({ background: '#7c7c7c', text: '#000000' }), '#000000');
  assert.equal(ink({ background: '#7c7c7c', text: '#050505' }), '#050505');
});

test('the footer has at least 4.5:1 on the margin, whatever the background and text colors', () => {
  const hex = (n) => n.toString(16).padStart(2, '0');
  const texts = [undefined, '#ffffff', '#000000', '#14181c', '#d5dbe1', '#777777', '#7c7c7c', 'red'];
  let lowest = Infinity;
  for (let r = 0; r < 256; r += 15) {
    for (let g = 0; g < 256; g += 15) {
      for (let b = 0; b < 256; b += 15) {
        const background = `#${hex(r)}${hex(g)}${hex(b)}`;
        for (const text of [...texts, background]) {
          const { footerTemplate } = pdfPageOptions({ pdfPageNumbers: true, colors: { background, text } });
          const color = footerTemplate.match(/color: (#[0-9a-f]{6});/i)[1];
          const got = ratio(color, background);
          lowest = Math.min(lowest, got);
          if (got < 4.5) assert.fail(`${color} on ${background} (text ${text}) is ${got.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.ok(lowest >= 4.5 && lowest < 5, String(lowest));
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
