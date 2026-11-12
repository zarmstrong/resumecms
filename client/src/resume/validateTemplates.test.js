import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/validate-templates.mjs over fixture folders: the landing page's
// template kind (issue #93). The script itself is dependency-free and runs
// from the repo root in CI; here it's handed a templates folder of its own.

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/validate-templates.mjs');
const META = { label: 'L', description: 'D', author: 'A' };

function fixture(landing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-templates-'));
  for (const [id, files] of Object.entries(landing)) {
    fs.mkdirSync(path.join(dir, 'landing', id), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, 'landing', id, name), typeof body === 'string' ? body : JSON.stringify(body));
    }
  }
  return dir;
}

function validate(landing) {
  const dir = fixture(landing);
  try {
    const run = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    return { ok: run.status === 0, out: run.stdout + run.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const css = (id) => `.l-template-${id} .l-main { max-width: 1px; }`;
const classic = { 'template.json': META, 'style.css': css('classic') };

test('landing templates need template.json and a scoped style.css; index.jsx is optional', () => {
  const ok = validate({
    classic,
    split: { 'template.json': { ...META, columns: true }, 'style.css': css('split'), 'index.jsx': 'export default () => null;' },
    cover: { 'template.json': { ...META, cover: true }, 'style.css': css('cover'), 'index.jsx': 'export default () => null;' },
  });
  assert.equal(ok.ok, true, ok.out);
  assert.match(ok.out, /3 landing template\(s\)/);

  const cases = [
    [{ classic, other: { 'template.json': META } }, /templates\/landing\/other: missing style\.css/],
    [{ classic, other: { 'template.json': META, 'style.css': '.l-main { color: red; }' } }, /other: style\.css must scope its rules under \.l-template-other/],
    [{ classic, other: { 'style.css': css('other') } }, /other: missing template\.json/],
    [{ classic, other: { 'template.json': { ...META, label: '' }, 'style.css': css('other') } }, /other: "label" must be a non-empty string/],
    [{ classic, other: { 'template.json': { ...META, skillsDisplay: 'pills' }, 'style.css': css('other') } }, /other: unrecognized field "skillsDisplay"/],
    [{ classic, other: { 'template.json': { ...META, columns: 'yes' }, 'style.css': css('other'), 'index.jsx': '' } }, /other: "columns" must be a boolean/],
    [{ classic, other: { 'template.json': { ...META, columns: true }, 'style.css': css('other') } }, /other: "columns" needs an index\.jsx/],
    [{ classic, other: { 'template.json': { ...META, cover: 1 }, 'style.css': css('other'), 'index.jsx': '' } }, /other: "cover" must be a boolean/],
    [{ classic, other: { 'template.json': { ...META, cover: true }, 'style.css': css('other') } }, /other: "cover" needs an index\.jsx/],
    [{ classic, Other_1: { 'template.json': META, 'style.css': css('Other_1') } }, /folder name "Other_1" must be lowercase kebab-case/],
    [{ split: { 'template.json': META, 'style.css': css('split') } }, /missing "classic"/],
  ];
  for (const [landing, message] of cases) {
    const run = validate(landing);
    assert.equal(run.ok, false, run.out);
    assert.match(run.out, message);
  }
});

// The accessibility bar's two linted rules (issue #130,
// templates/landing/README.md): no outline removed without a replacement in
// the same rule, and no motion outside prefers-reduced-motion:
// no-preference.
const withCss = (body) => ({ classic, other: { 'template.json': META, 'style.css': `${css('other')}\n${body}` } });

test('a landing style.css may not remove an outline without a replacement in the same rule', () => {
  const passing = [
    '.l-template-other a:focus-visible { outline: 2px solid var(--r-accent); outline-offset: 2px; }',
    '.l-template-other a:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--r-heading); }',
    '.l-template-other a:focus:not(:focus-visible) { outline: none; }',
    '.l-template-other a:not(:focus-visible), .l-template-other button:not( :focus-visible ) { outline: 0; }',
    // The forced-colors pattern: a transparent outline with a box-shadow ring.
    '.l-template-other a:focus-visible { outline: 2px solid transparent; box-shadow: 0 0 0 3px var(--r-heading); }',
    '.l-template-other a:focus-visible { outline: 2px solid; outline-color: rgba(0, 0, 0, 0); box-shadow: 0 0 0 3px red; }',
    // Black in the legacy comma form isn't transparent.
    '.l-template-other a:focus-visible { outline: 2px solid rgb(0, 0, 0); }',
    '.l-template-other a:focus-visible { outline: 2px solid transparent; outline-color: red; }',
    // A tint mixed toward transparent is still a visible ring.
    '.l-template-other a:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 60%, transparent); }',
    '.l-template-other a:focus-visible { outline: 2px solid; outline-color: color-mix(in srgb, #2f6f4e 70%, transparent); }',
    // Turned back on later in the same rule.
    '.l-template-other a:focus-visible { outline: none; outline: 2px solid red; }',
    '.l-template-other a:focus-visible { outline: 0 solid; outline-width: 2px; }',
    '.l-template-other a:focus-visible { outline-width: 3px; }',
    // A color's zeros aren't a width; a var() can't be read, so it's on.
    '.l-template-other a:focus-visible { outline: 2px solid hsl(0 0% 20%); }',
    '.l-template-other a:focus-visible { outline: 2px solid rgb(0 0 0 / .6); }',
    '.l-template-other a:focus-visible { outline: var(--l-ring); }',
    '.l-template-other a:focus-visible { outline: var(--w) solid red; outline-width: var(--w); }',
    // A comment or a string mentioning it isn't a declaration.
    '/* outline: none */ .l-template-other a::after { content: "outline: none; }"; }',
  ];
  for (const body of passing) {
    const run = validate(withCss(body));
    assert.equal(run.ok, true, `${body}\n${run.out}`);
  }

  const failing = [
    ['.l-template-other a:focus-visible { outline: none; }', /other\/style\.css:2: "\.l-template-other a:focus-visible" removes the outline without a replacement/],
    ['.l-template-other summary { outline: 0 }', /"\.l-template-other summary" removes the outline/],
    ['.l-template-other a:focus { outline: 0 none !important; }', /removes the outline/],
    ['.l-template-other a:focus { outline-style: none; }', /removes the outline/],
    ['.l-template-other a:focus { outline-width: 0px; }', /removes the outline/],
    ['.l-template-other a:focus { outline: none; box-shadow: none; }', /removes the outline/],
    ['.l-template-other a:focus { outline: none; border-color: red; }', /removes the outline/],
    // Only some of the selectors are pointer-only.
    ['.l-template-other a:not(:focus-visible), .l-template-other button:focus { outline: none; }', /removes the outline/],
    ['@container (max-width: 600px) {\n  .l-template-other a:focus { outline: none; }\n}', /other\/style\.css:3: .*removes the outline/],
    // A longhand switches one part back on, the other stays off.
    ['.l-template-other a:focus { outline: none; outline-width: 2px; }', /removes the outline/],
    ['.l-template-other a:focus { outline-style: none; outline-width: 3px; }', /removes the outline/],
    ['.l-template-other a:focus { outline: 0; outline-style: solid; }', /removes the outline/],
    // The shorthand without a style draws none.
    ['.l-template-other a:focus { outline: 2px red; }', /removes the outline/],
    // A transparent outline is drawn only in forced-colors mode.
    ['.l-template-other a:focus-visible { outline: 2px solid transparent; }', /removes the outline/],
    ['.l-template-other a:focus-visible { outline: 2px solid transparent; box-shadow: none; }', /removes the outline/],
    ['.l-template-other a:focus-visible { outline: 2px solid #0000; }', /removes the outline/],
    ['.l-template-other a:focus-visible { outline: 2px solid #00000000; }', /removes the outline/],
    ['.l-template-other a:focus-visible { outline: 2px solid red; outline-color: transparent; }', /removes the outline/],
    ['.l-template-other a:focus-visible { outline: 2px solid rgba(0,0,0,0); }', /removes the outline/],
    ['.l-template-other a:focus-visible { outline: 2px solid rgb(0 0 0 / 0%); }', /removes the outline/],
  ];
  for (const [body, message] of failing) {
    const run = validate(withCss(body));
    assert.equal(run.ok, false, body);
    assert.match(run.out, message, body);
  }
});

test('a landing style.css moves things only under prefers-reduced-motion: no-preference', () => {
  const passing = [
    '.l-template-other .l-action { transition: background 120ms ease, color 120ms ease, border-color 120ms; }',
    '.l-template-other .l-card { transition: opacity 0.2s cubic-bezier(0.2, 0, 0, 1) 40ms; }',
    '.l-template-other .l-card { transition-property: border-top-color, background-color; }',
    '.l-template-other .l-card { transition: none; animation: none; }',
    '.l-template-other .l-card { transition: unset; }',
    '@media (prefers-reduced-motion: no-preference) { .l-template-other .l-card { transition: transform 120ms; animation: spin 1s infinite; } }',
    '@media (min-width: 600px) and (prefers-reduced-motion:no-preference) { .l-template-other .l-card { transition: all 1s; } }',
    // Nested in another at-rule inside the gate.
    '@media (prefers-reduced-motion: no-preference) { @container (width > 600px) { .l-template-other .l-card { transition: transform 1s; } } }',
    // Keyframes describe an animation; they don't start one.
    '@keyframes l-other-in { from { transform: scale(0.9); } }',
    '.l-template-other .l-card { transition: visibility 0s linear 200ms, opacity 200ms; }',
    '.l-template-other .l-card { animation: none 0s; -webkit-animation: none; animation-name: none, none; }',
    '.l-template-other .l-card { transition-property: color; transition-duration: 200ms; }',
    '.l-template-other .l-card { transition-duration: 0s; }',
    '.l-template-other dialog { transition: opacity .2s, display .2s allow-discrete, overlay .2s allow-discrete; }',
    // A zero duration moves nothing (and the shorthand's default is 0s).
    '.l-template-other .l-card { transition: transform 0s; }',
    '.l-template-other .l-card { transition: transform; }',
    '.l-template-other .l-card { transition-property: transform; transition-duration: 0s; }',
    '.l-template-other .l-card { transition: color 1s, transform 0s; }',
    '.l-template-other input { transition: accent-color 1s, column-rule-color 1s; }',
    '.l-template-other { scroll-behavior: auto; }',
    '@media (prefers-reduced-motion: no-preference) { .l-template-other { scroll-behavior: smooth; } }',
    '@media (prefers-reduced-motion: no-preference) and (min-width: 1px), (prefers-reduced-motion: no-preference) { .l-template-other .l-card { animation: x 1s; } }',
    // A `not` on another condition leaves the gate alone.
    '@media (hover: hover) and (prefers-reduced-motion: no-preference) and (not (pointer: coarse)) { .l-template-other .l-card { animation: x 1s; } }',
  ];
  for (const body of passing) {
    const run = validate(withCss(body));
    assert.equal(run.ok, true, `${body}\n${run.out}`);
  }

  const failing = [
    ['.l-template-other .l-card { transition: transform 120ms ease; }', /other\/style\.css:2: "transition: transform 120ms ease" in "\.l-template-other \.l-card" transitions transform/],
    ['.l-template-other .l-card { transition: border-color 120ms, transform 120ms; }', /transitions transform,/],
    ['.l-template-other .l-card { transition: 120ms; }', /transitions all/],
    ['.l-template-other .l-card { transition: all 120ms; }', /transitions all/],
    ['.l-template-other .l-card { transition: box-shadow 120ms; }', /transitions box-shadow/],
    // A duration held in a custom property can't be read, so it isn't 0s.
    ['.l-template-other .l-card { transition: transform var(--l-speed) ease; }', /transitions transform/],
    ['.l-template-other .l-card { transition: transform var(--l-speed, 160ms); }', /transitions transform/],
    ['.l-template-other .l-card { transition-property: transform; transition-duration: var(--l-speed); }', /transitions transform/],
    ['.l-template-other .l-card { transition-property: top, color; }', /transitions top/],
    ['.l-template-other .l-card { animation: l-other-in 160ms ease-out; }', /"animation: l-other-in 160ms ease-out" .* must be inside @media \(prefers-reduced-motion: no-preference\)/],
    ['.l-template-other .l-card { animation-name: l-other-in; }', /"animation-name: l-other-in"/],
    // The opposite query, or no-preference negated, isn't the gate.
    ['@media (prefers-reduced-motion: reduce) { .l-template-other .l-card { transition: transform 1s; } }', /transitions transform/],
    ['@media not (prefers-reduced-motion: no-preference) { .l-template-other .l-card { animation: x 1s; } }', /"animation: x 1s"/],
    // A query list is an OR: every query in it needs the condition.
    ['@media screen, (prefers-reduced-motion: no-preference) { .l-template-other .l-card { animation: x 1s; } }', /"animation: x 1s"/],
    ['@media (prefers-reduced-motion: no-preference) or (min-width: 1px) { .l-template-other .l-card { animation: x 1s; } }', /"animation: x 1s"/],
    // A whole query negated, or the condition itself.
    ['@media not screen and (prefers-reduced-motion: no-preference) { .l-template-other .l-card { animation: x 1s; } }', /"animation: x 1s"/],
    ['@media (hover: hover) and (not (prefers-reduced-motion: no-preference)) { .l-template-other .l-card { animation: x 1s; } }', /"animation: x 1s"/],
    ['@media (min-width: 1px) OR (prefers-reduced-motion: no-preference) { .l-template-other .l-card { animation: x 1s; } }', /"animation: x 1s"/],
    // Pairs by index: the second property gets the second duration.
    ['.l-template-other .l-card { transition-property: color, transform; transition-duration: 1s, 2s; }', /transitions transform,/],
    ['.l-template-other .l-card { transition: transform 0s; transition-duration: 1s; }', /"transition: transform 0s; transition-duration: 1s" .* transitions transform/],
    // A duration alone transitions all.
    ['.l-template-other .l-card { transition-duration: 300ms; }', /"transition-duration: 300ms" .* transitions all/],
    ['.l-template-other .l-card { transition-duration: 0s, 1s; }', /transitions all/],
    // Prefixed properties are the same properties.
    ['.l-template-other .l-card { -webkit-transition: -webkit-transform 1s; }', /"-webkit-transition: -webkit-transform 1s" .* transitions -webkit-transform/],
    ['.l-template-other .l-card { -moz-animation: spin 1s; }', /"-moz-animation: spin 1s"/],
    ['.l-template-other .l-card { -o-transition-property: left; }', /transitions left/],
    ['.l-template-other .l-card { -webkit-transition-duration: 1s; }', /transitions all/],
    // Smooth scrolling is motion too.
    ['.l-template-other { scroll-behavior: smooth; }', /"scroll-behavior: smooth" in "\.l-template-other" must be inside/],
  ];
  for (const [body, message] of failing) {
    const run = validate(withCss(body));
    assert.equal(run.ok, false, body);
    assert.match(run.out, message, body);
  }
});

test("the repo's own templates pass", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
