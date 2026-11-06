import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { migrateToResumes } from './resumeMigration.js';
import { pdfPathFor } from './pdfPaths.js';
import { createResumeStore } from './resumeStore.js';

// Creating, cloning, updating and deleting resumes (issue #53, phase 2a),
// over a ':memory:' database like resumeStore.test.js.
function makeStore({ renderPdf } = {}) {
  const db = new Database(':memory:');
  ensureSchema(db);
  const defaultId = migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-resumes-'));
  const rendered = [];
  const store = createResumeStore({
    db,
    pdfDir,
    renderPdf:
      renderPdf ||
      (async ({ resumeId }) => {
        rendered.push(resumeId);
        return Buffer.from('%PDF-fake');
      }),
  });
  store.setHeader({ name: 'Zed', email: 'zed@example.com' });
  store.setSite({ title: 'Zed', layout: 'sidebar' });
  return { store, db, defaultId, pdfDir, rendered };
}

const statusOf = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

function addContent(scoped) {
  const h = scoped.createBlock({ type: 'heading', data: { text: 'Experience' } });
  const e = scoped.createBlock({ type: 'experience', parentId: h.id, data: { jobTitle: 'Dev', company: 'Acme' } });
  const s = scoped.createBlock({ type: 'summary', data: { text: 'Hi' } });
  return { h, e, s };
}

test('the migrated install lists one resume: the default, public', () => {
  const { store, defaultId } = makeStore();
  assert.deepEqual(
    store.listResumes().map((r) => [r.id, r.slug, r.isDefault, r.isPublic, r.publishedAt]),
    [[defaultId, 'main', true, true, null]]
  );
  assert.equal(store.getResume(defaultId).name, 'Main resume');
});

test('a blank resume starts private, unpublished, with the default header and look and no blocks', () => {
  const { store, defaultId } = makeStore();
  addContent(store);
  const r = store.createResume({ name: 'Sales' });
  assert.equal(r.slug, 'sales');
  assert.equal(r.isDefault, false);
  assert.equal(r.isPublic, false);
  assert.equal(r.publishedAt, null);
  assert.equal(r.isDirty, true);
  const scoped = store.forResume(r.id);
  assert.deepEqual(scoped.getHeader(), { name: 'Zed', email: 'zed@example.com' });
  assert.deepEqual(scoped.getSite(), { title: 'Zed', layout: 'sidebar' });
  assert.deepEqual(scoped.listBlocks(), []);
  assert.equal(store.defaultResumeId(), defaultId);
});

test('slugs are derived from the name and made unique; an explicit one must be free and valid', async () => {
  const { store } = makeStore();
  assert.equal(store.createResume({ name: 'Sales — EMEA' }).slug, 'sales-emea');
  assert.equal(store.createResume({ name: 'Sales — EMEA' }).slug, 'sales-emea-2');
  assert.equal(store.createResume({ name: 'Anything', slug: 'sec' }).slug, 'sec');
  assert.equal(await statusOf(() => store.createResume({ name: 'Again', slug: 'sec' })), 409);
  assert.equal(await statusOf(() => store.createResume({ name: 'Again', slug: 'main' })), 409);
  assert.equal(await statusOf(() => store.createResume({ name: 'Bad', slug: 'Not OK' })), 400);
  assert.equal(await statusOf(() => store.createResume({ slug: 'no-name' })), 400);
  assert.equal(await statusOf(() => store.createResume({ name: 'X', copyFrom: 'nope' })), 400);
  assert.equal(await statusOf(() => store.createResume('Sales')), 400);
  assert.equal(store.listResumes().length, 4);
});

