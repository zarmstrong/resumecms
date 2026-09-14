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
