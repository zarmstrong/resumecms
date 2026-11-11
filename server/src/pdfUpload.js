import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { constants as zlibConstants, inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectStreamParser,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFXRefStreamParser,
  decodePDFRawStream,
} from 'pdf-lib';
import { httpError } from './httpError.js';
import { LANDING_FILE_LIMITS, isPdf } from './landingFileFields.js';

// An uploaded PDF with its metadata stripped, for the landing page's
// documents (issue #128). A PDF says who wrote it and with what (its Info
// dictionary: Title, Author, Subject, Keywords, Creator, Producer, the
// dates), often again in XMP (a /Metadata stream, on the catalog and on
// pages, images or fonts), sometimes the authoring app's private data
// (/PieceInfo, which can be a whole editable copy), who left each comment
// and when (an annotation's /T, /M and /CreationDate), other files riding
// along (attachments: the catalog's /EmbeddedFiles, /AF associated files,
// a file attachment annotation, any file specification's /EF), and an
// incrementally saved file keeps every earlier revision after the current
// one. So every upload, whoever sent it, is loaded with pdf-lib and saved
// again without any of that, and with only the objects the document still
// reaches written out, as a single revision. The pages themselves are
// copied as they are (their content, the comments' text, form field
// values); nothing is re-rendered. The only module that loads pdf-lib, so
// the client's tests (which import some server modules) never need it.
//
// Resolves with { id, bytes }, `id` the sha256 of `bytes`; rejects with a
// 400 (not a PDF, encrypted, or unreadable) or a 413 (too big, told before
// anything parses it, once saved again, or decompressing past
// `maxDecodedBytes` while being read).
export async function stripPdf(input, {
  maxInputBytes = LANDING_FILE_LIMITS.uploadBytes,
  maxStoredBytes = LANDING_FILE_LIMITS.storedBytes,
  maxDecodedBytes = LANDING_FILE_LIMITS.decodedBytes,
} = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw httpError(400, 'Send the PDF file as the request body');
  if (input.length > maxInputBytes) throw httpError(413, `That file is too large (at most ${megabytes(maxInputBytes)} MB)`);
  if (!isPdf(input)) throw httpError(400, 'Only PDF files can be uploaded');

  const budget = { left: maxDecodedBytes, exceeded: false };
  const tooBig = () => httpError(413, `That PDF expands to more than ${megabytes(maxDecodedBytes)} MB when read, so it was refused`);
  let bytes;
  try {
    // Loaded even when encrypted, only so that's what the refusal can say.
    const doc = await decoding.run(budget, () => PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false }));
    if (budget.exceeded) throw tooBig();
    if (doc.isEncrypted) {
      throw httpError(400, 'That PDF is encrypted or password-protected, so it could not be cleaned of its metadata. Save an unprotected copy and upload that.');
    }
    if (doc.getPageCount() === 0) throw new Error('No pages');
    strip(doc);
    bytes = Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  } catch (err) {
    if (budget.exceeded) throw tooBig();
    if (err?.status) throw err;
    const bad = httpError(400, 'That file could not be read as a PDF; it may be damaged. Try saving or exporting it again.');
    bad.cause = err;
    throw bad;
  }
  if (bytes.length > maxStoredBytes) throw httpError(413, `That PDF is over ${megabytes(maxStoredBytes)} MB once cleaned; try a smaller one`);
  return { id: createHash('sha256').update(bytes).digest('hex'), bytes };
}

// Decompression bombs. Loading a PDF, pdf-lib decodes every object stream
// (/Type /ObjStm) and cross-reference stream (/Type /XRef) it meets, all of
// it at once and with no limit (the only streams it decodes on load; page
// content is copied still encoded), so a 1 MB upload of deflated spaces
// could take seconds and gigabytes. Both parsers are handed their stream
// through their exported `forStream()`, so that's wrapped here, once: the
// stream is decoded first by `boundedDecode()` against the budget of the
// stripPdf() call it's part of (an AsyncLocalStorage, so concurrent uploads
// each have their own), and the parser gets the decoded bytes, unfiltered,
// so pdf-lib's own decoder never runs on it. Past the budget it throws;
// pdf-lib's parser swallows an object's error (it reads the object as
// invalid and goes on), which is why the budget also records `exceeded`.
// pdfUpload.test.js fails if pdf-lib stops calling these.
const decoding = new AsyncLocalStorage();

const FILTER = PDFName.of('Filter');
const DECODE_PARMS = PDFName.of('DecodeParms');
const FLATE = PDFName.of('FlateDecode');
// The most each of pdf-lib's other decoders can make of a byte: ASCII85's
// `z` is four zero bytes, a RunLength pair repeats a byte 128 times, and an
// LZW code (9 bits at the least) stands for at most 4096 bytes. So their
// output is bounded before they run.
const EXPANSION = new Map([
  [PDFName.of('ASCIIHexDecode'), 1],
  [PDFName.of('ASCII85Decode'), 4],
  [PDFName.of('RunLengthDecode'), 64],
  [PDFName.of('LZWDecode'), Math.ceil((4096 * 8) / 9)],
]);

for (const Parser of [PDFObjectStreamParser, PDFXRefStreamParser]) {
  const forStream = Parser.forStream;
  if (typeof forStream !== 'function') throw new Error('pdf-lib changed: no forStream() to bound');
  Parser.forStream = (rawStream, ...rest) => forStream(boundedDecode(rawStream), ...rest);
}

