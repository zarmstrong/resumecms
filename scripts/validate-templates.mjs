#!/usr/bin/env node
// Validates the shape of everything under templates/ so a broken
// contribution fails fast in CI instead of silently breaking the build or
// showing up empty in the gallery. Dependency-free — only Node builtins —
// so it runs with no `npm install` step.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// The repo's templates/, or the folder given (validateTemplates.test.js
// runs it over fixtures).
const TEMPLATES_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'templates');
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
  const meta = readJson(path.join(dir, 'template.json'), label);
  checkMeta(meta, label, ['skillsDisplay', 'columns']);
  if (meta && 'columns' in meta && typeof meta.columns !== 'boolean') {
    errors.push(`${label}: "columns" must be a boolean`);
  }
}

// ---- landing style.css: the part of the accessibility bar a linter can
// see (templates/landing/README.md has the whole bar and these rules).
//
// Its rules are read by a small CSS reader: comments dropped, strings and
// parentheses kept whole (a `;` in a data: URL or a `{` in `content` isn't
// structure), and each rule's declarations listed with the at-rules
// around it. It's enough for the stylesheets we write, not a full parser.
function cssRules(source) {
  // Comments blanked rather than removed, so line numbers stay true.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const lineOf = (at) => text.slice(0, at).split('\n').length;
  const rules = [];
  let pos = 0;
  function block(atRules, selector) {
    const rule = { atRules, selector, declarations: [] };
    let chunk = '';
    let chunkStart = pos;
    let depth = 0;
    const flush = () => {
      const match = /^(-?[a-z][a-z-]*)\s*:([\s\S]*)$/i.exec(chunk.trim());
      if (match) {
        const value = match[2].replace(/!\s*important\s*$/i, '').trim();
        rule.declarations.push({ property: match[1].toLowerCase(), value, line: lineOf(chunkStart) });
      }
      chunk = '';
    };
    while (pos < text.length) {
      const ch = text[pos];
      if (!chunk.trim()) chunkStart = pos;
      if (ch === '"' || ch === "'") {
        let end = pos + 1;
        while (end < text.length && text[end] !== ch) end += text[end] === '\\' ? 2 : 1;
        chunk += text.slice(pos, end + 1);
        pos = end + 1;
        continue;
      }
      pos += 1;
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === ';') {
        flush();
        continue;
      } else if (depth === 0 && ch === '{') {
        const prelude = chunk.trim().replace(/\s+/g, ' ');
        chunk = '';
        if (prelude.startsWith('@')) block([...atRules, prelude], selector);
        else block(atRules, selector && prelude.includes('&') ? prelude.replaceAll('&', selector) : prelude);
        continue;
      } else if (depth === 0 && ch === '}') {
        flush();
        rules.push(rule);
        return;
      }
      chunk += ch;
    }
    flush();
    rules.push(rule);
  }
  block([], null);
  return rules.filter((rule) => rule.selector && !rule.atRules.some((at) => /^@(-webkit-)?keyframes\b/i.test(at)));
}

// Top-level commas only: `cubic-bezier(0, 0, 1, 1)` is one value.
function splitList(value) {
  const parts = [];
  let depth = 0;
  let part = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(part.trim());
      part = '';
    } else part += ch;
  }
  parts.push(part.trim());
  return parts.filter(Boolean);
}

// What a `transition` shorthand animates: in each comma-separated item, the
// one word that isn't a duration, a delay, an easing or a behavior; an item
// without one transitions `all`. `none` transitions nothing.
const TRANSITION_WORDS = new Set([
  'ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'normal', 'allow-discrete',
]);
function transitionedProperties(property, value) {
  if (property === 'transition-property') return splitList(value).map((name) => name.toLowerCase());
  return splitList(value).map((item) => {
    const words = item.replace(/[a-z-]+\([^)]*\)/gi, ' ').split(/\s+/).filter(Boolean);
    const name = words.find((word) => !TIME.test(word) && !TRANSITION_WORDS.has(word.toLowerCase()));
    return name ? name.toLowerCase() : 'all';
  });
}

