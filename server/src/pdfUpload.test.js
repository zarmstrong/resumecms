import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
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
const SECRETS = ['XmpAuthor', 'PieceSecret', 'OldRevisionText'];
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
  page.node.set(PDFName.of('PieceInfo'), doc.context.obj({ App: { Private: 'PieceSecret' } }));
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
  for (const key of ['/Info', '/Metadata', '/PieceInfo', '/Author', '/Creator', '/Producer', '/CreationDate', '/ModDate']) {
    assert.equal(text.includes(key), false, `${key} is gone`);
  }
  // A single revision.
  assert.equal(text.match(/%%EOF/g).length, 1);

  const reread = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(reread.getPageCount(), 1);
  assert.deepEqual(reread.getPage(0).getSize(), { width: 200, height: 200 });
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
