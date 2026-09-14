# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted, single-user resume site + CMS (see [README.md](README.md) for
the full product description, environment variables, and API reference).
Content is a flat, reorderable list of **blocks** (`{ id, type, position,
visibleWeb, visiblePrint, data }`); built-in types are `heading`,
`skills_group`, `experience`, `education`, plus a freeform `custom` type.
The header (name/title/contact) is a separate singleton setting.

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

# client (from client/)
npm run dev       # vite dev server on :5173, proxies /api -> :4000
npm run build     # vite build -> client/dist, also validates template components
npm run preview

# templates (from repo root)
node scripts/validate-templates.mjs   # lints templates/**, no npm install needed
```

There are no test suites or linters configured in either package — CI
(`.github/workflows/templates.yml`) only runs `scripts/validate-templates.mjs`
and a client build, and only when `templates/**`, `templateRegistry.js`, or
the validator itself changes. When touching templates, run both of those
locally before considering the change done. There's no root `package.json`;
`server/` and `client/` are independent npm packages, each with its own
lockfile.

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