// What may change gradually without the visitor having asked for motion:
// a color, a fade or a switch of visibility, which move nothing on the
// screen. Anything else (transform, a position, a size, a margin, a
// shadow's offset, `all`) belongs under prefers-reduced-motion:
// no-preference.
const STILL_PROPERTIES = new Set([
  'none', 'color', 'background', 'background-color', 'border-color', 'outline-color',
  'text-decoration-color', 'caret-color', 'fill', 'stroke', 'opacity', 'visibility',
  ...['top', 'right', 'bottom', 'left', 'block', 'inline', 'block-start', 'block-end', 'inline-start', 'inline-end']
    .map((side) => `border-${side}-color`),
]);
const CSS_WIDE = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer']);

// Inside the gate only if every query in the @media list has it: a list is
// an OR, so `screen, (prefers-reduced-motion: no-preference)` matches a
// visitor who asked for less motion too.
const motionAllowed = (rule) =>
  rule.atRules.some(
    (at) =>
      /^@media\b/i.test(at) &&
      splitList(at.replace(/^@media\s*/i, '')).every(
        (query) => /prefers-reduced-motion\s*:\s*no-preference/i.test(query) && !/\bnot\b/i.test(query)
      )
  );

// `-webkit-transition` is a transition (and so on for -moz-, -o-, -ms-).
const unprefixed = (property) => property.replace(/^-(webkit|moz|o|ms)-/, '');

const TIME = /^-?[\d.]+m?s$/i;

// The animations an `animation` shorthand starts: in each comma-separated
// item, the words that aren't a time, an easing, an iteration count, a
// direction, a fill mode or a play state. An item with none of them left,
// or only `none`, starts nothing (`animation: none 0s`).
const ANIMATION_WORDS = new Set([
  ...TRANSITION_WORDS, 'infinite', 'reverse', 'alternate', 'alternate-reverse',
  'forwards', 'backwards', 'both', 'running', 'paused',
]);
function animationNames(property, value) {
  const names =
    property === 'animation-name'
      ? splitList(value)
      : splitList(value).flatMap((item) =>
          item
            .replace(/[a-z-]+\([^)]*\)/gi, ' ')
            .split(/\s+/)
            .filter((word) => word && !TIME.test(word) && !/^[\d.]+$/.test(word) && !ANIMATION_WORDS.has(word.toLowerCase()))
        );
  return names.map((name) => name.toLowerCase()).filter((name) => name !== 'none');
}

