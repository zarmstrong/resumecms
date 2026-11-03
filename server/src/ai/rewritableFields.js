// What an AI rewrite is allowed to change, per block type. Anything not
// handled here — ids, dates, URLs, company/institution names, visibility
// flags, and the `data.style` keys BlockStyleForm writes — is copied from
// the original untouched, whatever the model returns. Like NESTABLE_TYPES in
// routes/blocks.js this is an explicit allowlist: a block type added later
// isn't rewritable until it's deliberately added here. (`education` is left
// out on purpose: every field it has is a fact, not prose.)
export const REWRITABLE_TYPES = new Set(['heading', 'summary', 'skills_group', 'experience', 'custom']);

// Mirrors client/src/resume/bulletUtils.js — bullets nest one level deep,
// and legacy data stored them as plain strings.
const MAX_BULLET_DEPTH = 1;

export function normalizeBullet(bullet, depth = 0) {
  if (typeof bullet === 'string') {
    return { text: bullet, visibleWeb: true, visiblePrint: true, children: [] };
  }
  return {
    text: bullet.text || '',
    visibleWeb: bullet.visibleWeb !== false,
    visiblePrint: bullet.visiblePrint !== false,
    children:
      depth < MAX_BULLET_DEPTH && Array.isArray(bullet.children)
        ? bullet.children.map((child) => normalizeBullet(child, depth + 1))
        : [],
  };
}

// A custom item's prose lives in a different field depending on its body
// type (see client/src/editor/blockForms/CustomForm.jsx). The model only
// ever sees one generic `body` per item; this maps it back.
const CUSTOM_BODY_FIELD = { text: 'text', list: 'items', tags: 'items', link: 'label' };
const bodyField = (item) => CUSTOM_BODY_FIELD[item.bodyType] || 'text';

