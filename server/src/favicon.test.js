import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEUTRAL_COLORS,
  colorOf,
  etagOf,
  faviconSvg,
  iconContent,
  iconVersions,
  initialsOf,
  inkFor,
  siteAccent,
  versionOf,
} from './favicon.js';
import { DEFAULT_LANDING_COLORS } from './landingStyle.js';

// The icon's content and markup (issue #104); routes/favicon.test.js
// covers which page it's drawn from and the responses.

const textOf = (svg) => svg.match(/<text[^>]*>(.*)<\/text>/)?.[1] ?? null;

test('initials: the first letters of the first and last words', () => {
  assert.equal(initialsOf('Jo Doe'), 'JD');
  assert.equal(initialsOf('  jo   doe  '), 'JD');
  assert.equal(initialsOf('Z'), 'Z');
  assert.equal(initialsOf('John Ronald Reuel Tolkien'), 'JT');
  assert.equal(initialsOf('Mary-Jane van der Berg'), 'MB');
  assert.equal(initialsOf('42 Studio'), '4S');
});

test('initials: odd names', () => {
  // A word without letters doesn't count; punctuation before one is skipped.
  assert.equal(initialsOf('😀 Jo 🚀'), 'J');
  assert.equal(initialsOf('😀'), '');
  assert.equal(initialsOf('— · —'), '');
  assert.equal(initialsOf('<script>alert(1)</script>'), 'S');
  assert.equal(initialsOf(`"Jo" O'Neil`), 'JO');
  assert.equal(initialsOf('(Jo) <b>Doe</b>'), 'JB');
  // Right-to-left and CJK names keep their own letters, in name order.
  assert.equal(initialsOf('דנה כהן'), 'דכ');
  assert.equal(initialsOf('محمد علي'), 'مع');
  assert.equal(initialsOf('山田 太郎'), '山太');
  // A letter keeps its combining marks; upper-casing never makes two of one.
  assert.equal(initialsOf('émile zola'), 'ÉZ');
  assert.equal(initialsOf('ßen'), 'ß');
  assert.equal(initialsOf('élodie'), 'É');
  // Not a name at all, or a very long one.
  for (const value of [undefined, null, 42, '', '   ']) assert.equal(initialsOf(value), '', String(value));
  assert.equal(initialsOf(`${'a '.repeat(10_000)}z`), 'AA', 'only the start of a long name is read');
});

test('the initials and the font name are escaped; nothing else in the SVG is free text', () => {
  const svg = faviconSvg({ initials: `<&"'>`, accent: '#2f6f4e', darkAccent: null });
  assert.equal(textOf(svg), '&lt;&amp;&quot;&#39;&gt;');
  assert.doesNotMatch(svg, /<[^a-z/!]/i, 'no stray markup');
  assert.match(svg, /font-family="&#39;Liberation Sans&#39;, Arial, Helvetica, sans-serif"/);
  // Each odd name comes out as well-formed markup with only its initials in it.
  for (const name of ['<script>alert(1)</script>', `"Jo" O'Neil`, '😀', 'דנה כהן', 'Z', 'a b c d e f g h']) {
    const markup = faviconSvg(iconContent({ name, accent: '#336699' }));
    assert.doesNotMatch(markup, /<script|alert/i, name);
    assert.equal((markup.match(/<svg /g) ?? []).length, 1, name);
    assert.match(markup, /<\/svg>$/, name);
  }
});

test('colors: only #rrggbb gets in', () => {
  assert.equal(colorOf('#AABBCC', null), '#aabbcc');
  for (const value of ['red', '#abc', '#aabbccdd', 'url(#x)', '#aabbcc"/><script>', '', null, 1]) {
    assert.equal(colorOf(value, 'fallback'), 'fallback', String(value));
  }
  const content = iconContent({ name: 'Jo', accent: '"/><script>alert(1)</script>', darkColors: { accent: 'expression(1)' } });
  assert.deepEqual(content, { initials: 'J', accent: NEUTRAL_COLORS.accent, darkAccent: null });
});

test("a resume's accent: its colors, an older site's flat accent, or the default", () => {
  assert.equal(siteAccent({ colors: { accent: '#112233' }, accent: '#445566' }), '#112233');
  assert.equal(siteAccent({ colors: {}, accent: '#445566' }), '#445566');
  assert.equal(siteAccent({ colors: { accent: 'bogus' } }), DEFAULT_LANDING_COLORS.accent);
  assert.equal(siteAccent(null), DEFAULT_LANDING_COLORS.accent);
});

