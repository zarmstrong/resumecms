import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_FILE_LIMITS,
  PUBLIC_FILE_PATH,
  checkFileRef,
  cleanFileName,
  contentDisposition,
  fileOfPath,
  isPdf,
  referencedFileIds,
  resolveFile,
  shownFileIds,
  shownFiles,
} from './landingFileFields.js';

// The landing page's documents (issue #128), the pure half.

const ID = 'a'.repeat(64);
const ID2 = 'b'.repeat(64);
const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('a PDF is told by its first bytes, never by what it claims to be', () => {
  assert.equal(isPdf(Buffer.from('%PDF-1.7\n...')), true);
  assert.equal(isPdf(Buffer.from('%PDF')), false);
  assert.equal(isPdf(Buffer.from(' %PDF-1.7')), false);
  assert.equal(isPdf(Buffer.from('<html>%PDF-1.7')), false);
  assert.equal(isPdf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false);
  assert.equal(isPdf('%PDF-1.7'), false);
  assert.equal(isPdf(null), false);
});

test('cleanFileName keeps a name a visitor may be sent, ending in .pdf', () => {
  assert.equal(cleanFileName('Portfolio 2026.pdf'), 'Portfolio 2026.pdf');
  assert.equal(cleanFileName('Portfolio.PDF'), 'Portfolio.pdf');
  assert.equal(cleanFileName('notes'), 'notes.pdf');
  assert.equal(cleanFileName('C:\\Users\\jo\\cv.pdf'), 'cv.pdf');
  assert.equal(cleanFileName('../../etc/passwd'), 'passwd.pdf');
  assert.equal(cleanFileName('say "hi" it\'s.pdf'), 'say hi its.pdf');
  assert.equal(cleanFileName('a\r\nb\u0000c\t d.pdf'), 'abc d.pdf');
  // A bidi override would make the name read as something else.
  assert.equal(cleanFileName('evil\u202Efdp.exe'), 'evilfdp.exe.pdf');
  assert.equal(cleanFileName('  ..hidden.pdf  '), 'hidden.pdf');
  assert.equal(cleanFileName('x.pdf '), 'x.pdf');
  assert.equal(cleanFileName('Lebenslauf – Jürgen 履歴書.pdf'), 'Lebenslauf – Jürgen 履歴書.pdf');
  for (const empty of ['', '.pdf', ' / ', '"', null, undefined, 42]) assert.equal(cleanFileName(empty), 'document.pdf');
  // Never longer than the cap, never cut inside a surrogate pair, never
  // holding a lone one (encodeURIComponent would throw on it).
  const long = cleanFileName(`${'😀'.repeat(200)}.pdf`);
  assert.equal(Array.from(long).length, LANDING_FILE_LIMITS.name);
  assert.ok(long.endsWith('😀.pdf'));
  assert.doesNotThrow(() => encodeURIComponent(cleanFileName('a\ud800b.pdf')));
  // Cleaning a cleaned name changes nothing, which is what a reference is held to.
  for (const raw of ['Portfolio.PDF', 'a .pdf', 'a.pdf.pdf', '..pdf', long, 'x'.repeat(300), 'abc def'.repeat(30)]) {
    assert.equal(cleanFileName(cleanFileName(raw)), cleanFileName(raw));
  }
});

test('a file reference is { fileId, name }, checked strictly, and must name a stored file unless already in the draft', () => {
  const refs = { knownFileIds: new Set([ID]) };
  assert.deepEqual(checkFileRef({ fileId: ID, name: 'cv.pdf' }, 'file', refs), { fileId: ID, name: 'cv.pdf' });
  assert.deepEqual(checkFileRef({ fileId: ID2, name: 'old.pdf' }, 'file', { previousFileIds: new Set([ID2]) }), { fileId: ID2, name: 'old.pdf' });
  for (const bad of [
    null,
    'cv.pdf',
    { fileId: ID },
    { fileId: ID, name: 'cv.pdf', size: 3 },
    { fileId: 'A'.repeat(64), name: 'cv.pdf' },
    { fileId: '../x', name: 'cv.pdf' },
    { fileId: ID2, name: 'cv.pdf' },
    { fileId: ID, name: 'cv' },
    { fileId: ID, name: 'a/b.pdf' },
    { fileId: ID, name: 'say "hi".pdf' },
    { fileId: ID, name: 'a\nb.pdf' },
    { fileId: ID, name: `${'x'.repeat(LANDING_FILE_LIMITS.name)}.pdf` },
    { fileId: ID, name: 3 },
  ]) {
    assert.equal(status(() => checkFileRef(bad, 'file', refs)), 400, JSON.stringify(bad));
  }
});

