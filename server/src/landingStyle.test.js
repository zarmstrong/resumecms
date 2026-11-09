import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLanding, mergeLandingPatch, resolveLanding, validateLanding } from './landingFields.js';
import { DEFAULT_DARK_COLORS, DEFAULT_LANDING_COLORS, emptyStyle, landingSite, resumeSitePatch } from './landingStyle.js';

// The landing page's look (issue #93): its template, and its own colors,
// fonts and dark palette.

const refs = { knownResumeIds: new Set() };
const check = (patch) => validateLanding({ ...emptyLanding(), ...patch }, refs);
const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};
const context = { photoUrl: '', site: { title: 'Resume', font: 'lora', colors: { accent: '#123456' } }, resumes: new Map(), images: new Map() };

test("a new draft is classic, in the default resume's colors and fonts", () => {
  const draft = validateLanding({}, refs);
  assert.equal(draft.template, 'classic');
  assert.deepEqual(draft.style, emptyStyle());
  assert.deepEqual(draft.style, { source: 'resume', colors: { accent: '', heading: '', text: '', background: '' }, font: '', nameFont: '' });
});

test('template is any well-formed template id', () => {
  assert.equal(check({ template: 'split' }).template, 'split');
  // Not checked against the templates the client was built with: an
  // unknown one is drawn as classic there.
  assert.equal(check({ template: 'someday-maybe' }).template, 'someday-maybe');
  for (const bad of ['', 'Split', 'split/../x', 'two--dashes', '-x', 'x'.repeat(65), 3, null]) {
    assert.equal(status(() => validateLanding({ template: bad }, refs)), bad === null ? null : 400, String(bad));
  }
});

test("style is checked with the site settings' rules: a bad color or font is a 400", () => {
  const style = check({
    style: { source: 'custom', colors: { accent: '#ABCDEF', text: '' }, font: 'inter', nameFont: 'lora', darkColors: { background: '#000000' } },
  }).style;
  assert.deepEqual(style, {
    source: 'custom',
    colors: { accent: '#abcdef', heading: '', text: '', background: '' },
    font: 'inter',
    nameFont: 'lora',
    darkColors: { accent: '', heading: '', text: '', background: '#000000' },
  });
  // The dark palette is only stored when there is one.
  assert.equal('darkColors' in check({ style: { source: 'custom' } }).style, false);
  assert.equal('darkColors' in check({ style: { darkColors: null } }).style, false);

  const bad = [
    'red',
    { source: 'mine' },
    { colors: 'red' },
    { colors: { accent: 'red' } },
    { colors: { accent: '#abc' } },
    { colors: { accent: '#abcdefa' } },
    { colors: { accent: 'url(x)' } },
    { colors: { accent: 1 } },
    { colors: { link: '#000000' } },
    { colors: { skillsCategoryPill: '#000000' } },
    { font: 'comic-sans' },
    { font: 3 },
    { nameFont: 'Inter' },
    { darkColors: { text: 'black' } },
    { darkColors: [] },
    { fontSize: 'large' },
  ];
  for (const style of bad) assert.equal(status(() => check({ style })), 400, JSON.stringify(style));
});

test("the resolver gives the page the default resume's site, or its own colors and fonts", () => {
  const ownStyle = { source: 'custom', colors: { accent: '#aa0000', heading: '', text: '', background: '' }, font: '', nameFont: 'lora' };
  const resume = resolveLanding(check({}), context);
  assert.equal(resume.template, 'classic');
  assert.deepEqual(resume.site, context.site);
  assert.equal(resume.darkColors, null);

  // Kept while the source is the resume, so switching back loses nothing.
  assert.deepEqual(resolveLanding(check({ style: { ...ownStyle, source: 'resume' } }), context).site, context.site);

  const own = resolveLanding(check({ template: 'centered', style: ownStyle }), context);
  assert.equal(own.template, 'centered');
  // In the site settings' shape, empty ones normalized to their defaults,
  // and nothing else of the resume's site.
  assert.deepEqual(own.site, {
    colors: { ...DEFAULT_LANDING_COLORS, accent: '#aa0000' },
    font: 'source-serif',
    nameFont: 'lora',
  });
  assert.equal(own.darkColors, null);
  // Even with no resume published at all.
  assert.deepEqual(resolveLanding(check({ style: ownStyle }), { ...context, site: null }).site, own.site);
  assert.equal(resolveLanding(check({}), { ...context, site: null }).site, null);
});

test('the dark palette resolves with either source, its empty colors the dark defaults', () => {
  for (const source of ['resume', 'custom']) {
    const page = resolveLanding(check({ style: { source, darkColors: { accent: '#ffcc00' } } }), context);
    assert.deepEqual(page.darkColors, { ...DEFAULT_DARK_COLORS, accent: '#ffcc00' });
  }
});

test('a draft stored before the look resolves as it always did', () => {
  const { template, style, ...old } = check({});
  const page = resolveLanding(old, context);
  assert.equal(page.template, 'classic');
  assert.deepEqual(page.site, context.site);
  assert.equal(page.darkColors, null);
});

test('mergeLandingPatch merges style one level deep and its palettes one more', () => {
  const current = check({ style: { source: 'custom', colors: { accent: '#111111', text: '#222222' }, font: 'inter', darkColors: { text: '#eeeeee' } } });
  const merged = mergeLandingPatch(current, { style: { colors: { accent: '#333333', text: null }, nameFont: 'lora' } });
  assert.deepEqual(check(merged).style, {
    source: 'custom',
    colors: { accent: '#333333', heading: '', text: '', background: '' },
    font: 'inter',
    nameFont: 'lora',
    darkColors: { accent: '', heading: '', text: '#eeeeee', background: '' },
  });
  // null drops the dark palette; the template is replaced like any field.
  const plain = check(mergeLandingPatch(current, { style: { darkColors: null }, template: 'split' }));
  assert.equal('darkColors' in plain.style, false);
  assert.equal(plain.template, 'split');
  assert.deepEqual(check(mergeLandingPatch(current, { style: null })).style, emptyStyle());
  // Prototype keys are ignored, not merged.
  assert.equal(Object.getPrototypeOf(mergeLandingPatch(current, JSON.parse('{"style":{"__proto__":{"x":1}}}')).style), Object.prototype);
});

test('only a page with colors of its own has any to give a resume, never its dark palette', () => {
  assert.equal(status(() => resumeSitePatch(emptyStyle())), 400);
  assert.equal(status(() => resumeSitePatch(undefined)), 400);
  const style = check({ style: { source: 'custom', colors: { accent: '#aa0000' }, font: 'inter', darkColors: { accent: '#ffffff' } } }).style;
  assert.deepEqual(resumeSitePatch(style), {
    colors: { ...DEFAULT_LANDING_COLORS, accent: '#aa0000' },
    font: 'inter',
    nameFont: '',
  });
  assert.deepEqual(resumeSitePatch(style), landingSite(style, null));
});
