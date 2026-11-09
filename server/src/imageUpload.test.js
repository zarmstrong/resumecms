import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { reencodeImage } from './imageUpload.js';
import { LANDING_IMAGE_LIMITS, sniffImageType } from './landingImageFields.js';

// The upload re-encode (issue #92): what's stored is never the bytes that
// were sent, so nothing the camera wrote reaches the public page.

const solid = (width, height) => sharp({ create: { width, height, channels: 3, background: '#336699' } });
const GPS = { GPSLatitudeRef: 'N', GPSLatitude: '38/1 42/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '9/1 8/1 0/1' };
const EXIF = { IFD0: { Make: 'TestCam', Model: 'Secret Model' }, IFD3: GPS };

const status = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err.status;
  }
  return null;
};

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// `png` with extra chunks inserted right after its IHDR.
function withChunks(png, chunks) {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), ...chunks, png.subarray(ihdrEnd)]);
}

function pngChunkTypes(png) {
  const types = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    types.push(png.toString('latin1', at + 4, at + 8));
    at += 12 + length;
  }
  return types;
}

test('the type comes from the bytes, never from what the upload says it is', async () => {
  const jpeg = await solid(8, 8).jpeg().toBuffer();
  const png = await solid(8, 8).png().toBuffer();
  const webp = await solid(8, 8).webp().toBuffer();
  assert.equal(sniffImageType(jpeg), 'image/jpeg');
  assert.equal(sniffImageType(png), 'image/png');
  assert.equal(sniffImageType(webp), 'image/webp');
  for (const other of [Buffer.from('GIF89a......'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(4), 'not a buffer']) {
    assert.equal(sniffImageType(other), null);
  }
  // A PNG named photo.jpg is still a PNG.
  assert.equal((await reencodeImage(png)).mime, 'image/png');
  assert.equal(await status(reencodeImage(Buffer.from('GIF89a garbage garbage'))), 400);
  assert.equal(await status(reencodeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))), 400);
  // The right first bytes and garbage after them.
  assert.equal(await status(reencodeImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]))), 400);
  assert.equal(await status(reencodeImage(Buffer.alloc(0))), 400);
  assert.equal(await status(reencodeImage(null)), 400);
});

test('EXIF, GPS position included, never survives a JPEG or WebP upload', async () => {
  for (const format of ['jpeg', 'webp']) {
    const input = await solid(64, 32).withExif(EXIF)[format]().toBuffer();
    assert.ok((await sharp(input).metadata()).exif, `the ${format} fixture carries EXIF`);
    assert.ok(input.includes(Buffer.from('Secret Model')));
    const out = await reencodeImage(input);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.exif, undefined, format);
    assert.equal(meta.xmp, undefined, format);
    assert.equal(out.bytes.includes(Buffer.from('Exif')), false, format);
    assert.equal(out.bytes.includes(Buffer.from('Secret Model')), false, format);
    assert.equal(out.bytes.includes(Buffer.from('TestCam')), false, format);
  }
});

test("a PNG's text and eXIf chunks are dropped", async () => {
  const exif = await solid(4, 4).withExif(EXIF).jpeg().toBuffer();
  const exifBody = (await sharp(exif).metadata()).exif;
  const input = withChunks(await solid(32, 32).png().toBuffer(), [
    pngChunk('tEXt', Buffer.from('Comment\0Taken at home, 38.7N 9.1W', 'latin1')),
    pngChunk('iTXt', Buffer.from('Author\0\0\0\0\0Jo', 'latin1')),
    pngChunk('eXIf', exifBody.subarray(6)),
  ]);
  assert.deepEqual(pngChunkTypes(input).slice(1, 4), ['tEXt', 'iTXt', 'eXIf']);
  const out = await reencodeImage(input);
  assert.equal(out.mime, 'image/png');
  const types = pngChunkTypes(out.bytes);
  for (const type of ['tEXt', 'iTXt', 'zTXt', 'eXIf']) assert.equal(types.includes(type), false, type);
  assert.equal(out.bytes.includes(Buffer.from('38.7N')), false);
});

test('the orientation is applied, large images are scaled down, small ones are not scaled up', async () => {
  const rotated = await solid(64, 32).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.equal((await sharp(rotated).metadata()).orientation, 6);
  const upright = await reencodeImage(rotated);
  assert.deepEqual([upright.width, upright.height], [32, 64]);
  assert.equal((await sharp(upright.bytes).metadata()).orientation, undefined);

  const wide = await reencodeImage(await solid(3200, 800).jpeg().toBuffer());
  assert.deepEqual([wide.width, wide.height], [LANDING_IMAGE_LIMITS.longSide, 400]);
  const tall = await reencodeImage(await solid(400, 2400).png().toBuffer());
  assert.deepEqual([tall.width, tall.height], [267, LANDING_IMAGE_LIMITS.longSide]);
  const small = await reencodeImage(await solid(300, 200).webp().toBuffer());
  assert.deepEqual([small.width, small.height, small.mime], [300, 200, 'image/webp']);
  // The id is the hash of what's stored.
  assert.match(small.id, /^[0-9a-f]{64}$/);
  assert.equal((await reencodeImage(await solid(300, 200).webp().toBuffer())).id, small.id);
});

test('the caps: what is sent, what is stored, and how many pixels', async () => {
  const jpeg = await solid(64, 64).jpeg().toBuffer();
  assert.equal(await status(reencodeImage(jpeg, { maxInputBytes: jpeg.length - 1 })), 413);
  assert.equal(await status(reencodeImage(jpeg, { maxStoredBytes: 10 })), 413);

  // A photo (a gradient with grain, here) is far bigger as PNG than as WebP:
  // over the cap as one, under it as the other.
  let seed = 1;
  const grain = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 16;
  const noise = Buffer.from(Array.from({ length: 300 * 300 * 3 }, (_, i) => Math.min(255, ((i / 3) % 300) * 0.8 + grain())));
  const png = await sharp(noise, { raw: { width: 300, height: 300, channels: 3 } }).png().toBuffer();
  const asPng = await reencodeImage(png);
  const asWebp = await reencodeImage(png, { maxStoredBytes: asPng.bytes.length - 1 });
  assert.equal(asWebp.mime, 'image/webp');
  assert.ok(asWebp.bytes.length < asPng.bytes.length);

  // 56 megapixels of one color: tiny as a file, turned away before it's
  // decoded.
  const bomb = await solid(8000, 7000).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(bomb.length < LANDING_IMAGE_LIMITS.uploadBytes);
  assert.equal(await status(reencodeImage(bomb)), 413);
});
