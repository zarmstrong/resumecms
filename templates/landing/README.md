# Landing page templates

A landing page template (issue #93) arranges the optional home page at `/`:
its hero (photo, availability line, headline, subheadline, buttons) and its
sections. The landing editor's **Look** group lists every folder here; the
draft's `template` names one, and an unknown or missing id is drawn as
`classic`, which must always exist. Templates are found at build time
(`import.meta.glob` in
[`client/src/resume/templateRegistry.js`](../../client/src/resume/templateRegistry.js)),
so adding a folder is enough: there's no registration step, and the server
never scans this folder.

Every template here, and any you add, meets [the accessibility
bar](#the-accessibility-bar) below.

## Making one

`templates/landing/<id>/`, `<id>` lowercase kebab-case:

- `template.json`, required: `{ "label", "description", "author" }`, all
  non-empty strings, plus an optional `"columns": true` (see `index.jsx`).
  No other key is allowed.
- `style.css`, required. Every rule is scoped under `.l-template-<id>`:
  the page root carries that class (`<div class="l-page
  l-template-<id>">`), and every template's stylesheet is in the bundle at
  once, so an unscoped rule would restyle the others. The validator checks
  the class appears.
- `index.jsx`, optional (see below).

### What's shared, and what's yours

[`client/src/landing/landing.css`](../../client/src/landing/landing.css)
holds the look of each part (a button, a card, a quote, the timeline, an
FAQ entry, the gallery's view) and never the arrangement. Your `style.css`
arranges them (the column, the hero, the grids) and may restyle them.
`classic` is the page as it was before templates, moved out of
`landing.css` unchanged.

[`LandingView.jsx`](../../client/src/landing/LandingView.jsx) draws every
part. It renders the page root, and inside it the hero as `<header
class="l-hero">` and each section as `<section class="l-section
l-section-<kind>">` with its title as `<h2 class="l-section-title">` (a
divider is a `<div>` holding a `role="separator"` rather than a section).
A template only arranges what it's handed, so it draws every section kind
there is, now and later, without knowing them. Don't hide a kind, and when
a new kind lands, check it in every template.

Colors come from the page's palette as custom properties, the light ones
or the dark ones (under the visitor's `prefers-color-scheme: dark`,
`.l-dark-auto`, or the editor's dark preview, `.l-dark-on`):

| Property | What it is |
| --- | --- |
| `--r-accent`, `--r-heading`, `--r-text`, `--r-bg` | the four colors |
| `--r-on-accent` | text on a fill of `--r-accent`: white or near-black, whichever reads better ([`contrastTextFor()`](../../client/src/resume/siteColors.js)) |
| `--r-accent-hover-mix` | what to mix into the accent for a hover, away from `--r-on-accent` |
| `--font-resume`, `--r-name-font`, `--r-font-size` | the page's fonts and size |

Use them, never fixed colors, so a template follows any palette, the dark
one included. A tint is `color-mix(in srgb, var(--r-accent, var(--ink))
12%, var(--r-bg, var(--panel)))` or the same over `transparent`.

Size the page with container queries rather than media queries: set
`container-type: inline-size` on `.l-template-<id>` and use `@container
(max-width: …)`, so the editor's narrower preview shows what a phone
would. (`classic` keeps its original `@media` query.)

### `index.jsx`

Only for a template that changes the page's structure, like `split`, which
puts the hero in a side column. It default-exports a component:

```jsx
export default function MyLanding({ landing, renderHero, renderSection, dropStrayDividers, colors, darkColors, preview }) {
  return (
    <main className="l-main">
      {renderHero()}
      {landing.sections.map(renderSection)}
    </main>
  );
}
```

- `landing`: the resolved page (`headline`, `sections`, …). Read it to
  decide where things go, but draw them with the two functions below.
- `renderHero()`: the hero. `renderSection(section, index)`: one section.
- `dropStrayDividers(sections, { atStart })`: only with `"columns": true`.
  Such a template splits the sections on `section.column === 'side'` and
  passes each column through this, `atStart` true when something sits
  above the column, so it draws only the dividers it has something to
  divide. Without `columns` the list comes already tidied, and `column` is
  ignored.
- `colors`, `darkColors`: the normalized palettes (`darkColors` null when
  the page has none).
- `preview`: true in the editor, where hidden sections are drawn dimmed
  (`.l-section-hidden`) and stray dividers labeled.

Without an `index.jsx`, the snippet above is what's rendered. Import shared
helpers through the `@resume` alias (`@resume/safeUrl.js`), since this
folder is outside `client/src`.

## The accessibility bar

Every landing template meets all of this, with the shared `landing.css`
under it. The validator checks the two parts a linter can see; the rest is
checked by hand (and by the reviewer, whose checklist lists the same bar).

1. **AA text contrast against the template's own tints**, with the default
   palette and a dark palette. Text is at least 4.5:1 against what it's
   drawn on, 3:1 for large text (24 px, or 18.66 px bold) and for the
   parts of a control you need to see (a focus ring, a button's outline).
   "What it's drawn on" includes every tint the template adds, stacked:
   an accent tint on a tinted panel is darker than one on the background,
   and text faded with `opacity` or a `color-mix()` toward the background
   counts at its faded color. Check both palettes:

   | Palette | accent | heading | text | background |
   | --- | --- | --- | --- | --- |
   | default (`DEFAULT_SITE_COLORS`) | `#2f6f4e` | `#14181c` | `#14181c` | `#ffffff` |
   | dark (`DEFAULT_DARK_COLORS`) | `#7cc4a0` | `#f2f4f6` | `#d5dbe1` | `#15191d` |

   The tightest pair in the shared look is accent text on the background
   (5.99:1 light). A tint takes it down: 12% of the accent over the
   background leaves accent text at 5.07:1, the same over `split`'s 9%
   panel at 4.49:1 (below AA, so `split` tints those tags over the
   background instead), and `bold`'s 18% band at 4.64:1, which is why
   `bold` draws no accent text at all.
2. **No text on the accent unless it uses the on-accent variables.** The
   person picks the accent, so it can be any color. Text on an accent fill
   is `--r-on-accent`, never a fixed white or the background color, and a
   hover mixes in `--r-accent-hover-mix` (away from the label, so it keeps
   its contrast). Even that is only the better of white and near-black,
   and on some mid-tone accents neither reaches 4.5:1 (the worst is about
   4.2:1). Text *in* the accent (the shared subheadline, a card's "View
   resume", a stat's figure) is drawn only on the background or a light
   tint of it, where item 1 holds for the default and dark palettes; it
   reads only as well as the person's accent does on their background. A
   template that has to be AA on any accent draws no text in or on it, as
   `bold` does: its primary button is the heading color with the
   background's as its label, and what's accent text elsewhere is in the
   heading or text color. See CLAUDE.md, "Text on a color".
3. **A visible focus ring** on every link, button and `<summary>`. Keep the
   browser's outline or draw your own (`outline: 2px solid …` on
   `:focus-visible`, in a color that passes 3:1 against what's around it).
   Never remove the outline without drawing a replacement in the same rule
   (see [What the validator checks](#what-the-validator-checks)). A resume
   card draws its ring around the whole card on its link's `::after`, in
   `landing.css`; restyle that `::after` rather than repeating the
   pattern. The gallery's `<dialog>` is the one ringless element: it takes
   focus itself when it opens, isn't a control, and its buttons keep
   their rings.
4. **Nothing breaks at 320 px wide or at 200% zoom.** No horizontal
   scrolling, nothing cut off or overlapping, nothing out of reach. 200%
   zoom on a 1280 × 800 screen is a 640 × 400 window, on a 1920 × 1080 one
   960 × 540. The person's own text can hold a word too long for a phone's
   line, so every part that shows it sets `overflow-wrap: anywhere` (or the
   template sets it on its root, as `editorial` and `bold` do), and a grid
   track is `minmax(min(100%, 240px), 1fr)` rather than a bare minimum
   wider than a phone's column. Anything `position: sticky` must fit the
   window it sticks in, or it hides its own end: `split`'s stuck hero
   is never taller than the window (past that it scrolls on its own, with
   room inside for its buttons' focus rings), and stops sticking in a
   window under 640 px tall.
5. **Motion only under `prefers-reduced-motion: no-preference`.** Anything
   that moves (a transform, a change of position or size, an animation,
   `scroll-behavior: smooth`) goes inside `@media (prefers-reduced-motion: no-preference) { … }`, so
   a visitor who asked for less motion never gets it, in any browser. A
   color or a fade may change gradually anywhere, since nothing moves.
   `transition: background` counts as a color although the shorthand
   also covers the background's position and size, so a template mustn't
   change `background-position` or `background-size` on a state it
   transitions that way (the shared `.l-action` transitions `background` for its hover).
   Switching the shared motion off (`transition: none`, `animation: none`,
   `transform: none` on hover) is always allowed.
6. **One `<h1>`, the headline, and section titles as `<h2>`.**
   `LandingView` draws them so (and a publications group's subheading as
   `<h3>`); an `index.jsx` adds no heading of its own and never draws the
   headline twice.

### What the validator checks

`node scripts/validate-templates.mjs` reads each landing template's
`style.css` and fails on:

- **An outline removed without a replacement.** The outline's style and
  width are followed separately through the rule's declarations, since a
  longhand can switch one back while the other stays off (`outline: none;
  outline-width: 2px` still draws nothing). The shorthand sets both, and a
  style it doesn't name is `none` (`outline: 2px red` is off). A rule that
  ends with either one off (`outline: none`, `outline: 0`, `outline-style:
  none`, `outline-width: 0`, or such a value followed by a longhand that
  only sets the other part) passes only if the
  same rule also draws a `box-shadow` (other than `none`) as the ring, or
  every selector in it is limited to `:not(:focus-visible)` (pointer focus
  only, so the keyboard's ring is untouched). A border or background change
  doesn't count: it's too easy to make too faint to see. A transparent
  outline isn't a removal (forced-colors mode still draws it).
- **Motion outside `@media (prefers-reduced-motion: no-preference)`.** Any
  `animation` or `animation-name` that names an animation (`animation:
  none 0s` names none); `scroll-behavior: smooth`; any `transition` or
  `transition-property` that transitions something other than a color
  (`color`, `background`, `background-color`, `border-color` and its sides,
  `outline-color`, `column-rule-color`, `text-decoration-color`,
  `caret-color`, `accent-color`, `fill`, `stroke`), `opacity`,
  `visibility`, `display` or `overlay` for a non-zero duration. The
  rule's transitions are read as CSS pairs them, the n-th property with
  the n-th duration, so `transition: transform 0s` (or a shorthand with
  no time, whose duration is 0s) moves nothing. What a longhand leaves
  unset may come from another rule, so an unknown duration counts as
  non-zero, and a non-zero `transition-duration` in a rule that names no
  property transitions `all` and is flagged. `box-shadow` is flagged
  too, since a shadow's offset can move. The `-webkit-`, `-moz-`, `-o-`
  and `-ms-` forms count as the same properties. A `@media` list's commas
  and a top-level `or` are both an OR, so it's the gate only if every
  alternative has the `no-preference` condition. `none` and the CSS-wide
  keywords (`initial`, `unset`, …) always pass. `@keyframes` blocks aren't
  read.

It's a best-effort lint over a small hand-written CSS reader, not a
full parser, so review still covers what it misses: a value set through
a custom property (`outline: var(--ring)` is taken as drawn), nesting
under a selector list, and strings that contain comment markers.

The validator lints only each template's own `style.css`. The shared
[`landing.css`](../../client/src/landing/landing.css) isn't linted, so its
motion and focus rules are kept by review (its card's ring on `::after`
and the gallery dialog's missing ring would both be flagged if it were).
The validator can't see contrast, layout or headings either: check those
yourself, in both palettes, at 320 px and at 200% zoom, with the editor's
preview and the published page.
