#!/usr/bin/env node
// Renders a preview.png thumbnail for every curated preset under
// templates/presets/ — maintainer/contributor tooling, not wired into the
// app itself (the in-app gallery renders live, not from these images; see
// client/src/editor/TemplateGallery.jsx). Boots its own throwaway server
// instance against an ephemeral data dir (never the real RESUMECMS_DATA_DIR)
// on a non-default port, screenshots each /template-preview/preset/:id route
// with the same headless-Chromium pattern src/pdfRenderer.js uses for PDF
// export, then shuts the server down.
//
// Usage: node server/scripts/render-template-previews.mjs
// (or via the isolated docker-compose "tools" profile — see docker-compose.yml)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // .../server
const REPO_ROOT = path.dirname(SERVER_DIR);
const PRESETS_DIR = path.join(REPO_ROOT, 'templates', 'presets');
const PORT = process.env.RENDER_PREVIEWS_PORT || '4321';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function presetIds() {
  if (!existsSync(PRESETS_DIR)) return [];
  return readdirSync(PRESETS_DIR).filter((name) => statSync(path.join(PRESETS_DIR, name)).isDirectory());
}

function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function poll() {
      fetch(url)
        .then(() => resolve())
        .catch((err) => {
          if (Date.now() > deadline) return reject(new Error(`server never came up at ${url}: ${err.message}`));
          setTimeout(poll, 300);
        });
    })();
  });
}

async function main() {
  const ids = presetIds();
  if (ids.length === 0) {
    console.log('No presets under templates/presets/ — nothing to render.');
    return;
  }

  const dataDir = mkdtempSync(path.join(tmpdir(), 'resumecms-preview-'));
  console.log(`Booting a throwaway server (port ${PORT}, ephemeral data dir ${dataDir})...`);

  const server = spawn('node', ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT,
      RESUMECMS_DATA_DIR: dataDir,
      // No RESUMECMS_ADMIN_USERNAME/PASSWORD — the preview routes need no
      // auth, and this instance is torn down before anyone could log in.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => (serverOutput += chunk));
  server.stderr.on('data', (chunk) => (serverOutput += chunk));

  let browser;
  try {
    await waitForServer(BASE_URL).catch((err) => {
      throw new Error(`${err.message}\n--- server output ---\n${serverOutput}`);
    });

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    for (const id of ids) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1000, height: 1400 });
      await page.goto(`${BASE_URL}/template-preview/preset/${id}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction('window.__PREVIEW_READY__ === true', { timeout: 15000 });

      const resume = await page.$('.r-page');
      if (!resume) throw new Error(`preset "${id}": .r-page never rendered`);
      const outPath = path.join(PRESETS_DIR, id, 'preview.png');
      await resume.screenshot({ path: outPath });
      await page.close();
      console.log(`✓ ${path.relative(REPO_ROOT, outPath)}`);
    }
  } finally {
    if (browser) await browser.close();
    // Precise kill on the PID we spawned and are holding a reference to —
    // never a name/pattern-based kill, which on a host running other node
    // processes could hit something other than this throwaway server.
    await killAndWait(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// spawn()'s ChildProcess (and the stdio streams piped from it) keep the
// event loop alive until it actually exits, not just until it's signaled —
// wait for that, with a SIGKILL escalation in case it ignores SIGTERM, so
// this script reliably exits on its own instead of hanging after its work
// is done.
function killAndWait(child, timeoutMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    // 'exit' covers the normal case; 'error' covers the child never having
    // started at all (e.g. spawn failure), which can fire without a
    // matching 'exit' and would otherwise leave this promise unresolved.
    child.once('exit', done);
    child.once('error', done);
    child.kill('SIGTERM');
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
