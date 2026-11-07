import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { migrateToResumes } from './resumeMigration.js';
import { letterPdfPathFor } from './pdfPaths.js';
import { createResumeStore } from './resumeStore.js';
import { initialCoverLetterData } from './coverLetterFields.js';

// Cover letters (issue #71) through the real store, over a ':memory:'
// database like resumeStore.test.js. The letter renderer is a fake that
// records which letter it was asked for and can be held open.
function makeStore({ renderLetterPdf } = {}) {
  const db = new Database(':memory:');
  ensureSchema(db);
  const defaultId = migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-letters-'));
  const rendered = [];
  const store = createResumeStore({
    db,
    pdfDir,
    renderPdf: async () => Buffer.from('%PDF-resume'),
    renderLetterPdf:
      renderLetterPdf ||
      (async ({ letterId }) => {
        rendered.push(letterId);
        return Buffer.from(`%PDF-letter-${rendered.length}`);
      }),
  });
  store.setHeader({ name: 'Ada Lovelace', email: 'ada@example.com' });
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

test('a new letter starts from the empty one; a list is oldest first', () => {
  const { store, defaultId } = makeStore();
  const first = store.createCoverLetter();
  assert.equal(first.title, 'Cover letter');
  assert.equal(first.resumeId, defaultId);
  assert.deepEqual(first.data, initialCoverLetterData());
  const second = store.createCoverLetter({ title: ' Acme SRE ', data: { paragraphs: ['Hello'] } });
  assert.equal(second.title, 'Acme SRE');
  assert.deepEqual(second.data, { paragraphs: ['Hello'] });
  assert.deepEqual(store.listCoverLetters().map((l) => l.id), [first.id, second.id]);
  assert.deepEqual(store.getCoverLetter(second.id), second);
});

test('create checks its input: data, title, copyFrom, unknown fields', async () => {
  const { store } = makeStore();
  const existing = store.createCoverLetter();
  assert.equal(await statusOf(() => store.createCoverLetter({ data: { paragraphs: 'x' } })), 400);
  assert.equal(await statusOf(() => store.createCoverLetter({ data: [] })), 400);
  assert.equal(await statusOf(() => store.createCoverLetter({ title: '' })), 400);
  assert.equal(await statusOf(() => store.createCoverLetter({ copyFrom: 'nope' })), 400);
  assert.equal(await statusOf(() => store.createCoverLetter({ copyFrom: existing.id, data: {} })), 400);
  // the resume is the URL prefix, never a body field
  assert.equal(await statusOf(() => store.createCoverLetter({ resumeId: 'x' })), 400);
  assert.equal(store.listCoverLetters().length, 1);
});

test('a copy has the source data under a "(copy)" title and is independent of it', () => {
  const { store } = makeStore();
  const source = store.createCoverLetter({ title: 'Acme', data: { paragraphs: ['One'] } });
  const copy = store.createCoverLetter({ copyFrom: source.id });
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.title, 'Acme (copy)');
  assert.deepEqual(copy.data, source.data);
  store.updateCoverLetter(copy.id, { data: { paragraphs: ['Two'] } });
  assert.deepEqual(store.getCoverLetter(source.id).data, { paragraphs: ['One'] });
  assert.equal(store.createCoverLetter({ copyFrom: source.id, title: 'Beta' }).title, 'Beta');
});

test('update replaces data, or merges it with mergeData; it renames; the result is checked', async () => {
  const { store } = makeStore();
  const letter = store.createCoverLetter({ data: { salutation: 'Hi,', paragraphs: ['One'], closing: 'Best,' } });
  const renamed = store.updateCoverLetter(letter.id, { title: 'Beta' });
  assert.equal(renamed.title, 'Beta');
  assert.deepEqual(renamed.data, letter.data);
  assert.ok(renamed.updatedAt >= letter.updatedAt);

  assert.deepEqual(store.updateCoverLetter(letter.id, { data: { paragraphs: ['Two'] } }).data, { paragraphs: ['Two'] });
  const merged = store.updateCoverLetter(letter.id, { data: { closing: 'Yours,', company: 'Acme' } }, { mergeData: true });
  assert.deepEqual(merged.data, { paragraphs: ['Two'], closing: 'Yours,', company: 'Acme' });
  assert.deepEqual(store.updateCoverLetter(letter.id, { data: { company: null } }, { mergeData: true }).data, {
    paragraphs: ['Two'],
    closing: 'Yours,',
  });

  assert.equal(await statusOf(() => store.updateCoverLetter(letter.id, { data: { paragraphs: [1] } }, { mergeData: true })), 400);
  assert.equal(await statusOf(() => store.updateCoverLetter(letter.id, { title: '  ' })), 400);
  assert.equal(await statusOf(() => store.updateCoverLetter(letter.id, { position: 1 })), 400);
  assert.equal(await statusOf(() => store.updateCoverLetter('nope', { title: 'x' })), 404);
  assert.equal(store.getCoverLetter(letter.id).title, 'Beta');
});

