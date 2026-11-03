import test from 'node:test';
import assert from 'node:assert/strict';
import { PDF_URL_PATH, pdfUrl } from './pdfUrl.js';

test('a PDF version becomes a cache-busting query string', () => {
  assert.equal(pdfUrl('1762186226000'), `${PDF_URL_PATH}?v=1762186226000`);
  assert.equal(pdfUrl('a/b c'), `${PDF_URL_PATH}?v=a%2Fb%20c`);
});

test('two renders never share a URL', () => {
  assert.notEqual(pdfUrl('1762186226000'), pdfUrl('1762186227000'));
});

test('no version falls back to the bare path', () => {
  assert.equal(pdfUrl(null), PDF_URL_PATH);
  assert.equal(pdfUrl(undefined), PDF_URL_PATH);
  assert.equal(pdfUrl(''), PDF_URL_PATH);
});