// Legacy custom items were saved as `{ heading, body }` with no bodyType.
// `body` is dropped so a rewritten item doesn't keep a stale second copy.
function normalizeCustomItem(item) {
  if (item.bodyType) return item;
  const { body, ...rest } = item;
  return { ...rest, bodyType: 'text', text: body };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBulletList = (list, depth = 0) =>
  list === undefined ||
  (Array.isArray(list) &&
    list.every(
      (b) => typeof b === 'string' || (isPlainObject(b) && (depth >= MAX_BULLET_DEPTH || isBulletList(b.children, depth + 1)))
    ));

// Whether `data` has the shape rewriteInput and mergeRewrite expect for its
// type. The rewrite route checks the client's copy of a block with this
// before trusting it over the saved one.
export function hasRewritableShape(type, data) {
  if (!isPlainObject(data)) return false;
  if (type === 'experience') return isBulletList(data.bullets);
  if (type === 'custom') return data.items === undefined || (Array.isArray(data.items) && data.items.every(isPlainObject));
  return true;
}

// Where a bullet actually shows: a sub-bullet is only shown in a mode where
// its parent is too (publicBlocks.js drops a hidden bullet's children with
// it), whatever its own flags say.
function shownFlags(bullet, parentShown = null) {
  return {
    visibleWeb: bullet.visibleWeb && (parentShown ? parentShown.visibleWeb : true),
    visiblePrint: bullet.visiblePrint && (parentShown ? parentShown.visiblePrint : true),
  };
}

const isHidden = (flags) => !(flags.visibleWeb && flags.visiblePrint);

// A bullet as the model sees it. Bullets that don't show in both modes are
// marked, because the tagline and description have no visibility flags of
// their own and always show, so the prompt keeps their content out of them.
// The output schema has no `hidden`, so nothing the model returns can change
// visibility.
function editableBullet(bullet, parentShown = null, depth = 0) {
  const shown = shownFlags(bullet, parentShown);
  const out = { text: bullet.text, ...(isHidden(shown) ? { hidden: true } : {}) };
  if (depth < MAX_BULLET_DEPTH) out.children = bullet.children.map((c) => editableBullet(c, shown, depth + 1));
  return out;
}

// Splits a block's data into what the model may rewrite (`editable`) and
// what it should only read for context (`context`).
export function rewriteInput(type, data = {}) {
  switch (type) {
    case 'heading':
    case 'summary':
      return { editable: { text: data.text || '' }, context: null };
    case 'skills_group':
      return { editable: { category: data.category || '', items: data.items || '' }, context: null };
    case 'experience':
      return {
        editable: {
          tagline: data.tagline || '',
          description: data.description || '',
          bullets: (data.bullets || []).map((b) => editableBullet(normalizeBullet(b))),
        },
        context: {
          jobTitle: data.jobTitle || '',
          company: data.company || '',
          location: data.location || '',
          startDate: data.startDate || '',
          endDate: data.endDate || '',
        },
      };
    case 'custom': {
      const items = (data.items || []).map(normalizeCustomItem);
      return {
        editable: {
          title: data.title || '',
          items: items.map((item) => ({
            heading: item.heading || '',
            body: item[bodyField(item)] || '',
          })),
        },
        context: { itemBodyTypes: items.map((item) => item.bodyType || 'text') },
      };
    }
    default:
      return null;
  }
}

const str = { type: 'string' };
// Both providers' strict structured-output modes require every property to
// be listed in `required` and `additionalProperties: false` on every object.
function obj(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

// Recursive schemas aren't supported by structured outputs, so the two
// bullet levels are spelled out explicitly.
const bulletSchema = obj({ text: str, children: { type: 'array', items: obj({ text: str }) } });

function editableSchema(type) {
  switch (type) {
    case 'heading':
    case 'summary':
      return obj({ text: str });
    case 'skills_group':
      return obj({ category: str, items: str });
    case 'experience':
      return obj({ tagline: str, description: str, bullets: { type: 'array', items: bulletSchema } });
    case 'custom':
      return obj({ title: str, items: { type: 'array', items: obj({ heading: str, body: str }) } });
    default:
      return null;
  }
}

export function outputSchema(type) {
  return obj({ explanation: str, rewrite: editableSchema(type) });
}

// The model returned something that can't be merged back (wrong shape, or a
// structural change it wasn't allowed to make).
export class RewriteShapeError extends Error {}

function requireString(value, field) {
  if (typeof value !== 'string') throw new RewriteShapeError(`AI response is missing "${field}"`);
  return value.trim();
}

// A field the model left alone keeps its stored value exactly. Otherwise the
// trim above would show stray whitespace as a change, and a field the block
// never had would be saved as an empty string.
function rewritten(original, value, field) {
  const next = requireString(value, field);
  return next === String(original ?? '').trim() ? original : next;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new RewriteShapeError(`AI response is missing "${field}"`);
  return value;
}

// Words are runs of letters/digits in any script, with accents folded.
// Chinese and Japanese don't put spaces between words, so each of their
// characters counts as its own token instead of a whole sentence being one.
const tokens = (text) =>
  new Set(
    String(text)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' $& ')
      .match(/[\p{L}\p{N}]+/gu) || []
  );

// Jaccard similarity over word sets — good enough to recognize "the same
// bullet, reworded" without pulling in a dependency.
export function textSimilarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

// Below this, a proposed bullet counts as new rather than a rewording of an
// original one, and starts out visible everywhere.
const MATCH_THRESHOLD = 0.3;

// `shown` is the bullet's effective visibility (see shownFlags). Only
// meaningful for originals; proposed bullets have no flags.
function flatten(bullets, depth = 0, out = [], parentShown = null) {
  for (const bullet of bullets) {
    const shown = shownFlags(bullet, parentShown);
    out.push({ bullet, depth, shown });
    if (bullet.children) flatten(bullet.children, depth + 1, out, shown);
  }
  return out;
}

function proposedBullets(raw) {
  return requireArray(raw, 'bullets').map((b) => ({
    text: requireString(b?.text, 'bullets.text'),
    children: requireArray(b?.children ?? [], 'bullets.children').map((c) => ({
      text: requireString(c?.text, 'bullets.children.text'),
    })),
  }));
}

// Reword-only mode: the structure must come back exactly as it went out, so
// each bullet keeps its own visibility flags by position.
function rewordBullets(originals, proposed) {
  const sameShape =
    proposed.length === originals.length &&
    proposed.every((p, i) => p.children.length === originals[i].children.length);
  if (!sameShape) {
    throw new RewriteShapeError(
      'The AI added or removed bullets, but bullet restructuring is turned off. Try again, or enable it in Account Settings.'
    );
  }
  const review = [];
  const bullets = originals.map((o, i) => {
    review.push({ depth: 0, before: o.text, after: proposed[i].text, wasHidden: isHidden(o), visibleWeb: o.visibleWeb, visiblePrint: o.visiblePrint });
    return {
      ...o,
      text: proposed[i].text,
      children: o.children.map((c, j) => {
        const after = proposed[i].children[j].text;
        const shown = shownFlags(c, o);
        review.push({ depth: 1, before: c.text, after, wasHidden: isHidden(shown), ...shown });
        return { ...c, text: after };
      }),
    };
  });
  return { bullets, review, removed: [] };
}

// Restructure mode: bullets may be added, removed, merged, or reordered, so
// each proposed bullet inherits the effective visibility of the most similar
// unused original (best pairs claimed first). Effective, not its own flags:
// a visible sub-bullet of a hidden bullet was never shown, and must not
// become shown just because the model promoted it to the top level.
// Unmatched proposals are new and visible everywhere; unmatched originals
// are reported as removed.
export function restructureBullets(originals, proposed) {
  const from = flatten(originals);
  const to = flatten(proposed);
  const pairs = [];
  to.forEach((t, ti) =>
    from.forEach((f, fi) => {
      const score = textSimilarity(t.bullet.text, f.bullet.text);
      if (score >= MATCH_THRESHOLD) pairs.push({ ti, fi, score });
    })
  );
  pairs.sort((a, b) => b.score - a.score || a.ti - b.ti);
  const matchOf = new Map();
  const usedFrom = new Set();
  for (const { ti, fi } of pairs) {
    if (matchOf.has(ti) || usedFrom.has(fi)) continue;
    matchOf.set(ti, fi);
    usedFrom.add(fi);
  }

  const review = [];
  let index = 0;
  function build(list, depth) {
    return list.map((p) => {
      const ti = index++;
      const match = matchOf.has(ti) ? from[matchOf.get(ti)] : null;
      const visibleWeb = match ? match.shown.visibleWeb : true;
      const visiblePrint = match ? match.shown.visiblePrint : true;
      review.push({ depth, before: match ? match.bullet.text : null, after: p.text, wasHidden: match ? isHidden(match.shown) : false, visibleWeb, visiblePrint });
      const bullet = { text: p.text, visibleWeb, visiblePrint, children: [] };
      if (p.children) bullet.children = build(p.children, depth + 1);
      return bullet;
    });
  }
  const bullets = build(proposed, 0);
  const removed = from
    .filter((_, fi) => !usedFrom.has(fi))
    .map(({ bullet, depth, shown }) => ({ depth, before: bullet.text, wasHidden: isHidden(shown) }));
  return { bullets, review, removed };
}

// Applies the model's `rewrite` object onto the block's original data,
// touching only the allowlisted fields above. Returns the proposed data plus,
// for experience blocks, a per-bullet review the editor shows before the
// user accepts.
export function mergeRewrite(type, data = {}, rewrite, { allowBulletRestructure = false } = {}) {
  if (!rewrite || typeof rewrite !== 'object') throw new RewriteShapeError('AI response is missing "rewrite"');
  switch (type) {
    case 'heading':
    case 'summary':
      return { data: { ...data, text: rewritten(data.text, rewrite.text, 'text') } };
    case 'skills_group':
      return {
        data: {
          ...data,
          category: rewritten(data.category, rewrite.category, 'category'),
          items: rewritten(data.items, rewrite.items, 'items'),
        },
      };
    case 'experience': {
      const originals = (data.bullets || []).map((b) => normalizeBullet(b));
      const proposed = proposedBullets(rewrite.bullets);
      const { bullets, review, removed } = allowBulletRestructure
        ? restructureBullets(originals, proposed)
        : rewordBullets(originals, proposed);
      return {
        data: {
          ...data,
          tagline: rewritten(data.tagline, rewrite.tagline, 'tagline'),
          description: rewritten(data.description, rewrite.description, 'description'),
          bullets,
        },
        bulletReview: { items: review, removed },
      };
    }
    case 'custom': {
      const originals = (data.items || []).map(normalizeCustomItem);
      const proposed = requireArray(rewrite.items, 'items');
      if (proposed.length !== originals.length) {
        throw new RewriteShapeError('The AI changed the number of items in this section. Try again.');
      }
      return {
        data: {
          ...data,
          title: rewritten(data.title, rewrite.title, 'title'),
          items: originals.map((item, i) => ({
            ...item,
            heading: rewritten(item.heading, proposed[i]?.heading, 'items.heading'),
            [bodyField(item)]: rewritten(item[bodyField(item)], proposed[i]?.body, 'items.body'),
          })),
        },
      };
    }
    default:
      throw new RewriteShapeError(`${type} blocks can't be rewritten`);
  }
}
