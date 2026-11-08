// What an AI rewrite is allowed to change, per block type. Anything not
// handled here — ids, dates, URLs, company/institution names, visibility
// flags, and the `data.style` keys BlockStyleForm writes — is copied from
// the original untouched, whatever the model returns. Like NESTABLE_TYPES in
// routes/blocks.js this is an explicit allowlist: a block type added later
// isn't rewritable until it's deliberately added here. (`education` is left
// out on purpose: every field it has is a fact, not prose.)
export const REWRITABLE_TYPES = new Set(['heading', 'summary', 'executive_summary', 'skills_group', 'experience', 'custom']);

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

// What part of a block a rewrite is aimed at. `block` (the default) is the
// whole block, except that an experience block's description is left out:
// it has its own `description` target, so asking for better bullets can
// never reword it and vice versa. `bullet` is one experience bullet by index
// path ([i] for a bullet and its sub-bullets, [i, j] for one sub-bullet);
// `item` is one custom-section item. Only the target is editable; the rest
// of the block goes to the model as read-only context.
export const BLOCK_TARGET = Object.freeze({ kind: 'block' });

// The request named a target that doesn't fit the block (wrong type, or a
// bullet or item that isn't there). The route turns this into a 400.
export class InvalidTargetError extends Error {}

// A stable string per target, for keying proposals. Mirrored client-side in
// client/src/editor/aiReview.js.
export function targetKey(target) {
  switch (target?.kind) {
    case 'description':
      return 'description';
    case 'bullet':
      return `bullet:${target.path.join('.')}`;
    case 'item':
      return `item:${target.index}`;
    default:
      return 'block';
  }
}

const isIndex = (n) => Number.isInteger(n) && n >= 0;

// Checks a request's target against the block it's for and returns a clean
// copy (no stray keys). A missing target means the whole block.
export function normalizeTarget(type, data = {}, target) {
  if (target === undefined || target === null) return { ...BLOCK_TARGET };
  if (!isPlainObject(target)) throw new InvalidTargetError('target must be an object');
  switch (target.kind) {
    case 'block':
      return { ...BLOCK_TARGET };
    case 'description':
      if (type !== 'experience') throw new InvalidTargetError(`${type} blocks have no description to rewrite`);
      return { kind: 'description' };
    case 'bullet': {
      if (type !== 'experience') throw new InvalidTargetError(`${type} blocks have no bullets to rewrite`);
      const { path } = target;
      if (!Array.isArray(path) || path.length < 1 || path.length > MAX_BULLET_DEPTH + 1 || !path.every(isIndex)) {
        throw new InvalidTargetError('A bullet target needs a path of [bullet] or [bullet, sub-bullet] indexes');
      }
      const bullets = Array.isArray(data.bullets) ? data.bullets.map((b) => normalizeBullet(b)) : [];
      const parent = bullets[path[0]];
      if (!parent || (path.length === 2 && !parent.children[path[1]])) {
        throw new InvalidTargetError('That bullet no longer exists. Reload and try again.');
      }
      return { kind: 'bullet', path: [...path] };
    }
    case 'item': {
      if (type !== 'custom') throw new InvalidTargetError(`${type} blocks have no items to rewrite`);
      const count = Array.isArray(data.items) ? data.items.length : 0;
      if (!isIndex(target.index) || target.index >= count) {
        throw new InvalidTargetError('That item no longer exists. Reload and try again.');
      }
      return { kind: 'item', index: target.index };
    }
    default:
      throw new InvalidTargetError('Unknown rewrite target');
  }
}

// Stands in for the targeted bullet or item in the context, so the model
// sees where it sits without being handed a second, read-only copy of it.
const TARGET_PLACEHOLDER = '[the part being rewritten]';

