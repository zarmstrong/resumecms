import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { httpError } from './httpError.js';
import { LANDING_FILE_LIMITS, isPdf } from './landingFileFields.js';

// An uploaded PDF with its metadata stripped, for the landing page's
// documents (issue #128); what's removed and kept is in pdfStrip.js.
//
// Never parsed on this thread. How long pdf-lib takes over a file, and how
// much it keeps, isn't bounded by the file's size: a 1 KB cross-reference
// stream can declare millions of objects, and pdf-lib loops over them
// without yielding and keeps a PDFRef for each in a pool it never empties.
// So each upload is read by a worker thread of its own
// (pdfStripWorker.js), with a heap limit, terminated past `timeoutMs`, and
// gone afterwards with everything pdf-lib held. They run one at a time, so
// at most one such heap exists. The bytes are transferred in and out, not
// copied twice.
//
// Resolves with { id, bytes }, `id` the sha256 of `bytes`; rejects with a
// 400 (not a PDF, encrypted, or unreadable) or a 413 (too big, told before
// anything parses it, once saved again, decompressing past
// `maxDecodedBytes` while being read, or too complex: declaring more
// objects than LANDING_FILE_LIMITS.streamEntries, running out of the
// worker's heap or its time).
export async function stripPdf(input, {
  maxInputBytes = LANDING_FILE_LIMITS.uploadBytes,
  maxStoredBytes = LANDING_FILE_LIMITS.storedBytes,
  maxDecodedBytes = LANDING_FILE_LIMITS.decodedBytes,
  maxEntries = LANDING_FILE_LIMITS.streamEntries,
  timeoutMs = LANDING_FILE_LIMITS.parseMs,
  heapMb = LANDING_FILE_LIMITS.parseHeapMb,
} = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw httpError(400, 'Send the PDF file as the request body');
  if (input.length > maxInputBytes) throw httpError(413, `That file is too large (at most ${megabytes(maxInputBytes)} MB)`);
  if (!isPdf(input)) throw httpError(400, 'Only PDF files can be uploaded');

  const job = queue.then(() => inWorker(input, { maxDecodedBytes, maxEntries, timeoutMs, heapMb }));
  queue = job.catch(() => {});
  const bytes = await job;
  if (bytes.length > maxStoredBytes) throw httpError(413, `That PDF is over ${megabytes(maxStoredBytes)} MB once cleaned; try a smaller one`);
  return { id: createHash('sha256').update(bytes).digest('hex'), bytes };
}

let queue = Promise.resolve();

const WORKER = new URL('./pdfStripWorker.js', import.meta.url);

function inWorker(input, { maxDecodedBytes, maxEntries, timeoutMs, heapMb }) {
  // A copy of its own to hand over: `input` may share its memory with
  // other buffers.
  const bytes = new Uint8Array(input);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { bytes, maxDecodedBytes, maxEntries },
      transferList: [bytes.buffer],
      resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: Math.min(32, heapMb) },
    });
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(() => settle(reject, tooComplex()), timeoutMs);
    worker.on('message', (message) => {
      if (message.bytes) settle(resolve, Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength));
      else settle(reject, httpError(message.status, message.message));
    });
    worker.on('error', (err) => {
      // Past its heap limit; anything else is a bug here, not the file.
      settle(reject, err?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? tooComplex() : err);
    });
    worker.on('exit', (code) => settle(reject, new Error(`PDF worker exited (${code}) without an answer`)));
  });
}

export function tooComplex() {
  return httpError(413, 'That PDF is too complex to read safely, so it was refused. Try exporting or printing it to a new PDF.');
}

function megabytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
