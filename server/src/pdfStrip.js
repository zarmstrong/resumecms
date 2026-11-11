import { constants as zlibConstants, inflateRawSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObjectStreamParser,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFXRefStreamParser,
  decodePDFRawStream,
} from 'pdf-lib';
import { httpError } from './httpError.js';
import { LANDING_FILE_LIMITS } from './landingFileFields.js';
import { tooComplex } from './pdfUpload.js';

// The metadata strip itself, for the landing page's documents (issue #128).
// A PDF says who wrote it and with what (its Info dictionary: Title,
// Author, Subject, Keywords, Creator, Producer, the dates), often again in
// XMP (a /Metadata stream, on the catalog and on pages, images or fonts),
// sometimes the authoring app's private data (/PieceInfo, which can be a
// whole editable copy, with the /LastModified date pages and forms carry
// beside it), who left each comment and when (an annotation's /T, /M and
// /CreationDate), other files riding along (attachments: the catalog's
// /EmbeddedFiles, /AF associated files, a file attachment annotation, any
// file specification's /EF), and an incrementally saved file keeps every
// earlier revision after the current one. So every upload, whoever sent
// it, is loaded with pdf-lib and saved again without any of that, and with
// only the objects the document still reaches written out, as a single
// revision. The pages themselves are copied as they are (their content,
// the comments' text, form field values); nothing is re-rendered.
//
// Only ever run inside pdfStripWorker.js, one upload per worker, never on
// the server's main thread: how long pdf-lib takes and how much it keeps
// isn't bounded by the file's size (it loops over what a stream declares,
// and every PDFRef it makes stays in a module-level pool for good), so
// pdfUpload.js gives each upload a thread it can kill, with a heap limit.
// The modules that load pdf-lib are this one and the worker, so the
// client's tests (which import some server modules) never need it.
//
// Resolves with the stripped bytes; rejects with a 400 (encrypted, or
// unreadable) or a 413 (decompressing past `maxDecodedBytes`, or declaring
// more than `maxEntries` objects, while being read).
export async function stripPdfBytes(input, {
  maxDecodedBytes = LANDING_FILE_LIMITS.decodedBytes,
  maxEntries = LANDING_FILE_LIMITS.streamEntries,
} = {}) {
  if (job) throw new Error('One PDF at a time');
  job = { left: maxDecodedBytes, entries: maxEntries, maxDecodedBytes, refusal: null };
  try {
    let bytes;
    try {
      // Loaded even when encrypted, only so that's what the refusal can say.
      const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
      if (job.refusal) throw job.refusal;
      if (doc.isEncrypted) {
        throw httpError(400, 'That PDF is encrypted or password-protected, so it could not be cleaned of its metadata. Save an unprotected copy and upload that.');
      }
      if (doc.getPageCount() === 0) throw new Error('No pages');
      strip(doc);
      bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    } catch (err) {
      if (job.refusal) throw job.refusal;
      if (err?.status) throw err;
      throw unreadable(err);
    }
    return bytes;
  } finally {
    job = null;
  }
}

function unreadable(cause) {
  const bad = httpError(400, 'That file could not be read as a PDF; it may be damaged. Try saving or exporting it again.');
  if (cause) bad.cause = cause;
  return bad;
}

// The upload being read: what's left of its decoding budget and of the
// entries its streams may declare, and why it's refused, once it is.
// pdf-lib's parser swallows an object's error (it reads the object as
// invalid and goes on), so a refusal is recorded here, not only thrown.
let job = null;

function refuse(err) {
  job.refusal ??= err;
  job.left = 0;
  return job.refusal;
}

// Decompression bombs. Loading a PDF, pdf-lib decodes every object stream
// (/Type /ObjStm) and cross-reference stream (/Type /XRef) it meets, all of
// it at once and with no limit (the only streams it decodes on load; page
// content is copied still encoded), so a 1 MB upload of deflated spaces
// could take seconds and gigabytes. Both parsers are handed their stream
// through their exported `forStream()`, so that's wrapped here, once: the
// stream is decoded first by `boundedDecode()` against the upload's budget,
// and the parser gets the decoded bytes, unfiltered, so pdf-lib's own
// decoder never runs on it. Then what the stream declares is checked
// against what it holds before pdf-lib loops over it: a cross-reference
// stream's /Index (or /Size) counts against its bytes and /W, an object
// stream's /N against its /First, both against `maxEntries` in all.
// pdfUpload.test.js fails if pdf-lib stops calling these.
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

const CHECKS = new Map([
  [PDFObjectStreamParser, checkObjectStream],
  [PDFXRefStreamParser, checkXRefStream],
]);
for (const [Parser, check] of CHECKS) {
  const forStream = Parser.forStream;
  if (typeof forStream !== 'function') throw new Error('pdf-lib changed: no forStream() to bound');
  Parser.forStream = (rawStream, ...rest) => {
    // Outside a strip, pdf-lib is left as it is.
    if (!job) return forStream(rawStream, ...rest);
    const decoded = boundedDecode(rawStream);
    check(decoded);
    return forStream(decoded, ...rest);
  };
}

