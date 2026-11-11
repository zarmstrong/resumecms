import { parentPort, workerData } from 'node:worker_threads';
import { stripPdfBytes } from './pdfStrip.js';

// One upload's metadata strip (pdfStrip.js), in a worker thread of its own
// started by pdfUpload.js, which kills it past its time and heap limits.
// It gets the file's bytes (transferred, not copied) and posts back the
// stripped ones the same way, or the refusal's status and message; then
// it's done, and whatever pdf-lib kept goes with the thread.

// pdf-lib's notes on every object it couldn't read, which a hostile file
// can make by the million, aren't logged.
console.warn = () => {};

const { bytes, maxDecodedBytes, maxEntries } = workerData;
try {
  const stripped = await stripPdfBytes(bytes, { maxDecodedBytes, maxEntries });
  parentPort.postMessage({ bytes: stripped }, [stripped.buffer]);
} catch (err) {
  parentPort.postMessage({ status: err?.status ?? 400, message: err?.message ?? 'Unreadable PDF' });
}
