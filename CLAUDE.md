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
allowlist (`NESTABLE_TYPES` in `resumeStore.js`), not "everything but
heading/summary", so a new block type added later is top-level-only until
deliberately added to it (see "Block nesting" below). The header
(name/title/contact) is a separate singleton setting. Besides the editor,
an MCP client can drive the same operations (see "MCP server" below).

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
they cover, e.g. `blockDeletion.test.js`, `blockDrag.test.js`) for logic
that doesn't need a live HTTP server or a DOM — run them with `npm test`
from the respective package. No test imports `server/src/db.js` (importing
it opens and seeds the real SQLite file); `resumeStore.test.js` instead
builds the store over a `better-sqlite3` `:memory:` database via
`ensureSchema()`, and the MCP tool tests inject a fake store. CI has three independent workflows,
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
`/api/site`) and the MCP tools both go through the shared store
(`server/src/resumeStore.js`, bound to the real DB in `server/src/store.js`),
whose mutating methods write the live "draft" tables directly and call
`touchDraft()` (`server/src/settings.js`, re-exported from `db.js`) to bump
`draft_meta.lastEditedAt`. The routes in `routes/blocks.js`,
`routes/publish.js`, and `routes/public.js` are thin wrappers that map a
store error's `.status` onto the response (wrap every handler over the
store in `handle()` from `routes/sendError.js`, sync or async). The public site and
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

When adding a new draft-mutating operation, put it in the store and call
`touchDraft()` there (not in a route or tool), or the "unpublished changes"
indicator will silently go stale for one of the two front doors.

### Route mount order matters

`server/src/index.js` mounts `/api/auth`, `/api/auth/totp`,
`/api/public`, and `/api/ai` *before* the catch-all `/api` mount for `blockRoutes`/
`publishRoutes`. Express matches `app.use()` by path prefix, so a more
specific route registered after the broad `/api` mount would first hit
`blockRoutes`' unconditional `requireAuth` and get rejected. Keep
new auth-exempt or differently-gated route groups registered before the
general `/api` mount, not after. `/mcp` (`routes/mcp.js`) is mounted first
of all, even ahead of the app-wide `express.json()` and the cookie session:
its bearer check runs before its own body parser, so an unauthenticated
request never gets 2 MB of JSON parsed on its behalf. Because of that the
router answers every method and sub-path itself (405/404) — anything it let
through would reach the SPA catch-all.

### Block nesting

A block's `parentId` (nullable, on the `blocks` table and in the API) points
at a `heading` block's `id`; only `experience`, `skills_group`, `education`,
and `custom` blocks can be nested, and only one level deep — a `heading`
can't itself have a `parentId`, and `summary` can't have one at all. This is
enforced server-side in `server/src/resumeStore.js`'s `assertValidParent`,
called from every store method that can set `parentId` (`createBlock`,
`updateBlock`, `reorderBlocks` — i.e. `POST /blocks`, `PUT /blocks/:id`,
`POST /blocks/reorder`, and the matching MCP tools). Deleting a heading promotes its
children back to top-level rather than deleting them.

