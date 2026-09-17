# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted, single-user resume site + CMS (see [README.md](README.md) for
the full product description, environment variables, and API reference).
Content is a reorderable list of **blocks** (`{ id, type, position, parentId,
visibleWeb, visiblePrint, data }`); built-in types are `heading`, `summary`,
`skills_group`, `experience`, `education`, plus a freeform `custom` type.
`experience`, `skills_group`, `education`, and `custom` blocks may each nest
one level deep under a `heading` block via `parentId` — this is an explicit
allowlist (`NESTABLE_TYPES` in `routes/blocks.js`), not "everything but
heading/summary", so a new block type added later is top-level-only until
deliberately added to it (see "Block nesting" below). The header
(name/title/contact) is a separate singleton setting.

Three surfaces render from the same data/components: `/` (public), `/print`
(used internally for PDF export), and `/editor` (password + optional TOTP
2FA gated).

## Commands

```bash
# server (from server/)
npm run dev      # node --watch src/index.js — needs RESUMECMS_ADMIN_USERNAME,
                  # RESUMECMS_APP_PASSWORD, RESUMECMS_SESSION_SECRET,
                  # RESUMECMS_DATA_DIR set (see README.md)
npm start
npm test          # node --test — auto-discovers **/*.test.js under server/src

# client (from client/)
npm run dev       # vite dev server on :5173, proxies /api -> :4000
npm run build     # vite build -> client/dist, also validates template components
npm run preview
npm test          # node --test — auto-discovers **/*.test.js under client/src

# templates (from repo root)
node scripts/validate-templates.mjs   # lints templates/**, no npm install needed
```

