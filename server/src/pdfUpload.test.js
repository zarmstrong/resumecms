import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createDeflate, deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFObjectStreamParser, PDFRawStream, PDFRef, PDFString, PDFXRefStreamParser, StandardFonts } from 'pdf-lib';
import { stripPdf } from './pdfUpload.js';
import { LANDING_FILE_LIMITS } from './landingFileFields.js';

// The upload clean-up (issue #128): what's stored is the PDF saved again by
// pdf-lib, without its Info dictionary, its XMP or any earlier revision.

const status = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err.status;
  }
  return null;
};

// What's written as it is (pdf-lib hex-encodes the Info dictionary's
// strings, so those are read back through pdf-lib instead).
const SECRETS = ['XmpAuthor', 'PieceSecret', 'OldRevisionText', 'D:2019', 'D:2022', 'D:2023'];
const INFO = ['getTitle', 'getAuthor', 'getSubject', 'getKeywords', 'getCreator', 'getProducer', 'getCreationDate', 'getModificationDate'];

// A real PDF, made by pdf-lib, carrying every kind of metadata the strip is
// meant to remove: the Info dictionary's fields, an XMP stream on the
// catalog and one on the page, an app's /PieceInfo, and an object only an
// earlier revision would reach, appended the way an incremental save does.
async function pdfWithMetadata() {
  const doc = await PDFDocument.create();
  doc.setTitle('Hidden Title');
  doc.setAuthor('Jo Secret');
  doc.setSubject('Hush subject');
  doc.setKeywords(['kw-private']);
  doc.setCreator('SecretWriter 9');
  doc.setProducer('ProducerX');
  doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
  doc.setModificationDate(new Date('2021-01-02T03:04:05Z'));
  const page = doc.addPage([200, 200]);
  page.drawText('Visible body', { x: 10, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  const xmp = (who) => doc.context.register(doc.context.stream(`<x:xmpmeta><dc:creator>${who}</dc:creator></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' }));
  doc.catalog.set(PDFName.of('Metadata'), xmp('XmpAuthor'));
  page.node.set(PDFName.of('Metadata'), xmp('XmpAuthor'));
  page.node.set(PDFName.of('PieceInfo'), doc.context.obj({ App: { Private: 'PieceSecret', LastModified: PDFString.of('D:20190101') } }));
  // The date an app stamps beside its /PieceInfo, on the page and on a form
  // XObject the page draws.
  page.node.set(PDFName.of('LastModified'), PDFString.of('D:20220304050607Z'));
  const form = doc.context.register(doc.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], LastModified: PDFString.of('D:20230405060708Z') }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ ...Object.fromEntries(page.node.Resources().entries().map(([k, v]) => [k.decodeText(), v])), XObject: { Fm1: form } }));
  const saved = Buffer.from(await doc.save({ useObjectStreams: false }));
  return Buffer.concat([saved, Buffer.from('\n99 0 obj\n(OldRevisionText)\nendobj\n')]);
}

test('a real PDF loses its Info dictionary, its XMP, private app data and unreachable objects, and keeps its pages', async () => {
  const input = await pdfWithMetadata();
  const raw = input.toString('latin1');
  for (const secret of SECRETS) assert.ok(raw.includes(secret), `the fixture carries ${secret}`);
  const original = await PDFDocument.load(input, { updateMetadata: false });
  assert.deepEqual([original.getAuthor(), original.getCreator(), original.getProducer()], ['Jo Secret', 'SecretWriter 9', 'ProducerX']);
  for (const field of INFO) assert.notEqual(original[field](), undefined, `the fixture has ${field}`);

  const { id, bytes } = await stripPdf(input);
  assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.equal(id, createHash('sha256').update(bytes).digest('hex'));
  const text = bytes.toString('latin1');
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `${secret} is gone`);
  for (const key of ['/Info', '/Metadata', '/PieceInfo', '/LastModified', '/Author', '/Creator', '/Producer', '/CreationDate', '/ModDate']) {
    assert.equal(text.includes(key), false, `${key} is gone`);
  }
  // A single revision.
  assert.equal(text.match(/%%EOF/g).length, 1);

  const reread = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(reread.getPageCount(), 1);
  assert.deepEqual(reread.getPage(0).getSize(), { width: 200, height: 200 });
  assert.ok(reread.getPage(0).node.Resources().lookup(PDFName.of('XObject')).lookup(PDFName.of('Fm1')), 'the form XObject is kept');
  for (const field of INFO) assert.equal(reread[field](), undefined, field);

  // The same upload is the same file, so the same id.
  assert.equal((await stripPdf(input)).id, id);
});

test('only a PDF, told by its bytes, within the size cap told before parsing', async () => {
  assert.equal(await status(stripPdf(Buffer.from('<html>%PDF-1.7</html>'))), 400);
  assert.equal(await status(stripPdf(Buffer.alloc(0))), 400);
  assert.equal(await status(stripPdf('%PDF-1.7')), 400);
  // Far too big to be a PDF pdf-lib could read fast, refused before trying.
  const huge = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(LANDING_FILE_LIMITS.uploadBytes)]);
  assert.equal(await status(stripPdf(huge)), 413);
  const small = await pdfWithMetadata();
  assert.equal(await status(stripPdf(small, { maxInputBytes: small.length - 1 })), 413);
  assert.equal(await status(stripPdf(small, { maxStoredBytes: 100 })), 413);
});

test('a PDF pdf-lib cannot clean is a 400 saying why', async () => {
  await assert.rejects(stripPdf(Buffer.from('%PDF-1.7\nnot really a pdf')), (err) => err.status === 400 && /could not be read as a PDF/.test(err.message));

  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 1, R: 2 });
  const encrypted = Buffer.from(await doc.save());
  await assert.rejects(stripPdf(encrypted), (err) => err.status === 400 && /encrypted or password-protected/.test(err.message));
});

// A comment's author and dates, and every way a PDF carries another file,
// go; the comment's text and a form field's name and value stay.
test('annotation authors and dates and embedded files are removed, annotations and form fields kept', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const { context } = doc;
  const attached = (secret) => context.obj({
    Type: 'Filespec',
    F: PDFString.of(`${secret}.txt`),
    EF: { F: context.register(context.stream(secret, { Type: 'EmbeddedFile' })) },
  });
  const date = PDFString.of('D:20200102030405Z');
  const popup = context.register(context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 50, 50], T: PDFString.of('PopupReviewer'), M: date }));
  const note = context.register(context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30],
    T: PDFString.of('ReviewerName'), M: date, CreationDate: date, Contents: PDFString.of('Visible note'), Popup: popup,
  }));
  const attachmentPopup = context.register(context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 50, 50], Contents: PDFString.of('AttachPopupText') }));
  const attachment = context.register(context.obj({
    Type: 'Annot', Subtype: 'FileAttachment', Rect: [40, 40, 60, 60], T: PDFString.of('AttacherName'),
    FS: attached('AnnotAttachmentBytes'), Popup: attachmentPopup,
  }));
  const widget = context.register(context.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Tx', Rect: [80, 80, 150, 100], T: PDFString.of('FieldName'), V: PDFString.of('FieldValue'), M: date,
  }));
  page.node.set(PDFName.of('Annots'), context.obj([note, popup, attachment, attachmentPopup, widget]));
  doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [widget] }));
  doc.catalog.set(PDFName.of('Names'), context.obj({ EmbeddedFiles: { Names: [PDFString.of('a.txt'), attached('NameTreeBytes')] } }));
  doc.catalog.set(PDFName.of('AF'), context.obj([attached('AssociatedBytes')]));
  page.node.set(PDFName.of('AF'), context.obj([attached('PageAssociatedBytes')]));
  const input = Buffer.from(await doc.save({ useObjectStreams: false }));
  const SECRETS = ['ReviewerName', 'PopupReviewer', 'AttacherName', 'AnnotAttachmentBytes', 'AttachPopupText', 'NameTreeBytes', 'AssociatedBytes', 'PageAssociatedBytes', 'D:2020'];
  for (const secret of SECRETS) assert.ok(input.toString('latin1').includes(secret), `the fixture carries ${secret}`);

  const { bytes } = await stripPdf(input);
  const text = bytes.toString('latin1');
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `${secret} is gone`);
  for (const key of ['/EmbeddedFile', '/EmbeddedFiles', '/AF', '/EF', '/FileAttachment', '/CreationDate']) {
    assert.equal(text.includes(key), false, `${key} is gone`);
  }
  for (const kept of ['Visible note', 'FieldName', 'FieldValue']) assert.ok(text.includes(kept), `${kept} is kept`);

  const reread = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = reread.getPage(0).node.Annots();
  assert.deepEqual(annots.asArray().map((ref) => reread.context.lookup(ref).lookup(PDFName.of('Subtype')).asString()), ['/Text', '/Popup', '/Widget']);
  assert.deepEqual(reread.getForm().getFields().map((field) => field.getName()), ['FieldName']);
});

// What pdf-lib saves with object streams on: several deflated /ObjStm (50
// objects in each) and a deflated cross-reference stream, all decoded on
// load.
async function pdfWithObjectStreams() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 120; i += 1) doc.addPage([200, 200]).drawText(`Page ${i + 1}`, { x: 10, y: 100, size: 12, font });
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

test('a PDF with several object streams and a cross-reference stream strips fine', async () => {
  const input = await pdfWithObjectStreams();
  const raw = input.toString('latin1');
  assert.ok(raw.match(/\/Type \/ObjStm/g).length >= 3, 'the fixture has several object streams');
  assert.ok(raw.includes('/Type /XRef'), 'and a cross-reference stream');
  const { bytes } = await stripPdf(input);
  const reread = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(reread.getPageCount(), 120);
  assert.equal(bytes.toString('latin1').includes('/ObjStm'), false, 'saved again without object streams');
});

test('every object and cross-reference stream is decoded through the bounded decoder', async () => {
  // Fails if pdf-lib stops parsing them through these: the wrapper wouldn't
  // see them, and the budget wouldn't hold.
  assert.equal(typeof PDFObjectStreamParser.forStream, 'function');
  assert.equal(typeof PDFXRefStreamParser.forStream, 'function');
  const input = await pdfWithObjectStreams();
  const warn = console.warn;
  console.warn = () => {}; // pdf-lib's notes about the objects it couldn't read
  try {
    await assert.rejects(stripPdf(input, { maxDecodedBytes: 200 }), (err) => err.status === 413 && /expands to more than/.test(err.message));
  } finally {
    console.warn = warn;
  }
});

// A one-page PDF with an object stream of `megabytes` MB of spaces, deflated
// (about a thousand to one), made without holding them all at once.
async function bomb(megabytes) {
  const deflate = createDeflate({ level: 9 });
  const chunks = [];
  deflate.on('data', (chunk) => chunks.push(chunk));
  const ended = new Promise((resolve) => deflate.on('end', resolve));
  const spaces = Buffer.alloc(1024 * 1024, 0x20);
  for (let i = 0; i < megabytes; i += 1) {
    if (!deflate.write(spaces)) await new Promise((resolve) => deflate.once('drain', resolve));
  }
  deflate.end();
  await ended;
  const body = Buffer.concat(chunks);
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'ObjStm', N: 0, First: 0, Filter: 'FlateDecode', Length: body.length }), body));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

test('a decompression bomb is refused fast, without decoding it', async () => {
  const input = await bomb(200);
  assert.ok(input.length < LANDING_FILE_LIMITS.uploadBytes, 'small enough to be let in');
  const warn = console.warn;
  console.warn = () => {}; // pdf-lib's note about the object it couldn't read
  try {
    const started = performance.now();
    await assert.rejects(stripPdf(input), (err) => err.status === 413 && /expands to more than 64 MB/.test(err.message));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1000, `refused in ${Math.round(elapsed)} ms`);
  } finally {
    console.warn = warn;
  }
});

test('object streams in other filters decode, within a bound told before decoding', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const objects = '50 0 (HexObjectValue)';
  const header = '50 0 ';
  const hex = Buffer.from(Buffer.from(objects).toString('hex') + '>');
  doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'ObjStm', N: 1, First: header.length, Filter: 'ASCIIHexDecode' }), hex));
  page.node.set(PDFName.of('Extra'), PDFRef.of(50));
  const { bytes } = await stripPdf(Buffer.from(await doc.save({ useObjectStreams: false })));
  assert.ok(bytes.toString('latin1').includes('(HexObjectValue)'), 'the object it held is read and kept');

  // An LZW stream could stand for thousands of times its size, so a big one
  // is refused before it's decoded.
  const lzw = await PDFDocument.create();
  lzw.addPage();
  const junk = Buffer.alloc(64 * 1024, 0x80);
  lzw.context.register(PDFRawStream.of(lzw.context.obj({ Type: 'ObjStm', N: 0, First: 0, Filter: 'LZWDecode' }), junk));
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(stripPdf(Buffer.from(await lzw.save({ useObjectStreams: false }))), (err) => err.status === 413);
  } finally {
    console.warn = warn;
  }
});

// Parsing is isolated (pdfUpload.js): pdf-lib's work and what it keeps
// aren't bounded by the file's size, so it never runs on the server's
// thread.

test('the server thread never loads pdf-lib: an upload is read in a worker', () => {
  const source = readFileSync(new URL('./pdfUpload.js', import.meta.url), 'utf8');
  assert.equal(/from 'pdf-lib'|import\('pdf-lib'\)|pdfStrip\.js'/.test(source), false);
  assert.match(source, /new Worker\(/);
});

// A valid one-page PDF with `object` appended, the way an incremental save
// adds to a file.
async function withAppended(object) {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  return Buffer.concat([Buffer.from(await doc.save({ useObjectStreams: false })), Buffer.from(object, 'latin1')]);
}

// pdf-lib reads every entry a cross-reference stream's /Index declares,
// data or no data, keeping a PDFRef for each for good: 977 bytes kept the
// server's thread for seconds and held hundreds of MB.
test('a cross-reference stream declaring more entries than it holds is refused at once', async () => {
  for (const count of [5_000_000, 50_000_000]) {
    const input = await withAppended(`\n999 0 obj\n<< /Type /XRef /Size 1 /Index [1000 ${count}] /W [0 0 0] /Root 1 0 R /Length 0 >>\nstream\n\nendstream\nendobj\n`);
    assert.ok(input.length < 2000);
    const started = performance.now();
    await assert.rejects(stripPdf(input), (err) => err.status === 400 && /could not be read as a PDF/.test(err.message));
    assert.ok(performance.now() - started < 2000, `refused in ${Math.round(performance.now() - started)} ms`);
  }
  // Widths that need more bytes than are there, and no /Index: /Size counts.
  const short = await withAppended('\n999 0 obj\n<< /Type /XRef /Size 1000 /W [1 2 1] /Root 1 0 R /Length 4 >>\nstream\n\x01\x00\x00\x00\nendstream\nendobj\n');
  assert.equal(await status(stripPdf(short)), 400);
});

// An object stream's header of `count` pairs, `pair(i)` each, deflated.
function objectStream(count, pair = () => '1000 0 ') {
  const parts = [];
  for (let i = 0; i < count; i += 1) parts.push(pair(i));
  const header = parts.join('');
  const body = deflateSync(Buffer.from(`${header}null`));
  return Buffer.concat([
    Buffer.from(`\n999 0 obj\n<< /Type /ObjStm /N ${count} /First ${header.length} /Filter /FlateDecode /Length ${body.length} >>\nstream\n`),
    body,
    Buffer.from('\nendstream\nendobj\n'),
  ]).toString('latin1');
}

test('streams declaring more objects than the cap, or than they hold, are refused at once', async () => {
  // 1.1 million pairs in a few KB: within the decoding budget, over the
  // entries cap.
  const many = await withAppended(objectStream(LANDING_FILE_LIMITS.streamEntries + 100_000));
  assert.ok(many.length < 100 * 1024);
  const started = performance.now();
  await assert.rejects(stripPdf(many), (err) => err.status === 413 && /too complex/.test(err.message));
  assert.ok(performance.now() - started < 3000, `refused in ${Math.round(performance.now() - started)} ms`);
  // The cap counts every stream's entries together.
  const two = await withAppended(objectStream(600) + objectStream(600));
  assert.equal(await status(stripPdf(two, { maxEntries: 1000 })), 413);
  assert.ok((await stripPdf(two, { maxEntries: 1300 })).bytes.length > 0);
  // /N pairs can't fit before /First.
  const crammed = await withAppended('\n999 0 obj\n<< /Type /ObjStm /N 100000 /First 4 /Length 8 >>\nstream\n1 0 null\nendstream\nendobj\n');
  assert.equal(await status(stripPdf(crammed)), 400);
});

const gc = (() => {
  setFlagsFromString('--expose-gc');
  return runInNewContext('gc');
})();

test('a slow PDF is stopped at the time limit and refused, while the server keeps running and keeps nothing', async () => {
  // 900,000 objects, under the cap: pdf-lib takes about ten seconds.
  const slow = await withAppended(objectStream(900_000));
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  let ticks = 0;
  const interval = setInterval(() => { ticks += 1; }, 10);
  const started = performance.now();
  try {
    await assert.rejects(stripPdf(slow, { timeoutMs: 400 }), (err) => err.status === 413 && /too complex/.test(err.message));
  } finally {
    clearInterval(interval);
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, `stopped after ${Math.round(elapsed)} ms`);
  assert.ok(ticks >= 15, `the event loop ticked ${ticks} times meanwhile`);
  gc();
  const grown = process.memoryUsage().heapUsed - heapBefore;
  assert.ok(grown < 16 * 1024 * 1024, `the server's heap grew by ${Math.round(grown / 1024 / 1024)} MB`);
});

test('a PDF that needs more than the heap limit to read is refused, not the server', async () => {
  const big = await withAppended(objectStream(300_000, (i) => `${1000 + i} 0 `));
  await assert.rejects(stripPdf(big, { heapMb: 16 }), (err) => err.status === 413 && /too complex/.test(err.message));
  // And a normal one still reads after it.
  const { bytes } = await stripPdf(await pdfWithObjectStreams());
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 120);
});

// pdf-lib (like pdf.js, Chrome and mupdf) never checks a zlib stream's
// Adler-32 trailer, so neither does the bounded decoder.
test('a flate stream with a wrong Adler-32 checksum still decodes', async () => {
  const input = await pdfWithObjectStreams();
  const streams = [...input.toString('latin1').matchAll(/\/Type \/ObjStm[^>]*?\/Length (\d+)[^>]*>>\nstream\n/g)];
  assert.ok(streams.length >= 3);
  const flipped = Buffer.from(input);
  for (const match of streams) flipped[match.index + match[0].length + Number(match[1]) - 1] ^= 0xff;
  assert.notDeepEqual(flipped, input);
  assert.equal((await PDFDocument.load(flipped)).getPageCount(), 120, 'pdf-lib itself reads it');
  const { bytes } = await stripPdf(flipped);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 120);
  assert.deepEqual(bytes, (await stripPdf(input)).bytes, 'the same file as from the intact one');
});
