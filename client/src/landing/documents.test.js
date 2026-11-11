import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFileSize } from './documents.js';

test("a document's size reads in KB under a megabyte, else in MB to one decimal", () => {
  assert.equal(formatFileSize(300), '1 KB');
  assert.equal(formatFileSize(0), '1 KB');
  assert.equal(formatFileSize(240 * 1024), '240 KB');
  assert.equal(formatFileSize(1024 * 1024 - 1), '1024 KB');
  assert.equal(formatFileSize(1024 * 1024), '1 MB');
  assert.equal(formatFileSize(1.25 * 1024 * 1024), '1.3 MB');
  assert.equal(formatFileSize(10 * 1024 * 1024), '10 MB');
  for (const bad of [undefined, null, NaN, -1, '12']) assert.equal(formatFileSize(bad), '');
});
