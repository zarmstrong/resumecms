import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { createResumeStore, NESTABLE_TYPES } from './resumeStore.js';

// Exercises the real SQL against an in-memory database — the regression
// guard for the logic that used to live inline in routes/blocks.js and
// routes/publish.js. Nothing here touches db.js or RESUMECMS_DATA_DIR.

function makeStore({ renderPdf, pdfTimeoutMs } = {}) {
  const db = new Database(':memory:');
  ensureSchema(db);
  const pdfPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-store-')), 'resume.pdf');
  const calls = { renderPdf: 0 };
  const store = createResumeStore({
    db,
    pdfPath,
    pdfTimeoutMs,
    renderPdf:
      renderPdf ||
      (async () => {
        calls.renderPdf += 1;
        return Buffer.from('%PDF-fake');
      }),
  });
  const setting = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  };
  return { store, db, pdfPath, calls, setting };
}

const ids = (blocks) => blocks.map((b) => b.id);

test('createBlock appends within its sibling group and bumps the draft', () => {
  const { store, setting } = makeStore();
  assert.equal(setting('draft_meta'), null);
  const h = store.createBlock({ type: 'heading', data: { text: 'Skills' } });
  const a = store.createBlock({ type: 'skills_group', data: { category: 'A' }, parentId: h.id });
  const b = store.createBlock({ type: 'skills_group', data: { category: 'B' }, parentId: h.id });
  const top = store.createBlock({ type: 'summary', data: { text: 'hi' } });
  assert.deepEqual([h.position, a.position, b.position, top.position], [0, 0, 1, 1]);
  assert.equal(a.parentId, h.id);
  assert.equal(top.parentId, null);
  assert.deepEqual(h, { id: h.id, type: 'heading', position: 0, parentId: null, visibleWeb: true, visiblePrint: true, data: { text: 'Skills' } });
  assert.ok(setting('draft_meta').lastEditedAt);
  assert.deepEqual(ids(store.listBlocks()), [h.id, a.id, b.id, top.id]);
});

