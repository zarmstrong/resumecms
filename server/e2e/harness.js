// The browser suite's harness (issue #178): a throwaway server on a free
// port and a fresh data dir, and a headless Chromium to drive it. Nothing
// here touches a real install: the data dir is made by mkdtemp and removed
// at the end, and the only process ever signalled is the one spawned here
// (by its ChildProcess, never by name: production may share this host's
// PID namespace).
//
// Named so `npm test` (node --test's default patterns, *.test.js and
// test/**) never picks it or the suite up; `npm run test:browser` runs it.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { constants, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { FORCE_EXIT_MS } from '../src/shutdown.js';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.dirname(SERVER_DIR);
const CLIENT_DIST_INDEX = path.join(REPO_ROOT, 'client', 'dist', 'index.html');
const REAPER = path.join(SERVER_DIR, 'e2e', 'reaper.js');

export const USERNAME = 'e2e-admin';
export const PASSWORD = `e2e-${randomBytes(8).toString('hex')}`;

const READY_TIMEOUT_MS = 20000;
// What each running server leaves behind if the test process ends without
// its after() hooks (Puppeteer's own SIGINT handler calls process.exit(130),
// an uncaught error, a signal): run on 'exit', which fires on any exit but
// only runs synchronous code, and on a signal, which by default ends the
// process without an 'exit'. A server is SIGTERMed rather than killed, so
// its shutdown (src/shutdown.js) still closes its PDF renderer's Chromium,
// which runs in a process group of its own; it finishes after we're gone,
// so its data dir is removed by e2e/reaper.js once it has exited.
const cleanups = new Set();
function runCleanups() {
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
}
process.on('exit', runCleanups);
// Then the process ends here, with the shell's code for that signal: a
// listener keeps it alive, and Puppeteer's own exits only on SIGINT (on
// SIGTERM and SIGHUP it just closes its browser). process.exit() still runs
// the 'exit' listeners, Puppeteer's included, which kills its browser.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    runCleanups();
    process.exit(128 + constants.signals[signal]);
  });
}

// Past the server's own FORCE_EXIT_MS backstop (src/shutdown.js), so its
// shutdown gets to close the PDF renderer's Chromium before a SIGKILL.
const STOP_GRACE_MS = FORCE_EXIT_MS + 2000;
const OUTPUT_KEEP_CHARS = 64 * 1024;

// A port nothing is listening on, from the OS. It's closed again before the
// server takes it, so another process could in principle grab it first; the
// ready check would then fail with the server's EADDRINUSE in its output.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Starts `node src/index.js` and resolves once /api/auth/status answers.
// Returns { baseUrl, dataDir, output(), stop() }; stop() SIGTERMs the
// child (SIGKILL after a grace period), waits for it, and removes the data
// dir. A server that exits or never answers rejects with its output.
export async function startServer() {
  if (!existsSync(CLIENT_DIST_INDEX)) {
    throw new Error(`The browser suite needs a built client, and ${CLIENT_DIST_INDEX} is missing. Run "npm run build" in client/ first.`);
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'resumecms-e2e-'));
  // The boot render of the default resume's PDF isn't part of any flow: an
  // empty file at the legacy path is moved to the resume's own by the
  // first-boot migration, so ensurePdfs() finds one and skips it.
  writeFileSync(path.join(dataDir, 'resume.pdf'), '');

  // Only what the server needs from the environment, so a RESUMECMS_*
  // variable set in the shell (a captcha, an MCP token, a real data dir)
  // can't change or reach the install under test.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RESUMECMS_')));
  Object.assign(env, {
    PORT: String(port),
    RESUMECMS_DATA_DIR: dataDir,
    RESUMECMS_ADMIN_USERNAME: USERNAME,
    RESUMECMS_APP_PASSWORD: PASSWORD,
    RESUMECMS_SESSION_SECRET: randomBytes(32).toString('hex'),
  });

  // In a process group of its own, so a signal to ours (a terminal's
  // Ctrl+C or hangup) reaches it only as the SIGTERM sent from here: it
  // handles SIGTERM and SIGINT, but a SIGHUP would end it without its
  // shutdown and leave its PDF renderer's Chromium running.
  const child = spawn(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  // Only a tail is ever shown, so only a tail is kept.
  let output = '';
  const keep = (chunk) => {
    output = (output + chunk).slice(-OUTPUT_KEEP_CHARS);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  // Tracked from the start: a spawn failure fires 'error' and never 'exit',
  // and a listener added only at stop() could miss either.
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (err) => resolve({ error: err }));
  });
  let done = false;
  exited.then(() => (done = true));

  // Until stop() has finished, so an exit in the middle of it still
  // takes the server and data dir with it (see `cleanups`).
  const cleanup = () => {
    if (done) {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    }
    child.kill('SIGTERM');
    spawn(process.execPath, [REAPER, String(child.pid), dataDir, String(STOP_GRACE_MS)], { detached: true, stdio: 'ignore' }).unref();
  };
  cleanups.add(cleanup);

  async function stop() {
    if (!done) {
      const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(timer);
    }
    rmSync(dataDir, { recursive: true, force: true });
    cleanups.delete(cleanup);
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last; // what the last probe got, for the timeout's message
  while (true) {
    if (done) {
      const how = await exited;
      await stop();
      throw new Error(`The server exited before it was ready (${JSON.stringify(how)}).\n--- server output ---\n${output}`);
    }
    try {
      // Bounded, so a server that takes the connection and never answers
      // still reaches the deadline below.
      const response = await fetch(`${baseUrl}/api/auth/status`, {
        signal: AbortSignal.timeout(Math.max(100, Math.min(2000, deadline - Date.now()))),
      });
      if (response.ok) break;
      last = `HTTP ${response.status}`;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`The server at ${baseUrl} wasn't ready after ${READY_TIMEOUT_MS} ms (last: ${last}).\n--- server output ---\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { baseUrl, dataDir, output: () => output, stop };
}

// Puppeteer's own browser, or PUPPETEER_EXECUTABLE_PATH (which Puppeteer
// reads itself). Chrome won't start its sandbox as root, and on GitHub's
// Ubuntu runners AppArmor blocks the unprivileged user namespaces it needs
// (Puppeteer's troubleshooting guide), so it's off there and as root only;
// the suite only ever loads the server it started.
export function launchBrowser() {
  const noSandbox = Boolean(process.env.CI) || process.getuid?.() === 0;
  return puppeteer.launch({
    headless: true,
    args: noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });
}

// Where a failed flow's screenshot goes: E2E_SCREENSHOT_DIR (CI uploads it)
// or a folder under the OS temp dir.
export async function saveScreenshot(page, name) {
  const dir = process.env.E2E_SCREENSHOT_DIR || path.join(tmpdir(), 'resumecms-e2e-screenshots');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (err) {
    return `(no screenshot: ${err.message})`;
  }
}
