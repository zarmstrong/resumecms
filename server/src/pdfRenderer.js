import puppeteer from 'puppeteer';

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
  await page.goto(printUrl, { waitUntil: 'networkidle0' });
  // The client app sets this flag once the resume data has fetched and rendered.
  await page.waitForFunction('window.__PDF_READY__ === true', { timeout: 15000 });

  const pdfBytes = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  });
  await page.close();
  // Puppeteer returns a Uint8Array; callers that hand this to res.send() or
  // fs.writeFile() need a real Buffer.
  return Buffer.from(pdfBytes);
}