// An outline that's switched off, its style and its width followed
// separately, since a longhand after the shorthand can switch either one
// back while the other stays off: `outline: none; outline-width: 2px` still
// draws nothing. The shorthand sets both (a style it doesn't name is
// `none`, so `outline: 2px red` is off too); `outline-style` and
// `outline-width` set one each. A transparent outline isn't off (it still
// shows in forced-colors mode, which is why it's used).
const ZERO = /^0(\.0+)?([a-z]+|%)?$/i;
const OUTLINE_STYLES = new Set(['auto', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
function outlineParts(property, value) {
  const words = value.toLowerCase().split(/\s+/);
  const wide = CSS_WIDE.has(words[0]);
  if (property === 'outline') {
    if (wide) return { style: 'on', width: 'on' };
    return {
      style: words.some((word) => OUTLINE_STYLES.has(word)) ? 'on' : 'off',
      width: words.some((word) => ZERO.test(word)) ? 'off' : 'on',
    };
  }
  if (property === 'outline-style') return { style: !wide && words.includes('none') ? 'off' : 'on' };
  if (property === 'outline-width') return { width: !wide && ZERO.test(words[0]) ? 'off' : 'on' };
  return null;
}

// Pointer focus only: every selector in the list leaves :focus-visible
// alone, so the keyboard's ring is untouched.
const pointerOnly = (selector) => splitList(selector).every((one) => /:not\(\s*:focus-visible\s*\)/i.test(one));

const GATE = 'must be inside @media (prefers-reduced-motion: no-preference)';

function checkLandingCss(source, label) {
  for (const rule of cssRules(source)) {
    const outline = { style: null, width: null };
    let outlineLine = 0;
    let replaced = false;
    let namesProperty = false;
    let duration = null;
    const gated = motionAllowed(rule);
    for (const { property: written, value, line } of rule.declarations) {
      const parts = outlineParts(written, value);
      if (parts) {
        Object.assign(outline, parts);
        outlineLine = line;
      }
      if (written === 'box-shadow' && !/^none$/i.test(value)) replaced = true;
      const property = unprefixed(written);
      if (property === 'transition' || property === 'transition-property') namesProperty = true;
      if (gated || CSS_WIDE.has(value.toLowerCase())) continue;
      const shown = `"${written}: ${value}" in "${rule.selector}"`;
      if ((property === 'animation' || property === 'animation-name') && animationNames(property, value).length) {
        errors.push(`${label}:${line}: ${shown} ${GATE}`);
      }
      if (property === 'scroll-behavior' && /^smooth$/i.test(value)) {
        errors.push(`${label}:${line}: ${shown} ${GATE}`);
      }
      if (property === 'transition' || property === 'transition-property') {
        const moving = transitionedProperties(property, value).filter((name) => !STILL_PROPERTIES.has(name));
        if (moving.length) {
          errors.push(
            `${label}:${line}: ${shown} transitions ${moving.join(', ')}, which ${GATE} (only colors, opacity and visibility may transition outside it)`
          );
        }
      }
      // A duration in a rule that names no property transitions `all`, the
      // initial transition-property (unless another rule names one, which
      // the linter can't see, so it asks for the property here).
      if (property === 'transition-duration' && splitList(value).some((time) => TIME.test(time) && parseFloat(time) !== 0)) {
        duration = { shown, line };
      }
    }
    if (duration && !namesProperty) {
      errors.push(`${label}:${duration.line}: ${duration.shown} transitions all (the rule names no transition-property), which ${GATE}`);
    }
    if ((outline.style === 'off' || outline.width === 'off') && !replaced && !pointerOnly(rule.selector)) {
      errors.push(
        `${label}:${outlineLine}: "${rule.selector}" removes the outline without a replacement focus style in the same rule (a box-shadow ring, or limit it to :not(:focus-visible))`
      );
    }
  }
}

// ---- landing: template.json + style.css required, index.jsx optional --
// (issue #93). Every one ships a style.css scoped under .l-template-<id>;
// one that changes the page's structure adds an index.jsx, and one whose
// index.jsx draws a section with `column: 'side'` in a side column says
// `columns: true`, so the editor offers the choice. `classic` is what an
// unknown or missing template is drawn as, so it must exist.
const landingIds = dirsIn(path.join(TEMPLATES_DIR, 'landing'));
for (const id of landingIds) {
  const dir = path.join(TEMPLATES_DIR, 'landing', id);
  const label = `templates/landing/${id}`;
  checkId(id, label);
  const meta = readJson(path.join(dir, 'template.json'), label);
  checkMeta(meta, label, ['columns']);
  if (meta && 'columns' in meta && typeof meta.columns !== 'boolean') {
    errors.push(`${label}: "columns" must be a boolean`);
  }
  if (meta?.columns === true && !existsSync(path.join(dir, 'index.jsx'))) {
    errors.push(`${label}: "columns" needs an index.jsx that places the side column`);
  }
  const css = path.join(dir, 'style.css');
  if (!existsSync(css)) errors.push(`${label}: missing style.css`);
  else {
    const source = readFileSync(css, 'utf8');
    if (!source.includes(`.l-template-${id}`)) {
      errors.push(`${label}: style.css must scope its rules under .l-template-${id}`);
    }
    checkLandingCss(source, `${label}/style.css`);
  }
}
if (!landingIds.includes('classic')) errors.push('templates/landing: missing "classic", the fallback for an unknown template');

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

console.log(
  `✓ templates/ OK — ${headerIds.length} header(s), ${layoutIds.length} layout(s), ${landingIds.length} landing template(s), ${presetIds.length} preset(s)`
);
