import { Router } from 'express';
import puppeteer from 'puppeteer';
import { getSetting } from '../db.js';

const router = Router();

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .catch((err) => {
        // Don't cache a failed launch — let the next request try again
        // (e.g. after a transient issue) instead of failing forever.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

router.get('/resume.pdf', async (req, res) => {
  try {
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
    // Puppeteer returns a Uint8Array; res.send() only special-cases real
    // Buffers for binary output, otherwise it JSON-serializes the bytes.
    const pdfBuffer = Buffer.from(pdfBytes);

    const site = getSetting('site') || {};
    const fileName = `${(site.title || 'resume').replace(/[^a-z0-9-_]+/gi, '-')}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed', detail: String(err.message || err) });
  }
});

export default router;