// Whether `data` has the shape rewriteInput and mergeRewrite expect for its
// type. The rewrite route checks the client's copy of a block with this
// before trusting it over the saved one.
export function hasRewritableShape(type, data) {
  if (!isPlainObject(data)) return false;
  if (type === 'experience') return isBulletList(data.bullets);
  if (type === 'custom') return data.items === undefined || (Array.isArray(data.items) && data.items.every(isPlainObject));
  if (type === 'executive_summary') {
    return data.highlights == null || (Array.isArray(data.highlights) && data.highlights.every((h) => typeof h === 'string'));
  }
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

function experienceInput(data, target) {
  const facts = {
    jobTitle: data.jobTitle || '',
    company: data.company || '',
    location: data.location || '',
    startDate: data.startDate || '',
    endDate: data.endDate || '',
  };
  const normalized = (data.bullets || []).map((b) => normalizeBullet(b));
  const bullets = normalized.map((b) => editableBullet(b));
  const tagline = data.tagline || '';
  const description = data.description || '';
  switch (target.kind) {
    case 'description':
      return { editable: { description }, context: { ...facts, tagline, bullets } };
    case 'bullet': {
      const [i, j] = target.path;
      const placeholder = { text: TARGET_PLACEHOLDER };
      const bullet =
        j === undefined
          ? bullets[i]
          : editableBullet(normalized[i].children[j], shownFlags(normalized[i]), MAX_BULLET_DEPTH);
      const others = bullets.map((b, k) => {
        if (k !== i) return b;
        if (j === undefined) return placeholder;
        return { ...b, children: b.children.map((c, m) => (m === j ? placeholder : c)) };
      });
      return { editable: { bullet }, context: { ...facts, tagline, description, bullets: others } };
    }
    default:
      return { editable: { tagline, bullets }, context: { ...facts, description } };
  }
}

const customItemInput = (item) => ({ heading: item.heading || '', body: item[bodyField(item)] || '' });

// A stored custom item as { heading, body }, whatever its body type (and
// legacy shape). For prompts that read a custom section as context, like
// a cover letter's (letterWriting.js).
export const customItemProse = (item) => customItemInput(normalizeCustomItem(item));

// An executive summary's highlights as the model sees them: the editor's
// one-per-line textarea can leave blank entries, which render as nothing.
const highlightList = (highlights) =>
  (Array.isArray(highlights) ? highlights : []).map((h) => String(h ?? '').trim()).filter(Boolean);

// Splits a block's data into what the model may rewrite (`editable`) and
// what it should only read for context (`context`). `target` must already
// be normalized (normalizeTarget).
export function rewriteInput(type, data = {}, target = BLOCK_TARGET) {
  switch (type) {
    case 'heading':
    case 'summary':
      return { editable: { text: data.text || '' }, context: null };
    case 'executive_summary':
      return {
        editable: { headline: data.headline || '', text: data.text || '', highlights: highlightList(data.highlights) },
        context: null,
      };
    case 'skills_group':
      return { editable: { category: data.category || '', items: data.items || '' }, context: null };
    case 'experience':
      return experienceInput(data, target);
    case 'custom': {
      const items = (data.items || []).map(normalizeCustomItem);
      if (target.kind === 'item') {
        const item = items[target.index];
        return {
          editable: customItemInput(item),
          context: {
            title: data.title || '',
            itemBodyType: item.bodyType || 'text',
            items: items.map((it, k) => (k === target.index ? { heading: '', body: TARGET_PLACEHOLDER } : customItemInput(it))),
          },
        };
      }
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
    case 'executive_summary':
      return obj({ headline: str, text: str, highlights: { type: 'array', items: str } });
    case 'skills_group':
      return obj({ category: str, items: str });
    case 'experience':
      return obj({ tagline: str, bullets: { type: 'array', items: bulletSchema } });
    case 'custom':
      return obj({ title: str, items: { type: 'array', items: obj({ heading: str, body: str }) } });
    default:
      return null;
  }
}

function targetSchema(type, target) {
  switch (target.kind) {
    case 'description':
      return obj({ description: str });
    case 'bullet':
      return obj({ bullet: target.path.length === 1 ? bulletSchema : obj({ text: str }) });
    case 'item':
      return obj({ heading: str, body: str });
    default:
      return editableSchema(type);
  }
}

// `target` must already be normalized (normalizeTarget).
export function outputSchema(type, target = BLOCK_TARGET) {
  return obj({ explanation: str, rewrite: targetSchema(type, target) });
}

// The model returned something that can't be merged back (wrong shape, or a
// structural change it wasn't allowed to make).
export class RewriteShapeError extends Error {}

export function requireString(value, field) {
  if (typeof value !== 'string') throw new RewriteShapeError(`AI response is missing "${field}"`);
  return value.trim();
}

// A field the model left alone keeps its stored value exactly. Otherwise the
// trim above would show stray whitespace as a change, and a field the block
// never had would be saved as an empty string.
export function rewritten(original, value, field) {
  const next = requireString(value, field);
  return next === String(original ?? '').trim() ? original : next;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new RewriteShapeError(`AI response is missing "${field}"`);
  return value;
}

// Like `rewritten`, for a list of lines (an executive summary's
// highlights). They carry no flags of their own, so the model may add,
// drop, or reorder them; blank ones are dropped. Unchanged apart from
// blanks and whitespace keeps the stored list exactly.
function rewrittenList(original, value, field) {
  const next = requireArray(value, field).map((line) => requireString(line, field)).filter(Boolean);
  return JSON.stringify(next) === JSON.stringify(highlightList(original)) ? original : next;
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

function proposedBullet(b, field) {
  return {
    text: requireString(b?.text, `${field}.text`),
    children: requireArray(b?.children ?? [], `${field}.children`).map((c) => ({
      text: requireString(c?.text, `${field}.children.text`),
    })),
  };
}

function proposedBullets(raw) {
  return requireArray(raw, 'bullets').map((b) => proposedBullet(b, 'bullets'));
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
// are reported as removed. A single-bullet rewrite restructures only that
// bullet's sub-bullets: `depth` 1 labels them as sub-bullets in the review,
// and `parentShown` is the bullet's own visibility, which they inherit.
export function restructureBullets(originals, proposed, { depth = 0, parentShown = null } = {}) {
  const from = flatten(originals, depth, [], parentShown);
  const to = flatten(proposed, depth);
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
  // A new (unmatched) bullet starts with its parent's visibility: `parentShown`
  // for the list's own level (a single-bullet rewrite's sub-bullets), the
  // built parent's flags below that, and visible everywhere at the top of a
  // whole block. A new sub-bullet under a hidden bullet is hidden with it
  // anyway, but keeping the flags means un-hiding the parent later doesn't
  // reveal it while the sub-bullets around it stay hidden.
  function build(list, depth, inherited) {
    return list.map((p) => {
      const ti = index++;
      const match = matchOf.has(ti) ? from[matchOf.get(ti)] : null;
      const visibleWeb = match ? match.shown.visibleWeb : inherited ? inherited.visibleWeb : true;
      const visiblePrint = match ? match.shown.visiblePrint : inherited ? inherited.visiblePrint : true;
      review.push({ depth, before: match ? match.bullet.text : null, after: p.text, wasHidden: match ? isHidden(match.shown) : false, visibleWeb, visiblePrint });
      const bullet = { text: p.text, visibleWeb, visiblePrint, children: [] };
      if (p.children) bullet.children = build(p.children, depth + 1, { visibleWeb, visiblePrint });
      return bullet;
    });
  }
  const bullets = build(proposed, depth, parentShown);
  const removed = from
    .filter((_, fi) => !usedFrom.has(fi))
    .map(({ bullet, depth, shown }) => ({ depth, before: bullet.text, wasHidden: isHidden(shown) }));
  return { bullets, review, removed };
}

const reviewEntry = (depth, before, after, shown) => ({ depth, before, after, wasHidden: isHidden(shown), ...shown });

// One experience bullet (path [i], with its sub-bullets) or one sub-bullet
// ([i, j]). Every other entry of `data.bullets` is passed through as stored,
// legacy string bullets included.
function mergeBullet(data, rewrite, [i, j], allowBulletRestructure) {
  const stored = data.bullets;
  const parent = normalizeBullet(stored[i]);
  const replace = (bullet) => ({ ...data, bullets: stored.map((b, k) => (k === i ? bullet : b)) });

  if (j !== undefined) {
    if (!isPlainObject(rewrite.bullet)) throw new RewriteShapeError('AI response is missing "bullet"');
    const child = parent.children[j];
    const text = rewritten(child.text, rewrite.bullet.text, 'bullet.text');
    const children = parent.children.map((c, m) => (m === j ? { ...c, text } : c));
    return {
      data: replace({ ...parent, children }),
      bulletReview: { items: [reviewEntry(1, child.text, text, shownFlags(child, parent))], removed: [] },
    };
  }

  const proposed = proposedBullet(rewrite.bullet, 'bullet');
  const text = rewritten(parent.text, proposed.text, 'bullet.text');
  let children;
  let review;
  let removed = [];
  if (allowBulletRestructure) {
    ({ bullets: children, review, removed } = restructureBullets(parent.children, proposed.children, {
      depth: 1,
      parentShown: shownFlags(parent),
    }));
  } else {
    if (proposed.children.length !== parent.children.length) {
      throw new RewriteShapeError(
        'The AI added or removed sub-bullets, but bullet restructuring is turned off. Try again, or enable it in Account Settings.'
      );
    }
    review = [];
    children = parent.children.map((c, m) => {
      const after = rewritten(c.text, proposed.children[m].text, 'bullet.children.text');
      review.push(reviewEntry(1, c.text, after, shownFlags(c, parent)));
      return { ...c, text: after };
    });
  }
  // The bullet itself always keeps its own visibility: it's the same bullet,
  // however much the wording changed.
  return {
    data: replace({ ...parent, text, children }),
    bulletReview: { items: [reviewEntry(0, parent.text, text, shownFlags(parent)), ...review], removed },
  };
}

function mergeItem(data, rewrite, index) {
  const item = normalizeCustomItem(data.items[index]);
  const field = bodyField(item);
  const next = {
    ...item,
    heading: rewritten(item.heading, rewrite.heading, 'heading'),
    [field]: rewritten(item[field], rewrite.body, 'body'),
  };
  return { data: { ...data, items: data.items.map((it, k) => (k === index ? next : it)) } };
}

// Applies the model's `rewrite` object onto the block's original data,
// touching only the allowlisted fields above, and within those only the
// target's: whatever else the model returns is ignored. Returns the proposed
// data plus, for experience bullets, a per-bullet review the editor shows
// before the user accepts.
export function mergeRewrite(type, data = {}, rewrite, { allowBulletRestructure = false, target } = {}) {
  if (!rewrite || typeof rewrite !== 'object') throw new RewriteShapeError('AI response is missing "rewrite"');
  const { kind, path, index } = normalizeTarget(type, data, target);
  if (kind === 'description') {
    return { data: { ...data, description: rewritten(data.description, rewrite.description, 'description') } };
  }
  if (kind === 'bullet') return mergeBullet(data, rewrite, path, allowBulletRestructure);
  if (kind === 'item') return mergeItem(data, rewrite, index);
  switch (type) {
    case 'heading':
    case 'summary':
      return { data: { ...data, text: rewritten(data.text, rewrite.text, 'text') } };
    case 'executive_summary':
      return {
        data: {
          ...data,
          headline: rewritten(data.headline, rewrite.headline, 'headline'),
          text: rewritten(data.text, rewrite.text, 'text'),
          highlights: rewrittenList(data.highlights, rewrite.highlights, 'highlights'),
        },
      };
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
      // `description` is never read from the model here; the spread copies it
      // through exactly as stored (see BLOCK_TARGET).
      return {
        data: {
          ...data,
          tagline: rewritten(data.tagline, rewrite.tagline, 'tagline'),
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
