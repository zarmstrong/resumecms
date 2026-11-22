import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetGroups, presetSite } from './resumePresets.js';
import { DEFAULT_SITE_COLORS, normalizeSiteColors, contrastRatio, relativeLuminance } from './siteColors.js';

// Read the registry's metadata directly: import.meta.glob is Vite-only.
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../templates');
function readTemplates(kind) {
  return fs.readdirSync(path.join(TEMPLATE_DIR, kind)).map((id) => ({
    id,
    ...JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, kind, id, 'template.json'), 'utf8')),
  }));
}
const PRESETS = readTemplates('presets');
const classic = PRESETS.find((p) => p.id === 'classic');

test('colors are replaced, including optional overrides, without changing either input', () => {
  const site = Object.freeze({ colors: Object.freeze({ accent: '#ff0000', datesPill: '#000000' }) });
  const preset = Object.freeze({ ...classic, colors: Object.freeze({ accent: '#1e3a5f' }) });
  const next = presetSite(site, preset);
  assert.deepEqual(next.colors, { accent: '#1e3a5f' });
  assert.equal(Object.hasOwn(next.colors, 'datesPill'), false);
  assert.deepEqual(site.colors, { accent: '#ff0000', datesPill: '#000000' });
});

test('a preset without colors clears the legacy accent and restores the default palette', () => {
  const next = presetSite({ accent: '#ff0000' }, classic);
  assert.equal(Object.hasOwn(next, 'accent'), false);
  assert.deepEqual(next.colors, {});
  assert.deepEqual(normalizeSiteColors(next), DEFAULT_SITE_COLORS);
});

test('missing preset type settings are removed, along with overrides a preset cannot set', () => {
  const next = presetSite({
    font: 'lora', fontSize: 'large', lineSpacing: 'loose', pillPadding: 'spacious',
    nameFont: 'montserrat', fontWeight: 'medium', bulletStyle: 'square',
  }, classic);
  for (const key of ['font', 'fontSize', 'lineSpacing', 'pillPadding', 'nameFont', 'fontWeight', 'bulletStyle']) {
    assert.equal(Object.hasOwn(next, key), false, key);
  }
});

test('preset type settings replace the previous values', () => {
  const preset = { ...classic, font: 'eb-garamond', fontSize: 'small', lineSpacing: 'tight', pillPadding: 'compact' };
  const next = presetSite({ font: 'lora', fontSize: 'large', lineSpacing: 'loose', pillPadding: 'spacious' }, preset);
  assert.equal(next.font, 'eb-garamond');
  assert.equal(next.fontSize, 'small');
  assert.equal(next.lineSpacing, 'tight');
  assert.equal(next.pillPadding, 'compact');
});

test('title, description and unrelated settings stay, and templateId is dropped', () => {
  const unrelated = { future: true };
  const next = presetSite({ title: 'My resume', description: 'About me', unrelated, templateId: 'old' }, classic);
  assert.equal(next.title, 'My resume');
  assert.equal(next.description, 'About me');
  assert.equal(next.unrelated, unrelated);
  assert.equal(Object.hasOwn(next, 'templateId'), false);
});

test('the PDF page numbers setting is kept, since it is not part of the look', () => {
  assert.equal(presetSite({ pdfPageNumbers: true }, classic).pdfPageNumbers, true);
});

test('every preset applies a registered header and layout', () => {
  const headers = new Set(readTemplates('headers').map((t) => t.id));
  const layouts = new Set(readTemplates('layouts').map((t) => t.id));
  for (const preset of PRESETS) {
    const next = presetSite({ template: 'old', layout: 'old' }, preset);
    assert.equal(next.template, preset.header, preset.id);
    assert.equal(next.layout, preset.layout, preset.id);
    assert.ok(headers.has(next.template), `${preset.id}: registered header`);
    assert.ok(layouts.has(next.layout), `${preset.id}: registered layout`);
  }
});

test('all seven profession presets have accents with at least 4.5:1 contrast against white', () => {
  for (const id of ['trades', 'healthcare', 'law-finance', 'education', 'research', 'creative', 'hospitality']) {
    const preset = PRESETS.find((p) => p.id === id);
    assert.ok(preset, id);
    assert.ok(contrastRatio(relativeLuminance(preset.colors.accent), relativeLuminance('#ffffff')) >= 4.5, id);
  }
});

test('presetGroups lists the profession group first, then the look group', () => {
  const groups = presetGroups([{ id: 'a', group: 'profession' }, { id: 'b' }]);
  assert.deepEqual(groups.map((group) => group.id), ['profession', 'look']);
  assert.equal(groups[0].title, 'By profession');
  assert.equal(groups[1].title, 'By look');
});

test('presetGroups puts a preset in the group its group key names, and every other one under look', () => {
  const groups = presetGroups([
    { id: 'trades', group: 'profession' },
    { id: 'classic' },
    { id: 'odd', group: 'something-else' },
    { id: 'empty-string', group: '' },
  ]);
  assert.deepEqual(groups[0].presets.map((p) => p.id), ['trades']);
  assert.deepEqual(groups[1].presets.map((p) => p.id), ['classic', 'odd', 'empty-string']);
});

test('presetGroups keeps the order the presets were given in each group', () => {
  const groups = presetGroups([
    { id: 'z', group: 'profession' },
    { id: 'm' },
    { id: 'a', group: 'profession' },
    { id: 'b' },
  ]);
  assert.deepEqual(groups[0].presets.map((p) => p.id), ['z', 'a']);
  assert.deepEqual(groups[1].presets.map((p) => p.id), ['m', 'b']);
});

test('presetGroups leaves out a group with nothing in it', () => {
  assert.deepEqual(presetGroups([{ id: 'classic' }]).map((group) => group.id), ['look']);
  assert.deepEqual(presetGroups([{ id: 'trades', group: 'profession' }]).map((group) => group.id), ['profession']);
  assert.deepEqual(presetGroups([]), []);
});

test('exactly the seven profession presets are marked group: "profession" in templates/presets', () => {
  const marked = PRESETS.filter((p) => p.group !== undefined).map((p) => p.id).sort();
  assert.deepEqual(marked, ['creative', 'education', 'healthcare', 'hospitality', 'law-finance', 'research', 'trades']);
  for (const preset of PRESETS.filter((p) => p.group !== undefined)) {
    assert.equal(preset.group, 'profession', preset.id);
  }
});