test("letters don't touch the draft: no unpublished changes, nothing in the snapshot", async () => {
  const { store } = makeStore();
  await store.publish();
  const letter = store.createCoverLetter();
  store.updateCoverLetter(letter.id, { title: 'x' });
  assert.equal(store.getPublishStatus().isDirty, false);
  store.deleteCoverLetter(letter.id);
  assert.equal(store.getPublishStatus().isDirty, false);
  await store.publish();
  assert.equal('coverLetters' in store.getPublishedResume('web'), false);
});

test("a letter of another resume is not found through this one, in every operation", async () => {
  const { store } = makeStore();
  const other = store.forResume(store.createResume({ name: 'Sales' }).id);
  const theirs = other.createCoverLetter({ title: 'Theirs' });
  assert.deepEqual(store.listCoverLetters(), []);
  assert.equal(await statusOf(() => store.getCoverLetter(theirs.id)), 404);
  assert.equal(await statusOf(() => store.updateCoverLetter(theirs.id, { title: 'Mine' })), 404);
  assert.equal(await statusOf(() => store.deleteCoverLetter(theirs.id)), 404);
  assert.equal(await statusOf(() => store.coverLetterPdf(theirs.id)), 404);
  assert.equal(await statusOf(() => store.createCoverLetter({ copyFrom: theirs.id })), 400);
  assert.equal(other.getCoverLetter(theirs.id).title, 'Theirs');
});