`position` is only unique within a sibling group (all blocks sharing a
`parentId`), not globally — so anything that needs the actual display order
must call `orderBlocksHierarchically()` (`server/src/blockRows.js`,
re-exported from `db.js`), which walks
each heading's children (sorted by their own `position`) in right after it.
Every place that hands a flat `blocks` array to a consumer — the store's
`listBlocks()`/`reorderBlocks()` (behind `GET /blocks`, `POST
/blocks/reorder`, and the MCP tools) and the `published_resume` snapshot
built by its `publish()` — already runs it, so `client/src/editor/BlockList.jsx` and
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
group in a side column) use the shared `groupBlocksIntoColumns()` helper
(`client/src/resume/blockColumns.js`), which groups a heading with whatever
is nested under it via `parentId` and sorts each group into one of two
columns. A heading can pin its own section to a column via `data.column`
(`'primary' | 'secondary'`, editable in the editor's heading form); anything
else falls to the layout's `classifyAuto(group, index)`. Three layouts use
this today: `sidebar` and `sidebar-right` (a skills/education rail, left or
right — see `client/src/resume/sidebarPanel.js` for their shared
heuristic + rail text-contrast handling) and `split-columns` (two even
columns, alternating by section).

### Pluggable header/layout templates

Templates live at the repo root under `templates/headers/<id>/` and
`templates/layouts/<id>/`, each with a `template.json`
(`label`/`description`/`author`, layouts also allow `skillsDisplay` and
`columns: true` for layouts that honor a heading's column placement).
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
`blocks`/`renderBlock`/`colors` and decides arrangement (e.g. the
`sidebar`/`sidebar-right`/`split-columns` layouts split blocks into two
columns via `groupBlocksIntoColumns()`, see "Block nesting" above).
`mode="preview"` (editor
only) renders every block regardless of visibility flags and dims hidden
ones instead of omitting them.

Block- and bullet-level visibility are applied server-side in
`server/src/publicBlocks.js` (called from `routes/public.js`). A block
hidden in the requested mode is not dropped: it's sent as a content-free
placeholder (`hidden: true`, only id/type/parentId plus a heading's
`data.column`) so column layouts group and classify exactly the list the
editor preview sees, and `ResumeView.renderBlock` returns `null` for it.
Bullet-level visibility (`experience` blocks) is independent of block-level
visibility, and bullets can nest one level deep — both the visibility
filter and the print/PDF path need to recurse into `children`.

### AI rewrites

`POST /api/ai/rewrite` (`server/src/routes/ai.js`) never writes anything. It
returns a proposal: the block's data with only allowlisted prose fields
replaced, via `mergeRewrite()` in `server/src/ai/rewritableFields.js`.
`EditorPage` holds that proposal, swaps it into the `blocks` it passes to
`ResumeView` (outlined via `highlightBlockId`), and on Accept saves it through
the normal `PUT /api/blocks/:id` path, so `touchDraft()` and publish work
unchanged.

`REWRITABLE_TYPES` there is an explicit allowlist like `NESTABLE_TYPES`, mirrored
client-side as `AI_REWRITABLE_TYPES` in `client/src/editor/aiReview.js`. A new
block type needs an entry in `rewriteInput`/`outputSchema`/`mergeRewrite` before
it can be added there.

Output schemas must stay valid for both providers' strict structured-output
modes. That means `additionalProperties: false` and every property in
`required` on every object, and no recursion (the two bullet levels are
spelled out explicitly). A test in `rewritableFields.test.js` checks this.

Provider settings (including API keys, in plain text) live in the `ai` settings
row (`server/src/ai/aiSettings.js`), not env vars. `publicAiSettings()` is the
only shape that may leave the server. Provider calls go through the official
`@anthropic-ai/sdk` and `openai` packages in `server/src/ai/providers.js`.
`rewriteBlock()` takes an injectable `callModel`, so tests never hit a real API.
`timeoutSeconds` (20–120, default 60) bounds each provider call, retries
included: the SDK `timeout` covers one attempt and an `AbortSignal.timeout`
caps the total.

### MCP server

`POST /mcp` (`server/src/routes/mcp.js`) exposes the store as MCP tools via
`@modelcontextprotocol/sdk`'s Streamable HTTP transport in stateless mode:
a fresh `McpServer` + transport per request, `enableJsonResponse: true` (no
SSE), `req.body` handed to `handleRequest` because `express.json()` already
parsed it, and explicit 405s for GET/DELETE (the SDK would otherwise hold a
GET open as an SSE stream). It's gated by `middleware/mcpAuth.js`: a bearer
token from `RESUMECMS_MCP_TOKEN`, compared via sha256 + `timingSafeEqual`;
unset or shorter than 32 chars means the route 404s. There's deliberately
no rate limiter (see the comment there); instead every failed auth attempt
and every tool call is logged as a JSON line (`mcp_auth_failed` /
`mcp_tool` events) so a leaked token leaves a trail.

The tools live in `server/src/mcp/createMcpServer.js`: the definitions
(names, descriptions, zod schemas) are a module-level `TOOLS` array built
once, and the factory only registers them on a fresh `McpServer` — the SDK
binds a server to exactly one transport, so per-request servers are
unavoidable in stateless mode. It takes the store (and a logger) as
parameters so `createMcpServer.test.js` can drive it over the SDK's
`InMemoryTransport` against a fake. Results are JSON text only (no
`structuredContent`, to avoid doubling payloads); store errors are rethrown
as `[<status>] <message>` so the SDK's `isError` result keeps the status,
and errors without a status (SQLite, JSON) are logged and surfaced as a
generic `[500]` — the REST routes do the same via `routes/sendError.js`.
Two tools deliberately differ from REST: `update_block` *merges* `data`
keys (with `replaceData: true` for REST's replace semantics), and
`move_block` turns a single-block move into the full `reorderBlocks()` list
via the pure `mcp/moveBlock.js`. The merge itself lives in the store
(`mergeShallow`, behind `updateBlock`'s `{ mergeData: true }` option and
`setHeader`/`setSite`'s `{ merge: true }` — options, not patch keys, so a
REST body can't switch them on), as does input validation (non-object
bodies, unknown block types, unknown ids on delete → 400/404; a `null`
`data` means "unchanged" on update and "empty" on create; a block's `data`
is type-checked against `server/src/blockData.js` — loose zod schemas,
unknown keys allowed, enums not enforced — on create, and on the merged
result of an update *only if the stored data already passes*, so rows
saved before the checks existed stay editable), so the tools stay one-call wrappers and both front
doors validate alike. `httpError()` lives in `server/src/httpError.js`
(re-exported from the store) and `DATA_DIR` in `server/src/dataDir.js`,
shared by `db.js` and `pdfRenderer.js`. `mcp/blockSchemas.js` is hand-written
documentation of the client-side data shapes (block forms, header, site
settings) for the `get_block_schemas` tool — update it when a form's fields
or option values change, together with `blockData.js` (`blockData.test.js`
fails if the two list different keys). SDK imports are confined to `routes/mcp.js`,
`mcp/createMcpServer.js`, and its test, so a future move to the v2 SDK
packages stays small.

### PDF generation

`server/src/pdfRenderer.js` drives headless Chromium (Puppeteer) to render
the `/print` route and produce a PDF. It's only ever invoked through the
store: `publish()` (behind `POST /api/publish` and the MCP `publish` tool)
and `ensurePdf()` (called from `index.js` on boot, renders only if no PDF
exists yet) — `GET /api/public/resume.pdf` only ever serves the
already-rendered file at `PDF_PATH` (exported from `pdfRenderer.js`,
`<RESUMECMS_DATA_DIR>/resume.pdf`), it doesn't render on demand. Both go
through the store's single PDF queue (`withPdfLock`), so two renders never
run at once and a slow first-boot render can't overwrite a newer publish;
keep any new PDF-writing code on that queue. Each render is bounded by the
store's `pdfTimeoutMs` (default 90 s, `DEFAULT_PDF_TIMEOUT_MS`) so a hung
Chromium releases the queue instead of blocking every later publish — the
renderer gets an `AbortSignal` and, when it fires, closes the shared
browser so the abandoned render stops and the next one starts fresh — and
the file is written to `resume.pdf.tmp` and renamed into place so a
download overlapping a publish never reads a partial file. `publish()`
takes the snapshot synchronously at call time — before queuing the render
— so edits and discards from either front door are strictly ordered
against it; a failed render leaves the site published and throws a 500
that says so (the REST route passes that message through, and the editor
shows it). The `pdf_meta` setting records which snapshot the file on disk
was rendered from, and `getPublishStatus()` reports `pdfStale: true` until
a later render catches up — the editor shows "PDF out of date" for it.

### Auth

Single username/password pair (seeded once from
`RESUMECMS_ADMIN_USERNAME`/`RESUMECMS_APP_PASSWORD` env vars on first boot,
then only ever read from/written to the `settings` table — changing the env
vars later does nothing) plus optional TOTP 2FA, both stored in SQLite, not
config. `server/src/middleware/requireAuth.js` gates everything under
`/api` except `/api/auth/*` and `/api/public/*`; `/mcp` is gated separately
by its bearer token (see "MCP server"). Login is rate-limited
(10 failed attempts / IP / 15 min) and optionally captcha-gated
(`RESUMECMS_CAPTCHA_PROVIDER`); see README.md for the full auth/security
notes, including manual TOTP recovery via direct SQLite access.