test('createBlock validates type and parent', () => {
  const { store } = makeStore();
  const h = store.createBlock({ type: 'heading', data: {} });
  const s = store.createBlock({ type: 'summary', data: {} });
  const fail = (args, status, re) => assert.throws(() => store.createBlock(args), (e) => e.status === status && re.test(e.message));
  fail({}, 400, /type is required/);
  fail(null, 400, /type is required/);
  fail('summary', 400, /block must be an object/);
  fail({ type: 'poem' }, 400, /unknown block type: poem/);
  fail({ type: 'summary', data: 'text' }, 400, /data must be an object/);
  fail({ type: 'summary', parentId: h.id }, 400, /can't be nested/);
  fail({ type: 'heading', parentId: h.id }, 400, /can't be nested/);
  fail({ type: 'experience', parentId: s.id }, 400, /must reference a heading/);
  fail({ type: 'experience', parentId: 'nope' }, 400, /does not reference an existing/);
  fail({ type: 'experience', parentId: 42 }, 400, /must be a string/);
  for (const type of NESTABLE_TYPES) assert.equal(store.createBlock({ type, parentId: h.id }).parentId, h.id);
});

test('block data is type-checked on create and on the merged result of an update', () => {
  const { store } = makeStore();
  assert.throws(
    () => store.createBlock({ type: 'experience', data: { bullets: 'not a list' } }),
    (e) => e.status === 400 && /^data\.bullets: /.test(e.message)
  );
  const x = store.createBlock({ type: 'experience', data: { jobTitle: 'Dev', bullets: ['one'] } });
  assert.throws(() => store.updateBlock(x.id, { data: { bullets: { text: 'x' } } }), (e) => e.status === 400);
  assert.throws(() => store.updateBlock(x.id, { data: { jobTitle: 7 } }, { mergeData: true }), (e) => e.status === 400);
  assert.deepEqual(store.getBlock(x.id).data, { jobTitle: 'Dev', bullets: ['one'] }, 'nothing was written');
  // merging a wrong-typed key over a right-typed one is caught on the result
  assert.deepEqual(store.updateBlock(x.id, { data: { bullets: [{ text: 'two', children: ['a'] }] } }, { mergeData: true }).data.bullets.length, 1);
  // a __proto__ key is dropped rather than changing the merged object's prototype
  const merged = store.updateBlock(x.id, { data: JSON.parse('{"__proto__":{"polluted":true},"company":"Co"}') }, { mergeData: true });
  assert.equal(merged.data.polluted, undefined);
  assert.equal(Object.getPrototypeOf(merged.data), Object.prototype);
  assert.equal(merged.data.company, 'Co');
});

test('data stored before the checks existed stays editable until it is fixed', () => {
  const { store, db } = makeStore();
  const x = store.createBlock({ type: 'experience', data: { jobTitle: 'Dev' } });
  // Legacy row: a number where a string is expected.
  db.prepare('UPDATE blocks SET data = ? WHERE id = ?').run(JSON.stringify({ jobTitle: 'Dev', startDate: 2019 }), x.id);
  // The editor sends the whole object back — still accepted, even with a new wrong-kind key
  assert.deepEqual(store.updateBlock(x.id, { data: { jobTitle: 'Lead', startDate: 2019 } }).data, { jobTitle: 'Lead', startDate: 2019 });
  assert.equal(store.updateBlock(x.id, { data: { bullets: 'meh' } }, { mergeData: true }).data.bullets, 'meh');
  // Once the data is valid again, the checks apply
  store.updateBlock(x.id, { data: { jobTitle: 'Lead', startDate: '2019', bullets: [] } });
  assert.throws(() => store.updateBlock(x.id, { data: { startDate: 2020 } }, { mergeData: true }), (e) => e.status === 400);
});

test('re-parenting closes the gap it leaves in the old sibling group', () => {
  const { store } = makeStore();
  const h = store.createBlock({ type: 'heading' });
  const a = store.createBlock({ type: 'experience', parentId: h.id });
  const b = store.createBlock({ type: 'experience', parentId: h.id });
  const c = store.createBlock({ type: 'experience', parentId: h.id });
  store.updateBlock(a.id, { parentId: null });
  const pos = Object.fromEntries(store.listBlocks().map((blk) => [blk.id, [blk.parentId, blk.position]]));
  assert.deepEqual(pos, { [h.id]: [null, 0], [b.id]: [h.id, 0], [c.id]: [h.id, 1], [a.id]: [null, 1] });
  // and the other way: top-level → nested
  store.updateBlock(h.id, { visibleWeb: false }); // unrelated patch, positions untouched
  store.updateBlock(a.id, { parentId: h.id });
  assert.deepEqual(store.listBlocks().map((blk) => [blk.id, blk.position]), [[h.id, 0], [b.id, 0], [c.id, 1], [a.id, 2]]);
});

test('createBlock treats a null data as empty', () => {
  const { store } = makeStore();
  assert.deepEqual(store.createBlock({ type: 'summary', data: null }).data, {});
  assert.throws(() => store.createBlock({ type: 'summary', data: 'x' }), (e) => e.status === 400);
});

test('getBlock throws 404 for unknown ids', () => {
  const { store } = makeStore();
  assert.throws(() => store.getBlock('missing'), (e) => e.status === 404 && e.message === 'Block not found');
});

test('updateBlock replaces data, toggles visibility, and distinguishes omitted from null parentId', () => {
  const { store } = makeStore();
  const h1 = store.createBlock({ type: 'heading', data: { text: 'One' } });
  const h2 = store.createBlock({ type: 'heading', data: { text: 'Two' } });
  const x = store.createBlock({ type: 'experience', data: { jobTitle: 'Dev', company: 'Co' }, parentId: h1.id });
  const y = store.createBlock({ type: 'experience', data: { jobTitle: 'Y' }, parentId: h2.id });

  // data is replaced whole, not merged
  let out = store.updateBlock(x.id, { data: { jobTitle: 'Lead' } });
  assert.deepEqual(out.data, { jobTitle: 'Lead' });
  // omitted parentId leaves nesting + position alone
  out = store.updateBlock(x.id, { visibleWeb: false });
  assert.equal(out.visibleWeb, false);
  assert.equal(out.visiblePrint, true);
  assert.equal(out.parentId, h1.id);
  assert.equal(out.position, 0);
  // null promotes to top level, at the end of the top-level group
  out = store.updateBlock(x.id, { parentId: null });
  assert.equal(out.parentId, null);
  assert.equal(out.position, 2);
  // re-parent lands at the end of the new group
  out = store.updateBlock(x.id, { parentId: h2.id });
  assert.equal(out.parentId, h2.id);
  assert.equal(out.position, 1);
  assert.deepEqual(ids(store.listBlocks()), [h1.id, h2.id, y.id, x.id]);

  assert.throws(() => store.updateBlock('missing', {}), (e) => e.status === 404);
  assert.throws(() => store.updateBlock(h1.id, { parentId: h2.id }), (e) => e.status === 400);
});

test('updateBlock with the mergeData option merges keys, deletes on null, and validates its input', () => {
  const { store, setting } = makeStore();
  const x = store.createBlock({ type: 'experience', data: { jobTitle: 'Dev', company: 'Co', bullets: ['one'] } });
  const merged = store.updateBlock(x.id, { data: { jobTitle: 'Lead', company: null, bullets: ['two'] } }, { mergeData: true });
  assert.deepEqual(merged.data, { jobTitle: 'Lead', bullets: ['two'] });
  assert.deepEqual(store.updateBlock(x.id, { data: { only: true } }).data, { only: true }, 'without the option, data is replaced');
  // The option is not part of the patch: a REST body can't turn merging on.
  assert.deepEqual(store.updateBlock(x.id, { data: { other: 1 }, mergeData: true }).data, { other: 1 });
  // A null data (what an older client sends to leave it alone) is ignored.
  assert.deepEqual(store.updateBlock(x.id, { data: null, visibleWeb: false }).data, { other: 1 });
  assert.equal(store.getBlock(x.id).visibleWeb, false);
  const fail = (patch, opts, re) =>
    assert.throws(() => store.updateBlock(x.id, patch, opts), (e) => e.status === 400 && re.test(e.message));
  assert.deepEqual(store.updateBlock(x.id, null).data, { other: 1 }, 'a null patch changes nothing');
  fail('x', undefined, /patch must be an object/);
  fail(['x'], undefined, /patch must be an object/);
  fail({ data: 'x' }, undefined, /data must be an object/);
  fail({ data: ['x'] }, { mergeData: true }, /data must be an object/);
  assert.deepEqual(store.getBlock(x.id).data, { other: 1 });
  assert.ok(setting('draft_meta').lastEditedAt);
});

test('deleteBlock promotes children in place and 404s on unknown ids', () => {
  const { store, setting } = makeStore();
  const s = store.createBlock({ type: 'summary' });
  const h = store.createBlock({ type: 'heading' });
  const a = store.createBlock({ type: 'experience', parentId: h.id });
  const b = store.createBlock({ type: 'experience', parentId: h.id });
  const tail = store.createBlock({ type: 'heading' });

  assert.deepEqual(store.deleteBlock(h.id), { ok: true });
  const after = store.listBlocks();
  assert.deepEqual(ids(after), [s.id, a.id, b.id, tail.id]);
  assert.ok(after.every((blk) => blk.parentId === null));
  assert.deepEqual(after.map((blk) => blk.position), [0, 1, 2, 3]);

  // an unknown id is a 404 and not an edit: the draft stays as it was
  const before = setting('draft_meta').lastEditedAt;
  assert.throws(() => store.deleteBlock('missing'), (e) => e.status === 404);
  assert.equal(setting('draft_meta').lastEditedAt, before);
});

test('reorderBlocks validates parents as the request assigns them, not as stored', () => {
  const { store, db } = makeStore();
  const h = store.createBlock({ type: 'heading' });
  const other = store.createBlock({ type: 'heading' });
  const x = store.createBlock({ type: 'experience' });
  // A heading that somehow got a parent (hand-edited SQLite) is un-nested
  // and given a child in the same request: valid as the request leaves it.
  db.prepare('UPDATE blocks SET parent_id = ? WHERE id = ?').run(other.id, h.id);
  const out = store.reorderBlocks([{ id: other.id }, { id: h.id }, { id: x.id, parentId: h.id }]);
  assert.deepEqual(out.map((b) => [b.id, b.parentId]), [[other.id, null], [h.id, null], [x.id, h.id]]);
});

test('reorderBlocks rewrites positions per group and rejects bad orders', () => {
  const { store } = makeStore();
  const h = store.createBlock({ type: 'heading' });
  const a = store.createBlock({ type: 'experience', parentId: h.id });
  const b = store.createBlock({ type: 'experience', parentId: h.id });
  const s = store.createBlock({ type: 'summary' });

  // omitted parentId means top-level — `a` is promoted here
  const out = store.reorderBlocks([{ id: s.id }, { id: h.id }, { id: b.id, parentId: h.id }, { id: a.id }]);
  assert.deepEqual(ids(out), [s.id, h.id, b.id, a.id]);
  assert.deepEqual(out.map((x) => [x.parentId, x.position]), [[null, 0], [null, 1], [h.id, 0], [null, 2]]);

  const fail = (items, re) => assert.throws(() => store.reorderBlocks(items), (e) => e.status === 400 && re.test(e.message));
  fail('nope', /must be an array/);
  fail([{ id: 1 }], /must be an array/);
  fail([{ id: 'ghost' }], /unknown block id: ghost/);
  fail([{ id: s.id }, { id: s.id }], /duplicate block id/);
  fail([{ id: s.id }], /every existing block exactly once/);
  fail([{ id: h.id }, { id: s.id }, { id: b.id, parentId: h.id }, { id: a.id }], /contiguous/);
  // contiguity is checked before parent validity (as the route always did)
  fail([{ id: s.id }, { id: h.id, parentId: s.id }, { id: b.id }, { id: a.id }], /can't be nested/);
});

test('header and site are replaced whole and mark the draft dirty', () => {
  const { store } = makeStore();
  assert.equal(store.getHeader(), null);
  assert.deepEqual(store.setHeader({ name: 'A', email: 'a@x' }), { name: 'A', email: 'a@x' });
  assert.deepEqual(store.setHeader({ name: 'B' }), { name: 'B' });
  assert.deepEqual(store.setHeader(undefined), {});
  assert.deepEqual(store.setSite({ title: 'T', colors: { accent: '#000000' } }), { title: 'T', colors: { accent: '#000000' } });
  assert.deepEqual(store.getSite(), { title: 'T', colors: { accent: '#000000' } });
  assert.equal(store.getPublishStatus().isDirty, true);
  assert.deepEqual(store.setSite(null), {});
  for (const bad of ['x', ['a'], 3]) {
    assert.throws(() => store.setHeader(bad), (e) => e.status === 400 && /header must be an object/.test(e.message));
    assert.throws(() => store.setSite(bad), (e) => e.status === 400 && /site must be an object/.test(e.message));
  }
});

test('header and site can merge instead of replace (colors one level deep)', () => {
  const { store } = makeStore();
  assert.deepEqual(store.setHeader({ name: 'A' }, { merge: true }), { name: 'A' }, 'merging into nothing');
  store.setHeader({ name: 'Zed', email: 'z@x', links: [{ url: 'a' }] });
  assert.deepEqual(store.setHeader({ title: 'Eng', email: null }, { merge: true }), { name: 'Zed', title: 'Eng', links: [{ url: 'a' }] });
  assert.deepEqual(store.setHeader({ links: [] }, { merge: true }).links, []);

  store.setSite({ title: 'T', font: 'inter', colors: { accent: '#111111', heading: '#222222' } });
  assert.deepEqual(store.setSite({ layout: 'sidebar', colors: { accent: '#abcdef' } }, { merge: true }), {
    title: 'T', font: 'inter', layout: 'sidebar', colors: { accent: '#abcdef', heading: '#222222' },
  });
  assert.deepEqual(store.setSite({ font: null, colors: { heading: null } }, { merge: true }), { title: 'T', layout: 'sidebar', colors: { accent: '#abcdef' } });
  assert.throws(() => store.setSite({ colors: 'red' }, { merge: true }), (e) => e.status === 400 && /site\.colors must be an object/.test(e.message));
  assert.throws(() => store.setHeader(['x'], { merge: true }), (e) => e.status === 400 && /header must be an object/.test(e.message));
  assert.deepEqual(store.getSite(), { title: 'T', layout: 'sidebar', colors: { accent: '#abcdef' } });
  assert.deepEqual(store.setSite({ colors: null }, { merge: true }), { title: 'T', layout: 'sidebar' });
});

test('publish snapshots the draft, writes the PDF, and clears isDirty', async () => {
  const { store, pdfPath, calls, setting } = makeStore();
  assert.deepEqual(store.getPublishStatus(), { publishedAt: null, isDirty: false, pdfStale: false });
  store.setHeader({ name: 'Zed' });
  const h = store.createBlock({ type: 'heading', data: { text: 'H' } });
  const x = store.createBlock({ type: 'experience', data: { jobTitle: 'J' }, parentId: h.id });
  store.updateBlock(x.id, { visibleWeb: false });
  assert.equal(store.getPublishStatus().isDirty, true);

  const { publishedAt } = await store.publish();
  assert.ok(publishedAt);
  assert.equal(calls.renderPdf, 1);
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), '%PDF-fake');
  assert.deepEqual(store.getPublishStatus(), { publishedAt, isDirty: false, pdfStale: false });
  assert.deepEqual(setting('pdf_meta'), { renderedFor: publishedAt });
  const snap = setting('published_resume');
  assert.deepEqual(snap.header, { name: 'Zed' });
  assert.deepEqual(ids(snap.blocks), [h.id, x.id]);

  // the public view filters by mode and keeps hidden blocks as placeholders
  const web = store.getPublishedResume('web');
  assert.equal(web.blocks.length, 2);
  assert.equal(web.blocks[1].hidden, true);
  assert.deepEqual(web.blocks[1].data, {});
  const print = store.getPublishedResume('print');
  assert.deepEqual(print.blocks[1].data, { jobTitle: 'J' });
  assert.equal(store.getPublishedResume('bogus').blocks[1].hidden, true);

  // a later edit makes the draft dirty again
  store.setSite({ title: 'new' });
  assert.equal(store.getPublishStatus().isDirty, true);
});

test('publish still writes the snapshot when the PDF render fails, and says so', async () => {
  const boom = new Error('chromium exploded');
  const { store, pdfPath, setting } = makeStore({ renderPdf: async () => { throw boom; } });
  store.setHeader({ name: 'Zed' });
  await assert.rejects(store.publish(), (e) => e.status === 500 && e.cause === boom && /Published, but the PDF render failed/.test(e.message));
  assert.deepEqual(setting('published_resume').header, { name: 'Zed' });
  assert.equal(fs.existsSync(pdfPath), false);
  assert.equal(store.getPublishStatus().isDirty, false);
  assert.equal(store.getPublishStatus().pdfStale, true);
});

test('pdfStale tracks whether the PDF on disk matches the published snapshot', async () => {
  let ok = true;
  const { store, db, pdfPath, setting } = makeStore({
    renderPdf: async () => {
      if (!ok) throw new Error('no chromium');
      return Buffer.from('pdf');
    },
  });
  // An install upgraded from before pdf_meta existed: snapshot + file, no
  // meta → assumed current.
  db.prepare("INSERT INTO settings (key, value) VALUES ('published_resume', ?)").run(
    JSON.stringify({ header: {}, site: {}, blocks: [], publishedAt: '2026-01-01T00:00:00.000Z' })
  );
  fs.writeFileSync(pdfPath, 'old');
  assert.equal(store.getPublishStatus().pdfStale, false);

  // Its first publish fails to render: the site moved on, the file didn't.
  ok = false;
  store.setHeader({ name: 'New' });
  await assert.rejects(store.publish());
  assert.equal(store.getPublishStatus().pdfStale, true);
  assert.deepEqual(setting('pdf_meta'), { renderedFor: '2026-01-01T00:00:00.000Z' });
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), 'old');

  // A later successful publish clears it; a missing file flags it again.
  ok = true;
  const { publishedAt } = await store.publish();
  assert.deepEqual(store.getPublishStatus(), { publishedAt, isDirty: false, pdfStale: false });
  fs.unlinkSync(pdfPath);
  assert.equal(store.getPublishStatus().pdfStale, true);
  await store.ensurePdf();
  assert.equal(store.getPublishStatus().pdfStale, false);
});

