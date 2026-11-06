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
(name/title/contact) is a separate setting. The install can hold several
resumes, each with its own blocks, header and site settings (see "Several
resumes" below). Besides the editor,
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
`touchDraft()` (`createResumeSettings` in `server/src/settings.js`) to bump
`draft_meta.lastEditedAt`. The routes in `routes/blocks.js`,
`routes/publish.js`, and `routes/public.js` are thin wrappers that map a
store error's `.status` onto the response (wrap every handler over the
store in `handle()` from `routes/sendError.js`, sync or async). The public site and
PDF (`server/src/routes/public.js`, `server/src/routes/pdf.js`) never read the draft tables —
they read the `published_resume` setting, a full snapshot written only by
`POST /api/publish` (`server/src/routes/publish.js`). `GET
/api/publish/status` reports unpublished changes when
`draft_meta.lastEditedAt` is set and not older than
`published_resume.publishedAt` — `publish()` clears it when it takes its
snapshot, so an edit in the same millisecond as a publish still counts;
`POST /api/discard-draft` overwrites the draft tables from the
last published snapshot. On first boot after this split was introduced,
whatever was in the draft tables becomes the initial published snapshot
(see `seedLegacyResume()` in `db.js`) so existing installs don't go blank.

When adding a new draft-mutating operation, put it in the store and call
`touchDraft()` there (not in a route or tool), or the "unpublished changes"
indicator will silently go stale for one of the two front doors.

### Several resumes

