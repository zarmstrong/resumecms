// Build-time registry for pluggable resume header/layout templates. Each
// template lives under templates/<kind>/<id>/ at the repo root (see
// templates/README.md) and is picked up here via import.meta.glob at build
// time — a contributed template becomes selectable just by adding files, no
// registration step. The server never renders resume markup (it only serves
// the static client build + JSON APIs), so there's no matching runtime scan.
//
// import.meta.glob requires a static string literal per call, so headers and
// layouts each need their own glob (can't parametrize the path).
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

export const DEFAULT_TEMPLATE = 'classic';
export const DEFAULT_LAYOUT = 'classic';

export function normalizeTemplate(site) {
  const value = site?.template;
  return HEADER_TEMPLATES.some((t) => t.id === value) ? value : DEFAULT_TEMPLATE;
}

export function normalizeLayout(site) {
  const value = site?.layout;
  return LAYOUT_TEMPLATES.some((l) => l.id === value) ? value : DEFAULT_LAYOUT;
}

export function getHeaderTemplate(id) {
  return HEADER_TEMPLATES.find((t) => t.id === id) || HEADER_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE);
}

export function getLayoutTemplate(id) {
  return LAYOUT_TEMPLATES.find((l) => l.id === id) || LAYOUT_TEMPLATES.find((l) => l.id === DEFAULT_LAYOUT);
}

// A layout with no Component is pure CSS (its style.css is imported as a
// side effect from its own index.jsx-less folder — see
// LAYOUT_STYLESHEETS below) and renders through the default flat block list.
export function skillsDisplayFor(site) {
  return getLayoutTemplate(normalizeLayout(site)).skillsDisplay || 'rows';
}

// Pure-CSS layouts (no index.jsx, e.g. timeline/minimal/boxed) still need
// their style.css pulled into the build; layouts with a component import
// their own CSS themselves (see templates/layouts/sidebar/index.jsx).
import.meta.glob('../../../templates/layouts/*/style.css', { eager: true });
