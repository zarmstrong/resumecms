# Contributing resume templates

This folder holds three kinds of contributable template, from least to most
involved:

- **[Presets](#presets)** — no code. A JSON file bundling an existing header
  + layout + optional colors/fonts under one name, shown as a card in the
  editor's gallery.
- **[Layouts](#headers--layouts)** — code (a React component), controls how
  section blocks are arranged below the header. Some existing layouts are
  pure CSS instead (no component needed).
- **[Headers](#headers--layouts)** — code (a React component), controls the
  name/title/photo/contact-info region at the top of the page.

Headers and layouts are two **independent** axes (see
[`client/src/resume/templateRegistry.js`](../client/src/resume/templateRegistry.js)).
A new layout works with every existing header automatically, and vice
versa; you don't need to touch the other axis to contribute one.

All three are loaded at build time via `import.meta.glob` in
[`client/src/resume/templateRegistry.js`](../client/src/resume/templateRegistry.js)
— adding files here is enough to make them selectable, no registration step.

## Presets

The simplest contribution: `templates/presets/<id>/template.json`, `<id>`
matching the folder name, lowercase kebab-case:

```json
{
  "id": "sidebar-sage",
  "label": "Sidebar (Sage)",
  "description": "Two-column resume with skills and education pinned to a tinted side rail.",
  "author": "Jane Doe",
  "header": "classic",
  "layout": "sidebar",
  "colors": { "accent": "#3f6b52", "sidebarBackground": "#eef2ea" },
  "font": "source-serif",
  "fontSize": "normal",
  "lineSpacing": "normal",
  "pillPadding": "cozy"
}
```

- `id`, `label`, `description`, `author` — required strings.
- `header` — required, must be an existing id under `templates/headers/`.
- `layout` — required, must be an existing id under `templates/layouts/`.
- `colors` — optional, a partial overlay of the color keys in
  [`DEFAULT_SITE_COLORS`](../client/src/resume/siteColors.js) (`accent`,
  `heading`, `text`, `background`, `skillsCategoryText`,
  `skillsCategoryPill`, `datesText`, `datesPill`, `sidebarBackground`), each
  a `#rrggbb` hex value. Unset keys fall back to the app's normal defaults —
  you don't need to specify every color.
- `font`, `fontSize`, `lineSpacing`, `pillPadding` — optional, matching the
  option keys in `siteColors.js`.

## Headers & layouts

`templates/headers/<id>/`:
- `template.json` — `{ label, description, author }`, all required strings.
- `index.jsx` — **required**. Default-exports a component:
  ```jsx
  export default function MyHeader({ header, showActions, onPrint, pdfHref }) {
    // header: { name, title, subtitle, location, email, phone, links, photoUrl }
    return <div className="r-header">...</div>;
  }
  ```
  Use the shared building blocks in
  [`@resume/headerParts.jsx`](../client/src/resume/headerParts.jsx)
  (`HeadshotImage`, `ContactInline`, `ContactRow`, `HeaderActions`) and
  [`@resume/safeUrl.js`](../client/src/resume/safeUrl.js)'s `safeHref()` for
  any link you render — resume links are free-text entered by whoever holds
  editor credentials, and `safeHref()` is what keeps a `javascript:` URL
  from becoming stored XSS. Don't roll your own link handling.

`templates/layouts/<id>/`:
- `template.json` — `{ label, description, author }`, plus an optional
  `skillsDisplay` (currently only `"chips"` is a real option — renders each
  skill as its own pill instead of one label + comma list).
- `index.jsx` — **optional**. Only needed for a layout that changes the DOM
  *structure* below the header (like `sidebar`, which splits blocks into a
  side rail and a main column). Default-exports:
  ```jsx
  export default function MyLayout({ blocks, renderBlock, mode, colors }) {
    // blocks: the full ordered block list
    // renderBlock(block): renders one block's content — always use this,
    //   don't reimplement it, so every layout shares the same visibility
    //   filtering and block-type dispatch
    // mode: 'web' | 'print' | 'preview'
    // colors: normalized site colors, for e.g. a custom background
    return <div className="r-body">{blocks.map(renderBlock)}</div>;
  }
  ```
  If your layout is purely a *style* change (like `timeline`, `minimal`,
  `boxed` — same flat block list, different CSS), skip `index.jsx` entirely
  and ship only `style.css`, scoped under a `.r-layout-<id>` selector (the
  page root always carries this class) — see `templates/layouts/boxed/style.css`
  for an example.

Both `@resume/*` imports work from anywhere under `templates/` via a Vite
alias to `client/src/resume/` — no fragile relative paths.

## Validating

```bash
node scripts/validate-templates.mjs
```

Checks folder/id naming, required fields, and that every preset's
`header`/`layout` reference something that actually exists. CI runs this
plus a full `npm run build` on any PR touching `templates/**` — a broken
component fails the build, not just the metadata check.

## Previewing while you work

```bash
cd server && npm run dev     # terminal 1
cd client && npm run dev     # terminal 2
```

- `http://localhost:5173/template-preview?header=<id>&layout=<id>` — an
  ad-hoc combo, rendered against shared placeholder data. Use this while
  developing a new header or layout, before it has a preset.
- `http://localhost:5173/template-preview/preset/<id>` — a specific preset.
- Or open `/editor` → Site Settings → the template gallery, which is a live
  render of every preset (not a screenshot), so it's always accurate.

None of these touch real resume data — they all render
[`client/src/resume/sampleResume.js`](../client/src/resume/sampleResume.js).

## Regenerating preset thumbnails

`preview.png` files (used for docs, not the in-app gallery, which renders
live) are generated by a script run inside an isolated, throwaway container
— it never touches your real `resume-data` volume or a running instance:

```bash
docker compose --profile tools run --rm resume-preview
```

See [`server/scripts/render-template-previews.mjs`](../server/scripts/render-template-previews.mjs).
