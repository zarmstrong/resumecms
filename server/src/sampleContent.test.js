import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';
import { SAMPLE_BLOCKS, SAMPLE_HEADER } from './sampleContent.js';

// db.js seeds these into a new install without going through the store,
// so check here that the store would take every one of them.
test('the sample blocks and header pass the store checks', () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  migrateToResumes(db);
  const store = createResumeStore({ db, pdfDir: '/nonexistent', renderPdf: async () => Buffer.from('') });
  store.setHeader(SAMPLE_HEADER);
  for (const { type, data } of SAMPLE_BLOCKS) {
    assert.doesNotThrow(() => store.createBlock({ type, data }), type);
  }
  assert.deepEqual(
    store.listBlocks().map((b) => b.type),
    SAMPLE_BLOCKS.map((b) => b.type),
  );
});

test('the sample content is placeholder text for any line of work', () => {
  const text = JSON.stringify(SAMPLE_BLOCKS);
  for (const word of ['Engineer', 'AWS', 'Docker', 'Technical', 'Technologies']) {
    assert.ok(!text.includes(word), word);
  }
});