test('a clone copies the draft with fresh block ids and nesting intact, and stays independent', () => {
  const { store, defaultId } = makeStore();
  const { h, e, s } = addContent(store);
  store.updateBlock(s.id, { visibleWeb: false });
  const clone = store.createResume({ name: 'Security', copyFrom: defaultId });
  const scoped = store.forResume(clone.id);

  const source = store.listBlocks();
  const copy = scoped.listBlocks();
  assert.deepEqual(
    copy.map((b) => [b.type, b.data, b.visibleWeb, b.visiblePrint]),
    source.map((b) => [b.type, b.data, b.visibleWeb, b.visiblePrint])
  );
  assert.equal(copy.filter((b) => [h.id, e.id, s.id].includes(b.id)).length, 0, 'no block id is shared');
  const [copyHeading, copyExperience] = copy;
  assert.equal(copyExperience.parentId, copyHeading.id);

  // Editing or deleting through the clone leaves the source alone.
  scoped.updateBlock(copyExperience.id, { data: { jobTitle: 'Lead', company: 'Acme' } });
  scoped.deleteBlock(copyHeading.id);
  assert.deepEqual(store.getBlock(e.id).data, { jobTitle: 'Dev', company: 'Acme' });
  assert.equal(store.getBlock(e.id).parentId, h.id);
  assert.deepEqual(store.listBlocks().map((b) => b.id), source.map((b) => b.id));
});

test('a clone of a non-default resume copies that one, never its published snapshot', async () => {
  const { store } = makeStore();
  const a = store.createResume({ name: 'A' });
  store.forResume(a.id).setHeader({ name: 'Zed (A)' });
  store.forResume(a.id).createBlock({ type: 'summary', data: { text: 'from A' } });
  await store.forResume(a.id).publish();
  const b = store.createResume({ name: 'B', copyFrom: a.id });
  assert.deepEqual(store.forResume(b.id).getHeader(), { name: 'Zed (A)' });
  assert.deepEqual(store.forResume(b.id).listBlocks().map((x) => x.data.text), ['from A']);
  assert.equal(store.getResume(b.id).publishedAt, null);
  assert.equal(store.forResume(b.id).getPdfFile(), null);
});

test('updateResume renames, changes the slug and toggles public, validating each', async () => {
  const { store } = makeStore();
  const r = store.createResume({ name: 'Sales' });
  store.createResume({ name: 'Ops' });
  const updated = store.updateResume(r.id, { name: ' Sales 2026 ', slug: 'sales-2026', isPublic: true });
  assert.deepEqual([updated.name, updated.slug, updated.isPublic], ['Sales 2026', 'sales-2026', true]);
  assert.equal(store.updateResume(r.id, { slug: 'sales-2026' }).slug, 'sales-2026', 'keeping its own slug is fine');
  assert.equal(store.updateResume(r.id, { isPublic: false }).isPublic, false);

  assert.equal(await statusOf(() => store.updateResume(r.id, { slug: 'ops' })), 409);
  assert.equal(await statusOf(() => store.updateResume(r.id, { slug: 'Ops!' })), 400);
  assert.equal(await statusOf(() => store.updateResume(r.id, { name: '' })), 400);
  assert.equal(await statusOf(() => store.updateResume(r.id, { isPublic: 'yes' })), 400);
  assert.equal(await statusOf(() => store.updateResume(r.id, { id: 'other' })), 400);
  assert.equal(await statusOf(() => store.updateResume(r.id, null)), null, 'an empty patch changes nothing');
  assert.equal(await statusOf(() => store.updateResume('nope', { name: 'x' })), 404);
  assert.equal(store.getResume(r.id).slug, 'sales-2026');
});

test('only a published resume can become the default; it becomes public and the old one steps down', async () => {
  const { store, defaultId } = makeStore();
  const r = store.createResume({ name: 'Sales' });
  store.forResume(r.id).setHeader({ name: 'Zed, Sales' });
  assert.equal(await statusOf(() => store.updateResume(r.id, { isDefault: true })), 409);
  assert.equal(store.defaultResumeId(), defaultId);

  await store.forResume(r.id).publish();
  const now = store.updateResume(r.id, { isDefault: true });
  assert.deepEqual([now.isDefault, now.isPublic], [true, true]);
  assert.equal(store.defaultResumeId(), r.id);
  assert.equal(store.getResume(defaultId).isDefault, false);
  assert.equal(store.getResume(defaultId).isPublic, true, 'the old default keeps its visibility');
  // The default-bound operations (unprefixed routes, MCP) follow it.
  assert.deepEqual(store.getHeader(), { name: 'Zed, Sales' });
  assert.equal(store.getPublishedResume().header.name, 'Zed, Sales');

  assert.equal(await statusOf(() => store.updateResume(r.id, { isDefault: false })), 409);
  assert.equal(await statusOf(() => store.updateResume(r.id, { isPublic: false })), 409);
  assert.equal(await statusOf(() => store.updateResume(defaultId, { isDefault: true, isPublic: false })), 409);
  assert.equal(store.updateResume(r.id, { isDefault: true }).isDefault, true, 'already the default: a no-op');
});