test('the initials are drawn in whichever of white and near-black reads on the accent', () => {
  assert.equal(inkFor('#2f6f4e'), '#ffffff');
  assert.equal(inkFor('#000000'), '#ffffff');
  assert.equal(inkFor('#ffffff'), '#14181c');
  assert.equal(inkFor('#ffd700'), '#14181c');
  // By contrast ratio against the near-black ink itself, not black's
  // 0.179 luminance cutoff: #777777 (0.184) still reads better in white.
  assert.equal(inkFor('#ff6600'), '#14181c');
  assert.equal(inkFor('#777777'), '#ffffff');
  assert.equal(inkFor('#808080'), '#14181c');
  assert.match(faviconSvg(iconContent({ name: 'Jo', accent: '#ffd700' })), /<text[^>]*fill="#14181c"/);
});

test('no name: the neutral mark, in the page accent or the neutral slate', () => {
  const plain = faviconSvg(iconContent());
  assert.equal(textOf(plain), null);
  assert.match(plain, new RegExp(`<rect class="tile"[^>]*fill="${NEUTRAL_COLORS.accent}"`));
  assert.equal((plain.match(/<rect class="ink"/g) ?? []).length, 3);
  assert.match(faviconSvg(iconContent({ name: '😀', accent: '#336699' })), /<rect class="tile"[^>]*fill="#336699"/);
});

test('the dark palette switches the SVG under prefers-color-scheme; the PNG stays light and square', () => {
  const content = iconContent({ name: 'Jo Doe', accent: '#2f6f4e', darkColors: { accent: '#7cc4a0', background: '#15191d' } });
  assert.equal(content.darkAccent, '#7cc4a0');
  const svg = faviconSvg(content);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)\{\.tile\{fill:#7cc4a0\}\.ink\{fill:#14181c\}\}/);
  assert.match(svg, /rx="14"/);
  const raster = faviconSvg(content, { forRaster: true });
  assert.doesNotMatch(raster, /<style|prefers-color-scheme/);
  assert.match(raster, /<rect class="tile" width="64" height="64" rx="0" fill="#2f6f4e"\/>/);
  assert.doesNotMatch(faviconSvg(iconContent({ name: 'Jo', accent: '#2f6f4e' })), /<style/, 'no dark palette, no media query');
});

test('the ETag is strong and follows the bytes', () => {
  const a = faviconSvg(iconContent({ name: 'Jo Doe', accent: '#2f6f4e' }));
  const renamed = faviconSvg(iconContent({ name: 'Al Doe', accent: '#2f6f4e' }));
  const recolored = faviconSvg(iconContent({ name: 'Jo Doe', accent: '#2f6f4f' }));
  assert.match(etagOf(a), /^"[0-9a-f]{32}"$/);
  assert.equal(etagOf(a), etagOf(faviconSvg(iconContent({ name: 'jo d', accent: '#2F6F4E' }))));
  assert.notEqual(etagOf(a), etagOf(renamed));
  assert.notEqual(etagOf(a), etagOf(recolored));
});

test("the links' versions (issue #108): the SVG's ETag, and the hash of the PNG's own SVG", () => {
  const content = iconContent({ name: 'Jo Doe', accent: '#2f6f4e', darkColors: { accent: '#7cc4a0' } });
  const { svg, png } = iconVersions(content);
  assert.equal(`"${svg}"`, etagOf(faviconSvg(content)));
  assert.equal(png, versionOf(faviconSvg(content, { forRaster: true })));
  assert.match(png, /^[0-9a-f]{32}$/);
  assert.notEqual(svg, png);
  // A dark accent is only in the SVG, so only its version follows it.
  const otherDark = iconVersions(iconContent({ name: 'Jo Doe', accent: '#2f6f4e', darkColors: { accent: '#ffcc00' } }));
  assert.notEqual(otherDark.svg, svg);
  assert.equal(otherDark.png, png);
  // A rename or a recolor moves both.
  for (const changed of [iconContent({ name: 'Al Doe', accent: '#2f6f4e' }), iconContent({ name: 'Jo Doe', accent: '#2f6f4f' })]) {
    const v = iconVersions(changed);
    assert.notEqual(v.svg, svg);
    assert.notEqual(v.png, png);
  }
});
