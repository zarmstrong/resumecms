import path from 'node:path';
import puppeteer from 'puppeteer';
import { DATA_DIR } from './dataDir.js';

// Where the published PDF lives on disk. Written by the store's publish()
// (and the first-boot render in index.js), served as-is by routes/pdf.js.
export const PDF_PATH = path.join(DATA_DIR, 'resume.pdf');

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .catch((err) => {
        // Don't cache a failed launch — let the next call try again
        // (e.g. after a transient issue) instead of failing forever.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

// Drops the shared browser so the next render launches a fresh one. Used
// when a render is abandoned: a tab that never settled is the usual sign
// of a wedged Chromium, and closing the browser is what unwedges it (and
// rejects the abandoned render's pending calls, so it finishes too).
function resetBrowser(current) {
  if (browserPromise === current) browserPromise = null;
  current.then((browser) => browser.close()).catch(() => {});
}

// `signal` (optional) comes from the store's render timeout: when it fires,
// the render is torn down rather than left running beside the next one.
export async function renderResumePdf({ signal } = {}) {
  const port = process.env.PORT || 4000;
  const printUrl = `http://127.0.0.1:${port}/print`;

  signal?.throwIfAborted();
  const current = getBrowser();
  const browser = await current;
  const page = await browser.newPage();
  const onAbort = () => resetBrowser(current);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await page.goto(printUrl, { waitUntil: 'networkidle0' });
    // The client app sets this flag once the resume data has fetched and rendered.
    await page.waitForFunction('window.__PDF_READY__ === true', { timeout: 15000 });

    const pdfBytes = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    });
    // Puppeteer returns a Uint8Array; callers that hand this to res.send() or
    // fs.writeFile() need a real Buffer.
    return Buffer.from(pdfBytes);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // A failed render must not leave a tab open in the shared browser.
    await page.close().catch(() => {});
  }
}
