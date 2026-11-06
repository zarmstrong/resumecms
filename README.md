# resume-cms

A self-hosted, single-user resume site + CMS. Drag-and-drop block editor,
per-block visibility control for web vs. print/PDF, and a public resume page
that always matches what you built — because the web page, the browser print
view, and the downloadable PDF all render from the exact same data and the
exact same components.

## What you get

- **`/`** — your public resume page.
- **`/editor`** — password-protected drag-and-drop editor. Blocks drag to
  reorder or nest; the bullet points inside an experience block drag too (a
  bullet moves among its siblings, carrying its sub-bullets — dragging can't
  turn a bullet into a sub-bullet or back), or move with the Up/Down arrow
  keys on their drag handle.
- **`/r/<link name>`** — another resume's public page, once it's public
  and published (see "several resumes" below).
- **`/print`** — the print-styled version of the resume (used internally by
  the PDF export; you generally won't visit this directly).
- **Download PDF** — server-generates a real PDF on demand via headless
  Chromium, from the same markup as the print view.

## How content is modeled

Everything below the header is a reorderable list of **blocks**. Every
block — built-in or custom — has the same shape:

```
{ id, type, position, parentId, visibleWeb, visiblePrint, data }
```

- `visibleWeb` — show this block on the public `/` page.
- `visiblePrint` — include this block in the browser print view *and* the
  generated PDF (they share the same template, so one flag covers both).
- `parentId` — nests this block one level deep under a `heading` block's
  `id`; `null` for a top-level block. Only `experience`, `skills_group`,
  `education`, and `custom` blocks can be nested — a `heading` can't be
  nested under another heading, and `summary` always stays top-level. In
  the editor, drag a block to sit directly under a heading to nest it there.
- `position` — only unique within a sibling group (blocks sharing the same
  `parentId`), not a global ordering key. Don't sort by it yourself; every
  API response that returns a `blocks` array (`GET /api/blocks`, `POST
  /api/blocks/reorder`, the public/PDF snapshot) already returns them in
  the correct overall display order, with each heading's children spliced
  in right after it.

Built-in block types: `heading`, `skills_group`, `experience`, `education`.

**Custom blocks** (`type: "custom"`) are a title plus a list of items, each
with an optional heading and a body. Use these for anything the built-in
types don't cover — certifications, publications, volunteer work, side
projects — without touching any code. They drag, reorder, and toggle
visibility exactly like built-in blocks.

The header (name, title, contact info, links) is edited separately from
the block list, since a resume only has one.

An install can hold **several resumes** (say, one per kind of role), each
with its own blocks, header, site settings, published version and PDF. One
of them is the **default**, which the public site serves. A new resume is
private until made public, and can start as a copy of an existing one. A
public resume has its own unlisted link, and can also be given domains of
its own (`sales.example.com` shows the sales resume, everything else the
default; see [Showing a resume on its own domain](#showing-a-resume-on-its-own-domain)).
The editor's top bar switches between them. **New resume** copies the open
one (or starts with the default's header and look and no sections), and
**Resume settings** renames it, changes its link, makes it public or
private, sets its domains, makes it the default, copies its link, or
deletes it. Each resume has its own Publish and Download PDF; a private
one's PDF downloads from the editor without making it public. The same
operations are in the API (`/api/resumes` below) and the MCP tools.

## Templates

The editor's Site Settings has a "Change template…" button opening a modal
where header style and body layout are browsed and picked independently,
mixed freely, and previewed live against your actual resume content before
you commit to anything. Headers, layouts, and the curated **presets** that
bundle a header + layout + optional colors/fonts under one shareable name
(previewable via `/template-preview/preset/<id>`, and used to generate the
thumbnails in [`templates/`](templates/)) are all open to contribution —
see [`templates/README.md`](templates/README.md) for the schema and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the full workflow, including a new
structural layout (not just a recombination of existing ones).

## Quickstart (Docker)

```bash
cp .env.example .env
# edit .env and set RESUMECMS_ADMIN_USERNAME, RESUMECMS_APP_PASSWORD, and RESUMECMS_SESSION_SECRET

docker compose up --build
```

Visit `http://localhost:4000` for the public resume, and
`http://localhost:4000/editor` to sign in and edit. Data is stored in a
SQLite file on a named Docker volume (`resume-data`), so it survives
container restarts and rebuilds.

## Local development (without Docker)

You'll need Node 22+ (puppeteer and better-sqlite3 require it); Node 24 (the current LTS, and what the Docker image uses) is recommended.

```bash
# terminal 1 — API server
cd server
npm install
RESUMECMS_ADMIN_USERNAME=admin RESUMECMS_APP_PASSWORD=devpass RESUMECMS_SESSION_SECRET=devsecret RESUMECMS_DATA_DIR=./data npm run dev

# terminal 2 — client with hot reload, proxied to the API above
cd client
npm install
npm run dev
```

Visit `http://localhost:5173`. Note that in this dev mode, PDF export will
fail unless Puppeteer can find a Chromium binary — see below.

## PDF export and Chromium

PDF generation uses Puppeteer driving a real Chromium instance. The Docker
image installs Debian's `chromium` package and points Puppeteer at it
(`PUPPETEER_SKIP_DOWNLOAD=true`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`)
rather than letting Puppeteer download its own copy — this is smaller, faster
to build, and more reliable across architectures (arm64 servers, Apple
Silicon, etc.).

If you want PDF export working in local (non-Docker) dev, install Chromium
yourself and set `PUPPETEER_EXECUTABLE_PATH` to point at it before starting
the server.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RESUMECMS_ADMIN_USERNAME` | yes | Initial username to sign in to `/editor`. Only read once, to seed the DB on first boot — change it later from Account Settings in the editor, not this variable. |
| `RESUMECMS_APP_PASSWORD` | yes | Initial password to sign in to `/editor`. Only read once, to seed the DB on first boot — change it later from Account Settings in the editor, not this variable. |
| `RESUMECMS_SESSION_SECRET` | yes | Random string used to sign session cookies. |
| `PORT` | no | Server port. Defaults to `4000`. |
| `RESUMECMS_DATA_DIR` | no | Where the SQLite file (`resume.sqlite3`) and the rendered PDFs (`pdf/`) live. Defaults to `/data`. |
| `RESUMECMS_TRUST_PROXY` | behind a reverse proxy | Express `trust proxy` value: the proxy's IP/subnet (e.g. `172.18.0.1`, `loopback`), or a hop count if the app port is only reachable through the proxy. Unset trusts no proxy. See the login rate-limiting notes below. |
| `RESUMECMS_CAPTCHA_PROVIDER` | no | `turnstile` or `recaptcha` to require a captcha on login. Unset disables it. |
| `RESUMECMS_TURNSTILE_SITE_KEY` / `RESUMECMS_TURNSTILE_SECRET_KEY` | if using Turnstile | From the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile). |
| `RESUMECMS_RECAPTCHA_SITE_KEY` / `RESUMECMS_RECAPTCHA_SECRET_KEY` | if using reCAPTCHA | From the [Google reCAPTCHA admin console](https://www.google.com/recaptcha/admin) (v2 "I'm not a robot" checkbox type). |
| `RESUMECMS_MCP_TOKEN` | no | Enables the [MCP server](#mcp-server) at `POST /mcp`; the bearer token MCP clients must send. Unset disables the endpoint. Must be at least 32 characters (`openssl rand -hex 32`). |

Generate a strong `RESUMECMS_SESSION_SECRET` with e.g. `openssl rand -hex 32`.

## API reference

All `/api/*` routes except `/api/auth/*` and `/api/public/*` require an
authenticated editor session (cookie set by `/api/auth/login`).

| Method & path | Purpose |
|---|---|
| `POST /api/auth/login` | `{ username, password, captchaToken, totpToken }` → sets session cookie |
| `POST /api/auth/logout` | clears session |
| `GET /api/auth/status` | `{ authenticated }` |
| `GET /api/auth/captcha-config` | `{ provider, siteKey, totpRequired }` — `provider` is `null` if captcha is disabled |
| `GET /api/auth/totp/status` | `{ enabled }` (auth-gated) |
| `POST /api/auth/totp/setup` | generates a new pending secret, returns `{ secret, otpauthUrl, qrDataUrl }` (auth-gated) |
| `POST /api/auth/totp/confirm` | `{ token }` → verifies and enables 2FA (auth-gated) |
| `POST /api/auth/totp/disable` | turns 2FA off (auth-gated) |
| `GET/PUT /api/header` | header/contact fields |
| `GET/PUT /api/site` | site settings (title, colors: accent/heading/text/background, plus optional skills-category and employment-dates text/pill overrides) |
| `GET /api/blocks` | all blocks, unfiltered, in display order (editor use) |
| `POST /api/blocks` | create a block: `{ type, data, parentId? }` (`type` must be one of the built-in types; `data`'s documented keys are type-checked, e.g. `bullets` must be an array) |
| `PUT /api/blocks/:id` | update `data` (replaced whole; `null` leaves it unchanged), `visibleWeb`/`visiblePrint` (booleans), and/or `parentId` |
| `DELETE /api/blocks/:id` | delete a block (nested children are promoted to top-level, not deleted); 404 for an unknown id |
| `POST /api/blocks/reorder` | `{ items: [{ id, parentId }, ...] }` in the desired display order |
| `GET /api/publish/status` | `{ publishedAt, isDirty, pdfStale, pdfVersion }` |
| `POST /api/publish` | snapshot the draft to the public site and re-render the PDF |
| `POST /api/discard-draft` | restore the draft from the last published snapshot |
| `GET /api/resumes` | every resume, default first: `{ id, slug, name, isDefault, isPublic, hostnames, createdAt, updatedAt, publishedAt, isDirty, pdfStale }` |
| `POST /api/resumes` | `{ name, slug?, copyFrom? }` → a new private, unpublished resume. With `copyFrom` (a resume id) it starts as a copy of that resume's draft; without it, with the default resume's header and site settings and no blocks. `slug` (lowercase letters, digits and dashes) defaults to one made from the name; a taken one is a 409 |
| `GET /api/resumes/:id` | one resume, same shape as the list |
| `PATCH /api/resumes/:id` | any of `{ name, slug, isPublic, isDefault: true, hostnames }`. Only a published resume can become the default, the default is always public, and there's no un-defaulting: make another resume the default instead. `hostnames` replaces the resume's domains (see [Showing a resume on its own domain](#showing-a-resume-on-its-own-domain)): giving it any makes it public, making it private removes them, and a domain another resume has is a 409 |
| `DELETE /api/resumes/:id` | delete a resume with its blocks, settings, domains and PDF; the default can't be deleted (409) |
| `GET /api/resumes/:id/resume.pdf` | download any resume's last rendered PDF, private ones included |
| `/api/resumes/:id/…` | every editor route in this table (`header`, `site`, `blocks…`, `publish…`, `discard-draft`, `ai/rewrite`) for that resume. The unprefixed ones act on whichever resume is the default |
| `GET /api/ai/settings` | AI rewrite settings: provider, models, `allowBulletRestructure`, `tense` (with `tenses`, its options), the custom-block tense picker's `pickedTenseTypes`, `pickedTenses`, and `pickedTenseDefault`, `timeoutSeconds`, and per-provider `{ hasKey, hint }` — never the key itself |
| `PUT /api/ai/settings` | `{ enabled?, provider?, models?, allowBulletRestructure?, tense?, timeoutSeconds?, apiKeys?, removeKeys?, currentPassword? }` — `currentPassword` is required when adding or removing a key |
| `POST /api/ai/rewrite` | `{ blockId, data, instruction, target?, tense? }` → `{ proposal }` for review; saves nothing. `target` narrows the rewrite: `{ kind: 'block' }` (default), `{ kind: 'description' }` (experience), `{ kind: 'bullet', path: [i] \| [i, j] }` (experience), or `{ kind: 'item', index }` (custom); one that doesn't fit the block is a 400. `tense` (`auto`, `past`, or `present`) is only accepted for custom blocks and defaults from the tense setting |
| `GET /api/public/resume?mode=web\|print` | public, the published version of the resume this domain shows (the default, unless the request's host is one of another resume's `hostnames`), filtered by the matching visibility flag, plus the snapshot's `publishedAt` and the current `pdfVersion` |
| `GET /api/public/resume.pdf` | public, streams that same resume's last rendered PDF (any query string, e.g. the client's `?v=<pdfVersion>`, is ignored) |
| `GET /api/public/resumes/:slug?mode=web\|print` | public, the same for a resume by its link name; 404 unless that resume is public and published. Sent with `X-Robots-Tag: noindex` |
| `GET /api/public/resumes/:slug/resume.pdf` | public, its PDF, on the same terms |
| `POST /mcp` | [MCP server](#mcp-server) endpoint (Streamable HTTP, JSON responses); bearer-token gated, 404 when `RESUMECMS_MCP_TOKEN` is unset |

## MCP server

The server can expose the editor's capabilities as [MCP](https://modelcontextprotocol.io)
tools, so Claude Code, Claude Desktop, or any other MCP client can read and
edit your resume conversationally ("tighten the bullets on my last job and
publish"). It's off by default: set `RESUMECMS_MCP_TOKEN` to a random string
of at least 32 characters and restart, and `POST /mcp` comes alive. The
endpoint speaks Streamable HTTP in stateless mode (one JSON response per
request, no SSE, nothing for a reverse proxy to buffer), and every request
must carry `Authorization: Bearer <token>`.

Connect from Claude Code:

```bash
claude mcp add --transport http resumecms https://your-host/mcp \
  --header 'Authorization: Bearer ${RESUMECMS_MCP_TOKEN}'
```

(`${VAR}` is expanded by Claude Code when it loads the config, so keep the
single quotes; `--scope user` makes it available in every project.) Other
clients take the equivalent JSON:

```json
{ "type": "http", "url": "https://your-host/mcp", "headers": { "Authorization": "Bearer <token>" } }
```

Everything the tools write goes to the **draft**, exactly like the editor;
nothing is visible on the public site or PDF until `publish` is called.

Every tool below except `get_block_schemas` and the resume tools takes an
optional `resumeId` (an id from `list_resumes`): without it, it works on the
default resume, the one your main domain shows; with it, on that resume
("copy my resume as Sales, rewrite it for account executive roles, and
publish it"). An unknown `resumeId` is a `[404] Resume not found`.

| Tool | What it does |
|---|---|
| `get_block_schemas` | documents each block type's `data` shape plus the header and site-settings objects (`type` narrows it to one block type); the documented block keys are type-checked on write, so a wrong-kind value (`bullets` as a string) is a 400 |
| `get_draft` | the whole draft in one call: `{ header, site, blocks }` in display order, hidden blocks included |
| `list_blocks`, `get_block` | draft blocks in display order / one block by id |
| `create_block` | `{ type, data?, parentId? }` — appended to the end of its sibling group |
| `update_block` | `{ id, data?, replaceData?, visibleWeb?, visiblePrint?, parentId? }` — `data` is **merged** key by key (a `null` value removes a key, so a literal `null` can't be stored this way; arrays such as `bullets` are replaced whole); `replaceData: true` replaces the object, matching `PUT /api/blocks/:id` |
| `move_block` | `{ id, parentId?, beforeId? \| afterId? \| index? }` — repositions one block (a heading brings its children); omit `parentId` to stay put, `null` promotes to top level |
| `delete_block` | deletes a block; a heading's children are promoted, not deleted |
| `reorder_blocks` | `{ items: [{ id, parentId? }] }` — the complete order, every block once; an omitted `parentId` means top level |
| `get_header`, `update_header` | read / merge keys into the header (`links` is replaced whole) |
| `get_site_settings`, `update_site_settings` | read / merge keys into site settings (`colors` merges one level deep) |
| `get_publish_status` | `{ publishedAt, isDirty, pdfStale, pdfVersion }` — `pdfVersion` identifies the PDF file on disk (null if none); `pdfStale` means the PDF on disk wasn't rendered from the current published snapshot (a publish whose PDF render failed); the next successful `publish` clears it |
| `publish` | snapshot the draft to the public site and re-render the PDF (takes a few seconds) |
| `discard_draft` | restore the draft from the last published snapshot |
| `get_published_resume` | the published snapshot as the site (`mode: "web"`) or PDF (`"print"`) sees it |
| `list_resumes`, `get_resume` | every resume (the default first) / one, by `resumeId`, with its slug, visibility, domains and publish status, as `GET /api/resumes` returns them |
| `create_resume` | `{ name, slug?, copyFrom? }` — a new private, unpublished resume; `copyFrom` copies that resume's draft |
| `update_resume` | `{ resumeId, name?, slug?, isPublic?, isDefault?, hostnames? }` — send only what changes, with the same rules as `PATCH /api/resumes/:id` (`hostnames` replaces the list and makes the resume public; only a published resume can become the default) |
| `delete_resume` | `{ resumeId }` — deletes a resume with its blocks, domains and PDF; the default can't be deleted |

Tool errors carry the same status the REST API would return, e.g.
`[404] Block not found`.

Security notes: the token grants full editor access (everything but
changing the login and 2FA), so treat it like the password and only expose
`/mcp` over HTTPS. There's no login-style rate limiting on `/mcp` — a
limiter keyed on the client IP would let a stranger lock you out from
behind a shared proxy — which is why the token must be long and random; a
shorter one is logged and ignored. The token is read once at startup and
never logged. Every rejected attempt (`"event":"mcp_auth_failed"`, with the
client address as `ip` — the real client once `RESUMECMS_TRUST_PROXY` is
set, otherwise your proxy's own address — plus the `X-Forwarded-For`
header as received as `forwardedFor`) and every tool call
(`"event":"mcp_tool"`, with the tool name, the `resumeId` it named if any,
outcome and duration) is written
to the same JSON log as requests, so `docker compose logs | grep mcp_`
shows exactly what a client did with the token. To revoke a token, change `RESUMECMS_MCP_TOKEN` and restart
the container. If a client reports an OAuth or discovery error against
`/mcp`, the token is wrong (the server answers 401, and some clients then go
looking for an OAuth server that doesn't exist). `publish` runs Chromium, so
keep any proxy read timeout above the time a render takes (a render is
given up on after 90 seconds, which leaves the site published and the PDF
marked out of date).

To poke at it by hand (MCP requires both `Accept` types):

```bash
curl -s -X POST https://your-host/mcp \
  -H "Authorization: Bearer $RESUMECMS_MCP_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Logging and security

Every request is logged to stdout as one JSON line (method, URL, status,
response time, IP, referrer, user agent) — `docker compose logs` (or
whatever log driver you point Docker at) captures it, and it pipes cleanly
into `jq` for filtering. No separate log file or aggregation stack is
needed for a single-instance deployment.

`POST /api/auth/login` is rate-limited to 10 failed attempts per IP per
15 minutes (successful logins don't count against the limit) to slow down
password brute-forcing. Set `RESUMECMS_CAPTCHA_PROVIDER` to `turnstile` or
`recaptcha` (with the matching site/secret key pair, see above) to also
require solving a captcha before the password is even checked — the login
form loads the provider's widget dynamically and the server verifies the
token server-side on every attempt. Leaving it unset disables the captcha
entirely; rate limiting alone still applies either way.

If you run this behind a reverse proxy, set `RESUMECMS_TRUST_PROXY` so
rate limiting (and the access log) keys on the real client IP instead of
the proxy's — otherwise every visitor shares one rate-limit bucket. Set it
to the proxy's address as the container sees it (with Docker port
publishing that's usually the bridge gateway, e.g. `172.18.0.1`; the
`ip` field in the access log shows it), or to Express's named subnets like
`loopback` / `uniquelocal`.

Only trust a proxy you actually control: whatever you trust can set
`X-Forwarded-For` to anything, letting a client spoof its way around the
limit. The value is trusted exactly as written — the server doesn't judge
whether a range is too broad, so list only your proxy's own address or
subnet. Startup fails, with an error naming the variable, if the value
is `true` (which trusts everyone), mixes a hop count into an address list
(e.g. `1, loopback` — Express would read the `1` as the address
`0.0.0.1`), or is anything else Express can't parse. Two caveats:

- **Hop counts** (e.g. `1`) trust whatever connects directly, so they're
  only safe if the app port can't be reached except through the proxy,
  and the count must match the real number of proxies — a larger one
  trusts client-supplied entries too.
  The compose file publishes `4000:4000` on all interfaces, so with it as
  shipped, someone who connects straight to port 4000 can fake their IP.
- **The Docker gateway address** is also the source of anything Docker's
  userland proxy forwards — IPv6 clients, and processes on the host
  itself — so those can spoof the header too. It can also change if the
  compose network is recreated, which silently puts everyone back in one
  bucket. To close both, publish the port on loopback only
  (`'127.0.0.1:4000:4000'`) so only a proxy on the same host can reach it.

### Showing a resume on its own domain

A public resume can be given one or more domains (`hostnames` in `PATCH
/api/resumes/:id`). A request whose host is one of them gets that resume
at `/` and `/api/public/resume.pdf`; any other host gets the default.
Domains are stored lowercase, without a port or trailing dot, and can't
be wildcards. A domain mapped to a resume that hasn't been published yet
keeps showing the default until it is.

A domain isn't a way to keep a resume private: anyone can send any `Host`
header straight to the server. So giving a resume a domain makes it
public, and making it private removes its domains.

For each domain:

1. **DNS:** point it at the same place as the main site (with Cloudflare,
   a proxied record; Universal SSL covers first-level subdomains).
2. **Reverse proxy:** route it to the same backend, and keep the client's
   `Host` header. If the proxy's TLS certificate is per domain (e.g. a
   Cloudflare Origin Certificate), check that it covers the new one.
3. **Check the app sees it:**
   `curl -H 'Host: sales.example.com' http://127.0.0.1:4000/api/public/resume`
   should return the mapped resume. With `RESUMECMS_TRUST_PROXY` set, the
   app reads the host from the trusted proxy's `X-Forwarded-Host` instead,
   when it sends one.

Do your editing from the main domain: the login session is per host, and
the editor's unprefixed routes always edit the default resume, whichever
domain they're called on. The editor's **Resume settings** shows a
resume's domain as its link once it has one.

A resume's own link (`/r/<link name>`, its JSON and its PDF) is sent with
`X-Robots-Tag: noindex`, and nothing links to it, so only the default and
resumes with a domain of their own are meant to show up in search.

### Caching and CDNs

The server states a cache policy on everything the public can fetch, so a
Publish shows up on the next page load instead of whenever a cache feels
like it. `/api/public/resume` and the HTML shell are sent with
`Cache-Control: no-cache` (always revalidate; unchanged content is a cheap
`304`), the PDF with `private, no-cache` (never stored by a shared cache),
and the hashed bundles under `/assets/` as `immutable` for a year. The
public page also refetches when it comes back into view, and the PDF link
carries a `pdfVersion` (the rendered file's timestamp) as a query string so
each render is a URL no cache has seen before.

If you put a CDN in front of the app, let those headers through. Cloudflare
in particular caches `.pdf`, `.js`, and `.css` by file extension and, with
a zone-wide *Browser Cache TTL* set, used to overwrite the previous
`max-age=0` with hours of caching — which is exactly how an old PDF kept
appearing after a publish. `private` and `no-cache` are respected by
default, but if your CDN has a "cache everything" or TTL-override rule, add
a bypass for `/api/*`. No purge-on-publish is needed once the headers are
respected.

### Two-factor authentication (TOTP)

From the editor's "Two-Factor Authentication" panel you can enable
app-based 2FA (Google Authenticator, 1Password, Authy, etc.): it shows a QR
code (and the raw key as a manual-entry fallback) and asks you to confirm
with a code before turning enforcement on. Once enabled, login requires
that code in addition to the username and password. It's stored in the
same SQLite database as your content, not in an env var — nothing to
configure ahead of time, and it's off by default.

**If you lose access to your authenticator app**, there's no in-app
recovery (turning 2FA off requires being logged in). Recover by deleting
the `totp` row directly from the settings table on the host running the
container:

```bash
sqlite3 /path/to/your/data-dir/resume.sqlite3 "DELETE FROM settings WHERE key='totp';"
```

This immediately disables the code requirement on next login.

### AI rewrites

Optional and off by default. In Account Settings → AI Rewrites, pick
Claude (Anthropic) or ChatGPT (OpenAI), paste an API key, and enable it.
Each rewritable block (headings, summary, skills rows, experience entries,
custom blocks) then gets a "Rewrite with AI" button. You give it an
instruction, or pick a preset such as *Tighten* or *Quantify impact*, and
review the result before anything is saved. The review shows a word-level
diff in the block and the rewritten block, outlined, in the live preview.
**Accept** saves it as an ordinary draft edit; it still isn't public until
you Publish.

Parts of a block can also be rewritten on their own:

- Each experience bullet, and each sub-bullet, has a ✨ button that
  rewrites just that bullet (a bullet's sub-bullets come with it). The
  rest of the entry is sent as read-only context so the rewrite stays
  consistent with its neighbors, and nothing else in the entry changes.
- The experience description has its own "Rewrite description with AI"
  button (or "Write description" when it's empty). The entry's main button
  becomes "Rewrite tagline and bullets with AI" and never changes the
  description, whatever the AI returns. Likewise, a bullet rewrite never
  changes the description.
- Each item in a custom block has a ✨ button that rewrites just that item.

Several rewrites can be open at once, on different blocks or on different
parts of one block. The preview shows all of them together, each one is
accepted or discarded in its own panel, and **Discard all** in the preview
banner clears them. A rewrite only warns that it's out of date when the
part it rewrites has changed since. An open rewrite follows its bullet or
item when you drag it, or delete or add one above it. Once you edit the
description, bullet, or item a rewrite is for, the rewrite stays open with
the warning but drops out of the preview, and its panel says so. A bullet
rewrite is also left out of the preview while a rewrite that may add,
remove, or reorder that block's bullets is open. The ✨ button on a bullet
or item collapses and reopens its panel; collapsing doesn't discard the
rewrite.

- Only the block's prose is sent and can change. Dates, URLs,
  company/institution names, visibility flags, and block styling are
  always kept from the original. Education blocks aren't rewritable.
  Your header and contact details are never sent.
- Bullets hidden from web or print **are** sent along with the rest of
  their block, so the AI can rewrite them too. The rewrite panel says how
  many hidden bullets a block has before you send it. Don't rely on
  hiding a bullet to keep its text away from the provider.
- The AI is told not to invent facts. Where a number would help, it
  inserts a placeholder like `[X%]` for you to fill in.
- The description's rewrite panel has a *Write description* preset, which
  drafts the optional description from the entry's own tagline and
  bullets. If the entry already has a description, the preset is *Rewrite
  description*. An empty description stays empty unless you ask for one.
  The description has no visibility toggle and always shows, so the AI is
  told not to use anything from hidden bullets in it (or in the tagline,
  for the same reason). A single-bullet rewrite is likewise told not to
  carry a hidden bullet's content into a visible bullet. Check the review
  before accepting.
- **Let AI add, remove, or merge bullets** (off by default) controls
  experience bullets. When it's off, the AI may only reword bullets in
  place. When it's on, the AI can restructure them, and each resulting
  bullet keeps the web/print visibility of the original it most
  resembles. New top-level bullets start visible everywhere, and new
  sub-bullets start with their parent bullet's visibility. The review marks
  added, removed, and hidden bullets. The AI is told not to merge a hidden
  bullet's content into a visible one. "Visibility of the original" means
  where it actually showed: a sub-bullet of a hidden bullet was never shown,
  so it stays hidden even if the AI promotes it to a top-level bullet, and
  it keeps those hidden flags as its own afterwards (un-hiding the parent
  later won't un-hide it). For a single-bullet rewrite the setting applies
  to that bullet's sub-bullets; the bullet itself always keeps its own
  visibility.
- **Verb tense** (default *Let the AI decide*) adds one line to the prompt
  for experience entries, so rewrites stop drifting between "Led" and
  "Lead". *Past tense* and *Present tense* always ask for that tense, and
  *By role* picks per entry (below). In present tense, bullets drop the
  implied "I" ("Lead a team", not "Leads a team"), and full sentences keep
  their subject. In past tense, statements of who you are ("Engineer with
  ten years of experience") stay as they are. The AI uses the tense in
  whatever it writes or rewrites for your instruction, but leaves text the
  instruction doesn't touch alone: fixing one typo won't retense the whole
  entry. To convert an entry, ask for it, for example "Put this in the
  past tense". A tense named in the instruction always overrides the
  setting.
- *By role* applies only to experience entries, and reads the End date, or
  the end of it if you typed a range ("Dec 2023 – Present", "2019-2021",
  "Jan 2020 to Dec 2023"). A spaced dash always starts a range, so "Mar –
  2026" is read as 2026. A final period is ignored. Present tense when it
  is a word like "Current", "Present", "Till date", or "Today", or a few
  common non-English ones, possibly with a qualifier ("Present day") or a
  note on the kind or length of the job, in brackets or after a comma,
  "·", or "|" ("Present (contract)", "Present · 2 yrs"), or after a date
  ("Jan 2022 to Present"). Past tense when it is a real calendar date from
  1900 on that is over: a year, optionally with a month number or an
  English, German, French, Spanish, Italian, or Portuguese month name
  ("2024", "Mar 2024", "Mar-2024", "März 2024", "Mar '24", "03/2024",
  "2024-03-31"). A date like "12/01/2024" that reads either way counts as
  over only when both readings are. Anything else gets no tense
  instruction rather than a guess: a blank End date, an open range ("Dec
  2023 –"), a range that starts with a current word ("Present – 2021"), a
  year, month, or day not over yet, counting the day after it too since
  your day may differ from the server's ("2026" until 2 January 2027, "Dec
  2027"), an impossible date ("2024-02-31"), an End date over 100
  characters, or other text ("TBD", "Since 2021", "Spring 2024", "Present,
  resigned"). Other blocks get none either.
- Custom blocks, which can hold anything from awards to a current side
  project, pick a tense for each rewrite in a menu next to their Rewrite
  button: *Any tense*, *Past tense*, or *Present tense*. It starts at the
  setting when that is *Past tense* or *Present tense*, and at *Any tense*
  otherwise. Summaries, headings, and skills rows get no tense
  instruction. A custom item's ✨ rewrite has the same menu.
- The default models are `claude-opus-5-5` and `gpt-5.6`. Change them in
  the same panel. Rewrites are rate-limited to 30 per 10 minutes.
- **Timeout** (default 60 seconds, 20–120) is how long a rewrite may take,
  including one automatic retry, before the server gives up on the
  provider. If you run behind a reverse proxy, keep it below the proxy's
  read timeout so you get the real error instead of the proxy's.

API keys are stored in plain text in the same SQLite database, like the
TOTP secret, so anyone with a copy of your data directory has them. The
API never sends a key back to the browser, only its last four
characters. Adding or removing a key requires your current password.

## What's intentionally out of scope (v1)

- Multi-user auth — this is single-account, single-tenant by design (one username/password pair, with optional TOTP 2FA).
- Image/photo uploads — add them as a future block type if you need them.
- Rich text formatting inside bullets/body text (currently plain text).
- Undo/version history.

## Design notes

The editor UI is a two-pane layout: your block list on the left, a live
preview on the right that dims any block hidden from web and/or print so you
can see the effect of a toggle immediately. The resume itself renders in a
serif built for reading on paper (Source Serif 4); the editor chrome uses a
plain grotesk sans (IBM Plex Sans) so the tool never gets mistaken for the
document.
