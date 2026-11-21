import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FONT_OPTIONS } from './resume/siteColors.js';

// fonts.js is CSS imports only, which node can't load, so it's read as text.
const source = readFileSync(new URL('./fonts.js', import.meta.url), 'utf8');
const imported = new Map();
for (const [, pkg, weight] of source.matchAll(/^import '@fontsource\/([a-z0-9-]+)\/(\d+)\.css';$/gm)) {
  imported.set(pkg, [...(imported.get(pkg) || []), Number(weight)]);
}
const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tokens = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8');

const firstFamily = (css) => css.split(',')[0].trim().replace(/^'|'$/g, '');
const packageOf = (family) => family.toLowerCase().replace(/\s+/g, '-');
const SYSTEM_FONTS = new Set(['Georgia']);

test('every site font but a system one is self-hosted from its static @fontsource package', () => {
  for (const option of FONT_OPTIONS) {
    const family = firstFamily(option.css);
    if (SYSTEM_FONTS.has(family)) continue;
    const pkg = packageOf(family);
    assert.ok(imported.get(pkg)?.includes(400), `${option.value}: fonts.js imports @fontsource/${pkg} at 400`);
    assert.ok(imported.get(pkg)?.includes(700) || pkg === 'ibm-plex-sans', `${option.value}: fonts.js imports a bold weight`);
  }
});

test('the UI font is self-hosted too', () => {
  const ui = tokens.match(/--font-ui:\s*([^;]+);/)?.[1];
  assert.ok(ui, 'tokens.css sets --font-ui');
  assert.ok(imported.has(packageOf(firstFamily(ui))), `fonts.js imports ${firstFamily(ui)}`);
});

test('fonts.js imports only static packages the client depends on, never a variable build', () => {
  assert.ok(imported.size > 0);
  for (const pkg of imported.keys()) {
    assert.ok(pkgJson.dependencies[`@fontsource/${pkg}`], `package.json depends on @fontsource/${pkg}`);
  }
  assert.doesNotMatch(source, /@fontsource-variable\//, 'a variable font embeds in a PDF as Type3');
});