test('concurrent publishes are serialized', async () => {
  let active = 0;
  let maxActive = 0;
  const { store } = makeStore({
    renderPdf: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return Buffer.from('x');
    },
  });
  await Promise.all([store.publish(), store.publish(), store.publish()]);
  assert.equal(maxActive, 1);
});

test('ensurePdf renders only when no PDF exists', async () => {
  const { store, pdfPath, calls } = makeStore();
  assert.deepEqual(await store.ensurePdf(), { rendered: true });
  assert.equal(calls.renderPdf, 1);
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), '%PDF-fake');
  assert.deepEqual(await store.ensurePdf(), { rendered: false });
  assert.equal(calls.renderPdf, 1);
});

test('ensurePdf queues behind an in-flight publish and never overwrites its output', async () => {
  // A slow first render (the first-boot case) must not land on top of the
  // PDF a publish started afterwards wrote.
  let n = 0;
  const { store, pdfPath } = makeStore({
    renderPdf: async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1));
      return Buffer.from(`render-${n}`);
    },
  });
  const [first, published] = await Promise.all([store.ensurePdf(), store.publish()]);
  assert.deepEqual(first, { rendered: true });
  assert.ok(published.publishedAt);
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), 'render-2');

  // and the other way round: a publish already running makes ensurePdf a no-op
  const { store: store2, pdfPath: pdfPath2, calls } = makeStore();
  const [, second] = await Promise.all([store2.publish(), store2.ensurePdf()]);
  assert.deepEqual(second, { rendered: false });
  assert.equal(calls.renderPdf, 1);
  assert.equal(fs.readFileSync(pdfPath2, 'utf8'), '%PDF-fake');
});

