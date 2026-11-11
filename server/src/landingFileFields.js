import { httpError } from './httpError.js';

// The landing page's documents (issue #128), the pure half: the caps, how an
// upload's type is told, how the page refers to a file, and how a file's
// name is made safe to send. The bytes live in the `landing_files` table
// (landingFileStore.js), with their metadata stripped on upload
// (pdfUpload.js), so the draft only carries a reference:
//   { fileId, name }
// `fileId` is the sha256 (hex) of the stored bytes; `name` is what the file
// is called when a visitor opens or saves it, always a cleanFileName(). A
// new reference must name a stored file; one already in the draft may
// outlive its file, as an image reference may, and then shows nothing. Only
// a `documents` section's entries hold one. PDF only: a PDF opens in the
// browser, other types don't.

export const LANDING_FILE_LIMITS = {
  // What the editor may send, checked before anything parses it, and what a
  // stored file may be once its metadata is stripped.
  uploadBytes: 10 * 1024 * 1024,
  storedBytes: 10 * 1024 * 1024,
  // A few documents, and the ones a draft has replaced but the snapshot
  // still shows. They live in SQLite with the images, and every backup
  // copies the database, so this is kept small.
  count: 20,
  totalBytes: 30 * 1024 * 1024,
  // A file name, `.pdf` included.
  name: 120,
};

// Where a visitor opens a file (only while the shown page shows it, see the
// store's publicLandingFile()), as <PUBLIC_FILE_PATH><id>/<name>, and
// where the editor's preview does (any stored file, behind login).
export const PUBLIC_FILE_PATH = '/api/public/landing/files/';
export const EDITOR_FILE_PATH = '/api/landing/files/';

const FILE_ID = /^[0-9a-f]{64}$/;
const REF_FIELDS = ['fileId', 'name'];

export function isFileId(value) {
  return typeof value === 'string' && FILE_ID.test(value);
}

// Whether an upload is a PDF, from its first bytes. The declared
// Content-Type is never trusted.
export function isPdf(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 5 && bytes.toString('latin1', 0, 5) === '%PDF-';
}

// What a name may not hold: path separators, quotes, control and format
// characters (bidi overrides included, which can make "evil‮fdp.exe" read
// as something else), and line or paragraph separators.
const UNSAFE_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"']/gu;

// `raw` (the name the editor's file picker had) as a file name a visitor
// may be sent: its last path segment, without the characters above, its
// spaces collapsed, no leading or trailing dots or spaces, at most
// LANDING_FILE_LIMITS.name code points, ending in `.pdf`; "document.pdf"
// when nothing is left. A cleaned name comes back unchanged, which is what
// checkFileRef() holds a reference's name to.
export function cleanFileName(raw) {
  const segment = (typeof raw === 'string' ? raw : '').toWellFormed().split(/[\\/]/).pop();
  const trim = (text) => text.replace(/^[.\s]+|[.\s]+$/g, '');
  let stem = segment.replace(UNSAFE_NAME, '').replace(/\s+/g, ' ').trim();
  stem = trim(stem.replace(/\.pdf$/i, ''));
  // By code point, so a cut never leaves half a surrogate pair.
  stem = trim(Array.from(stem).slice(0, LANDING_FILE_LIMITS.name - 4).join(''));
  return `${stem || 'document'}.pdf`;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// One reference, checked: `refs` is { knownFileIds, previousFileIds }, the
// stored files and the ones the draft already names.
export function checkFileRef(ref, label, { knownFileIds = new Set(), previousFileIds = new Set() } = {}) {
  if (!isPlainObject(ref)) throw httpError(400, `${label} must be an object with fileId and name`);
  const unknown = Object.keys(ref).find((key) => !REF_FIELDS.includes(key));
  if (unknown !== undefined) throw httpError(400, `Unknown ${label} field: ${unknown}`);
  if (!isFileId(ref.fileId)) throw httpError(400, `${label}.fileId must be an uploaded file's id`);
  if (!knownFileIds.has(ref.fileId) && !previousFileIds.has(ref.fileId)) {
    throw httpError(400, `${label}.fileId does not reference a stored file`);
  }
  if (typeof ref.name !== 'string' || cleanFileName(ref.name) !== ref.name) {
    throw httpError(
      400,
      `${label}.name must be a file name ending in .pdf, at most ${LANDING_FILE_LIMITS.name} characters, without slashes, quotes or control characters`
    );
  }
  return { fileId: ref.fileId, name: ref.name };
}

// Every file `landing` (a draft or snapshot) names, shown or not.
export function referencedFileIds(landing) {
  const refs = (Array.isArray(landing?.sections) ? landing.sections : []).flatMap((section) =>
    section?.kind === 'documents' && Array.isArray(section.documents) ? section.documents.map((entry) => entry?.file) : []
  );
  return new Set(refs.filter((ref) => isPlainObject(ref) && isFileId(ref.fileId)).map((ref) => ref.fileId));
}

// A reference as a visitor sees it, { href, size }, or null when it names
// no stored file. `files` is a Map of id → { src, size } (resolveLanding()'s
// context.files), `src` the path the name is appended to.
export function resolveFile(ref, files) {
  const file = isPlainObject(ref) && typeof ref.name === 'string' ? files?.get(ref.fileId) : null;
  return file ? { href: `${file.src}/${encodeURIComponent(ref.name)}`, size: file.size } : null;
}

// The file id and name in a public file path, else null.
export function fileOfPath(href) {
  if (typeof href !== 'string' || !href.startsWith(PUBLIC_FILE_PATH)) return null;
  const [id, name, ...rest] = href.slice(PUBLIC_FILE_PATH.length).split('/');
  if (!isFileId(id) || name === undefined || rest.length) return null;
  try {
    return { id, name: decodeURIComponent(name) };
  } catch {
    return null;
  }
}

// Every file the resolved page (resolveLanding()'s shape) shows: a Map of
// id → the names it's shown under, which is what
// /api/public/landing/files/:id/:name may serve.
export function shownFiles(resolved) {
  const shown = new Map();
  for (const section of resolved?.sections ?? []) {
    if (section.kind !== 'documents') continue;
    for (const entry of section.documents) {
      const file = fileOfPath(entry.href);
      if (file) shown.set(file.id, new Set([...(shown.get(file.id) ?? []), file.name]));
    }
  }
  return shown;
}

export function shownFileIds(resolved) {
  return new Set(shownFiles(resolved).keys());
}

// RFC 5987's attr-char: what may go unescaped in `filename*`.
const encodeAttr = (text) => encodeURIComponent(text).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// The Content-Disposition a file is sent with: opened in the browser, and
// saved as `name` (cleaned again, whatever it is), with a plain-ASCII
// `filename` for clients that don't read RFC 5987's `filename*`.
export function contentDisposition(name) {
  const clean = cleanFileName(name);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeAttr(clean)}`;
}
