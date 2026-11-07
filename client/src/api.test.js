import test from 'node:test';
import assert from 'node:assert/strict';
import { api, resumeApi } from './api.js';

// Records each request instead of sending it.
function recordFetch(t) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return requests;
}

test("every one of a resume's calls goes under /api/resumes/:id, the id escaped", async (t) => {
  const requests = recordFetch(t);
  const rapi = resumeApi('a b');
  // (coverLetterPdfPath only builds a link)
  const calls = Object.entries(rapi).filter(([name, value]) => typeof value === 'function' && name !== 'coverLetterPdfPath');
  assert.ok(calls.length >= 18);
  for (const [, call] of calls) await call('x', {}, null, undefined, undefined);
  assert.equal(requests.length, calls.length);
  for (const { url } of requests) assert.ok(url.startsWith('/api/resumes/a%20b/'), url);
  assert.equal(rapi.pdfPath, '/api/resumes/a%20b/resume.pdf');
  assert.equal(rapi.coverLetterPdfPath('l/1'), '/api/resumes/a%20b/cover-letters/l%2F1/letter.pdf');
});

test('the resume calls and the public slug reach the right routes', async (t) => {
  const requests = recordFetch(t);
  await api.listResumes();
  await api.createResume({ name: 'Sales', copyFrom: 'main' });
  await api.updateResume('r/1', { isPublic: true });
  await api.deleteResume('r1');
  await api.getPublicResume('web');
  await api.getPublicResume('web', 'sales');
  assert.deepEqual(
    requests.map(({ url, method, body }) => [method, url, body]),
    [
      ['GET', '/api/resumes', undefined],
      ['POST', '/api/resumes', { name: 'Sales', copyFrom: 'main' }],
      ['PATCH', '/api/resumes/r%2F1', { isPublic: true }],
      ['DELETE', '/api/resumes/r1', undefined],
      ['GET', '/api/public/resume?mode=web', undefined],
      ['GET', '/api/public/resumes/sales?mode=web', undefined],
    ]
  );
});