test('publish snapshots the draft at call time, before waiting for the PDF queue', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { store, setting } = makeStore({ renderPdf: async () => { await gate; return Buffer.from('x'); } });
  store.setHeader({ name: 'First' });
  const first = store.publish(); // render blocks on the gate
  await new Promise((r) => setTimeout(r, 2)); // isDirty compares ms timestamps
  store.setHeader({ name: 'Second' }); // an edit that lands while it renders
  assert.deepEqual(setting('published_resume').header, { name: 'First' });
  assert.equal(store.getPublishStatus().isDirty, true);
  const second = store.publish(); // queued behind the first
  assert.deepEqual(setting('published_resume').header, { name: 'Second' });
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.ok(a.publishedAt < b.publishedAt || a.publishedAt === b.publishedAt);
  assert.deepEqual(store.getPublishStatus(), { publishedAt: b.publishedAt, isDirty: false, pdfStale: false });
});

test('a hung render times out and releases the queue for later publishes', async () => {
  let hang = true;
  let aborted = false;
  const { store, pdfPath, setting } = makeStore({
    pdfTimeoutMs: 20,
    renderPdf: ({ signal }) => {
      if (!hang) return Promise.resolve(Buffer.from('ok'));
      signal.addEventListener('abort', () => { aborted = /abandoned/.test(signal.reason?.message); });
      return new Promise(() => {});
    },
  });
  store.setHeader({ name: 'A' });
  await assert.rejects(
    store.publish(),
    (e) => e.status === 500 && /PDF render failed/.test(e.message) && /timed out after 20 ms/.test(e.cause.message)
  );
  assert.deepEqual(setting('published_resume').header, { name: 'A' });
  assert.equal(store.getPublishStatus().pdfStale, true);
  assert.equal(aborted, true, 'the renderer is told to stop, and why');
  assert.equal(fs.readdirSync(path.dirname(pdfPath)).length, 0, 'no temp file left behind');
  hang = false;
  const { publishedAt } = await store.publish();
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), 'ok');
  assert.deepEqual(store.getPublishStatus(), { publishedAt, isDirty: false, pdfStale: false });
});

