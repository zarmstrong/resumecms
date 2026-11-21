import test from 'node:test';
import assert from 'node:assert/strict';
import { printMarginColor } from './pageStyle.js';
import { normalizeSiteColors } from './siteColors.js';
import { pdfMarginColor } from '../../../server/src/pdfFooter.js';

// Issue #213: the PDF's margins are painted in the page's background, and
// the server picks the page-number footer's ink for the color it reads
// from the same site settings, so the two have to agree on it.
test("a PDF's margin color is the page's #rrggbb background, as the server's footer reads it", () => {
  const backgrounds = [undefined, null, '', '#ffffff', '#15191d', '#15191D', '#2f6f4e', 'navy', '#fff', 'rgb(0, 0, 0)', '#15191d; x', 42];
  const sites = [undefined, null, {}, { colors: null }, { colors: {} }, ...backgrounds.map((background) => ({ colors: { background } }))];
  for (const site of sites) {
    const painted = printMarginColor(normalizeSiteColors(site).background);
    assert.equal(painted ?? '#ffffff', pdfMarginColor(site), JSON.stringify(site));
  }
});

test('only a #rrggbb is painted into the margin', () => {
  assert.equal(printMarginColor('#15191d'), '#15191d');
  assert.equal(printMarginColor('#ffffff'), '#ffffff');
  for (const value of ['navy', '#fff', 'red;} body{color:red', '', null, undefined, 42]) {
    assert.equal(printMarginColor(value), null, String(value));
  }
});
