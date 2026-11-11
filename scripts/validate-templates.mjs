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

// A value with its functions (`cubic-bezier(…)`, `rgb(0 0 0 / .6)`,
// `calc(…)`) taken out, innermost first, so the zeros and commas inside
// them aren't read as the value's own words.
const withoutFunctions = (value) => {
  let text = value;
  while (/\([^()]*\)/.test(text)) text = text.replace(/[a-z-]*\([^()]*\)/gi, ' ');
  return text;
};
const wordsOf = (value) => withoutFunctions(value).split(/\s+/).filter(Boolean);

const TIME = /^-?[\d.]+m?s$/i;
// A duration that's a custom property or a calc() can't be read, so it
// counts as non-zero, like a longhand left to another rule.
const COMPUTED = /\b(?:var|calc)\(/i;
const nonZeroTime = (time) => (TIME.test(time) ? parseFloat(time) !== 0 : COMPUTED.test(time));

// What a `transition` shorthand animates, and for how long: in each
// comma-separated item, the one word that isn't a time, an easing or a
// behavior (an item without one transitions `all`) and the first time
// (none means 0s, the shorthand's default). `none` transitions nothing.
const TRANSITION_WORDS = new Set([
  'ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'normal', 'allow-discrete',
]);
function transitionItems(value) {
  return splitList(value).map((item) => {
    const words = wordsOf(item);
    const name = words.find((word) => !TIME.test(word) && !TRANSITION_WORDS.has(word.toLowerCase()));
    const time = words.find((word) => TIME.test(word));
    // No time left after the functions are taken out, but a var() or
    // calc() may have held one: unknown, so non-zero (`transform var(--speed)`).
    const duration = time || (COMPUTED.test(item) ? item : '0s');
    return { name: name ? name.toLowerCase() : 'all', duration };
  });
}

// What may change gradually without the visitor having asked for motion:
// a color, a fade, or a switch of visibility or display, which move
// nothing on the screen. Anything else (transform, a position, a size, a
// margin, a shadow's offset, `all`) belongs under prefers-reduced-motion:
// no-preference. `background` stays allowed although the shorthand
// includes its position and size, so a template mustn't change those on a
// state it transitions (templates/landing/README.md).
const STILL_PROPERTIES = new Set([
  'none', 'color', 'background', 'background-color', 'border-color', 'outline-color', 'column-rule-color',
  'text-decoration-color', 'caret-color', 'accent-color', 'fill', 'stroke', 'opacity', 'visibility',
  'display', 'overlay',
  ...['top', 'right', 'bottom', 'left', 'block', 'inline', 'block-start', 'block-end', 'inline-start', 'inline-end']
    .map((side) => `border-${side}-color`),
]);
const CSS_WIDE = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer']);

// The alternatives of a media query list: its commas, and Media Queries
// 4's `or` outside any parentheses, are both an OR.
function mediaAlternatives(prelude) {
  return splitList(prelude.replace(/^@media\s*/i, '')).flatMap((query) => {
    let depth = 0;
    const outside = [...query].map((ch) => {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      return depth > 0 || ch === ')' ? ' ' : ch;
    }).join('');
    const parts = [];
    let from = 0;
    for (const match of outside.matchAll(/\bor\b/gi)) {
      parts.push(query.slice(from, match.index));
      from = match.index + match[0].length;
    }
    parts.push(query.slice(from));
    return parts;
  });
}

// Inside the gate only if every alternative of the @media list has it:
// `screen, (prefers-reduced-motion: no-preference)` or `… or (min-width:
// 1px)` matches a visitor who asked for less motion too. So does a query
// negated as a whole (`not screen and (…)`) or one whose no-preference
// condition is itself negated; a `not` on another condition (`and (not
// (pointer: coarse))`) leaves the gate alone.
const motionAllowed = (rule) =>
  rule.atRules.some(
    (at) =>
      /^@media\b/i.test(at) &&
      mediaAlternatives(at).every(
        (query) =>
          /prefers-reduced-motion\s*:\s*no-preference/i.test(query) &&
          !/^\s*not\b/i.test(query) &&
          !/\bnot\s*\(\s*prefers-reduced-motion\b/i.test(query)
      )
  );

// `-webkit-transition` is a transition (and so on for -moz-, -o-, -ms-).
const prefixOf = (property) => /^-(webkit|moz|o|ms)-/.exec(property)?.[0] ?? '';

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
          wordsOf(item).filter((word) => !TIME.test(word) && !/^[\d.]+$/.test(word) && !ANIMATION_WORDS.has(word.toLowerCase()))
        );
  return names.map((name) => name.toLowerCase()).filter((name) => name !== 'none');
}