// `rawStream` with its filters applied, as a stream with none, never
// decoding more than the current budget has left.
function boundedDecode(rawStream) {
  const budget = decoding.getStore() ?? { left: LANDING_FILE_LIMITS.decodedBytes, exceeded: false };
  const { dict } = rawStream;
  const filter = dict.lookup(FILTER);
  const parms = dict.lookup(DECODE_PARMS);
  const steps = filter instanceof PDFArray
    ? filter.asArray().map((_, i) => [filter.lookup(i), parms instanceof PDFArray ? parms.lookup(i) : undefined])
    : filter === undefined ? [] : [[filter, parms]];
  let bytes = rawStream.contents;
  for (const [name, stepParms] of steps) bytes = decodeStep(dict.context, bytes, name, stepParms, budget);
  const plain = dict.clone();
  plain.delete(FILTER);
  plain.delete(DECODE_PARMS);
  return PDFRawStream.of(plain, bytes);
}

function decodeStep(context, bytes, name, parms, budget) {
  const overBudget = () => {
    budget.exceeded = true;
    budget.left = 0;
    return new Error('Decoded stream over the budget');
  };
  if (budget.left <= 0) throw overBudget();
  let out;
  if (name === FLATE) {
    try {
      // A truncated stream gives what it has, as pdf-lib's decoder does.
      out = inflateSync(bytes, { maxOutputLength: budget.left, finishFlush: zlibConstants.Z_SYNC_FLUSH });
    } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE') throw overBudget();
      throw err;
    }
  } else if (EXPANSION.has(name)) {
    if (bytes.length * EXPANSION.get(name) > budget.left) throw overBudget();
    const step = PDFDict.withContext(context);
    step.set(FILTER, name);
    if (parms instanceof PDFDict) step.set(DECODE_PARMS, parms);
    out = decodePDFRawStream(PDFRawStream.of(step, bytes)).decode();
  } else {
    throw new Error(`Unsupported stream filter ${name}`);
  }
  if (out.length > budget.left) throw overBudget();
  budget.left -= out.length;
  return out;
}

// Taken off every dictionary, wherever it is: XMP, an app's private data,
// associated files, and a file specification's embedded file streams.
const DROPPED_KEYS = ['Metadata', 'PieceInfo', 'AF', 'EF'].map((key) => PDFName.of(key));
// Taken off every annotation: who wrote it (/T, but for a form field's
// widget, whose /T is the field's name) and when.
const ANNOTATION_DATES = ['M', 'CreationDate'].map((key) => PDFName.of(key));
const AUTHOR = PDFName.of('T');
const SUBTYPE = PDFName.of('Subtype');
const WIDGET = PDFName.of('Widget');
const FILE_ATTACHMENT = PDFName.of('FileAttachment');
const POPUP = PDFName.of('Popup');
const ANNOTS = PDFName.of('Annots');
const NAMES = PDFName.of('Names');

function strip(doc) {
  const { context, catalog } = doc;
  context.trailerInfo.Info = undefined;
  // A portfolio is only a view of its attachments.
  catalog.delete(PDFName.of('Collection'));
  const names = catalog.lookup(NAMES);
  if (names instanceof PDFDict) names.delete(PDFName.of('EmbeddedFiles'));
  for (const page of doc.getPages()) stripAnnotations(context, page.node);
  for (const [, object] of context.enumerateIndirectObjects()) dropKeys(object);
  // What only an earlier revision, the Info dictionary, a metadata stream,
  // an attachment or a removed annotation used is no longer reached from
  // the catalog, and isn't written out.
  const reached = reachable(context, context.trailerInfo.Root);
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.tag)) context.delete(ref);
  }
}

// A page's file attachment annotations (and their popups) removed, and
// every other annotation's author and dates.
function stripAnnotations(context, pageNode) {
  const annots = pageNode.lookup(ANNOTS);
  if (!(annots instanceof PDFArray)) return;
  const removed = new Set();
  for (let i = 0; i < annots.size(); i += 1) {
    const annot = annots.lookup(i);
    if (annot instanceof PDFDict && annot.lookup(SUBTYPE) === FILE_ATTACHMENT) {
      removed.add(annot);
      const popup = annot.lookup(POPUP);
      if (popup instanceof PDFDict) removed.add(popup);
    }
  }
  for (let i = annots.size() - 1; i >= 0; i -= 1) {
    const annot = annots.lookup(i);
    if (removed.has(annot)) annots.remove(i);
    else if (annot instanceof PDFDict) {
      clearAuthor(annot);
      const popup = annot.lookup(POPUP);
      if (popup instanceof PDFDict) clearAuthor(popup);
    }
  }
  if (annots.size() === 0) pageNode.delete(ANNOTS);
}

function clearAuthor(annot) {
  ANNOTATION_DATES.forEach((key) => annot.delete(key));
  if (annot.lookup(SUBTYPE) !== WIDGET) annot.delete(AUTHOR);
}

// DROPPED_KEYS off `value` and every dictionary held directly in it (an
// indirect one is visited as an object of its own).
function dropKeys(value) {
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    const dict = item instanceof PDFStream ? item.dict : item;
    if (dict instanceof PDFDict) {
      DROPPED_KEYS.forEach((key) => dict.delete(key));
      stack.push(...dict.values());
    } else if (item instanceof PDFArray) {
      stack.push(...item.asArray());
    }
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