test('publishing a non-default resume renders its own PDF', async () => {
  const { store, rendered, pdfDir } = makeStore();
  const r = store.createResume({ name: 'Sales' });
  await store.forResume(r.id).publish();
  assert.deepEqual(rendered, [r.id]);
  assert.equal(store.forResume(r.id).getPdfFile().path, pdfPathFor(pdfDir, r.id));
  assert.equal(store.getPdfFile(), null, 'the default still has none');
});

test('deleting a resume removes its blocks, settings and PDF; the default cannot be deleted', async () => {
  const { store, db, defaultId, pdfDir } = makeStore();
  const r = store.createResume({ name: 'Sales', copyFrom: defaultId });
  addContent(store.forResume(r.id));
  await store.forResume(r.id).publish();
  assert.ok(fs.existsSync(pdfPathFor(pdfDir, r.id)));

  assert.deepEqual(await store.deleteResume(r.id), { deleted: r.id });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blocks WHERE resume_id = ?').get(r.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resume_settings WHERE resume_id = ?').get(r.id).n, 0);
  assert.equal(fs.existsSync(pdfPathFor(pdfDir, r.id)), false);
  assert.equal(await statusOf(() => store.forResume(r.id)), 404);
  assert.equal(await statusOf(() => store.deleteResume(r.id)), 404);
  assert.deepEqual(store.listResumes().map((x) => x.id), [defaultId]);

  assert.equal(await statusOf(() => store.deleteResume(defaultId)), 409);
  assert.equal(store.defaultResumeId(), defaultId);
});

test("deleting a resume doesn't wait for another resume's render", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { store, pdfDir } = makeStore({
    renderPdf: async () => {
      await gate;
      return Buffer.from('%PDF-slow');
    },
  });
  const busy = store.createResume({ name: 'Busy' });
  const doomed = store.createResume({ name: 'Doomed' });
  fs.writeFileSync(pdfPathFor(pdfDir, doomed.id), '%PDF-old');
  const publishing = store.forResume(busy.id).publish();
  // Returns at once, PDF already gone, while the other render still holds the queue.
  assert.deepEqual(store.deleteResume(doomed.id), { deleted: doomed.id });
  assert.equal(fs.existsSync(pdfPathFor(pdfDir, doomed.id)), false);
  release();
  await publishing;
  assert.ok(store.forResume(busy.id).getPdfFile());
});

