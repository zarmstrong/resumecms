#!/usr/bin/env node
// Validates the shape of everything under templates/ so a broken
// contribution fails fast in CI instead of silently breaking the build or
// showing up empty in the gallery. Dependency-free — only Node builtins —
// so it runs with no `npm install` step.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errors = [];

function dirsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory());
}

function readJson(file, label) {
  if (!existsSync(file)) {
    errors.push(`${label}: missing template.json`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    errors.push(`${label}: template.json is not valid JSON (${err.message})`);
    return null;
  }
}

function checkMeta(meta, label, extraKeys = []) {
  if (!meta) return;
  for (const field of ['label', 'description', 'author']) {
    if (typeof meta[field] !== 'string' || !meta[field].trim()) {
      errors.push(`${label}: "${field}" must be a non-empty string`);
    }
  }
  const allowed = new Set(['label', 'description', 'author', ...extraKeys]);
  for (const key of Object.keys(meta)) {
    if (!allowed.has(key)) errors.push(`${label}: unrecognized field "${key}"`);
  }
}

function checkId(id, label) {
  if (!ID_RE.test(id)) errors.push(`${label}: folder name "${id}" must be lowercase kebab-case`);
}

// ---- headers: template.json + index.jsx both required -----------------
const headerIds = dirsIn(path.join(TEMPLATES_DIR, 'headers'));
for (const id of headerIds) {
  const dir = path.join(TEMPLATES_DIR, 'headers', id);
  const label = `templates/headers/${id}`;
  checkId(id, label);
  checkMeta(readJson(path.join(dir, 'template.json'), label), label);
  if (!existsSync(path.join(dir, 'index.jsx'))) errors.push(`${label}: missing index.jsx`);
}

// ---- layouts: template.json required, index.jsx optional --------------
const layoutIds = dirsIn(path.join(TEMPLATES_DIR, 'layouts'));
for (const id of layoutIds) {
  const dir = path.join(TEMPLATES_DIR, 'layouts', id);
  const label = `templates/layouts/${id}`;
  checkId(id, label);
  checkMeta(readJson(path.join(dir, 'template.json'), label), label, ['skillsDisplay']);
}

// ---- presets: template.json referencing an existing header + layout ---
const presetIds = dirsIn(path.join(TEMPLATES_DIR, 'presets'));
const COLOR_KEYS = new Set([
  'accent', 'heading', 'text', 'background',
  'skillsCategoryText', 'skillsCategoryPill', 'datesText', 'datesPill', 'sidebarBackground',
]);
const HEX_RE = /^#[0-9a-f]{6}$/i;
for (const id of presetIds) {
  const dir = path.join(TEMPLATES_DIR, 'presets', id);
  const label = `templates/presets/${id}`;
  checkId(id, label);
  const meta = readJson(path.join(dir, 'template.json'), label);
  checkMeta(meta, label, [
    'id', 'header', 'layout', 'colors', 'font', 'fontSize', 'lineSpacing', 'pillPadding',
  ]);
  if (!meta) continue;
  if (meta.id !== id) errors.push(`${label}: "id" (${meta.id}) must match its folder name`);
  if (!headerIds.includes(meta.header)) {
    errors.push(`${label}: "header" references unknown header "${meta.header}"`);
  }
  if (!layoutIds.includes(meta.layout)) {
    errors.push(`${label}: "layout" references unknown layout "${meta.layout}"`);
  }
  if (meta.colors) {
    for (const [key, value] of Object.entries(meta.colors)) {
      if (!COLOR_KEYS.has(key)) errors.push(`${label}: colors.${key} is not a recognized color field`);
      else if (!HEX_RE.test(value)) errors.push(`${label}: colors.${key} ("${value}") must be a #rrggbb hex value`);
    }
  }
}

if (errors.length) {
  console.error(`✗ templates/ validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):\n`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`✓ templates/ OK — ${headerIds.length} header(s), ${layoutIds.length} layout(s), ${presetIds.length} preset(s)`);