// An outline that's switched off, its style and its width followed
// separately, since a longhand after the shorthand can switch either one
// back while the other stays off: `outline: none; outline-width: 2px` still
// draws nothing. The shorthand sets both (a style it doesn't name is
// `none`, so `outline: 2px red` is off too); `outline-style` and
// `outline-width` set one each. A color's own zeros (`rgb(0 0 0 / .6)`)
// aren't a width, and a value with a `var()` in it can't be read, so it
// counts as on. Its color is followed too: a transparent outline
// (`transparent`, or a color function with a zero alpha) is off, since
// only forced-colors mode draws it; the forced-colors pattern pairs it
// with a box-shadow ring, which is the replacement that lets it pass.
const ZERO = /^0(\.0+)?([a-z]+|%)?$/i;
const OUTLINE_STYLES = new Set(['auto', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
// `transparent`, `rgba(0, 0, 0, 0)`, `rgb(0 0 0 / 0%)`, `hsl(… / 0)`, …
const ZERO_ALPHA = /^0*(\.0+)?%?$/;
function isTransparent(value) {
  // Only a color the outline is drawn in, never one mixed into it:
  // `color-mix(in srgb, currentColor 60%, transparent)` is a visible tint.
  const words = wordsOf(value.toLowerCase());
  if (words.includes('transparent')) return true;
  // A hex color with a zero alpha: #rgb0 or #rrggbb00.
  if (words.some((word) => /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/.test(word))) return true;
  if (/\bcolor-mix\(/i.test(value)) return false;
  // A color function's alpha: after a slash, or the fourth of its commas.
  return [...value.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)/gi)].some(([, args]) => {
    const slash = args.split('/');
    if (slash.length === 2) return ZERO_ALPHA.test(slash[1].trim());
    const commas = args.split(',');
    return commas.length === 4 && ZERO_ALPHA.test(commas[3].trim());
  });
}
function outlineParts(property, value) {
  if (!['outline', 'outline-style', 'outline-width', 'outline-color'].includes(property)) return null;
  const words = wordsOf(value.toLowerCase());
  const unread = CSS_WIDE.has(words[0]) || /\bvar\(/i.test(value);
  const color = !unread && isTransparent(value) ? 'off' : 'on';
  if (property === 'outline') {
    if (unread) return { style: 'on', width: 'on', color: 'on' };
    return {
      style: words.some((word) => OUTLINE_STYLES.has(word)) ? 'on' : 'off',
      width: words.some((word) => ZERO.test(word)) ? 'off' : 'on',
      color,
    };
  }
  if (property === 'outline-style') return { style: !unread && words.includes('none') ? 'off' : 'on' };
  if (property === 'outline-color') return { color };
  return { width: !unread && ZERO.test(words[0] ?? '') ? 'off' : 'on' };
}

// Pointer focus only: every selector in the list leaves :focus-visible
// alone, so the keyboard's ring is untouched.
const pointerOnly = (selector) => splitList(selector).every((one) => /:not\(\s*:focus-visible\s*\)/i.test(one));

const GATE = 'must be inside @media (prefers-reduced-motion: no-preference)';

// A rule's transitions, one set per prefix, as CSS pairs them: the n-th
// property with the n-th duration (the list repeated). What a longhand
// leaves unset may come from another rule, which the linter can't see, so
// an unknown duration counts as non-zero and an unknown property as `all`.
function movingTransitions(state) {
  if (!state.names) return state.durations.some(nonZeroTime) ? ['all'] : [];
  return state.names.filter((name, i) => {
    if (STILL_PROPERTIES.has(name)) return false;
    return state.durations === null || nonZeroTime(state.durations[i % state.durations.length]);
  });
}

function checkLandingCss(source, label) {
  for (const rule of cssRules(source)) {
    const outline = { style: null, width: null, color: null };
    let outlineLine = 0;
    let replaced = false;
    const transitions = new Map();
    const gated = motionAllowed(rule);
    for (const { property: written, value, line } of rule.declarations) {
      const parts = outlineParts(written, value);
      if (parts) {
        Object.assign(outline, parts);
        outlineLine = line;
      }
      if (written === 'box-shadow' && !/^none$/i.test(value)) replaced = true;
      if (gated) continue;
      const prefix = prefixOf(written);
      const property = written.slice(prefix.length);
      const declaration = `${written}: ${value}`;
      if (['transition', 'transition-property', 'transition-duration'].includes(property)) {
        if (CSS_WIDE.has(value.toLowerCase())) {
          transitions.delete(prefix);
          continue;
        }
        const state = transitions.get(prefix) ?? { names: null, durations: null, declarations: [], line };
        if (property === 'transition') {
          const items = transitionItems(value);
          Object.assign(state, { names: items.map((item) => item.name), durations: items.map((item) => item.duration) });
        } else if (property === 'transition-property') {
          state.names = splitList(value).map((name) => name.toLowerCase());
        } else {
          state.durations = splitList(value);
        }
        state.declarations.push(declaration);
        transitions.set(prefix, state);
        continue;
      }
      if (CSS_WIDE.has(value.toLowerCase())) continue;
      const shown = `"${declaration}" in "${rule.selector}"`;
      if ((property === 'animation' || property === 'animation-name') && animationNames(property, value).length) {
        errors.push(`${label}:${line}: ${shown} ${GATE}`);
      }
      if (property === 'scroll-behavior' && /^smooth$/i.test(value)) {
        errors.push(`${label}:${line}: ${shown} ${GATE}`);
      }
    }
    for (const state of transitions.values()) {
      const moving = movingTransitions(state);
      if (!moving.length) continue;
      const what = state.names ? moving.join(', ') : 'all (the rule names no transition-property)';
      errors.push(
        `${label}:${state.line}: "${state.declarations.join('; ')}" in "${rule.selector}" transitions ${what}, which ${GATE} (only colors, opacity, visibility and display may transition outside it)`
      );
    }
    if (Object.values(outline).includes('off') && !replaced && !pointerOnly(rule.selector)) {
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