test('referencedFileIds lists every file a documents section names, shown or not', () => {
  const landing = {
    sections: [
      { kind: 'documents', hidden: true, documents: [{ file: { fileId: ID, name: 'a.pdf' } }, { file: null }] },
      { kind: 'documents', documents: [{ file: { fileId: ID2, name: 'b.pdf' } }, { file: { fileId: 'nope', name: 'c.pdf' } }] },
      { kind: 'gallery', images: [{ image: { imageId: 'c'.repeat(64), alt: '' } }] },
    ],
  };
  assert.deepEqual([...referencedFileIds(landing)].sort(), [ID, ID2]);
  assert.deepEqual([...referencedFileIds(null)], []);
  assert.deepEqual([...referencedFileIds({ sections: 'x' })], []);
});

test('a file resolves to its public path with its name, and its size; the id and name come back out of it', () => {
  const files = new Map([[ID, { src: PUBLIC_FILE_PATH + ID, size: 1234 }]]);
  const shown = resolveFile({ fileId: ID, name: 'Teaching philosophy.pdf' }, files);
  assert.deepEqual(shown, { href: `${PUBLIC_FILE_PATH}${ID}/Teaching%20philosophy.pdf`, size: 1234 });
  assert.equal(resolveFile({ fileId: ID2, name: 'x.pdf' }, files), null);
  assert.equal(resolveFile(null, files), null);
  assert.equal(resolveFile({ fileId: ID, name: 'x.pdf' }, undefined), null);
  assert.deepEqual(fileOfPath(shown.href), { id: ID, name: 'Teaching philosophy.pdf' });
  for (const bad of [`/api/landing/files/${ID}/x.pdf`, `${PUBLIC_FILE_PATH}${ID}`, `${PUBLIC_FILE_PATH}${ID}/a/b.pdf`, `${PUBLIC_FILE_PATH}nope/x.pdf`, `${PUBLIC_FILE_PATH}${ID}/%E0.pdf`, 3]) {
    assert.equal(fileOfPath(bad), null, String(bad));
  }
});

test('shownFiles reads the resolved page: each shown file by id, with the names it is shown under', () => {
  const href = (id, name) => `${PUBLIC_FILE_PATH}${id}/${encodeURIComponent(name)}`;
  const resolved = {
    sections: [
      { kind: 'documents', documents: [{ href: href(ID, 'cv.pdf') }, { href: href(ID, 'résumé.pdf') }] },
      { kind: 'links', links: [{ url: href(ID2, 'x.pdf') }] },
      { kind: 'documents', documents: [{ href: href(ID2, 'b.pdf') }] },
    ],
  };
  const shown = shownFiles(resolved);
  assert.deepEqual([...shown.get(ID)], ['cv.pdf', 'résumé.pdf']);
  assert.deepEqual([...shown.get(ID2)], ['b.pdf']);
  assert.deepEqual([...shownFileIds(resolved)], [ID, ID2]);
  assert.deepEqual([...shownFileIds(null)], []);
});

test('contentDisposition opens inline, with an ASCII filename and an RFC 5987 filename*', () => {
  assert.equal(contentDisposition('cv.pdf'), `inline; filename="cv.pdf"; filename*=UTF-8''cv.pdf`);
  assert.equal(contentDisposition('Jürgen (CV) 2026*.pdf'), `inline; filename="J_rgen (CV) 2026*.pdf"; filename*=UTF-8''J%C3%BCrgen%20%28CV%29%202026%2A.pdf`);
  // Whatever it's handed is cleaned first, so no quote, separator or line
  // break can end the header early.
  const header = contentDisposition('a"; filename=evil.html\r\nX-Injected: 1.pdf');
  assert.equal(header, `inline; filename="a; filename=evil.htmlX-Injected: 1.pdf"; filename*=UTF-8''a%3B%20filename%3Devil.htmlX-Injected%3A%201.pdf`);
  assert.equal(contentDisposition(undefined), `inline; filename="document.pdf"; filename*=UTF-8''document.pdf`);
});
