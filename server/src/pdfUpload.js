import { createHash } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from 'pdf-lib';
import { httpError } from './httpError.js';
import { LANDING_FILE_LIMITS, isPdf } from './landingFileFields.js';

// An uploaded PDF with its metadata stripped, for the landing page's
// documents (issue #128). A PDF says who wrote it and with what (its Info
// dictionary: Title, Author, Subject, Keywords, Creator, Producer, the
// dates), often again in XMP (a /Metadata stream, on the catalog and on
// pages, images or fonts), sometimes the authoring app's private data
// (/PieceInfo, which can be a whole editable copy), and an incrementally
// saved file keeps every earlier revision after the current one. So every
// upload, whoever sent it, is loaded with pdf-lib and saved again: the Info
// dictionary dropped from the trailer, /Metadata and /PieceInfo taken off
// every object, and only the objects the document still reaches written
// out, as a single revision. The pages themselves are copied as they are;
// nothing is re-rendered. The only module that loads pdf-lib, so the
// client's tests (which import some server modules) never need it.
//
// Resolves with { id, bytes }, `id` the sha256 of `bytes`; rejects with a
// 400 (not a PDF, encrypted, or unreadable) or a 413 (too big, told before
// anything parses it, or once saved again).
export async function stripPdf(input, { maxInputBytes = LANDING_FILE_LIMITS.uploadBytes, maxStoredBytes = LANDING_FILE_LIMITS.storedBytes } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw httpError(400, 'Send the PDF file as the request body');
  if (input.length > maxInputBytes) throw httpError(413, `That file is too large (at most ${megabytes(maxInputBytes)} MB)`);
  if (!isPdf(input)) throw httpError(400, 'Only PDF files can be uploaded');

  let bytes;
  try {
    // Loaded even when encrypted, only so that's what the refusal can say.
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    if (doc.isEncrypted) {
      throw httpError(400, 'That PDF is encrypted or password-protected, so it could not be cleaned of its metadata. Save an unprotected copy and upload that.');
    }
    if (doc.getPageCount() === 0) throw new Error('No pages');
    strip(doc.context);
    bytes = Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  } catch (err) {
    if (err?.status) throw err;
    const bad = httpError(400, 'That file could not be read as a PDF; it may be damaged. Try saving or exporting it again.');
    bad.cause = err;
    throw bad;
  }
  if (bytes.length > maxStoredBytes) throw httpError(413, `That PDF is over ${megabytes(maxStoredBytes)} MB once cleaned; try a smaller one`);
  return { id: createHash('sha256').update(bytes).digest('hex'), bytes };
}

const METADATA_KEYS = [PDFName.of('Metadata'), PDFName.of('PieceInfo')];

function strip(context) {
  context.trailerInfo.Info = undefined;
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object;
    if (dict instanceof PDFDict) METADATA_KEYS.forEach((key) => dict.delete(key));
  }
  // What only an earlier revision, the Info dictionary or a metadata stream
  // used is no longer reached from the catalog, and isn't written out.
  const reached = reachable(context, context.trailerInfo.Root);
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.tag)) context.delete(ref);
  }
}

// The tags of every indirect object `root` leads to.
function reachable(context, root) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (value instanceof PDFRef) {
      if (seen.has(value.tag)) continue;
      seen.add(value.tag);
      const target = context.lookup(value);
      if (target !== undefined) stack.push(target);
    } else if (value instanceof PDFStream) {
      stack.push(value.dict);
    } else if (value instanceof PDFDict) {
      stack.push(...value.values());
    } else if (value instanceof PDFArray) {
      stack.push(...value.asArray());
    }
  }
  return seen;
}

function megabytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
