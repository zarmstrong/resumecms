# resume-cms

A self-hosted, single-user resume site + CMS. Drag-and-drop block editor,
per-block visibility control for web vs. print/PDF, and a public resume page
that always matches what you built — because the web page, the browser print
view, and the downloadable PDF all render from the exact same data and the
exact same components.

## What you get

- **`/`** — your public resume page.
- **`/editor`** — password-protected drag-and-drop editor.
- **`/print`** — the print-styled version of the resume (used internally by
  the PDF export; you generally won't visit this directly).
- **Download PDF** — server-generates a real PDF on demand via headless
  Chromium, from the same markup as the print view.

## How content is modeled

Everything below the header is a flat, reorderable list of **blocks**. Every
block — built-in or custom — has the same shape:

```
{ id, type, position, visibleWeb, visiblePrint, data }
```

- `visibleWeb` — show this block on the public `/` page.
- `visiblePrint` — include this block in the browser print view *and* the
  generated PDF (they share the same template, so one flag covers both).

Built-in block types: `heading`, `skills_group`, `experience`, `education`.

**Custom blocks** (`type: "custom"`) are a title plus a list of items, each
with an optional heading and a body. Use these for anything the built-in
types don't cover — certifications, publications, volunteer work, side
projects — without touching any code. They drag, reorder, and toggle
visibility exactly like built-in blocks.

The header (name, title, contact info, links) is a singleton, edited
separately from the block list since a resume only has one.

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
| `RESUMECMS_DATA_DIR` | no | Where the SQLite file lives. Defaults to `/data`. |
| `RESUMECMS_CAPTCHA_PROVIDER` | no | `turnstile` or `recaptcha` to require a captcha on login. Unset disables it. |
| `RESUMECMS_TURNSTILE_SITE_KEY` / `RESUMECMS_TURNSTILE_SECRET_KEY` | if using Turnstile | From the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile). |
| `RESUMECMS_RECAPTCHA_SITE_KEY` / `RESUMECMS_RECAPTCHA_SECRET_KEY` | if using reCAPTCHA | From the [Google reCAPTCHA admin console](https://www.google.com/recaptcha/admin) (v2 "I'm not a robot" checkbox type). |

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
| `GET /api/blocks` | all blocks, unfiltered (editor use) |
| `POST /api/blocks` | create a block: `{ type, data }` |
| `PUT /api/blocks/:id` | update `data`, `visibleWeb`, and/or `visiblePrint` |
| `DELETE /api/blocks/:id` | delete a block |
| `POST /api/blocks/reorder` | `{ orderedIds: [...] }` |
| `GET /api/public/resume?mode=web\|print` | public, filtered by the matching visibility flag |
| `GET /api/public/resume.pdf` | public, generates and streams a PDF |

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

If you run this behind a reverse proxy, set
Express's `trust proxy` setting so rate limiting keys on the real client
IP instead of the proxy's — but only if you actually control that proxy,
since trusting `X-Forwarded-For` blindly lets a client spoof its way
around the limit.

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
