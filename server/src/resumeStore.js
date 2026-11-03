import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { httpError } from './httpError.js';
import { assertBlockData } from './blockData.js';
import { createSettings } from './settings.js';
import { rowToBlock, orderBlocksHierarchically } from './blockRows.js';
import { promotedBlockPositions } from './blockDeletion.js';
import { findSplitSectionId } from './blockReorder.js';
import { blocksForMode } from './publicBlocks.js';

// The single implementation of every content operation the editor's REST
// routes and the MCP tools expose: blocks, header, site settings, publish
// and discard. Routes and tools are thin wrappers over this. It's a factory
// over an injected database handle (plus the PDF renderer and output path)
// rather than a module that imports db.js, so resumeStore.test.js can run
// the real SQL against a ':memory:' database; store.js binds it to the real
// one for the running server.
//
// Errors carry an http-ish `.status` (400/404/409/500) the REST layer maps
// straight onto the response, and the MCP layer surfaces in the tool error.

// Only these types can be nested under a heading; `heading` itself can't
// (no multi-level nesting) and `summary` stays top-level only.
export const NESTABLE_TYPES = new Set(['experience', 'skills_group', 'education', 'custom']);

export const BLOCK_TYPES = ['heading', 'summary', 'skills_group', 'experience', 'education', 'custom'];

export { httpError };

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isPlainObject(value)) throw httpError(400, `${label} must be an object`);
  return value;
}

