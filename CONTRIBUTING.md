# Contributing

## Dev setup

See the README's [Quickstart](README.md#quickstart-docker) and
[Local development](README.md#local-development-without-docker) sections to
get the app running.

## Templates

Resume templates (header styles, body layouts, and the curated presets
combining them) are the one area of this repo explicitly designed for
outside contribution — see [`templates/README.md`](templates/README.md) for
the full schema and how to preview your work locally.

Quick version:

1. **Just want to remix existing looks?** Add
   `templates/presets/<id>/template.json` — a header id + layout id +
   optional colors/fonts. No code.
2. **Want a new visual style for the body** (not a new arrangement — same
   flat block list, different CSS, like `timeline`/`minimal`/`boxed`)? Add
   `templates/layouts/<id>/template.json` + `style.css`.
3. **Want a genuinely new arrangement** (like `sidebar`'s side-rail split),
   or a new header design? Add `templates/layouts/<id>/` or
   `templates/headers/<id>/` with an `index.jsx` component, following the
   contract in `templates/README.md`.

Before opening a PR:

```bash
node scripts/validate-templates.mjs   # metadata/schema check
cd client && npm run build            # catches broken components
```

Both also run in CI on any PR touching `templates/**`. If your change is
worth a thumbnail for docs, regenerate one via
`docker compose --profile tools run --rm resume-preview` (see
`templates/README.md`) and include it in the PR — this runs in an isolated,
throwaway container and never touches a real deployment's data.

## Everything else

For non-template changes (bug fixes, new block types, editor features,
etc.), open a PR against `main` as usual. There's no formal issue process —
just describe what changed and why, and how you tested it.

A PR can only merge into `main` once CI's `ci-passed` check is green. CI
runs the server tests, the client tests and build, the template
validator, and a Docker build, each only when the PR touches its part.

PRs are squash-merged (the only merge method `main` allows), and the PR
title becomes the commit's title, with the PR's commit messages as its
body, so the title must be a [Conventional Commit](https://www.conventionalcommits.org/),
e.g. `feat: add a cover landing template (#130)` or `fix(pdf): retry a
timed-out render`. CI's `pr-title` check enforces it. Releases are built
from these titles: release-please keeps a release PR open with the next
version and changelog. `feat` makes a minor release, `fix` and `perf` a
patch, and a `!` after the type (or a `BREAKING CHANGE:` footer) a major
one. `docs`, `refactor`, `test`, `build`, `ci`, `chore` and `style`
make no release on their own. Merging the release PR tags the release
and publishes the Docker image (`.github/workflows/release.yml`). The
commits inside a PR can say whatever you like, except a line starting
`BREAKING CHANGE:`, which lands in the squash commit's body and makes a
major release. Run the same locally
first: `npm test` in `server/` and `client/`, and the two commands above
for templates.
