import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { APPLE_TOUCH_SIZE, faviconSvg, iconContent } from './favicon.js';
import { createFaviconRaster } from './faviconRaster.js';

// /apple-touch-icon.png's renders (issue #104): a real one through sharp,
// and the cache around them with a fake renderer.

const svgOf = (name, accent = '#2f6f4e') => faviconSvg(iconContent({ name, accent }), { forRaster: true });

function countingRender() {
  const calls = [];
  const render = async (svg, size) => {
    calls.push(svg);
    return Buffer.from(`${size}:${svg}`);
  };
  return { calls, render };
}

test('a real render is a 180×180 opaque PNG in the accent color', async () => {
  const raster = createFaviconRaster({ size: APPLE_TOUCH_SIZE });
  const { bytes, etag } = await raster.pngFor(svgOf('Jo Doe', '#336699'));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 180);
  assert.equal(meta.height, 180);
  assert.equal(meta.hasAlpha, false);
  const { data } = await sharp(bytes).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data], [0x33, 0x66, 0x99], 'a corner is the accent, edge to edge');
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  // The neutral mark (and a name with odd characters) renders too.
  for (const svg of [faviconSvg(iconContent(), { forRaster: true }), svgOf('<&> "Jo"'), svgOf('דנה כהן')]) {
    assert.equal((await sharp((await raster.pngFor(svg)).bytes).metadata()).width, 180);
  }
});

test('the same SVG is drawn once, even when asked for twice at once', async () => {
  const { calls, render } = countingRender();
  const raster = createFaviconRaster({ size: 180, render });
  const [a, b] = await Promise.all([raster.pngFor(svgOf('Jo')), raster.pngFor(svgOf('Jo'))]);
  assert.equal(a, b);
  await raster.pngFor(svgOf('Jo'));
  assert.equal(calls.length, 1);
  await raster.pngFor(svgOf('Al'));
  assert.equal(calls.length, 2, 'a rename is a new render');
  assert.notEqual((await raster.pngFor(svgOf('Al'))).etag, a.etag);
});

test('the cache is bounded, dropping the least recently used', async () => {
  const { calls, render } = countingRender();
  const raster = createFaviconRaster({ size: 180, maxEntries: 3, render });
  for (const name of ['A', 'B', 'C']) await raster.pngFor(svgOf(name));
  await raster.pngFor(svgOf('A')); // A is now the most recent
  for (let i = 0; i < 50; i++) await raster.pngFor(svgOf('D', `#0000${String(i).padStart(2, '0')}`));
  assert.equal(raster.size(), 3);
  calls.length = 0;
  await raster.pngFor(svgOf('A'));
  assert.equal(calls.length, 1, 'A was pushed out by the newer ones');

  const small = createFaviconRaster({ size: 180, maxEntries: 2, render });
  for (const name of ['A', 'B']) await small.pngFor(svgOf(name));
  await small.pngFor(svgOf('A'));
  await small.pngFor(svgOf('C'));
  calls.length = 0;
  await small.pngFor(svgOf('A'));
  assert.equal(calls.length, 0, 'the recently used one stayed; B went');
});

test('a failed render is not kept', async () => {
  let fail = true;
  const raster = createFaviconRaster({
    size: 180,
    render: async () => {
      if (fail) throw new Error('librsvg says no');
      return Buffer.from('png');
    },
  });
  await assert.rejects(raster.pngFor(svgOf('Jo')), /librsvg says no/);
  assert.equal(raster.size(), 0);
  fail = false;
  assert.equal((await raster.pngFor(svgOf('Jo'))).bytes.toString(), 'png');
});
