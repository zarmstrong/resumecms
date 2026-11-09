import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DARK_COLORS, LANDING_COLOR_KEYS, darkClass, darkPalette, landingPageStyle, landingSite, ownStyleFrom } from './landingStyle.js';
import { resolveLanding } from './resolveLanding.js';
import { DEFAULT_FONT, DEFAULT_SITE_COLORS, FONT_OPTIONS } from '../resume/siteColors.js';
import * as server from '../../../server/src/landingStyle.js';
import * as serverFields from '../../../server/src/landingFields.js';

// The landing page's look (issue #93) is checked on the server against the
// site settings' rules, which live here (siteColors.js), and resolved in
// both places: the two have to agree.

test("the server's copy of the site settings' rules matches siteColors.js", () => {
  assert.deepEqual(server.FONT_IDS, FONT_OPTIONS.map((f) => f.value));
  assert.equal(server.DEFAULT_FONT, DEFAULT_FONT);
  assert.deepEqual(server.LANDING_COLOR_KEYS, LANDING_COLOR_KEYS);
  assert.deepEqual(server.DEFAULT_LANDING_COLORS, Object.fromEntries(LANDING_COLOR_KEYS.map((key) => [key, DEFAULT_SITE_COLORS[key]])));
  assert.deepEqual(server.DEFAULT_DARK_COLORS, DEFAULT_DARK_COLORS);
});

const resumeSite = { title: 'T', font: 'lora', colors: { accent: '#123456', datesPill: '#000000' } };
const styles = [
  undefined,
  server.emptyStyle(),
  { source: 'resume', colors: { accent: '#aa0000' }, font: 'inter', nameFont: '' },
  { source: 'custom', colors: { accent: '', heading: '', text: '', background: '' }, font: '', nameFont: '' },
  { source: 'custom', colors: { accent: '#aa0000', heading: '#111111', text: '', background: '#fafafa' }, font: 'inter', nameFont: 'lora' },
  { source: 'resume', colors: {}, font: '', nameFont: '', darkColors: { accent: '#ffcc00', heading: '', text: '', background: '' } },
  { source: 'custom', colors: {}, font: 'work-sans', nameFont: '', darkColors: { accent: '', heading: '', text: '', background: '' } },
];

test('the preview picks the same site and dark palette as the server', () => {
  for (const style of styles) {
    for (const site of [resumeSite, null]) {
      assert.deepEqual(landingSite(style, site), server.landingSite(style, site), JSON.stringify(style));
    }
    assert.deepEqual(darkPalette(style), server.darkPalette(style), JSON.stringify(style));
  }
});

test('the whole resolved look matches the server', () => {
  const draft = { ...serverFields.emptyLanding(), headline: 'Jo' };
  const context = { photoUrl: '', site: resumeSite, resumes: [], images: [] };
  const serverContext = { photoUrl: '', site: resumeSite, resumes: new Map(), images: new Map() };
  for (const style of styles) {
    for (const template of [undefined, 'split', 'nope']) {
      const landing = { ...draft, ...(style ? { style } : {}), ...(template ? { template } : {}) };
      if (!style) delete landing.style;
      if (!template) delete landing.template;
      const ours = resolveLanding(landing, context);
      const theirs = serverFields.resolveLanding(landing, serverContext);
      assert.deepEqual(
        { template: ours.template, site: ours.site, darkColors: ours.darkColors },
        { template: theirs.template, site: theirs.site, darkColors: theirs.darkColors },
        JSON.stringify(landing)
      );
    }
  }
});

test("the page's style sets its light colors, its dark ones only when it has some, and its fonts", () => {
  const { colors, style } = landingPageStyle({ colors: { accent: '#ffffff' }, font: 'inter', nameFont: 'lora' }, null);
  assert.equal(colors.accent, '#ffffff');
  assert.equal(style['--l-accent'], '#ffffff');
  assert.equal(style['--l-on-accent'], '#14181c');
  assert.equal(style['--l-bg'], DEFAULT_SITE_COLORS.background);
  assert.match(style['--font-resume'], /Inter/);
  assert.match(style['--r-name-font'], /Lora/);
  assert.equal(Object.keys(style).some((key) => key.startsWith('--l-dark-')), false);

  const dark = landingPageStyle(null, DEFAULT_DARK_COLORS).style;
  assert.equal(dark['--l-dark-bg'], DEFAULT_DARK_COLORS.background);
  assert.equal(dark['--l-dark-on-accent'], '#14181c');
  assert.equal('--r-name-font' in dark, false);
});

test('a dark palette is followed by the visitor’s setting, unless the preview picks', () => {
  assert.equal(darkClass(null), '');
  assert.equal(darkClass(null, 'dark'), '');
  assert.equal(darkClass(DEFAULT_DARK_COLORS), 'l-dark-auto');
  assert.equal(darkClass(DEFAULT_DARK_COLORS, 'dark'), 'l-dark-on');
  assert.equal(darkClass(DEFAULT_DARK_COLORS, 'light'), '');
});

test("its own colors start from what the page shows, and only once", () => {
  const first = ownStyleFrom(server.emptyStyle(), { font: 'lora', nameFont: 'inter', colors: { accent: '#ABCDEF', text: '#12' } });
  assert.deepEqual(first, {
    source: 'custom',
    // The resume's text color is half typed, so it starts as the default.
    colors: { accent: '#abcdef', heading: DEFAULT_SITE_COLORS.heading, text: '', background: DEFAULT_SITE_COLORS.background },
    font: 'lora',
    nameFont: 'inter',
  });
  // What it saves passes the server's checks.
  assert.deepEqual(server.checkStyle(first), first);
  assert.deepEqual(ownStyleFrom({ ...server.emptyStyle(), font: '' }, null).font, DEFAULT_FONT);
  // Once picked, switching back and forth keeps what was chosen.
  const chosen = { source: 'resume', colors: { accent: '#aa0000', heading: '', text: '', background: '' }, font: '', nameFont: '' };
  assert.deepEqual(ownStyleFrom(chosen, resumeSite), { ...chosen, source: 'custom' });
});