for (const when of ['queued', 'running']) {
  test(`a render ${when} when its resume is deleted writes nothing`, async () => {
    let release;
    let started;
    const gate = new Promise((resolve) => (release = resolve));
    const running = new Promise((resolve) => (started = resolve));
    const rendered = [];
    const { store, db, pdfDir } = makeStore({
      renderPdf: async ({ resumeId }) => {
        rendered.push(resumeId);
        started();
        await gate;
        return Buffer.from('%PDF-late');
      },
    });
    const r = store.createResume({ name: 'Sales' });
    const publishing = store.forResume(r.id).publish();
    if (when === 'running') await running;
    const deleting = store.deleteResume(r.id);
    release();
    assert.equal(await statusOf(() => publishing), 404);
    await deleting;
    assert.deepEqual(rendered, when === 'running' ? [r.id] : []);
    assert.equal(fs.existsSync(pdfPathFor(pdfDir, r.id)), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resume_settings WHERE resume_id = ?').get(r.id).n, 0);
  });
}

test('domains: setting them makes a resume public, making it private removes them, and each shows one resume', async () => {
  const { store, defaultId } = makeStore();
  const sales = store.createResume({ name: 'Sales' });
  const ops = store.createResume({ name: 'Ops' });

  const mapped = store.updateResume(sales.id, { hostnames: ['Sales.Example.com', 'sales.example.com.', 'jobs.example.com'] });
  assert.deepEqual(mapped.hostnames, ['jobs.example.com', 'sales.example.com']);
  assert.equal(mapped.isPublic, true, 'a resume with domains is public');
  assert.deepEqual(store.listResumes().find((r) => r.id === sales.id).hostnames, ['jobs.example.com', 'sales.example.com']);
  assert.deepEqual(store.getResume(defaultId).hostnames, []);

  assert.equal(await statusOf(() => store.updateResume(ops.id, { hostnames: ['sales.example.com'] })), 409, 'taken by another resume');
  assert.equal(await statusOf(() => store.updateResume(ops.id, { hostnames: ['https://ops.example.com'] })), 400);
  assert.equal(await statusOf(() => store.updateResume(ops.id, { hostnames: 'ops.example.com' })), 400);
  assert.equal(await statusOf(() => store.updateResume(ops.id, { hostnames: ['ops.example.com'], isPublic: false })), 409);
  assert.deepEqual(store.getResume(ops.id).hostnames, [], 'a refused update changes nothing');
  assert.equal(store.getResume(ops.id).isPublic, false);

  assert.deepEqual(store.updateResume(sales.id, { name: 'Sales 2026' }).hostnames, ['jobs.example.com', 'sales.example.com'], 'other updates keep them');
  assert.deepEqual(store.updateResume(sales.id, { hostnames: ['sales.example.com'] }).hostnames, ['sales.example.com'], 'a list replaces them');
  const privateAgain = store.updateResume(sales.id, { isPublic: false });
  assert.deepEqual([privateAgain.isPublic, privateAgain.hostnames], [false, []]);
  assert.deepEqual(store.updateResume(ops.id, { hostnames: ['sales.example.com'] }).hostnames, ['sales.example.com'], 'freed for another resume');

  assert.deepEqual(store.updateResume(defaultId, { hostnames: ['example.com'] }).hostnames, ['example.com'], 'the default can have domains too');
  assert.equal(await statusOf(() => store.updateResume(defaultId, { hostnames: [], isPublic: false })), 409);
});

test('a host shows its mapped resume once that is published, and the default otherwise', async () => {
  const { store, defaultId } = makeStore();
  await store.publish();
  const sales = store.createResume({ name: 'Sales', copyFrom: defaultId });
  store.forResume(sales.id).setHeader({ name: 'Zed, Sales' });
  store.updateResume(sales.id, { hostnames: ['sales.example.com'] });

  const nameOn = (hostname) => store.forHost(hostname).getPublishedResume().header?.name;
  assert.equal(nameOn('sales.example.com'), 'Zed', 'not published yet: the default');
  await store.forResume(sales.id).publish();
  assert.equal(nameOn('sales.example.com'), 'Zed, Sales');
  assert.equal(nameOn('SALES.example.com.'), 'Zed, Sales');
  assert.equal(store.forHost('sales.example.com').getPdfFile().path, store.forResume(sales.id).getPdfFile().path);
  for (const other of ['example.com', 'www.sales.example.com', '127.0.0.1', '', undefined]) {
    assert.equal(nameOn(other), 'Zed', String(other));
  }

  store.updateResume(sales.id, { isPublic: false });
  assert.equal(nameOn('sales.example.com'), 'Zed', 'private again: the mapping is gone');

  store.updateResume(sales.id, { hostnames: ['sales.example.com'] });
  store.deleteResume(sales.id);
  assert.equal(nameOn('sales.example.com'), 'Zed', 'deleted: the default');
});

test('a public link (/r/<slug>) finds only a public, published resume', async () => {
  const { store, defaultId } = makeStore();
  const sales = store.createResume({ name: 'Sales', copyFrom: defaultId });
  store.forResume(sales.id).setHeader({ name: 'Zed, Sales' });

  assert.equal(await statusOf(() => store.forPublicSlug('sales')), 404, 'private and unpublished');
  await store.forResume(sales.id).publish();
  assert.equal(await statusOf(() => store.forPublicSlug('sales')), 404, 'published but private');
  store.updateResume(sales.id, { isPublic: true });
  assert.equal(store.forPublicSlug('sales').getPublishedResume().header.name, 'Zed, Sales');
  assert.equal(store.forPublicSlug('Sales').getPublishedResume().header.name, 'Zed, Sales', 'a link typed with capitals');

  const draft = store.createResume({ name: 'Draft' });
  store.updateResume(draft.id, { isPublic: true });
  assert.equal(await statusOf(() => store.forPublicSlug('draft')), 404, 'public but never published');
  assert.equal(await statusOf(() => store.forPublicSlug('main')), 404, 'the default, never published');
  await store.publish();
  assert.equal(store.forPublicSlug('main').getPublishedResume().header.name, 'Zed', 'the default has a link too');
  for (const bad of ['nope', '', undefined, sales.id]) {
    assert.equal(await statusOf(() => store.forPublicSlug(bad)), 404, String(bad));
  }
});

test('a resume keeps the brief it was tailored for: set, copied, replaced, cleared, never published', async () => {
  const { store, db, defaultId } = makeStore();
  const brief = { audience: 'SRE roles', posting: 'On-call.', guidance: '' };
  assert.equal(store.getResume(defaultId).tailoring, null);

  const acme = store.createResume({ name: 'Acme', copyFrom: defaultId, tailoring: { audience: ' SRE roles ', posting: 'On-call.' } });
  assert.deepEqual(acme.tailoring, brief, 'checked and trimmed');
  assert.deepEqual(store.listResumes().find((r) => r.id === acme.id).tailoring, brief);
  assert.deepEqual(store.createResume({ name: 'Acme 2', copyFrom: acme.id }).tailoring, brief, "a copy keeps its source's");
  assert.equal(store.createResume({ name: 'Acme 3', copyFrom: acme.id, tailoring: null }).tailoring, null, 'unless told otherwise');
  assert.equal(store.createResume({ name: 'Blank' }).tailoring, null);
  assert.equal(await statusOf(() => store.createResume({ name: 'Bad', tailoring: { posting: 'x' } })), 400);
  assert.equal(store.listResumes().length, 5, 'a bad brief creates nothing');

  // It's a note about the draft, not part of it.
  const statusBefore = store.forResume(acme.id).getPublishStatus();
  const updated = store.updateResume(acme.id, { tailoring: { audience: 'Platform roles', guidance: 'Stress Kubernetes.' } });
  assert.deepEqual(updated.tailoring, { audience: 'Platform roles', posting: '', guidance: 'Stress Kubernetes.' });
  assert.deepEqual(store.forResume(acme.id).getPublishStatus(), statusBefore, 'not a draft change');
  assert.deepEqual(store.updateResume(acme.id, { name: 'Acme SRE' }).tailoring, updated.tailoring, 'other updates leave it');
  assert.equal(await statusOf(() => store.updateResume(acme.id, { tailoring: 'SRE' })), 400);
  assert.throws(() => store.updateResume(acme.id, { tailoring: { audience: '' } }), /^Error: tailoring\.audience is required/);
  assert.equal(await statusOf(() => store.updateResume(acme.id, { tailoring: { audience: 'x'.repeat(201) } })), 400);
  assert.deepEqual(store.getResume(acme.id).tailoring, updated.tailoring, 'a refused update changes nothing');

  await store.forResume(acme.id).publish();
  assert.equal(JSON.stringify(store.forResume(acme.id).getPublishedResume()).includes('Platform roles'), false);

  assert.equal(store.updateResume(acme.id, { tailoring: null }).tailoring, null);
  store.updateResume(acme.id, { tailoring: brief });
  store.deleteResume(acme.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM resume_settings WHERE resume_id = ? AND key = 'tailoring'").get(acme.id).n, 0);
});

test('deleting a resume removes its domains', () => {
  const { store, db } = makeStore();
  const r = store.createResume({ name: 'Sales' });
  store.updateResume(r.id, { hostnames: ['sales.example.com'] });
  store.deleteResume(r.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resume_hosts').get().n, 0);
});
