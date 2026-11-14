import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBlocks, sampleHeader } from './sampleResume.js';
import { SAMPLE_BLOCKS, SAMPLE_HEADER } from '../../../server/src/sampleContent.js';

// The template previews show what a fresh install is seeded with.
test('the template previews use the content a new install starts with', () => {
  assert.deepEqual(sampleHeader, SAMPLE_HEADER);
  assert.deepEqual(
    sampleBlocks.map(({ type, data }) => ({ type, data })),
    SAMPLE_BLOCKS,
  );
  sampleBlocks.forEach((block, i) => {
    assert.equal(block.position, i);
    assert.equal(block.visibleWeb && block.visiblePrint, true);
  });
});