There's no linter configured in either package. Both `server/` and `client/`
have a small `node:test` suite (plain `*.test.js` files next to the code
they cover, e.g. `blockDeletion.test.js`, `blockDrag.test.js`) for pure
logic that doesn't need a live DB/HTTP server or a DOM — run them with `npm
test` from the respective package. CI has three independent workflows,
each scoped by path so it only runs when relevant:
`.github/workflows/templates.yml` runs `scripts/validate-templates.mjs` and
a client build when `templates/**`, `templateRegistry.js`, or the validator
itself changes; `.github/workflows/server-tests.yml` runs `npm test` in
`server/` when `server/**` changes; `.github/workflows/client-tests.yml`
runs `npm test` in `client/` when `client/**` changes. When touching
templates, run both templates commands locally before considering the
change done; when touching `server/src`, run `npm test` from `server/`;
when touching `client/src`, run `npm test` from `client/`. There's no root
`package.json`; `server/` and `client/` are independent npm packages, each
with its own lockfile.

PDF export needs a real Chromium; the Docker image installs the system
package and points Puppeteer at it. In local (non-Docker) dev, PDF export
fails unless you install Chromium yourself and set `PUPPETEER_EXECUTABLE_PATH`.

## Architecture

### Draft vs. published content

The editor's writes (`PUT/POST/DELETE /api/blocks*`, `/api/header`,
`/api/site`) mutate the live "draft" tables directly and call `touchDraft()`
(`server/src/db.js`) to bump `draft_meta.lastEditedAt`. The public site and
PDF (`server/src/routes/public.js`, `server/src/routes/pdf.js`) never read the draft tables —
they read the `published_resume` setting, a full snapshot written only by
`POST /api/publish` (`server/src/routes/publish.js`). `GET
/api/publish/status` compares `draft_meta.lastEditedAt` against
`published_resume.publishedAt` to report whether there are unpublished
changes; `POST /api/discard-draft` overwrites the draft tables from the
last published snapshot. On first boot after this split was introduced,
whatever was in the draft tables becomes the initial published snapshot
(see the migration block at the bottom of `db.js`) so existing installs
don't go blank.

When adding a new draft-mutating route, call `touchDraft()` from it, or the
"unpublished changes" indicator will silently go stale.

### Route mount order matters

`server/src/index.js` mounts `/api/auth`, `/api/auth/totp`, and
`/api/public` *before* the catch-all `/api` mount for `blockRoutes`/
`publishRoutes`. Express matches `app.use()` by path prefix, so a more
specific route registered after the broad `/api` mount would first hit
`blockRoutes`' unconditional `requireAuth` and get rejected. Keep
new auth-exempt or differently-gated route groups registered before the
general `/api` mount, not after.

### Block nesting

A block's `parentId` (nullable, on the `blocks` table and in the API) points
at a `heading` block's `id`; only `experience`, `skills_group`, `education`,
and `custom` blocks can be nested, and only one level deep — a `heading`
can't itself have a `parentId`, and `summary` can't have one at all. This is
enforced server-side in `server/src/routes/blocks.js`'s `assertValidParent`,
called from every route that can set `parentId` (`POST /blocks`, `PUT
/blocks/:id`, `POST /blocks/reorder`). Deleting a heading promotes its
children back to top-level rather than deleting them.

`position` is only unique within a sibling group (all blocks sharing a
`parentId`), not globally — so anything that needs the actual display order
must call `orderBlocksHierarchically()` (`server/src/db.js`), which walks
each heading's children (sorted by their own `position`) in right after it.
Every place that hands a flat `blocks` array to a consumer — `GET /blocks`,
`POST /blocks/reorder`'s response, and the `published_resume` snapshot built
in `publish.js` — already runs it, so `client/src/editor/BlockList.jsx` and
`ResumeView.jsx` can both treat the array they receive as already in the
right order; neither re-derives nesting from scratch.

The editor's `BlockList` projects the pointer destination before dropping
(`blockDrag.js`). The center of a heading nests an allowed block; heading
edges place it before or after the whole section. Dropping among children
joins their section, while the list's left edge promotes the dragged block
to top level. A highlighted heading or insertion line labels the projected
destination. Rows remain stationary during dragging, and moving a heading
moves its children too. Only the dragged block's `parentId` changes.

Layout templates that want to react to nesting (e.g. put a heading's whole
group in a side column) can group `blocks` by `parentId` themselves — see
`templates/layouts/sidebar/index.jsx`'s `splitBlocksForSidebar`, which
currently infers grouping from block-type adjacency and could be simplified
to use `parentId` directly now that it's explicit.

### Pluggable header/layout templates

Templates live at the repo root under `templates/headers/<id>/` and
`templates/layouts/<id>/`, each with a `template.json`
(`label`/`description`/`author`, layouts also allow `skillsDisplay`).
Headers require an `index.jsx` component; layouts' `index.jsx` is optional
(a layout with none is pure CSS — its `style.css` renders through the
default flat block list; see `templateRegistry.js`'s comment on
`skillsDisplayFor`).

`client/src/resume/templateRegistry.js` builds the registry at **build
time** via `import.meta.glob` (eager, one glob per kind — the glob path
must be a static literal, so headers and layouts can't share one call). New
templates become selectable just by adding files under `templates/`, no
registration step. The server never renders resume markup — it only serves
the built client + JSON APIs — so there is no matching runtime scan.

A contributed component imports shared rendering helpers via the `@resume`
Vite alias (e.g. `@resume/safeUrl.js`) rather than a relative path, since
templates live outside `client/src`. `client/vite.config.js` also sets
`server.fs.allow: ['..']` so the dev server can resolve `templates/` at all
(a Vite dev-server restriction that `vite build` doesn't have).

`scripts/validate-templates.mjs` (dependency-free, Node builtins only)
checks folder naming (lowercase kebab-case), required `template.json`
fields, and — for the `templates/presets/` kind it also supports (not yet
populated) — that a preset's `header`/`layout` references exist and its
`colors` are recognized `#rrggbb` keys. Run it after adding or editing any
template; CI runs it plus a client build on PRs touching `templates/**`.

### Resume rendering pipeline

`ResumeView` (`client/src/resume/ResumeView.jsx`) is the single component
all three modes (`web` / `print` / `preview`) render through. It normalizes
site settings (colors, fonts, sizes, pill styles — `siteColors.js`) into
CSS custom properties, resolves the header template and layout template
from `templateRegistry.js`, and renders blocks via `BLOCK_RENDERERS`
(`blockRenderers.jsx`) — a layout component receives already-resolved
`blocks`/`renderBlock`/`colors` and decides arrangement (e.g.
`templates/layouts/sidebar/index.jsx` regroups blocks under headings into a
side rail vs. main column based on block type). `mode="preview"` (editor
only) renders every block regardless of visibility flags and dims hidden
ones instead of omitting them.

Bullet-level visibility (`experience` blocks) is filtered server-side in
`public.js`, independently of block-level visibility, and bullets can nest
one level deep — both the visibility filter and the print/PDF path need to
recurse into `children`.

### PDF generation

`server/src/pdfRenderer.js` drives headless Chromium (Puppeteer) to render
the `/print` route and produce a PDF. It's invoked from three places: on
first boot if no PDF exists yet, on every `POST /api/publish`, and nowhere
else — `GET /api/public/resume.pdf` only ever serves the already-rendered
file at `PDF_PATH` (`<RESUMECMS_DATA_DIR>/resume.pdf`), it doesn't render on
demand.

### Auth

Single username/password pair (seeded once from
`RESUMECMS_ADMIN_USERNAME`/`RESUMECMS_APP_PASSWORD` env vars on first boot,
then only ever read from/written to the `settings` table — changing the env
vars later does nothing) plus optional TOTP 2FA, both stored in SQLite, not
config. `server/src/middleware/requireAuth.js` gates everything under
`/api` except `/api/auth/*` and `/api/public/*`. Login is rate-limited
(10 failed attempts / IP / 15 min) and optionally captcha-gated
(`RESUMECMS_CAPTCHA_PROVIDER`); see README.md for the full auth/security
notes, including manual TOTP recovery via direct SQLite access.
