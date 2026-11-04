import puppeteer from 'puppeteer';

// Renders a PDF and returns its bytes; the store decides where they go
// (see pdfPaths.js and resumeStore.js's writePdf).

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

// Drops the shared browser so the next render launches a fresh one, and
// closes it once (if ever) its launch resolves. Used when a render is
// abandoned: a launch or a tab that never settled is the usual sign of a
// wedged Chromium, and closing the browser is what unwedges it — it also
// rejects the abandoned render's pending calls, so that render finishes
// instead of running on beside the next one.
function resetBrowser(launch) {
  if (browserPromise === launch) browserPromise = null;
  launch.then((browser) => browser.close()).catch(() => {});
}

// Rejects as soon as `signal` aborts, even if `promise` never settles —
// so a hung launch(), newPage(), goto() or pdf() can't outlive the
// store's render timeout.
function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('PDF render aborted'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// `signal` (optional) comes from the store's render timeout: when it fires,
// whatever stage the render is at is torn down (browser reset) and this
// rejects, rather than the render being left running beside the next one.
// `resumeId` names the resume to render. The print page is addressed by
// id, not slug, so a rename mid-render can't make it render another one.
// (Until the client reads `?resume=`, /print renders the default resume,
// which is the only one that can exist so far.)
export async function renderResumePdf({ signal, resumeId } = {}) {
  const port = process.env.PORT || 4000;
  const query = resumeId ? `?resume=${encodeURIComponent(resumeId)}` : '';
  const printUrl = `http://127.0.0.1:${port}/print${query}`;

  signal?.throwIfAborted();
  const launch = getBrowser();
  const onAbort = () => resetBrowser(launch);
  signal?.addEventListener('abort', onAbort, { once: true });
  let page = null;
  try {
    const browser = await untilAborted(launch, signal);
    page = await untilAborted(browser.newPage(), signal);
    await untilAborted(page.goto(printUrl, { waitUntil: 'networkidle0' }), signal);
    // The client app sets this flag once the resume data has fetched and rendered.
    await untilAborted(page.waitForFunction('window.__PDF_READY__ === true', { timeout: 15000 }), signal);

    const pdfBytes = await untilAborted(
      page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      }),
      signal
    );
    // Puppeteer returns a Uint8Array; callers that hand this to res.send() or
    // fs.writeFile() need a real Buffer.
    return Buffer.from(pdfBytes);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // A failed render must not leave a tab open in the shared browser. (An
    // aborted one has had the whole browser closed by resetBrowser.)
    if (page) await page.close().catch(() => {});
  }
}