// Shallow-merge `patch` into `base` (JSON-merge-patch style): a null value
// deletes the key, anything else — arrays and nested objects included —
// replaces it wholesale. Used by the MCP tools; REST replaces instead.
export function mergeShallow(base, patch, label) {
  assertObject(patch, label);
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    // JSON.parse happily produces an own "__proto__" key; assigning it
    // would swap the prototype of `out` rather than store a property.
    if (key === '__proto__') continue;
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

// Upper bound on one PDF render. Every render runs on the single PDF
// queue below, so a Chromium that never settles would otherwise block
// every later publish (and the boot render) until a restart.
export const DEFAULT_PDF_TIMEOUT_MS = 90_000;

// Runs `fn({ signal })` and gives up after `ms`: the signal is aborted (so
// the renderer can tear down whatever is wedged) and the returned promise
// rejects, whatever `fn` goes on to do.
function withTimeout(fn, ms, message) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, ms);
    timer.unref?.(); // a pending render must not keep the process alive on shutdown
  });
  const work = Promise.resolve().then(() => fn({ signal: controller.signal }));
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function createResumeStore({ db, renderPdf, pdfPath, pdfTimeoutMs = DEFAULT_PDF_TIMEOUT_MS }) {
  const { getSetting, setSetting, touchDraft } = createSettings(db);

  function lookupParentRow(parentId) {
    return db.prepare('SELECT * FROM blocks WHERE id = ?').get(parentId);
  }

  // Throws (with an http status) if parentId isn't a valid parent for a block
  // of the given type — null/undefined is always fine (top-level). `lookup`
  // defaults to a fresh SQLite query per call, which is fine for the
  // single-block methods below; reorderBlocks already has every row loaded
  // in memory and passes a map lookup instead to avoid one query per item.
  function assertValidParent(parentId, type, lookup = lookupParentRow) {
    if (parentId == null) return;
    if (typeof parentId !== 'string') {
      // Without this, a non-string parentId (object/array) reaches the
      // SQLite bind below and better-sqlite3 throws its own error — a raw
      // 500 with an internal message, instead of a clean, stable 400.
      throw httpError(400, 'parentId must be a string');
    }
    if (!NESTABLE_TYPES.has(type)) {
      throw httpError(400, `${type} blocks can't be nested under a heading`);
    }
    const parent = lookup(parentId);
    if (!parent) {
      throw httpError(400, 'parentId does not reference an existing block');
    }
    if (parent.type !== 'heading') {
      throw httpError(400, 'parentId must reference a heading block');
    }
    if (parent.parent_id != null) {
      // The API never lets a heading itself take a parentId, so this only
      // fires against a heading that got one some other way (hand-edited
      // SQLite, imported data) — without this check, nesting under it would
      // silently produce two levels of nesting despite the documented
      // one-level guarantee.
      throw httpError(400, 'parentId must reference a top-level heading block');
    }
  }

  function nextPosition(parentId) {
    const row =
      parentId == null
        ? db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM blocks WHERE parent_id IS NULL').get()
        : db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM blocks WHERE parent_id = ?').get(parentId);
    return row.m + 1;
  }

  function orderedBlocks() {
    const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
    return orderBlocksHierarchically(rows.map(rowToBlock));
  }

  function currentDraft() {
    return {
      header: getSetting('header'),
      site: getSetting('site'),
      blocks: orderedBlocks(),
    };
  }

  function isDirty() {
    const draftMeta = getSetting('draft_meta');
    const published = getSetting('published_resume');
    if (!draftMeta?.lastEditedAt) return false;
    if (!published?.publishedAt) return true;
    return draftMeta.lastEditedAt > published.publishedAt;
  }

  // ---- header / site -------------------------------------------------------

  function getHeader() {
    return getSetting('header');
  }

  // `merge: true` shallow-merges into the existing header (see mergeShallow)
  // instead of replacing it. The read and write happen synchronously, so
  // nothing can interleave between them.
  function setHeader(header, { merge = false } = {}) {
    const next = merge ? mergeShallow(getSetting('header'), header, 'header') : assertObject(header ?? {}, 'header');
    setSetting('header', next);
    touchDraft();
    return getSetting('header');
  }

  function getSite() {
    return getSetting('site');
  }

  // `merge: true` shallow-merges, with `colors` itself merged one level deep.
  function setSite(site, { merge = false } = {}) {
    let next;
    if (merge) {
      assertObject(site, 'site');
      const current = getSetting('site') || {};
      const { colors, ...rest } = site;
      next = mergeShallow(current, rest, 'site');
      if (colors === null) delete next.colors;
      else if (colors !== undefined) next.colors = mergeShallow(current.colors, colors, 'site.colors');
    } else {
      next = assertObject(site ?? {}, 'site');
    }
    setSetting('site', next);
    touchDraft();
    return getSetting('site');
  }

  // ---- blocks --------------------------------------------------------------

  function listBlocks() {
    return orderedBlocks();
  }

  function getBlock(id) {
    const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Block not found');
    return rowToBlock(row);
  }

  function createBlock(input = {}) {
    const { type, data, parentId = null } = assertObject(input ?? {}, 'block');
    if (!type) throw httpError(400, 'type is required');
    if (!BLOCK_TYPES.includes(type)) throw httpError(400, `unknown block type: ${type}`);
    if (data != null) assertBlockData(type, assertObject(data, 'data')); // null/undefined → empty, as before
    assertValidParent(parentId, type);
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO blocks (id, type, position, parent_id, visible_web, visible_print, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`
    ).run(id, type, nextPosition(parentId), parentId, JSON.stringify(data || {}), now, now);
    touchDraft();
    return getBlock(id);
  }

  // `patch` may carry `data`, `visibleWeb`, `visiblePrint`, and `parentId`.
  // `data` replaces the stored object whole; a null (or absent) `data`
  // leaves it unchanged, like the other fields. The `mergeData` option —
  // not part of the patch, so a REST body can't switch it on — makes it a
  // shallow merge instead (see mergeShallow); the MCP update_block tool
  // uses that. A `parentId` key that's *present* (even as null) re-parents
  // the block; an absent key leaves it alone — hence the hasOwn check
  // rather than a `?? existing` default.
  function updateBlock(id, patch = {}, { mergeData = false } = {}) {
    patch = assertObject(patch ?? {}, 'patch'); // null/undefined → nothing to change
    const existing = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
    if (!existing) throw httpError(404, 'Block not found');

    let { data } = patch;
    const { visibleWeb, visiblePrint } = patch;
    if (data == null) data = undefined;
    else {
      data = mergeData ? mergeShallow(JSON.parse(existing.data), data, 'data') : assertObject(data, 'data');
      assertBlockData(existing.type, data); // the merged/replaced result, i.e. what would be stored
    }
    const parentIdProvided = Object.hasOwn(patch, 'parentId');
    const parentId = parentIdProvided ? patch.parentId : undefined;
    if (parentIdProvided) assertValidParent(parentId, existing.type);
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE blocks SET
         data = COALESCE(?, data),
         visible_web = COALESCE(?, visible_web),
         visible_print = COALESCE(?, visible_print),
         parent_id = ?,
         position = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      data !== undefined ? JSON.stringify(data) : null,
      visibleWeb !== undefined ? (visibleWeb ? 1 : 0) : null,
      visiblePrint !== undefined ? (visiblePrint ? 1 : 0) : null,
      parentIdProvided ? parentId : existing.parent_id,
      // Re-parenting drops the block at the end of its new sibling group;
      // fine-grained ordering within a group happens via reorderBlocks.
      parentIdProvided && parentId !== existing.parent_id ? nextPosition(parentId) : existing.position,
      now,
      id
    );
    touchDraft();
    return getBlock(id);
  }

  // An unknown id is a 404 from both front doors (the editor deletes
  // optimistically and treats a 404 as "already gone").
  function deleteBlock(id) {
    const txn = db.transaction(() => {
      // Promote children in place to match the editor's optimistic deletion.
      // Reindex the top-level siblings from the existing display order so the
      // promoted entries don't jump to the bottom on refresh or publication.
      const hasChildren = db.prepare('SELECT 1 FROM blocks WHERE parent_id = ? LIMIT 1').get(id);
      if (hasChildren) {
        const promote = db.prepare('UPDATE blocks SET parent_id = NULL, position = ? WHERE id = ?');
        for (const block of promotedBlockPositions(orderedBlocks(), id)) {
          promote.run(block.position, block.id);
        }
      }
      return db.prepare('DELETE FROM blocks WHERE id = ?').run(id).changes;
    });
    if (txn() === 0) throw httpError(404, 'Block not found');
    touchDraft();
    return { ok: true };
  }

  // `items` is the full desired display order — every block exactly once,
  // each heading immediately followed by its children. An omitted parentId
  // means top-level (unlike updateBlock, where omitted means unchanged).
  function reorderBlocks(items) {
    const isValidItem = (item) =>
      item &&
      typeof item.id === 'string' &&
      (item.parentId === null || item.parentId === undefined || typeof item.parentId === 'string');
    if (!Array.isArray(items) || items.some((item) => !isValidItem(item))) {
      throw httpError(400, 'items must be an array of { id, parentId }, parentId being a string, null, or omitted');
    }

    const rows = db.prepare('SELECT * FROM blocks').all();
    const typeById = new Map(rows.map((r) => [r.id, r.type]));
    const rowById = new Map(rows.map((r) => [r.id, r]));

    // A duplicate or missing id would otherwise leave sibling-group
    // positions inconsistent (gaps, or two blocks sharing one).
    const seen = new Set();
    for (const { id } of items) {
      if (!typeById.has(id)) throw httpError(400, `unknown block id: ${id}`);
      if (seen.has(id)) throw httpError(400, `duplicate block id: ${id}`);
      seen.add(id);
    }
    if (seen.size !== typeById.size) {
      throw httpError(400, 'items must include every existing block exactly once');
    }

    const splitId = findSplitSectionId(items);
    if (splitId) {
      throw httpError(400, `items must keep block ${splitId}'s section contiguous, directly after its heading`);
    }

    // Validate each parent as this request leaves it, not as the table has
    // it now: the heading's own parent_id is the one `items` assigns.
    const assignedParent = new Map(items.map(({ id, parentId }) => [id, parentId ?? null]));
    const lookup = (pid) => {
      const row = rowById.get(pid);
      return row && { ...row, parent_id: assignedParent.get(pid) };
    };
    for (const { id, parentId } of items) {
      assertValidParent(parentId ?? null, typeById.get(id), lookup);
    }

    const update = db.prepare('UPDATE blocks SET parent_id = ?, position = ? WHERE id = ?');
    const txn = db.transaction((entries) => {
      const counters = new Map();
      for (const { id, parentId } of entries) {
        const key = parentId ?? null;
        const position = counters.get(key) ?? 0;
        counters.set(key, position + 1);
        update.run(key, position, id);
      }
    });
    txn(items);
    touchDraft();
    return orderedBlocks();
  }

  // ---- publish / discard ---------------------------------------------------

  // The `pdf_meta` setting records which published snapshot the PDF on disk
  // was rendered from, so a publish whose render failed (site updated, PDF
  // not) is visible as pdfStale instead of silently serving an old file.
  // Installs from before this setting existed have no pdf_meta; their PDF
  // is assumed current until the next publish records one.
  function pdfStale(published) {
    if (!published) return false;
    const meta = getSetting('pdf_meta');
    if (!meta) return !fs.existsSync(pdfPath);
    return meta.renderedFor !== published.publishedAt || !fs.existsSync(pdfPath);
  }

  function getPublishStatus() {
    const published = getSetting('published_resume');
    return { publishedAt: published?.publishedAt ?? null, isDirty: isDirty(), pdfStale: pdfStale(published) };
  }

  // Everything that writes the PDF file goes through this one queue, so two
  // renders never run at once and an older render can't land on top of a
  // newer one: the editor and an MCP client publishing together, or the
  // first-boot render (ensurePdf) overlapping an early publish.
  let pdfChain = Promise.resolve();
  function withPdfLock(fn) {
    const result = pdfChain.then(fn);
    pdfChain = result.catch(() => {});
    return result;
  }

  // Bounded by pdfTimeoutMs so a Chromium that never settles releases the
  // queue. The renderer gets an AbortSignal and is expected to stop (close
  // its page / reset the browser) when it fires, so the next render on the
  // queue doesn't start beside a wedged one; a result that arrives after
  // the timeout is dropped either way.
  function renderPdfBounded() {
    return withTimeout(renderPdf, pdfTimeoutMs, `PDF render timed out after ${pdfTimeoutMs} ms`);
  }

  // Write to a sibling temp file and rename it into place, so a download
  // overlapping a publish never reads a half-written PDF and a crash
  // mid-write can't leave a truncated file that looks valid.
  function writePdf(buffer) {
    const tmp = `${pdfPath}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, pdfPath);
  }

  // The snapshot is taken synchronously, before anything is queued, so a
  // publish reflects the draft exactly as it was when it was called: any
  // edit or discard that follows (from either front door) is ordered after
  // it, and nothing can slip in between the status check and the snapshot.
  // Only the render waits for the PDF queue.
  //
  // The snapshot is written first, so the public site reflects the draft
  // even if the PDF render then fails (a dev box without Chromium can still
  // publish). The error says so — a caller shouldn't retry a publish that
  // already took effect — and getPublishStatus() reports pdfStale until a
  // later publish renders successfully.
  function publish() {
    const previous = getSetting('published_resume');
    if (!getSetting('pdf_meta')) {
      // First publish since pdf_meta was introduced: pin the file on disk
      // to the snapshot it belongs to, so a failed render below is
      // detected as stale rather than assumed current.
      setSetting('pdf_meta', { renderedFor: previous?.publishedAt ?? null });
    }
    const publishedAt = new Date().toISOString();
    setSetting('published_resume', { ...currentDraft(), publishedAt });
    return withPdfLock(async () => {
      try {
        writePdf(await renderPdfBounded());
      } catch (cause) {
        const err = httpError(500, 'Published, but the PDF render failed — the site is updated, the PDF is not');
        err.cause = cause;
        throw err;
      }
      // The render read whatever snapshot was current while it ran, which
      // is this one or a newer one; a newer publish is queued behind us and
      // will record itself when its own render lands.
      setSetting('pdf_meta', { renderedFor: publishedAt });
      return { publishedAt };
    });
  }

  // Renders a PDF for the current published snapshot if none exists yet
  // (a snapshot can be seeded from pre-existing draft content on first boot
  // without a PDF ever having been generated for it). Queued behind any
  // in-flight publish, and skipped if one has written the file meanwhile,
  // so it can never overwrite a fresher render.
  function ensurePdf() {
    return withPdfLock(async () => {
      if (fs.existsSync(pdfPath)) return { rendered: false };
      writePdf(await renderPdfBounded());
      setSetting('pdf_meta', { renderedFor: getSetting('published_resume')?.publishedAt ?? null });
      return { rendered: true };
    });
  }

  function discardDraft() {
    const published = getSetting('published_resume');
    if (!published) throw httpError(409, 'Nothing has been published yet');

    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO blocks (id, type, position, parent_id, visible_web, visible_print, data, created_at, updated_at)
      VALUES (@id, @type, @position, @parentId, @visibleWeb, @visiblePrint, @data, @now, @now)
    `);
    // One transaction for blocks and settings alike (setSetting runs on the
    // same connection), so a crash mid-way can't leave restored blocks next
    // to a stale header.
    const txn = db.transaction((blocks) => {
      db.prepare('DELETE FROM blocks').run();
      // published.blocks is already in hierarchical order (a heading directly
      // followed by its children), but `position` must be re-derived per
      // sibling group, not from the flat array index.
      const positionByParent = new Map();
      blocks.forEach((block) => {
        const parentId = block.parentId ?? null;
        const position = positionByParent.get(parentId) ?? 0;
        positionByParent.set(parentId, position + 1);
        insert.run({
          id: block.id || randomUUID(),
          type: block.type,
          position,
          parentId,
          visibleWeb: block.visibleWeb ? 1 : 0,
          visiblePrint: block.visiblePrint ? 1 : 0,
          data: JSON.stringify(block.data),
          now,
        });
      });
      setSetting('header', published.header);
      setSetting('site', published.site);
      setSetting('draft_meta', { lastEditedAt: null });
    });
    txn(published.blocks);

    return currentDraft();
  }

  // ---- published snapshot --------------------------------------------------

  // What the public site and PDF render from: the last-published snapshot,
  // never the draft. Hidden blocks come back as content-free placeholders
  // (see publicBlocks.js).
  function getPublishedResume(mode) {
    const resolvedMode = mode === 'print' ? 'print' : 'web';
    const published = getSetting('published_resume') || { header: null, site: null, blocks: [] };
    return {
      header: published.header,
      site: published.site,
      blocks: blocksForMode(published.blocks, resolvedMode),
    };
  }

  return {
    getHeader,
    setHeader,
    getSite,
    setSite,
    listBlocks,
    getBlock,
    createBlock,
    updateBlock,
    deleteBlock,
    reorderBlocks,
    getPublishStatus,
    publish,
    ensurePdf,
    discardDraft,
    getPublishedResume,
    currentDraft,
  };
}