// An object stream's header is /N pairs of numbers before /First, at least
// four bytes each ("1 0 " but for the last).
function checkObjectStream({ dict, contents }) {
  const count = whole(dict.lookup(PDFName.of('N')));
  const first = whole(dict.lookup(PDFName.of('First')));
  if (count === null || first === null || first > contents.length || count * 4 - 1 > first) throw refuse(unreadable());
  declare(count);
}

// A cross-reference stream is its entries' /W widths, back to back, for
// every object its /Index (or else /Size) counts.
function checkXRefStream({ dict, contents }) {
  const widths = dict.lookup(PDFName.of('W'));
  const index = dict.lookup(PDFName.of('Index'));
  if (!(widths instanceof PDFArray)) throw refuse(unreadable());
  const entryBytes = widths.asArray().reduce((sum, _, i) => sum + (whole(widths.lookup(i)) ?? NaN), 0);
  let counts;
  if (index instanceof PDFArray) {
    if (index.size() % 2 !== 0) throw refuse(unreadable());
    counts = index.asArray().map((_, i) => whole(index.lookup(i))).filter((_, i) => i % 2 === 1);
  } else {
    counts = [whole(dict.lookup(PDFName.of('Size')))];
  }
  const entries = counts.reduce((sum, count) => sum + (count ?? NaN), 0);
  if (!Number.isFinite(entryBytes) || !Number.isFinite(entries)) throw refuse(unreadable());
  if (entries > 0 && (entryBytes === 0 || entries * entryBytes > contents.length)) throw refuse(unreadable());
  declare(entries);
}

function declare(entries) {
  job.entries -= entries;
  if (job.entries < 0) throw refuse(tooComplex());
}

// A non-negative whole number, or null.
function whole(value) {
  const n = value instanceof PDFNumber ? value.asNumber() : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// `rawStream` with its filters applied, as a stream with none, never
// decoding more than the budget has left.
function boundedDecode(rawStream) {
  const { dict } = rawStream;
  const filter = dict.lookup(FILTER);
  const parms = dict.lookup(DECODE_PARMS);
  const steps = filter instanceof PDFArray
    ? filter.asArray().map((_, i) => [filter.lookup(i), parms instanceof PDFArray ? parms.lookup(i) : undefined])
    : filter === undefined ? [] : [[filter, parms]];
  let bytes = rawStream.contents;
  for (const [name, stepParms] of steps) bytes = decodeStep(dict.context, bytes, name, stepParms);
  const plain = dict.clone();
  plain.delete(FILTER);
  plain.delete(DECODE_PARMS);
  return PDFRawStream.of(plain, bytes);
}

function decodeStep(context, bytes, name, parms) {
  const overBudget = () => refuse(httpError(413, `That PDF expands to more than ${megabytes(job.maxDecodedBytes)} MB when read, so it was refused`));
  if (job.left <= 0) throw overBudget();
  let out;
  if (name === FLATE) {
    try {
      out = inflate(bytes, job.left);
    } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE') throw overBudget();
      throw err;
    }
  } else if (EXPANSION.has(name)) {
    if (bytes.length * EXPANSION.get(name) > job.left) throw overBudget();
    const step = PDFDict.withContext(context);
    step.set(FILTER, name);
    if (parms instanceof PDFDict) step.set(DECODE_PARMS, parms);
    out = decodePDFRawStream(PDFRawStream.of(step, bytes)).decode();
  } else {
    throw new Error(`Unsupported stream filter ${name}`);
  }
  if (out.length > job.left) throw overBudget();
  job.left -= out.length;
  return out;
}

// A zlib stream inflated as pdf-lib's own decoder (and pdf.js, Chrome,
// mupdf) reads one: its two-byte header checked the same way, the deflate
// data inflated raw, and the Adler-32 trailer never verified, so a
// garbled or missing one doesn't make a readable PDF unreadable. A
// truncated stream gives what it has.
function inflate(bytes, maxOutputLength) {
  if (bytes.length < 2) throw new Error('Invalid header in flate stream');
  const [cmf, flg] = bytes;
  if ((cmf & 0x0f) !== 0x08) throw new Error('Unknown compression method in flate stream');
  if (((cmf << 8) + flg) % 31 !== 0) throw new Error('Bad FCHECK in flate stream');
  if (flg & 0x20) throw new Error('FDICT bit set in flate stream');
  return inflateRawSync(bytes.subarray(2), { maxOutputLength, finishFlush: zlibConstants.Z_SYNC_FLUSH });
}

// Taken off every dictionary, wherever it is: XMP, an app's private data
// and the /LastModified date that goes with it (on a page or a form
// XObject), associated files, and a file specification's embedded file
// streams.
const DROPPED_KEYS = ['Metadata', 'PieceInfo', 'LastModified', 'AF', 'EF'].map((key) => PDFName.of(key));
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