test('the PDF is written atomically: the old file stays intact until the new one is complete', async () => {
  const { store, pdfPath } = makeStore({
    renderPdf: async () => {
      // While a render is in flight the previously published file is still
      // whole, and no partial file is served from the real path.
      assert.equal(fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath, 'utf8') : null, fs.existsSync(pdfPath) ? '%PDF-first' : null);
      return Buffer.from(fs.existsSync(pdfPath) ? '%PDF-second' : '%PDF-first');
    },
  });
  await store.publish();
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), '%PDF-first');
  await store.publish();
  assert.equal(fs.readFileSync(pdfPath, 'utf8'), '%PDF-second');
  assert.deepEqual(fs.readdirSync(path.dirname(pdfPath)), ['resume.pdf'], 'the temp file is renamed away');
});

test('discardDraft restores the published snapshot and 409s when nothing is published', async () => {
  const { store, setting } = makeStore();
  assert.throws(() => store.discardDraft(), (e) => e.status === 409 && /Nothing has been published/.test(e.message));

  store.setHeader({ name: 'Published' });
  store.setSite({ title: 'P' });
  const h = store.createBlock({ type: 'heading', data: { text: 'H' } });
  const a = store.createBlock({ type: 'experience', data: { jobTitle: 'A' }, parentId: h.id });
  await store.publish();

  store.setHeader({ name: 'Draft' });
  store.createBlock({ type: 'summary', data: { text: 'scratch' } });
  store.deleteBlock(a.id);
  assert.equal(store.getPublishStatus().isDirty, true);

  const restored = store.discardDraft();
  assert.deepEqual(restored.header, { name: 'Published' });
  assert.deepEqual(restored.site, { title: 'P' });
  assert.deepEqual(ids(restored.blocks), [h.id, a.id]);
  assert.deepEqual(restored.blocks.map((b) => [b.parentId, b.position]), [[null, 0], [h.id, 0]]);
  assert.deepEqual(setting('draft_meta'), { lastEditedAt: null });
  assert.equal(store.getPublishStatus().isDirty, false);
  assert.deepEqual(store.listBlocks(), restored.blocks);
});
