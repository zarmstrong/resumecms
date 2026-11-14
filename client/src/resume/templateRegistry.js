// Build-time registry for pluggable resume header/layout templates. Each
// template lives under templates/<kind>/<id>/ at the repo root (see
// templates/README.md) and is picked up here via import.meta.glob at build
// time — a contributed template becomes selectable just by adding files, no
// registration step. The server never renders resume markup (it only serves
// the static client build + JSON APIs), so there's no matching runtime scan.
//
// import.meta.glob requires a static string literal per call, so headers,
// layouts, landing page templates and both kinds of preset each need their
// own glob (can't parametrize the path).
const headerMeta = import.meta.glob('../../../templates/headers/*/template.json', {
  eager: true,
  import: 'default',
});
const headerComponents = import.meta.glob('../../../templates/headers/*/index.jsx', {
  eager: true,
  import: 'default',
});
const layoutMeta = import.meta.glob('../../../templates/layouts/*/template.json', {
  eager: true,
  import: 'default',
});
const layoutComponents = import.meta.glob('../../../templates/layouts/*/index.jsx', {
  eager: true,
  import: 'default',
});
// Curated bundles combining a header + layout + colors/fonts, previewable
// via TemplatePreviewPage.jsx's /template-preview/preset/:id route — unlike
// headers/layouts these already carry their own `id` field (validated to
// match their folder name), so no id-from-path step is needed here.
const presetMeta = import.meta.glob('../../../templates/presets/*/template.json', {
  eager: true,
  import: 'default',
});

// The landing page's templates (issue #93), templates/landing/<id>/: a
// template.json, a style.css scoped under `.l-template-<id>` and an
// optional index.jsx arranging the hero and sections (see LandingView.jsx).
// Each entry carries its template.json's flags as they are: `columns` (it
// has a side column) and `cover` (it draws the page's coverImage, issue
// #130), which the editor reads to offer the matching fields.
const landingMeta = import.meta.glob('../../../templates/landing/*/template.json', {
  eager: true,
  import: 'default',
});
const landingComponents = import.meta.glob('../../../templates/landing/*/index.jsx', {
  eager: true,
  import: 'default',
});

// Starting points for the landing page by profession (issue #130),
// templates/landing-presets/<id>/template.json: a landing template, its
// colors and fonts, and the sections to start with (kind and title), which
// client/src/editor/landingPresets.js applies to a draft. Like the resume
// presets they carry their own `id`.
const landingPresetMeta = import.meta.glob('../../../templates/landing-presets/*/template.json', {
  eager: true,
  import: 'default',
});

function idFromPath(path) {
  const match = path.match(/\/([^/]+)\/[^/]+$/);
  return match ? match[1] : null;
}

function buildRegistry(metaGlob, componentGlob) {
  const byId = {};
  for (const [path, meta] of Object.entries(metaGlob)) {
    const id = idFromPath(path);
    if (id) byId[id] = { id, Component: null, ...meta };
  }
  for (const [path, Component] of Object.entries(componentGlob)) {
    const id = idFromPath(path);
    if (id && byId[id]) byId[id].Component = Component;
  }
  return Object.values(byId).sort((a, b) => a.label.localeCompare(b.label));
}

export const HEADER_TEMPLATES = buildRegistry(headerMeta, headerComponents);
export const LAYOUT_TEMPLATES = buildRegistry(layoutMeta, layoutComponents);
export const LANDING_TEMPLATES = buildRegistry(landingMeta, landingComponents);
export const PRESETS = Object.values(presetMeta).sort((a, b) => a.label.localeCompare(b.label));

// In the order of their labels; the editor's picker lists them that way.
export const LANDING_PRESETS = Object.values(landingPresetMeta).sort((a, b) => a.label.localeCompare(b.label));

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id);
}

export const DEFAULT_TEMPLATE = 'classic';
export const DEFAULT_LAYOUT = 'classic';
// server/src/landingStyle.js's DEFAULT_LANDING_TEMPLATE.
export const DEFAULT_LANDING_TEMPLATE = 'classic';

export function normalizeTemplate(site) {
  const value = site?.template;
  return HEADER_TEMPLATES.some((t) => t.id === value) ? value : DEFAULT_TEMPLATE;
}

export function normalizeLayout(site) {
  const value = site?.layout;
  return LAYOUT_TEMPLATES.some((l) => l.id === value) ? value : DEFAULT_LAYOUT;
}

// The landing page's `template` (the server keeps any well-formed id), or
// classic for one this build doesn't have.
export function normalizeLandingTemplate(value) {
  return LANDING_TEMPLATES.some((t) => t.id === value) ? value : DEFAULT_LANDING_TEMPLATE;
}

export function getLandingTemplate(id) {
  return LANDING_TEMPLATES.find((t) => t.id === normalizeLandingTemplate(id));
}

export function getHeaderTemplate(id) {
  return HEADER_TEMPLATES.find((t) => t.id === id) || HEADER_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE);
}

export function getLayoutTemplate(id) {
  return LAYOUT_TEMPLATES.find((l) => l.id === id) || LAYOUT_TEMPLATES.find((l) => l.id === DEFAULT_LAYOUT);
}

// A layout with no Component is pure CSS (its style.css is imported below
// as a side effect) and renders through the default flat block list.
export function skillsDisplayFor(site) {
  return getLayoutTemplate(normalizeLayout(site)).skillsDisplay || 'rows';
}

// Pure-CSS layouts (no index.jsx, e.g. timeline/minimal/boxed) still need
// their style.css pulled into the build; layouts with a component import
// their own CSS themselves (see templates/layouts/sidebar/index.jsx).
import.meta.glob('../../../templates/layouts/*/style.css', { eager: true });

// Every landing template ships a style.css (scoped under its
// `.l-template-<id>` class), component or not.
import.meta.glob('../../../templates/landing/*/style.css', { eager: true });
