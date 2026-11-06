import test from 'node:test';
import assert from 'node:assert/strict';
import { PDF_URL_PATH, pdfUrl, publicPdfPath } from './pdfUrl.js';

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

test('another PDF path gets the same cache-busting, and a slug is escaped', () => {
  assert.equal(publicPdfPath('sales'), '/api/public/resumes/sales/resume.pdf');
  assert.equal(publicPdfPath('a/b'), '/api/public/resumes/a%2Fb/resume.pdf');
  assert.equal(pdfUrl('7', publicPdfPath('sales')), '/api/public/resumes/sales/resume.pdf?v=7');
  assert.equal(pdfUrl(null, '/api/resumes/r1/resume.pdf'), '/api/resumes/r1/resume.pdf');
});