All of the above is per resume (issue #53). The install keeps several
resumes ("variants") in the `resumes` table (`server/src/schema.js`): a
stable `id`, a renameable `slug`, and exactly one `is_default` (a partial
unique index allows at most one; the store never removes the last). Each
resume owns its blocks (`blocks.resume_id`) and its `header`, `site`,
`draft_meta`, `published_resume`, `pdf_meta` and `tailoring` rows in `resume_settings`
(`RESUME_SETTING_KEYS`); the global `settings` table keeps only
`credentials`, `totp` and `ai`, and `db.js`'s `getSetting`/`setSetting`
only ever see those.

`store.forResume(id)` returns the content operations bound to one resume
(404 for an unknown id), and every `blocks` query inside is scoped by
`resume_id`: a block of another resume is "not found", so it can't be
edited, deleted, reordered or nested under through the wrong one. Any new
`blocks` query must be scoped the same way. The store object itself also
carries every operation bound to whichever resume is the default at call
time — that's what the unprefixed REST routes and MCP tools called without
a `resumeId` use.

The store also manages the resumes themselves (`listResumes`,
`createResume`, `updateResume`, `deleteResume`; pure validation and the
block-copying in `resumeFields.js`). A new resume is private and
unpublished; `copyFrom` clones another's draft with fresh block ids and
remapped `parentId`s, and never its published snapshot or PDF. Only a
published resume can become the default (the public site reads the
default's snapshot), the default is always public, and it can't be
deleted. `deleteResume` removes the PDF straight away rather than waiting
on the PDF queue: a render of a resume deleted while it was queued or
running writes neither a file nor a `pdf_meta` row (`stillExists()`,
checked on both sides of the render in `publish`/`ensurePdf`).
`routes/resumes.js` serves `/api/resumes` and mounts the same block and
publish handlers under `/api/resumes/:resumeId/`: `routes/blocks.js` and
`routes/publish.js` export factories taking `storeFor(req)`, and their
default export is the unprefixed default-resume instance; `routes/ai.js`'s
`rewriteHandlers(storeFor)` does the same for the AI rewrite (one shared
rate limiter). Address a resume by the URL prefix, never a body field, so a
client that prefixes its calls can't forget it on one of them.

The public side picks a resume in two ways, both in the store. `forHost(req.hostname)`
(behind `/api/public/resume` and `/api/public/resume.pdf`) returns the
resume whose domain that is (`resume_hosts`, normalized by `hostnames.js`),
if it's public and published, and the default otherwise; the render
cookie (see "PDF generation") takes precedence over it.
`forPublicSlug(slug)` (behind `/api/public/resumes/:slug` and its
`resume.pdf`) 404s unless the resume is public and published, so an
unknown, private and unpublished slug all look the same. Those slug
responses and the `/r/<slug>` HTML shell carry `X-Robots-Tag: noindex`
(`NOINDEX` in `cacheHeaders.js`), and the two host-resolved routes send
`Vary: Host, X-Forwarded-Host` (`HOST_HEADERS`; behind a trusted proxy
the host comes from the latter) so no cache hands one domain's resume to
another. A domain is never access control (anyone
can send any `Host`), so `updateResume` makes a resume public when it
gets domains and removes them when it goes private; keep that pairing if
you add another way to set either. The editor's routes never follow the
host: the unprefixed ones always mean the default. The client's
`/r/:slug` route (`App.jsx`) renders `PublicResumePage` with that slug,
its PDF link pointing at the slug's PDF (`publicPdfPath()`).

In the editor, `ResumesEditor.jsx` loads the list and mounts `EditorPage`
for the resume `?resume=<id>` names (plain `/editor` for the default),
keyed by its id, so switching remounts it: AI proposals, debounce timers
and late responses can't cross to another resume. `EditorPage` makes
every content call through `resumeApi(id)` (`api.js`, always under
`/api/resumes/:id`; the client no longer calls the unprefixed routes), and
every edit to the draft goes through its `createSaveQueue()`
(`editor/saveQueue.js`): debounced saves by `schedule()`, every edit's
request by `track()` (with a key when a failure leaves the edit only on
screen, so it's still reported at the next switch). Switching, New resume
(the server copies its *stored* draft), Discard and Log out `flush()`
first, and unmounting sends whatever is still waiting, so a new edit must
be tracked there too or a switch can outrun it. The switcher's dialogs are
in `ResumeModals.jsx`, and their pure parts (which resume to open, its
public URL, the settings form's PATCH) in `resumeLinks.js`.

`migrateToResumes()` (`server/src/resumeMigration.js`) turns an install
from before variants into its default resume (slug `main`) on first boot:
it attaches the blocks, moves the settings rows, and moves
`<RESUMECMS_DATA_DIR>/resume.pdf` to the new per-resume path. A fresh
install goes through the same path: `db.js` seeds the old single-resume
shape and migrates it, and none of that seeding runs once a resume exists.
Every boot also runs `adoptLegacyRows()`: blocks with no `resume_id`
(written by a rolled-back pre-variant image) are attached to the default
resume, and per-resume keys back in the global `settings` table are only
warned about, never moved.

### Route mount order matters

`server/src/index.js` mounts `/api/auth`, `/api/auth/totp`,
`/api/public`, `/api/ai` and `/api/resumes` *before* the catch-all `/api` mount for `blockRoutes`/
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

Bullets inside an experience block have their own, simpler drag-and-drop
inside the form (`client/src/editor/blockForms/ExperienceForm.jsx`, a nested
`DndContext`), with the pure logic in `client/src/editor/bulletDrag.js`.
Bullets have no ids, so they're addressed by index path (`[1, 0]`, key
`'1.0'`). The rules:

- A bullet only moves among its own siblings; sub-bullets travel with their
  parent. Promote/demote by drag is deliberately not supported.
- The hovered row is resolved to the sibling it belongs to (`dropTargetPath`:
  a top-level bullet over someone's sub-bullet targets that sub-bullet's
  parent), and before/after is judged against that sibling's whole group (row
  plus sub-bullets), which is also where the indicator is drawn.
- Only rows that stand for a legal sibling are candidates and the nearest one
  wins, so gaps between rows and the space just past the last sibling resolve
  to a position; a pointer outside the sibling list (for a sub-bullet, its
  parent's group) cancels instead of snapping.
- A drop is applied as `fromPath`/`toIndex` only if the bullets still match
  the drag's starting snapshot; an edit that lands mid-drag cancels the drop
  rather than moving whatever now sits at those indexes.
- The handle's Up/Down arrow keys are the keyboard fallback, announced through
  the form's live region.

The new order is just `data.bullets`, saved through the normal `onChange`
path.

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
`ResumeView` (outlined via `highlightBlockIds`), and on Accept saves it through
the normal `PUT /api/blocks/:id` path, so `touchDraft()` and publish work
unchanged.

A request's optional `target` narrows the rewrite: `block` (default),
`description` (experience), `bullet` with an index `path` (`[i]` with its
sub-bullets, or `[i, j]`; experience), or `item` with an `index` (custom).
`normalizeTarget()` validates it against the block (`InvalidTargetError` → 400).
`rewriteInput()`/`outputSchema()` put only the target's fields in the editable
set and schema, with the rest of the block as context (a placeholder marks
the target's spot). `mergeRewrite()` writes back only the target, whatever
else the model returns. In particular, an experience `block` rewrite no longer
includes the description and copies it through unchanged; only the
`description` target can change it. The editor keys open proposals by
`proposalKey(blockId, target)` (`client/src/editor/aiReview.js`), so several
can be open at once, even on one block. `applyProposal()` writes just a
proposal's target onto the block's current data, `previewData()` composes all
of a block's proposals for the preview, and `isProposalStale()` only compares
the target's slice. Bullet and item targets are positions, so an effect in
`EditorPage` re-keys a ready proposal when its bullet or item moves, and
drops it when its position is gone, or its block is. `relocateTarget()`
aligns the list at the proposal's depth in `anchorData` (the block data it
was last placed against) with the current one: unchanged entries pair in
order (LCS), an unpaired entry in an equal-sized gap was edited in place
and stays put, and otherwise a unique unpaired exact copy is where it was
dragged. The effect advances `anchorData` on every change to the block, so
each call resolves one change; comparing against `baseData` instead can't
tell "edited, then a bullet added above" from other sequences. A placed
proposal keeps `origin`, its position in its own `baseData`/`proposedData`,
which `applyProposal()`, `isProposalStale()` and the review diff read from.
`previewedProposals()` is the one place that decides what the preview
shows (the banner count and outline use it too), and a mounted row panel
resyncs its instruction and tense when a different request (`requestId`)
moves under it. The helpers take the block type because an
experience `block` target doesn't own the description: accepting one keeps
the current description.

`REWRITABLE_TYPES` there is an explicit allowlist like `NESTABLE_TYPES`, mirrored
client-side as `AI_REWRITABLE_TYPES` in `client/src/editor/aiReview.js`. A new
block type needs an entry in `rewriteInput`/`outputSchema`/`mergeRewrite` before
it can be added there. Tense policy lives in `server/src/ai/tense.js`:
`TENSE_TYPES` lists the types the AI `tense` setting applies to (experience
only), and `PICKED_TENSE_TYPES` the ones that pick a tense per rewrite in the
editor instead (custom only), next to the options and `roleTense` (which End
dates `byRole` reads as current). The editor's picker gets that list, its
options, and its default from `publicAiSettings()`, so nothing about it is
mirrored client-side. The README and the `AiSettings.jsx` hint both describe
this in prose (the hint more briefly), so update both with it. The prompt's
wording for each tense stays in `rewrite.js` (`TENSE_RULES`).

Tailoring (issue #53) is a rewrite with a `brief` (`server/src/ai/brief.js`:
`{ audience, posting, guidance }`, checked and capped by `normalizeBrief()`,
caps in `BRIEF_LIMITS`, exposed as `briefLimits` by `publicAiSettings()`).
It only changes the prompt: `buildPrompt` adds `TAILORING_RULES` and the
brief as read-only context (the posting is the employer's text, so a rule
says it's data, not instructions), and the guidance goes after the
instruction as the person's own words. Target, schema and merge are the
same as without one, and with a brief the instruction may be empty
(`TAILOR_INSTRUCTION`). A summary tailored also gets `resumeOutline()` of
the rest of its resume, built in the route from the stored draft; it
leaves out every block hidden anywhere the summary shows (a summary hidden
everywhere counts as shown everywhere, since unhiding it publishes its
text), so keep that filter if you add fields to it. Requests with a brief count against their
own rate limiter (`tailorLimiter`) instead of `rewriteLimiter`. Each resume
keeps the brief it was tailored for as its `tailoring` setting
(`createResume`/`updateResume`, shown on every resume the API returns): a
note, so no `touchDraft()` and never published, and a copy keeps its
source's unless given one.

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
unavoidable in stateless mode. The content tools sit in `CONTENT_TOOLS`,
and `scopedToResume()` gives each an optional `resumeId` and hands its
`run()` `store.forResume(resumeId)` (or the default-bound store when it's
omitted), so no content tool handles the argument itself; put a new
content tool there too. The resume tools (`list_resumes`, `get_resume`,
`create_resume`, `update_resume`, `delete_resume`) wrap the store's
resume methods, and every `mcp_tool` log line carries the `resumeId` a
call named. `createMcpServer()` takes the store (and a logger) as
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
unknown keys allowed, enums not enforced — on create and on the merged
result of an update — or, when the stored data already fails, only on the
keys the update changes, so rows saved before the checks existed stay
editable; `visibleWeb`/`visiblePrint` must be booleans), so the tools stay one-call wrappers and both front
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
and `ensurePdf()` (called through `ensurePdfs()` from `index.js` on boot
for every published resume, renders only if that resume has no PDF yet) —
`GET /api/public/resume.pdf` (and the other two PDF routes: by slug, and
the editor's `GET /api/resumes/:id/resume.pdf`, all through
`sendResumePdf()` in `routes/sendPdf.js`) only ever serves the already-rendered
file (the store's `getPdfFile()`), it doesn't render on demand. Each resume has
its own file, `<RESUMECMS_DATA_DIR>/pdf/<resume id>.pdf` (`pdfPaths.js`,
`pdfPathFor()`), keyed by id so a slug rename never orphans it; the
renderer loads `/print` in a throwaway browser context holding a signed
cookie for the resume id (`renderAccess.js`, key random per process), and
`/api/public/resume` serves that resume's snapshot, public or not, to a
request carrying a valid one (`Cache-Control: private, no-store`,
`RENDER` in `cacheHeaders.js`), naming it in `X-ResumeCMS-Resume`; the
renderer throws if the page wasn't served the resume it asked for, so a
cookie that stops getting through fails renders instead of filing the
default's content under another name. A cookie rather than a header because
Puppeteer's extra headers go to every request, Google Fonts included. So
the client needs no change to render any resume. Every render goes through the store's
single PDF queue (`withPdfLock`, shared by every resume), so two renders
never run at once and a slow first-boot render can't overwrite a newer
publish; keep any new PDF-writing code on that queue. Each render is bounded by the
store's `pdfTimeoutMs` (default 90 s, `DEFAULT_PDF_TIMEOUT_MS`) so a hung
Chromium releases the queue instead of blocking every later publish — the
renderer gets an `AbortSignal` and, when it fires, closes the shared
browser so the abandoned render stops and the next one starts fresh — and
the file is written to a `.tmp` sibling and renamed into place so a
download overlapping a publish never reads a partial file. `publish()`
takes the snapshot synchronously at call time — before queuing the render
— so edits and discards from either front door are strictly ordered
against it; a failed render leaves the site published and throws a 500
that says so (the REST route passes that message through, and the editor
shows it). The `pdf_meta` setting records which snapshot the file on disk
was rendered from, and `getPublishStatus()` reports `pdfStale: true` until
a later render catches up — the editor shows "PDF out of date" for it.

### Cache headers

Every public response carries an explicit `Cache-Control` from
`server/src/cacheHeaders.js`: `no-cache` for `/api/public/resume`,
`/api/public/resumes/:slug` and the HTML shell, `private, no-cache` for
every PDF route, `immutable` for the hashed
files Vite's build manifest lists (`build.manifest` in
`client/vite.config.js` → `dist/.vite/manifest.json`, re-read whenever its
mtime changes so a rebuild under a running dev server is picked up; a file
merely copied from `public/` is never in it, so it's revalidated).
The client is mounted by `server/src/clientStatic.js`, which also owns the
SPA fallback — and 404s any path whose last segment has a file extension,
so a bundle from an older build never comes back as HTML. That means SPA
routes must not contain a dot. Express's defaults (`public, max-age=0`,
or nothing) merely say "revalidate", and a CDN caching by file extension
was turning that into hours of stale PDF after a publish. Keep any new
public route on one of those constants, set before any early return so
error responses carry it too. Don't drop the `pdfVersion` (the PDF file's
mtime plus size, from the store's `pdfVersion()`) that
`getPublishedResume()`, `getPublishStatus()` and `publish()` return:
`client/src/resume/pdfUrl.js` appends it to the PDF link so each render
is a fresh URL even for caches that ignore headers. It's keyed on the
file, not `publishedAt`, because a publish whose render failed must not
advertise a new URL for the old file; the store's temp-file-plus-rename
write means it only moves once a render is complete.

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
