// AI tailoring in the editor (issue #53): one ordinary rewrite request per
// section, each carrying the brief (server/src/ai/brief.js), whose results
// land as normal proposals in the review panels. Pure, so tailorRun.test.js
// covers it without React.
import { AI_REWRITABLE_TYPES, BLOCK_TARGET } from './aiReview.js';
import { BLOCK_TYPE_LABELS } from './blockDefaults.js';

// The block types a run can cover, in the dialog's order, and whether each
// is ticked to start with: the prose that carries a resume's pitch, not its
// headings or freeform sections.
export const TAILOR_TYPES = [
  { type: 'summary', label: 'Summary', checked: true },
  { type: 'experience', label: 'Experience', checked: true },
  { type: 'skills_group', label: 'Skills', checked: true },
  { type: 'heading', label: 'Headings', checked: false },
  { type: 'custom', label: 'Custom sections', checked: false },
].filter(({ type }) => AI_REWRITABLE_TYPES.has(type));

export const DEFAULT_TAILOR_TYPES = TAILOR_TYPES.filter((t) => t.checked).map((t) => t.type);

// How many requests are out at once: enough to finish a resume in a few
// rounds, few enough to stay well inside the server's tailoring rate limit
// and the provider's own.
export const TAILOR_CONCURRENCY = 3;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const bulletText = (b) => (typeof b === 'string' ? b : b?.text);

// Whether a block has anything for a rewrite to work from: a request for
// an empty one would only invite the AI to make something up.
function hasText(type, data = {}) {
  switch (type) {
    case 'heading':
    case 'summary':
      return Boolean(text(data.text));
    case 'skills_group':
      return Boolean(text(data.items));
    case 'experience':
      return Boolean(
        text(data.tagline) ||
          (data.bullets || []).some((b) => text(bulletText(b)) || (b?.children || []).some((c) => text(bulletText(c))))
      );
    case 'custom':
      // `body`/`heading`: items saved before bodyType existed (the server's
      // normalizeCustomItem reads them the same way).
      return (data.items || []).some(
        (item) => text(item?.text) || text(item?.items) || text(item?.label) || text(item?.body) || text(item?.heading)
      );
    default:
      return false;
  }
}

// The requests a run makes for `blocks` (in display order) and the chosen
// types: one per block, plus one for an experience entry's description,
// which a whole-block rewrite never touches (see the server's
// rewritableFields.js). A block hidden on both web and print is skipped,
// since nobody sees it, and so is one with no text. Each item is
// { key, blockId, target, label }.
export function tailorItems(blocks, types) {
  const wanted = new Set(types);
  const items = [];
  for (const block of blocks) {
    if (!wanted.has(block.type) || !AI_REWRITABLE_TYPES.has(block.type)) continue;
    if (!block.visibleWeb && !block.visiblePrint) continue;
    const label = blockLabel(block);
    if (hasText(block.type, block.data)) items.push({ key: `${block.id}:block`, blockId: block.id, target: BLOCK_TARGET, label });
    if (block.type === 'experience' && text(block.data?.description)) {
      items.push({ key: `${block.id}:description`, blockId: block.id, target: { kind: 'description' }, label: `${label}, description` });
    }
  }
  return items;
}

// "Experience Entry: Engineer, Acme", for the list of sections that failed.
function blockLabel(block) {
  const data = block.data || {};
  const detail =
    block.type === 'experience'
      ? [text(data.jobTitle), text(data.company)].filter(Boolean).join(', ')
      : block.type === 'skills_group'
        ? text(data.category)
        : block.type === 'custom'
          ? text(data.title)
          : text(data.text).slice(0, 40);
  const type = BLOCK_TYPE_LABELS[block.type] || 'Section';
  return detail ? `${type}: ${detail}` : type;
}

// Runs `items` through `run(item)`, at most `concurrency` at a time, in
// order. `run` resolves with { ok: true }, { ok: false, error } or
// { superseded: true } (another request for the same spot took over, or
// the block was deleted: counted as skipped, since there's nothing to
// review or retry); a rejection counts as a failure. `onUpdate(state)`
// gets { total, done, skipped, failed: [{ item, error }], running,
// cancelled, finished } after every change, the first time synchronously
// from here.
//
// cancel() sends nothing more and forgets what's in flight, so a late
// result changes nothing; it returns those items, whose requests the
// caller should forget too.
export function createTailorRun({ items, run, onUpdate, concurrency = TAILOR_CONCURRENCY }) {
  const queue = [...items];
  const inFlight = new Set();
  const failed = [];
  let done = 0;
  let skipped = 0;
  let cancelled = false;

  const snapshot = () => ({
    total: items.length,
    done,
    skipped,
    failed: [...failed],
    running: inFlight.size,
    cancelled,
    finished: inFlight.size === 0 && (cancelled || queue.length === 0),
  });

  function settle(item, result) {
    if (!inFlight.delete(item)) return;
    if (result?.ok) done += 1;
    else if (result?.superseded) skipped += 1;
    else failed.push({ item, error: result?.error || 'The rewrite failed.' });
    pump();
  }

  function pump() {
    while (!cancelled && inFlight.size < concurrency && queue.length > 0) {
      const item = queue.shift();
      inFlight.add(item);
      Promise.resolve()
        .then(() => run(item))
        .then(
          (result) => settle(item, result),
          (err) => settle(item, { ok: false, error: err?.message })
        );
    }
    onUpdate(snapshot());
  }

  // A run that's already over has nothing to stop, and stays as it ended.
  function cancel() {
    if (cancelled || (inFlight.size === 0 && queue.length === 0)) return [];
    cancelled = true;
    const abandoned = [...inFlight];
    inFlight.clear();
    queue.length = 0;
    onUpdate(snapshot());
    return abandoned;
  }

  pump();
  return { cancel };
}
