# Contributing resume templates

This folder holds four kinds of contributable templates, from least to most
involved:

- **[Presets](#presets)** — no code. A JSON file bundling an existing header
  + layout + optional colors/fonts under one name, shown as a card in the
  editor's gallery.
- **[Layouts](#headers--layouts)** — code (a React component) that controls
  how section blocks are arranged below the header. Some existing layouts
  are pure CSS instead (no component needed).
- **[Headers](#headers--layouts)** — code (a React component) that controls
  the name/title/photo/contact-info region at the top of the page.
- **[Landing page templates](#landing-page-templates)** — CSS, plus an
  optional React component, arranging the optional home page at `/`.

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
  skill as its own pill instead of one label + comma list) and an optional
  `columns: true` for a layout that honors a heading's "Column placement"
  setting (see "Splitting blocks into columns" below) — the editor lists
  these layouts next to that field, so set it or the hint will say your
  layout ignores the setting.
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

### Splitting blocks into columns

A layout that arranges blocks into two columns (like `sidebar`,
`sidebar-right`, or `split-columns`) should use the shared
`groupBlocksIntoColumns(blocks, classifyAuto)` helper
(`@resume/blockColumns.js`) instead of inventing its own grouping, and set
`"columns": true` in its `template.json`. The helper keeps a heading and
its section together as one unit — the blocks explicitly nested under it
(via `parentId`) or, for a heading with no nested children (most resumes
predate nesting), the unnested top-level blocks that simply follow it up to
the next heading — and honors a heading's own `data.column` override
(`'primary' | 'secondary'`, set from the editor's heading form) before
falling back to your `classifyAuto(group, index, { previousColumn })` for
anything left unpinned (`previousColumn` is where the group before this one
actually landed, pin included, or `null` for the first group). A top-level block that follows a heading *with* nested children
was deliberately placed after that section in the editor, so it becomes a
headless group of its own:

```jsx
import { groupBlocksIntoColumns } from '@resume/blockColumns.js';

function classifyAuto(group, index, { previousColumn }) {
  // group: { heading: Block | null, blocks: Block[] } — blocks is the
  // heading plus its nested children (or, for a heading with none, the
  // unnested blocks that follow it up to the next heading), or one or more
  // consecutive headless top-level blocks.
  return index % 2 === 0 ? 'primary' : 'secondary';
}

export default function MyTwoColumnLayout({ blocks, renderBlock }) {
  const { primary, secondary } = groupBlocksIntoColumns(blocks, classifyAuto);
  return (
    <div className="r-body">
      <div>{primary.map(renderBlock)}</div>
      <div>{secondary.map(renderBlock)}</div>
    </div>
  );
}
```

For a layout that alternates sections between two equal columns, reuse
`makeAlternateByHeadingClassifier()` from the same module (what
`split-columns` uses): it only advances on heading groups, so a headless
group stays in the column the section before it landed in (its pin
included) instead of taking a slot. Note that the public API keeps blocks
hidden in the current mode as content-free placeholders flagged `hidden`
(so grouping matches the editor preview); `renderBlock` returns `null` for
them, so a layout never needs to special-case them. `sidebar` and `sidebar-right` share a skills/education auto-classify
heuristic and rail text-contrast handling via `@resume/sidebarPanel.js`,
plus the rail's `.r-sidebar`/`.r-main` CSS via `@resume/sidebarPanel.css` —
import both if you're contributing another rail-style layout rather than
reimplementing them.

Both `@resume/*` imports work from anywhere under `templates/` via a Vite
alias to `client/src/resume/` — no fragile relative paths.

## Landing page templates

`templates/landing/<id>/` (issue #93) arranges the landing page: its hero
(photo, availability line, headline, subheadline, buttons) and its
sections. The landing editor's **Look** group lists them, each with a
live thumbnail of the draft drawn in it (issue #130), so a new template
shows up there with no picture to provide; an unknown or missing id is
drawn as `classic`, which must always exist. The thumbnail is the real
page at 1280 × 800 scaled down, so a template that sizes itself with
container queries on the page root gets its wide arrangement there; one
that uses viewport `@media` queries (as `classic` does, at 560 px) follows
the editor's window instead, and shows its phone layout in an editor that
narrow. Every one meets
the accessibility bar in [`landing/README.md`](landing/README.md), which
also has the full contract.

- `template.json` — `{ label, description, author }`, all required strings,
  plus an optional `columns: true` for a template whose `index.jsx` draws
  a section with `column: 'side'` in a side column (like `split`, under
  the hero); the editor offers each section a "Show in the side column"
  box only then. Every other template ignores `column`.
- `style.css` — **required**, every rule scoped under `.l-template-<id>`
  (the page root carries that class; the validator checks it's there).
  The look of each part (a card, a quote, the timeline, a button) is
  shared in
  [`client/src/landing/landing.css`](../client/src/landing/landing.css);
  your CSS arranges them and may restyle them. Use the `--r-accent`,
  `--r-heading`, `--r-text` and `--r-bg` custom properties for colors,
  never fixed ones: they follow the page's palette, its dark one
  included. Prefer `@container` queries to `@media` ones (set
  `container-type: inline-size` on `.l-template-<id>`), so the editor's
  narrower preview looks like a phone does.
- `index.jsx` — **optional**, for a template that changes the page's
  structure (like `split`, which puts the hero in a side column, or
  `gallery`, which wraps each run of image sections in one block of
  pictures).
  Default-exports:
  ```jsx
  export default function MyLanding({ landing, renderHero, renderSection, dropStrayDividers, colors, darkColors, preview }) {
    // landing: the resolved page (headline, sections, …) — read it, but
    //   draw the parts with the two functions below, so every template
    //   shows every kind of section the same way
    // renderHero(): the hero, an <header class="l-hero">
    // renderSection(section, index): one section; landing.sections.map(renderSection)
    //   (with `columns: true`, split them on section.column === 'side', and
    //   pass each column through dropStrayDividers(sections, { atStart }),
    //   atStart true when something sits above it, so it draws only the
    //   dividers it has something to divide; without `columns`, the list
    //   comes already tidied)
    //   A section given an `anchor` ({ ...section, anchor }) is drawn
    //   with that as its id, so the template can link to it
    // colors / darkColors: the normalized palettes (darkColors null if none)
    // preview: true in the editor's preview. The editor may also draw the
    //   page with preview false as a small thumbnail, inside an `inert`
    //   box that clips it: a template that does anything beyond drawing
    //   (listens to scrolling, reads location.hash, sets ids) checks for
    //   an [inert] ancestor and stays a picture there, with no effect on
    //   the document
    return (
      <main className="l-main">
        {renderHero()}
        {landing.sections.map(renderSection)}
      </main>
    );
  }
  ```
  Without one, that's exactly what's rendered. Landing helpers are
  imported through the `@landing` alias (to `client/src/landing/`), as
  resume templates use `@resume`. `directory` is the example of linking
  to sections: a section's `id` never leaves the server, so
  `@landing/sectionAnchors.js`'s `withAnchors()` makes anchors from the
  titles (deduplicated, prefixed so they can't meet another id on the
  page; pass a prefix of your own in the preview), and
  `@landing/useSectionSpy.js` tracks which section is in view and
  scrolls to one inside whatever holds the page, the editor's preview
  pane included, without touching the editor's URL, and does nothing
  inside an `[inert]` ancestor.

## Landing page presets

`templates/landing-presets/<id>/template.json` (issue #130) is a starting
point for the landing page for one kind of work, which the landing
editor offers when it's first opened and from **Start from a preset…**.
No code: a landing template, its colors and fonts, and the sections the
page starts with, each by its kind and title only.

```json
{
  "id": "trades",
  "label": "Trades and home services",
  "description": "Who it's for and what it leads with.",
  "author": "you",
  "template": "card",
  "style": {
    "source": "custom",
    "colors": { "accent": "#b4410c", "heading": "#1c1917", "text": "#292524", "background": "#ffffff" },
    "font": "inter",
    "nameFont": "montserrat"
  },
  "sections": [
    { "kind": "contact", "title": "Get in touch" },
    { "kind": "services", "title": "Services" }
  ]
}
```

- `id` matches the folder name; `label`, `description` and `author` are
  required strings.
- `template` names a folder under `templates/landing/`.
- `style` is the landing page's own `style` (`source`, `colors` as
  `#rrggbb` or `''`, `font`, `nameFont`, optional `darkColors`), checked
  by the server's own rules, so a font must be one of the site fonts.
  Pick colors that keep the template's text at WCAG AA (4.5:1): the
  accent on the background, and white or near-black on the accent.
- `sections` lists `{ kind, title }` in order (any section kind, at most
  20, at most one `contact`). Each starts empty, the way "+ Add section"
  starts one; an experience or education section reads the default
  resume, and a new contact section takes the email and phone of the
  page's links that aren't hidden. If the page already has as many
  sections as it may (20), the preset's new ones are left out from the
  end.

Applying a preset never removes what someone wrote: a section of a kind
the preset has, with something in it, is kept in its place, the other
sections with something in them follow, and the hero is untouched (see
`client/src/editor/landingPresets.js`).

## Validating

```bash
node scripts/validate-templates.mjs
```

Checks folder/id naming, required fields, that every preset's
`header`/`layout` reference something that actually exists, and that every
landing template has a `style.css` scoped under its own class, with no
outline removed without a replacement and no motion outside
`prefers-reduced-motion: no-preference` (see
[`landing/README.md`](landing/README.md#what-the-validator-checks)). CI runs this
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
- Or open `/editor` → Site Settings → "Change template…", which lists every
  registered header and layout and renders your **real** resume content
  live as you browse them — the most accurate way to check a new header or
  layout looks right, since it's not placeholder text.

The two `/template-preview` routes above don't touch real resume data —
they render
[`client/src/resume/sampleResume.js`](../client/src/resume/sampleResume.js)
instead, since they need no editor login.

## Regenerating preset thumbnails

`preview.png` files (used for docs, not the in-app gallery, which renders
live) are generated by a script run inside an isolated, throwaway container
— it never touches your real `resume-data` volume or a running instance:

```bash
docker compose --profile tools run --rm resume-preview
```

See [`server/scripts/render-template-previews.mjs`](../server/scripts/render-template-previews.mjs).
