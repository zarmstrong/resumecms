# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted, single-user resume site + CMS (see [README.md](README.md) for
the full product description, environment variables, and API reference).
Content is a reorderable list of **blocks** (`{ id, type, position, parentId,
visibleWeb, visiblePrint, data }`); built-in types are `heading`, `summary`,
`executive_summary` (headline, overview, `highlights` list), `skills_group`,
`experience`, `education`, plus a freeform `custom` type. `experience`,
`skills_group`, `education`, `custom`, and `executive_summary` blocks may each nest
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
`ensureSchema()`, and the MCP tool tests inject a fake store. CI is one workflow,
`.github/workflows/ci.yml`, run on every PR into `main` (issue #97): a
`changes` job diffs the PR and only the jobs it touches run (`server
tests` for `server/**`; `client tests and build` for `client/**`,
`server/**` (client tests import the server modules they mirror) or
anything a template build reads; `templates`, the validator, for
`templates/**`, `templateRegistry.js` or the validator itself; all of
them when `.github/workflows/` changes). `ci-passed` gathers them and is
the only check the ruleset on `main` requires, so a PR can't merge
until it's green; a skipped job counts as passing. Keep a new job
behind `changes` and in `ci-passed`'s `needs`, and never put a `paths:`
filter on the workflow itself: a required check that never runs stays
pending forever. When touching
templates, run both templates commands locally before considering the
change done; when touching `server/src`, run `npm test` from `server/`;
when touching `client/src`, run `npm test` from `client/`. There's no root
`package.json`; `server/` and `client/` are independent npm packages, each
with its own lockfile.

PDF export needs a real Chromium; the Docker image installs the system
package and points Puppeteer at it. In local (non-Docker) dev, PDF export
fails unless you install Chromium yourself and set `PUPPETEER_EXECUTABLE_PATH`.

## Working in this repo

Always work in a git worktree under `.claude/worktrees/<name>`, branched
from an up-to-date `origin/main`, and never edit, switch branches or
`git stash` in the main `/opt/resumecms` checkout. The production sites are
built from that checkout, so whatever is in it ships on the next rebuild.
Keep it on a clean `main`. A fresh worktree has no `node_modules`: run
`npm ci` in `server/` and `client/` before their tests.

Subagents follow the same rule. Agents that write code run with
`isolation: worktree`, and the project's own agents are in
`.claude/agents/`:

- `resumecms-implementer`: makes one scoped change in its own worktree and
  runs the checks for every package it touched.
- `resumecms-reviewer`: read-only review of a branch's diff against the
  invariants in this file.
- `resumecms-app-verifier`: runs a worktree's server on a scratch port and
  data dir and drives the real app. Production shares this host's PID
  namespace, so it never kills processes by name.

When an invariant below changes, update the reviewer's checklist along with
this file.

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
(`RESUME_SETTING_KEYS`), and its cover letters (see "Cover letters"
below); the global `settings` table keeps only
`credentials`, `totp`, `ai` and the landing page's keys (see "Landing
page" below), and `db.js`'s `getSetting`/`setSetting`
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
another; so does the slug's JSON, whose "← Home" link depends on the
host (see "Landing page"). A domain is never access control (anyone
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

### Cover letters

Issue #71. A `cover_letters` table (`schema.js`): `id`, `resume_id`,
`title` (internal), `data` (JSON), `pdf_key`. `coverLetterStore.js` holds
the operations, composed into each resume's scoped store (so they're in
`RESUME_METHODS` and on `forResume(id)`); pure checks are in
`coverLetterFields.js`. Every query is scoped by `resume_id` like
`blocks`'. A letter is private: no draft/publish, never in
`published_resume`, and nothing calls `touchDraft()`. `data` is checked
by a loose zod schema (`COVER_LETTER_DATA_VALIDATOR`) on create and on the
(merged) result of an update; `COVER_LETTER_SCHEMA` in
`mcp/blockSchemas.js` documents the same keys (a test compares them) and
`CoverLetterForm.jsx` edits them, so change all three together.
`deleteResume` deletes a resume's letters and their PDFs; `copyFrom` on a
resume doesn't copy them. REST is `routes/coverLetters.js`, mounted only
under `/api/resumes/:resumeId/`; the MCP tools are in `CONTENT_TOOLS`.

A letter renders with its resume's *draft* header and site settings (it
has no published version): `CoverLetterView` (`client/src/letters/`) uses
the header template and `resumePageStyle()` (`resume/pageStyle.js`, shared
with `ResumeView`), not the layout. Its PDF is rendered on request
(`coverLetterPdf()`, behind `GET …/cover-letters/:letterId/letter.pdf`) on
the same `withPdfLock` queue, timeout and wait (a 503 past it, see "PDF
generation"), written atomically to
`<pdfDir>/letters/<letter id>.pdf`, and reused while `letterPdfKey()` of
what it shows (data, header, site, and today's date if the letter has
none) matches `pdf_key`. The renderer loads `/print/letter`, whose fetch of
`/api/public/letter` is served the letter named by a second signed cookie
(`RENDER_LETTER_COOKIE`, `renderTarget(cookie, 'letter')`); without one
that endpoint 404s. The server sends the date to show (`letterToday()`,
mirrored client-side in `letterParts.js`) so the PDF and its cache key
agree. In the editor, `?page=letters` (with the resume's `?resume=`) mounts
`CoverLettersPage` keyed by resume id, with its own save queue flushed
before switching, Back, Duplicate, Download PDF and logout.

AI writing for a letter is `server/src/ai/letterWriting.js`, behind `POST
…/cover-letters/:letterId/rewrite` (`letterRewriteHandlers()` in
`routes/ai.js`, sharing its two rate limiters). It's a rewrite like a
block's, apart from it: its own targets (`letter`: salutation, body and
closing, drafted from scratch when the body is empty; `paragraph` by
index), its own prompt, schema and merge, and it never touches recipient,
date, address or signature. It reads the resume's draft blocks through
`letterResumeContext()`, which leaves out every block and bullet hidden on
both web and print (shown anywhere is enough), and the header's name and
title only; keep both if you add fields. Its output schemas are in
`rewritableFields.test.js`'s strict-mode check. Client-side,
`letters/letterAi.js` mirrors the target key and holds the proposal
helpers (`relocateParagraph()` follows a paragraph like `relocateTarget()`
follows a bullet, reusing its `lcsPairs()`), `CoverLettersPage` holds the
proposals by `(letterId, target)` and saves an accepted one through its
save queue, and `editor/LetterAiPanels.jsx` has the two panels (the brief
fields are `TailorModal.jsx`'s `BriefFields`).

### Landing page

An optional home page at `/` (issue #70), off by default. It belongs to the
install, not to a resume, so it lives in the global `settings` table:
`landing_draft`, `landing_published`, `landing_meta` (its own
`lastEditedAt`, bumped by `touchLanding()`) and `landing_enabled`.
`server/src/landingStore.js` holds the operations and is composed into the
store by `createResumeStore()`; validation and the public shape are pure, in
`landingFields.js`. It isn't blocks: `{ headline, subheadline, availability, actions,
photo, photoUrl, photoImage?, sections, seo, homeLink, homeLinkLabel }` (`seo` is `{ title, description, noindex, image? }`, see
"Search and link previews"; `mergeLandingPatch()` merges it one level
deep; `actions` are the hero's buttons, issue #88, a `link` or a `resume`
opening its `page` or `pdf`), where `sections` is an ordered list of
`{ id, kind, title, ... }` with only the fields of its kind
(`SECTION_FIELDS`): `text` (`body`), `items` (`[{ title, text, url, meta, image? }]`),
`links`, `resumes` (cards `{ resumeId, label, blurb }`), `quotes`
(`[{ text, name, role, url }]`), `experience` (`resumeId`, `count`,
`showDates`; issue #90) and `image` (`{ image, caption }`, `image` null
until one is uploaded; issue #92). Any section may be `hidden: true`: kept in the
draft, dropped by `resolveLanding()`, dimmed in the editor's preview
(the client resolver's `withHidden`). `hidden` and an item's `meta` are
only stored when set. The `id` is
for the editor only and never leaves the server publicly. A draft or
snapshot stored before sections (`intro`/`links`/`resumes` as fields) is
read through `upgradeLanding()`, with fixed ids, until the next save or
publish. It's checked far more
strictly than the header, because all of it is shown to every visitor:
unknown keys, wrong types and values over `LANDING_LIMITS` are a 400, a
link (or item URL) with any scheme but http/https/mailto/tel is too (the client's
`safeHref()` rule, run through the WHATWG parser so `java\tscript:` is
caught; a URL the parser rejects outright, like a half-typed `https://`,
saves but is never shown), and `photoUrl` has to be
a base64 JPEG/PNG/WebP `data:` URL (still accepted; uploads go to the image
store below). A link's `type` only picks its badge;
its names are `LINK_TYPES`, kept in step with the catalog in
`client/src/resume/linkTypes.js` and the header enum in
`mcp/blockSchemas.js`, and `telUrl()` (a fresh draft's phone link) mirrors
the client's `telHref()`. A new card, resume action or experience section
must name an existing resume, but one already in the draft may outlive its resume
(`referencedResumeIds()`), so a deletion doesn't make the draft unsavable. Publishing it is separate from
publishing any resume, and `landing_enabled` isn't drafted: it takes
effect at once, and does nothing until a snapshot exists.

A text section's `body` and an item's `text` (issue #91, nothing else: a
quote's `text`, an item's `meta`, an image section's `caption`, an
image's `alt` and every title or label stay plain text,
never parsed, escaped or migrated) may
hold `[label](url)`, `**bold**` and `*italic*`; a `\` before `\ * [ ]`
escapes it, and an unmatched marker stays literal. The tokenizer,
`parseInline()`, is pure and exists twice, `server/src/inlineText.js` and
`client/src/landing/inlineText.js` (the shared part identical), kept in
step by the cases in `server/src/inlineText.cases.js`, which the client's
`inlineText.test.js` runs through both. A body is parsed one paragraph at a
time (`textParagraphs()`, also in both), an item's text whole, and every
consumer has to read it the same way: `checkInlineText()` holds each
link's URL to `isAllowedDraftUrl()` (a 400 naming the section and
paragraph) and counts its cap with `inlineLength()`, every character as
written except an escaping backslash (also in both copies; the landing
rewrite's length check counts the same way, and the editor's two textareas
refuse an edit past it with `inlineEdit()` instead of a `maxLength`, which
can't be exact: typing inside an escape changes the count by two), so escaping never takes a field over its cap. `LandingView` renders the tokens as
elements through `renderInline.js` (hrefs through `linkProps()`, never
`dangerouslySetInnerHTML`), and both `pageMeta.js` copies read a body's
description as its plain text. Text stored before the syntax was escaped
once by `migrateLandingText()` (`landingTextMigration.js`, run from
`db.js` on every boot): `escapeInline()` only touches text that would read
differently, and the `landing_text_format` setting, written in the same
transaction, keeps it from running twice (escaping isn't idempotent).
An editor loaded before the upgrade would write its unescaped draft back,
so the format is explicit on writes: the client sends `textFormat:
'inline'` in `PUT /api/landing`'s body and the rewrite route's `landing`
copy (`api.js`), the routes take it off with `splitTextFormat()`, and the
store's `setLanding()`/`checkLandingDraft()` escape a write without it
(`{ textFormat: 'plain' }`, `escapeLandingText()`) before checking it. Such
an editor may also have re-read the escaped draft (a GET on mount, a
Discard), so a field equal to the stored draft's at its place is kept as
it is and only a field that differs is escaped. A text section's body is
matched by section id. An item's text is kept when it equals the stored
item at its index, escaped when its escaped form equals some stored item
in that section (an original the editor never re-read), kept when it
equals one (a moved echo), and escaped otherwise (`keepItem()`). So an
echoed field is never escaped twice, and an edited one reads as that
editor showed it, backslashes included. The marker is never stored. The store's default is `'inline'`, so MCP writes (whose
tool descriptions document the syntax) and tests are taken as inline.

Its images (issue #92) can't ride in the draft (the editor PUTs it whole
under `express.json()`'s 2 MB limit), so they're a store of their own: the
`landing_images` table (`schema.js`; in SQLite, not under the data dir,
because the backups copy only the database and an upload can't be
re-rendered like a PDF), `landingImageStore.js` composed into the landing
store, pure parts in `landingImageFields.js`. `POST /api/landing/images`
takes the raw file (`express.raw()` on that route only, after the login
check) and `upload_landing_image` (MCP) base64 under a smaller cap, both
into `uploadLandingImage()`. `imageUpload.js`, the only module that loads
`sharp` (a pinned dependency; it ships prebuilt binaries for the Docker
image's glibc), tells the type by its bytes (JPEG/PNG/WebP, never the
`Content-Type`), refuses more than 50 MP before decoding, and *always*
re-encodes: EXIF orientation applied, at most 1600 px on the long side,
no metadata at all (EXIF/GPS, XMP, PNG text), a PNG too big for the cap
kept as WebP. The id is the sha256 of the stored bytes; caps and the
grace period are `LANDING_IMAGE_LIMITS` and `IMAGE_GRACE_MS`. The draft
refers to an image as `{ imageId, alt }` (`checkImageRef()`; `alt` a
required string, '' allowed in a draft while it's typed, but
`publishLanding()` refuses with a 400 naming the field while a reference
the page would show has a blank one: `assertImagesDescribed()`) in `photoImage` (with
`photo: 'upload'`), an item's `image`, an `image` section and
`seo.image`; the optional ones are stored only when set. Like a card, a
new reference must name a stored image and one already in the draft may
outlive it (`referencedImageIds()`). After a publish and on boot,
`pruneLandingImages()` deletes images neither the stored draft nor the
snapshot references once they're past the grace period (so an upload
just before a discard survives), and a full store prunes before refusing
(409). The editor fetches any stored image at `GET /api/landing/images/:id`
(`EDITOR_IMAGE`, behind login); a visitor only through
`GET /api/public/landing/images/:id`, which `publicLandingImage()` answers
only while the landing page is shown and `shownImageIds()` of its
resolved snapshot includes the id, so a draft-only upload isn't public
just because its hash is known, and a removed one is gone at the next
publish (hence `REVALIDATE` with the id as a strong ETag, not
`immutable`).

`resolveLanding()` is the only shape that leaves the server publicly, and
it resolves references when the page is requested, not when it's
published (`landingContext()`). That's what keeps a resume made private,
unpublished or deleted after the publish off the page, and keeps a renamed
one's link working. Cards carry an `href` (`/resume` for the default,
`/r/<slug>` otherwise) and a label, never a resume id or its internal
`name` (which can say who it was tailored for); an empty label uses the
resume's published header title. A card with `showPdf`, and a resume
action with `open: 'pdf'`, link the PDF (`pdfHref` in the context: the
host's own `/api/public/resume.pdf` for the default, the slug's
otherwise, with `pdfVersionOf()`'s `?v=`) only while the file exists; a
resolved action is `{ label, href }`. An experience section never stores
roles or block ids: the context carries each visible resume's
`experience`, `experienceRoles()` of its published blocks (the experience
entries `publicBlocks.js` shows on the web, in order, with only title,
company, its URL, location and dates), and the section resolves to its
first `count` of them plus the resume's `href`. An image reference resolves
against `context.images` to `{ src, alt, width, height }` (its public path)
or drops out when its image is gone; an uploaded hero photo is `photoUrl`
plus `photoAlt`. A section left with nothing to show
(no text, no item or quote, every card's resume hidden, no role, no image) is dropped, heading and
all, as is a hidden one. The photo (`photo: 'resume'`) and the
site settings come from the default resume's *published* snapshot, never
its draft. Keep both properties if you add fields or section kinds; a new
kind needs `SECTION_FIELDS`, `checkSection()`, `resolveSection()` (both
copies), the MCP `landingSection()` union, `LANDING_SCHEMA`, and a case in
`LandingForm`'s `SectionFields` and `LandingView`'s `SectionBody`.

`GET /api/public/home` is what `/` loads: `{ kind: 'landing' }` from
`landingForHost()` when it's enabled, published and the host isn't in
`resume_hosts` (any mapping, published or not, so switching the page on
never changes what a resume's domain shows), otherwise `{ kind: 'resume' }`
with what `/api/public/resume?mode=web` would send. One request, so a cold
load never shows the resume and then swaps. It sends `REVALIDATE` and
`HOST_HEADERS`. The editor's routes are in `routes/landing.js`
(`/api/landing`, mounted before the catch-all `/api`), and the MCP tools
are `LANDING_TOOLS` in `createMcpServer.js` (no `resumeId`;
`update_landing_page` merges via `mergeLandingPatch()`, `sections` as a
whole list).

While the landing page holds `/`, resume pages link back to it (issue
#89): `/api/public/resume` and `/api/public/resumes/:slug` (both in
`routes/publicResume.js`, a factory over the store so its test runs on
`:memory:`) add `home: { href: '/', label }` when `homeLinkForHost()`
says so: the same conditions as `landingForHost()`, plus the published
snapshot's `homeLink` (a drafted boolean, on by default and for a
snapshot stored before it). `label` is that snapshot's `homeLinkLabel`
(drafted too, capped by `LANDING_LIMITS`), trimmed, or `HOME_LINK`'s
"Home" when empty; never the draft's. Never in
print mode or to the render cookie, so no PDF shows it, and never on a
resume's own domain. `home` isn't part of the snapshot, so both send
`HOST_HEADERS`, and the client's `sameResume()` compares it on refetch.
`PublishedResume` draws it as "← <label>" above `ResumeView`, not in it
(`client/src/resume/homeLink.js` checks it's a same-site path, web
only), so no template draws it and the editor preview never shows it.

On the client, `/` is `HomePage` (`client/src/landing/HomePage.jsx`), which
renders `LandingView` or the resume from that one response, and `/resume`
is `ResumeRoute`, which redirects to `/` whenever `/` would show a resume
itself. Both refetch like `PublicResumePage`, through the shared
`usePublicFetch()` hook. The editor opens the landing page from the
switcher (`ResumeSelect`, value `LANDING_PAGE`) as `/editor?page=landing`,
where `ResumesEditor` mounts `LandingEditorPage` instead of `EditorPage`;
it has its own save queue, flushed before a switch, publish, discard and
logout. Its preview resolves the local draft with
`client/src/landing/resolveLanding.js`, a mirror of the server's
`resolveLanding()` (keep the two in step), against the `context` from
`GET /api/landing`, whose `images` list the stored ones at the editor's
path. An upload goes through `LandingImageField.jsx` and
`LandingEditorPage`'s `handleImageUpload()`, which tracks it on the save
queue and applies the reference before it settles, so a flush waits for
both. It applies it to the draft as it is when the upload resolves
(`landingRef`), never through a field's render-time closure, at the right
target or not at all (`landingImages.js`: the hero, the share image, a
section by id, and an item by a client-only key held in a `WeakMap` on
the item object, never saved; anything that replaces an item with an
edited copy passes it on with `carryItemKey()`, as `LandingForm` and
`setLandingSlice()` do). A target that's gone by then (the hero switched
away from an upload, the section or item removed, or an item whose key
didn't follow it) drops the reference; content is never used to guess.
A new image there starts with an empty `alt` (only the same image
uploaded again keeps it), so the publish check asks for a description of
the image actually shown.
If the page unmounted mid-upload without a flush (the browser's Back
button), the reference is dropped too: writing it into the server's draft
could race a new editor page and overwrite its edits, so the worst case
stays a lost upload, never a lost edit. AI rewrites of its fields are described under "AI
rewrites" below. While the page is shown (`landingShown()` in
`resumeLinks.js`), `publicUrl()` gives the default resume's link as
`/resume`.

### Search and link previews

Issue #87. Link-preview crawlers and most search crawlers don't run the
app's JavaScript, so the HTML shell carries each public page's `<title>`,
description, Open Graph/Twitter tags, canonical link and (landing page and
a resume at `/` or `/resume`, never `/r/<slug>`) a JSON-LD `Person`.
`clientStatic.js` reads `index.html` (re-read when its mtime changes,
`shellWatcher()`) and swaps its `<title>` for `headFor(req)`'s tags;
`shellHead.js` decides which page a path is by asking the store exactly
what that page's own fetch would (`landingForHost()`, `forHost()`,
`forPublicSlug()`), and returns null (index.html's generic tags) for
everything else, for an unknown, private or unpublished slug, and when the
store throws. The tags themselves are pure, in `pageMeta.js`
(`resumePage()`, `landingPage()`, `headTags()`, all escaping in one
place); `client/src/share/pageMeta.js` mirrors its title and description
rules for the editor's preview and the public pages' `document.title`,
and its test compares the two directly. Everything comes from published
snapshots (a resume's `getPublishedResume('web')`, so a block hidden on
the web is a placeholder and never the description), and from what the
page shows. A resume's overrides are `site.title` (also the tab title) and
`site.description`, so they're drafted, published and discarded with the
site settings; the landing page's are its `seo`. `seo.noindex` adds
`X-Robots-Tag: noindex` to `/` while the landing page is what it shows.

The image is the landing page's `seo.image` when it has one (issue #92:
`landingPage()`'s `shareImage`, served by its public path with its size,
and then no card is drawn), else a share card when one is drawn, else the
photo (an uploaded hero photo by its public path, which `cardContent()`
also accepts).
`shareImages.js` (pure) keys both by a hash of what they show: a photo by
its `data:` URL, a card by `cardContent()` (name, title, photo and only the
colors and fonts it's drawn in) plus `CARD_DESIGN_VERSION`, which must be
bumped when `client/src/share/ShareCard.jsx` changes. `shareStore.js`
(composed into the store like the landing store) renders cards on the PDF
queue (`withPdfLock`, the render timeout) as `<pdfDir>/cards/<key>.png`:
`publish()`, `publishLanding()`, `setLandingEnabled()` and boot call
`refreshShareCards()`, and a page whose card isn't drawn yet names the
photo and queues it (`readyCardKey()`). A failed render isn't retried for
`CARD_RETRY_MS`, cards no public page shows are deleted after each render,
and nobody waits on a card: a publish never fails over one. The renderer
(`renderShareCard()`) loads `/print/card` with the content set as
`window.__SHARE_CARD__` before the page's scripts run, so no endpoint
serves card content, and screenshots 1200×630. `GET
/api/public/images/:key` serves an image only while `publicPages()` (the
shown landing page and every public, published resume) still shows it, so
taking a resume private takes its photo and card down with it; keep that
check if you add an image (the landing page's uploads have the same rule,
see "Landing page").

### Route mount order matters

`server/src/index.js` mounts `/api/auth`, `/api/auth/totp`,
`/api/public`, `/api/ai`, `/api/resumes` and `/api/landing` *before* the catch-all `/api` mount for `blockRoutes`/
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
`custom`, and `executive_summary` blocks can be nested, and only one level deep — a `heading`
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
text), so keep that filter if you add fields to it. An `executive_summary`
gets the outline on every rewrite, brief or not, and with each job's
tagline, description and bullets (`accomplishments`; bullets hidden where
it shows are left out, a sub-bullet with its parent): `outlineScope()` in
`brief.js` is the one place that decides, read by both the route and
`rewriteBlock`, and the editor's `contextNote()` (`aiReview.js`) says so in
the panel. Its `highlights` are an array of plain strings with no flags, so
`mergeRewrite` lets the model add, drop or reorder them (blanks dropped)
without the bullet-restructure setting. Requests with a brief count against their
own rate limiter (`tailorLimiter`) instead of `rewriteLimiter`. Each resume
keeps the brief it was tailored for as its `tailoring` setting
(`createResume`/`updateResume`, shown on every resume the API returns): a
note, so no `touchDraft()` and never published, and a copy keeps its
source's unless given one.

In the editor, a tailoring run is just many ordinary proposals.
`client/src/editor/tailorRun.js` picks the items (`tailorItems`: one per
block of the chosen types, plus an experience description; it skips
blocks hidden everywhere and ones with no text) and runs them
(`createTailorRun`, `TAILOR_CONCURRENCY` at a time, `cancel()` forgetting
what's in flight). Each item goes through `EditorPage`'s
`handleAiRequest` with the brief, which resolves with how it ended, so
review, staleness and relocation all work unchanged. A run started from
New resume (`TailorModal.jsx`'s fields in `ResumeModals.jsx`) has to
survive the switch to the copy, which remounts `EditorPage`: so
`ResumesEditor` holds it as `pendingTailor` until the copy's page has
loaded and takes it. A run stops when its page unmounts. "Accept all" saves
`acceptAllPlan()` (`aiReview.js`): what the preview shows, minus
whole-block proposals whose block was edited since, which the preview
still shows but a bulk accept mustn't apply without asking.

A tailoring *plan* (issue #84, `server/src/ai/tailorPlan.js`, behind `POST
…/ai/tailor-plan` via `tailorPlanHandlers(storeFor)`, on `tailorLimiter`
only, since its brief is required) suggests what to hide and a section
order instead of rewriting text, and writes nothing either. The model sees
`planOutline()` of the stored draft: short refs (`B3`, `B3.2`, `B3.2.1`,
bullets by index path) instead of ids, and nothing hidden on both web and
print, as in `letterResumeContext()`; keep both if you add fields.
A heading's section is its nested blocks *plus* the top-level blocks after
it up to the next heading (`draftTree()`; the editor's `sectionMembers()`
mirrors it), since a resume made before nesting, the sample content
included, has headings that only title what follows them; moving or
hiding a section takes all of it, and an order puts a section's nested
blocks first so `reorderBlocks()` accepts it.
`checkPlan()` drops, one at a time, any suggestion naming an unknown ref,
something already hidden on the `hideFrom` surfaces, a summary or
executive summary, a resume's last shown experience entry (per surface),
or an entry's last shown bullet, checking each against the hides kept so
far (sections, then blocks, then bullets) so any subset of the plan still
follows the rules. A heading's ref hides its whole section. The order is
kept only as an exact permutation of what was sent, top level and within
each section, never across one; blocks not sent keep their slots, so
`order.blockIds` passes `reorderBlocks()` unchanged. Hide keys are
`<blockId>:hide` and `<blockId>:hide:<path>` (`hideKey()`), the editor's
`proposalKey()` with a `hide` target.

In the editor the plan is a third kind of proposal, kept apart from
`aiProposals`: `EditorPage`'s `planHides` (by key) and `planOrder`, with
the pure helpers in `client/src/editor/tailorPlan.js` and the panels in
`PlanHidePanel.jsx` (under each block's row; the order's banner above
the preview). `receivePlan()` stamps each hide with its surfaces, a
bullet hide with the `anchorData` that `relocateHide()` follows it from
(`relocateTarget()`'s rules), and the order with the nesting it was made
for. A hide is stale once what it was made for changed (`isHideStale()`),
gone once it's in effect (`isHideApplied()`), and left out of the preview
under a rewrite that may move its bullet; an order is stale once the ids
or nesting differ (`isOrderStale()`), and then can only be discarded.
Accepting goes through the existing saves: `handleVisibilityChange()`
per block, `handleBlockDataChange()` for a bullet, `handleReorder()` for
the order. Accepting a bullet hide rebases that block's open rewrites
(`rebaseOnBulletHide()`) so they don't go stale over the flag, or undo
the hide when accepted later; `acceptAllWithPlan()` extends
`acceptAllPlan()`. `handleReorder()` keeps each block's local content
when its response lands, since an Accept all's data edits (or any edit
on its debounce) aren't in it yet. In a run, the plan is
`tailorRun.js`'s `planItem()`, a `barrier` item that runs alone first;
its `skipBlockIds` take the rewrites of blocks it suggests hiding out of
the run (`suggestedHidden`). `pendingTailor` carries the options as
`plan` across New resume's switch. Discard, Discard all and switching
resume drop the plan.

The landing page has its own rewrite (issue #73):
`server/src/ai/landingRewrite.js`, served by `landingRewriteHandlers()` in
`routes/ai.js` and mounted at `POST /api/landing/rewrite` by
`routes/landing.js` (same `rewriteLimiter`). Every landing field it writes
is one string, so a proposal is `{ target, before, after }`, and one
request returns a list (an `intro` target writes headline, subheadline and
a text section, three proposals). Targets are an allowlist
(`LANDING_TARGET_KINDS`); sections and cards are addressed by id, items by
index. Quotes (someone else's words), experience sections (read from a
resume) and an item's `meta` are deliberately never targets. The page is
public, so what the model sees is too: the route builds
`landingProfile()` from `store.visibleResumeSnapshot()` (a resume's
*published* snapshot, only while it's public; the card's resume for a
blurb, the default otherwise), and the page context leaves out URLs, ids,
the photo and hidden sections (but the one the target is in), and shows an
experience section's roles from `getLandingContext()`. Keep both if you
add a target or a field to the profile.
The editor copy it works on is checked by `store.checkLandingDraft()`. In
the editor, `LandingEditorPage` holds the requests and proposals,
`client/src/editor/landingAi.js` mirrors `landingSlice()` and follows an
item's proposal when the item moves (`locateTarget()`), and each field's
panel is `LandingAiPanel.jsx`.

The model must never be able to put a URL on the landing page (issue #91).
In the text it rewrites (a `text`, an `item`, or an `intro`'s section),
each link's URL becomes a placeholder (`linkPlaceholders()`: `#L1`, `#L2`,
…, one per URL, built from the draft alone so prompt and merge agree), and
in the page context a link is just its label. `landingProposals()` maps
the placeholders back (`unmaskLinks()`, through `mapLinks()`, which finds
links exactly as the page does) and makes a link to anything else a 502
for the whole answer. Labels may change and links may move or go. Keep
that check in the merge if you add a target whose text holds links.

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
`publish()` waits for its render for at most `pdfWaitMs` (default
20 s, `DEFAULT_PDF_WAIT_MS`; issue #58): one stuck behind a hung
render could otherwise hold the caller for two full timeouts, past a
reverse proxy's patience, and a dropped connection looks like a failed
publish that in fact took effect. Past that it answers `pdfPending: true`
and the render finishes on the queue (a failure then is only logged).
`getPublishStatus().pdfPending` is true while any render of that resume
(`trackRender()`, publish or `ensurePdf`) is queued or running; the
editor shows "PDF rendering…" and polls until it clears. A cover
letter's download has the same cap: past it, a 503 to try again, while
the render carries on and leaves its file for the retry (the editor
retries on its own). Both go through `settleWithin()`, so a request that
waits on the PDF queue should too.

Puppeteer is launched with its own SIGTERM/SIGINT/SIGHUP handlers off: they
closed the browser but kept Node from exiting, so a server that had ever
rendered survived `docker stop` (issue #68). `server/src/shutdown.js` owns
both signals instead: it stops accepting connections, gives in-flight
requests `DRAIN_MS` before cutting them, closes the shared browser
(`closeBrowser()`) and the DB, and exits, with a `FORCE_EXIT_MS` backstop
inside Docker's 10 s grace period; a second signal exits at once. Node is
PID 1 in the container, which only gets signals it handles, so keep a
handler there; compose's `init: true` adds a real init that also reaps
Chromium's children.

### Cache headers

Every public response carries an explicit `Cache-Control` from
`server/src/cacheHeaders.js`: `no-cache` for `/api/public/resume`,
`/api/public/resumes/:slug`, `/api/public/images/:key`,
`/api/public/landing/images/:id` and the HTML shell
(which also sends `HOST_HEADERS` as `Vary`, since its tags name the
host's resume and origin; see "Search and link previews"), `private, no-cache` for
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