test("copying a resume doesn't copy its letters; deleting one deletes them with their PDFs", async () => {
  const { store, db, pdfDir } = makeStore();
  const sales = store.forResume(store.createResume({ name: 'Sales' }).id);
  const letter = sales.createCoverLetter();
  await sales.coverLetterPdf(letter.id);
  assert.ok(fs.existsSync(letterPdfPathFor(pdfDir, letter.id)));

  const copy = store.createResume({ name: 'Copy', copyFrom: sales.getCoverLetter(letter.id).resumeId });
  assert.deepEqual(store.forResume(copy.id).listCoverLetters(), []);

  store.deleteResume(letter.resumeId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cover_letters').get().n, 0);
  assert.equal(fs.existsSync(letterPdfPathFor(pdfDir, letter.id)), false);
});

test('deleting a letter removes it and its PDF; an unknown id is a 404', async () => {
  const { store, pdfDir } = makeStore();
  const letter = store.createCoverLetter();
  await store.coverLetterPdf(letter.id);
  assert.deepEqual(store.deleteCoverLetter(letter.id), { deleted: letter.id });
  assert.equal(fs.existsSync(letterPdfPathFor(pdfDir, letter.id)), false);
  assert.equal(await statusOf(() => store.deleteCoverLetter(letter.id)), 404);
});

test('the PDF is rendered once and reused until the letter, header or look changes', async () => {
  const { store, rendered } = makeStore();
  const letter = store.createCoverLetter({ title: 'Acme', data: { company: 'Acme', paragraphs: ['Hi'] } });
  const pdf = await store.coverLetterPdf(letter.id);
  assert.deepEqual(rendered, [letter.id]);
  assert.equal(fs.readFileSync(pdf.path, 'utf8'), '%PDF-letter-1');
  assert.equal(pdf.name, 'Ada Lovelace');
  assert.equal(pdf.company, 'Acme');

  await store.coverLetterPdf(letter.id);
  // a rename isn't in the PDF
  store.updateCoverLetter(letter.id, { title: 'Acme SRE' });
  await store.coverLetterPdf(letter.id);
  assert.equal(rendered.length, 1);

  store.updateCoverLetter(letter.id, { data: { signature: 'A. Lovelace' } }, { mergeData: true });
  assert.equal((await store.coverLetterPdf(letter.id)).name, 'A. Lovelace');
  store.setHeader({ name: 'Ada Lovelace', email: 'ada@example.org' });
  await store.coverLetterPdf(letter.id);
  store.setSite({ font: 'lora' });
  await store.coverLetterPdf(letter.id);
  assert.equal(rendered.length, 4);

  // a file gone from disk is rendered again
  fs.rmSync(pdf.path);
  await store.coverLetterPdf(letter.id);
  assert.equal(rendered.length, 5);
});

test('a failed render is a 500 and caches nothing', async () => {
  let fail = true;
  const { store } = makeStore({
    renderLetterPdf: async () => {
      if (fail) throw new Error('Chromium fell over');
      return Buffer.from('%PDF-ok');
    },
  });
  const letter = store.createCoverLetter();
  await assert.rejects(store.coverLetterPdf(letter.id), (e) => e.status === 500 && e.cause?.message === 'Chromium fell over');
  fail = false;
  assert.equal(fs.readFileSync((await store.coverLetterPdf(letter.id)).path, 'utf8'), '%PDF-ok');
});

test('a letter deleted while its render runs gets no file', async () => {
  let release;
  const { store, pdfDir } = makeStore({
    renderLetterPdf: () => new Promise((resolve) => (release = () => resolve(Buffer.from('%PDF-late')))),
  });
  const letter = store.createCoverLetter();
  const pending = store.coverLetterPdf(letter.id);
  await new Promise((resolve) => setImmediate(resolve));
  store.deleteCoverLetter(letter.id);
  release();
  await assert.rejects(pending, (e) => e.status === 404);
  assert.equal(fs.existsSync(letterPdfPathFor(pdfDir, letter.id)), false);
});

test('letter renders wait on the same queue as publishes', async () => {
  const order = [];
  let releaseResume;
  const db = new Database(':memory:');
  ensureSchema(db);
  migrateToResumes(db);
  const store = createResumeStore({
    db,
    pdfDir: fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-letters-')),
    renderPdf: () =>
      new Promise((resolve) => {
        order.push('resume start');
        releaseResume = () => {
          order.push('resume end');
          resolve(Buffer.from('%PDF'));
        };
      }),
    renderLetterPdf: async () => {
      order.push('letter');
      return Buffer.from('%PDF');
    },
  });
  const letter = store.createCoverLetter();
  const publishing = store.publish();
  const letterPdf = store.coverLetterPdf(letter.id);
  await new Promise((resolve) => setImmediate(resolve));
  releaseResume();
  await Promise.all([publishing, letterPdf]);
  assert.deepEqual(order, ['resume start', 'resume end', 'letter']);
});

test("what the renderer's page gets: the letter, its resume's draft header and look, and today", () => {
  const { store } = makeStore();
  const sales = store.forResume(store.createResume({ name: 'Sales' }).id);
  sales.setHeader({ name: 'Ada (draft)' });
  sales.setSite({ template: 'banner' });
  const letter = sales.createCoverLetter({ data: { paragraphs: ['Hi'] } });
  const content = store.letterForRender(letter.id);
  assert.deepEqual(content.letter, letter);
  assert.deepEqual(content.header, { name: 'Ada (draft)' });
  assert.deepEqual(content.site, { template: 'banner' });
  assert.match(content.today, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  assert.throws(() => store.letterForRender('nope'), (e) => e.status === 404);
  assert.throws(() => store.letterForRender(undefined), (e) => e.status === 404);
});

test('without a letter renderer, a PDF is a 500', async () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  migrateToResumes(db);
  const store = createResumeStore({ db, pdfDir: fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-letters-')), renderPdf: async () => Buffer.from('') });
  const letter = store.createCoverLetter();
  await assert.rejects(store.coverLetterPdf(letter.id), (e) => e.status === 500);
});
