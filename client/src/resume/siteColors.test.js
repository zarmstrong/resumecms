import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SITE_COLORS, contrastRatio, contrastTextAcross, contrastTextFor, mixWithBlack, relativeLuminance } from './siteColors.js';
import { DEFAULT_DARK_COLORS } from '../landing/landingStyle.js';
import { GRADIENT_SHADE } from './pageStyle.js';
import { NEUTRAL_COLORS, inkFor } from '../../../server/src/favicon.js';

const DARK = '#14181c';
const WHITE = '#ffffff';
const ratio = (a, b) => contrastRatio(relativeLuminance(a), relativeLuminance(b));

// Issue #142's fills, where a brightness cutoff put white text that fails AA.
const VIVID = ['#ff6600', '#00a0a0', '#ff1493', '#e63946'];
// The colors a page starts out in, and the usual dark and pale ones.
const COMMON_DARK = [DEFAULT_SITE_COLORS.accent, NEUTRAL_COLORS.accent, '#000000', DARK, '#000080', '#1f3a5f', '#555555'];
const COMMON_LIGHT = [DEFAULT_DARK_COLORS.accent, WHITE, '#999999', '#bbbbbb', '#ffd700', '#eef2ea'];

test('the text on a fill is whichever of near-black and white contrasts more with it', () => {
  for (const fill of [...VIVID, ...COMMON_DARK, ...COMMON_LIGHT, '#777777', '#808080']) {
    const picked = contrastTextFor(fill);
    const other = picked === DARK ? WHITE : DARK;
    assert.ok(ratio(fill, picked) >= ratio(fill, other), fill);
  }
});

test('vivid mid-tone fills get near-black text (issue #142)', () => {
  for (const fill of VIVID) assert.equal(contrastTextFor(fill), DARK, fill);
  assert.ok(ratio('#ff6600', DARK) > 6 && ratio('#ff6600', WHITE) < 3);
});

test('the defaults, black, navy and white keep the text they had', () => {
  for (const fill of COMMON_DARK) assert.equal(contrastTextFor(fill), WHITE, fill);
  for (const fill of COMMON_LIGHT) assert.equal(contrastTextFor(fill), DARK, fill);
});

test('mid greys switch to near-black between #777777 and #808080', () => {
  assert.equal(contrastTextFor('#777777'), WHITE);
  assert.equal(contrastTextFor('#808080'), DARK);
});

test('a fill that is not a 6-digit hex color gets white, and the # is optional', () => {
  for (const fill of ['', null, undefined, '#fff', 'red', '#ff660', '#gg6600', 42]) assert.equal(contrastTextFor(fill), WHITE, String(fill));
  assert.equal(contrastTextFor('FF6600'), DARK);
});

test("the favicon's ink makes the same choice", () => {
  const fills = [...VIVID, ...COMMON_DARK, ...COMMON_LIGHT, '#777777', '#808080'];
  // A spread over the whole cube, including the band just around where
  // the two contrasts cross (a luminance of about 0.2).
  for (let r = 0; r < 256; r += 51) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 51) fills.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    }
  }
  for (let v = 0x70; v <= 0x90; v++) fills.push(`#${v.toString(16).repeat(3)}`);
  for (const fill of fills) assert.equal(inkFor(fill), contrastTextFor(fill), fill);
});

test('text across several fills reads on the one it reads worst on', () => {
  assert.equal(contrastTextAcross(['#ff6600']), contrastTextFor('#ff6600'));
  // Near-black on #ff6600 is far better, but the gradient's dark end
  // would leave it at about 2.3:1; white is better there.
  assert.equal(contrastTextAcross(['#ff6600', mixWithBlack('#ff6600', GRADIENT_SHADE)]), WHITE);
  assert.equal(contrastTextAcross([DEFAULT_SITE_COLORS.accent, mixWithBlack(DEFAULT_SITE_COLORS.accent, GRADIENT_SHADE)]), WHITE);
  assert.equal(contrastTextAcross(['#ffd700', mixWithBlack('#ffd700', GRADIENT_SHADE)]), DARK);
  assert.equal(contrastTextAcross(['#ff6600', 'bogus']), WHITE);
  assert.equal(contrastTextAcross([]), WHITE);
});

test("mixing with black is color-mix()'s, channel by channel", () => {
  assert.equal(mixWithBlack('#ff6600', 0.55), '#8c3800');
  assert.equal(mixWithBlack('#ffffff', 1), '#ffffff');
  assert.equal(mixWithBlack('#ffffff', 0), '#000000');
  assert.equal(mixWithBlack('nope', 0.5), null);
});
