import path from 'node:path';
import puppeteer from 'puppeteer';

// Where the published PDF lives on disk. Written by the store's publish()
// (and the first-boot render in index.js), served as-is by routes/pdf.js.
const DATA_DIR = process.env.RESUMECMS_DATA_DIR || '/data';
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

export async function renderResumePdf() {
  const port = process.env.PORT || 4000;
  const printUrl = `http://127.0.0.1:${port}/print`;

  const browser = await getBrowser();
  const page = await browser.newPage();
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
    // A failed or abandoned render (the store gives up on it after a
    // timeout) must not leave a tab open in the shared browser.
    await page.close().catch(() => {});
  }
}
