import fs from 'node:fs';
import path from 'node:path';
import { cardKey, isImageKey, parsePhoto, photoKey } from './shareImages.js';
import { writePdfAtomically } from './pdfPaths.js';

// Link-preview images (issue #87), composed into the resume store by
// createResumeStore(): the share cards, rendered on the PDF queue and kept
// as <pdfDir>/cards/<key>.png, and which images may be served at all.
//
// `publicPages()` lists every page a visitor can open right now (the
// landing page when it's on and published, every public, published
// resume) as pageMeta.js's resumePage()/landingPage() shapes. An image is
// served only while one of them shows it, so a resume made private or
// deleted takes its photo and card with it at once, whatever URL a crawler
// kept. `renderCard(content)` resolves with the PNG (already bounded by
// the store's render timeout); without one no card is ever drawn and the
// pages fall back to the photo.

// A card whose render failed isn't tried again for this long, so a box
// without Chromium (local dev) doesn't queue a render on every page view.
export const CARD_RETRY_MS = 10 * 60_000;

export function createShareStore({ pdfDir, withPdfLock, renderCard, publicPages }) {
  const cardDir = path.join(pdfDir, 'cards');
  const cardPath = (key) => path.join(cardDir, `${key}.png`);
  const pending = new Map();
  const failedAt = new Map();

  const shownCardKeys = () => new Set(publicPages().map((page) => cardKey(page.card)).filter(Boolean));

  // Deletes every card no public page shows any more. Runs after each
  // render, which is when a card can have replaced another. Never throws:
  // it runs in a job's `finally`, and nobody waits on those.
  function pruneCards() {
    let files;
    try {
      files = fs.readdirSync(cardDir);
    } catch {
      return;
    }
    try {
      const keep = shownCardKeys();
      for (const file of files) {
        const key = file.replace(/\.png$/, '');
        if (file.endsWith('.png') && !keep.has(key) && !pending.has(key)) fs.rmSync(path.join(cardDir, file), { force: true });
      }
    } catch (err) {
      console.error('Could not prune the share cards:', err);
    }
  }

  // Queues a render of `content`'s card unless it's on disk, already
  // queued, or failed a moment ago. Resolves once it has settled (a
  // failure is only logged: nobody waits on a card); null when nothing
  // was queued.
  function scheduleCard(content) {
    const key = cardKey(content);
    if (!key || !renderCard) return null;
    if (pending.has(key)) return pending.get(key);
    if (fs.existsSync(cardPath(key))) return null;
    if (Date.now() - (failedAt.get(key) ?? -Infinity) < CARD_RETRY_MS) return null;
    const job = withPdfLock(async () => {
      // Queued behind other renders: by now it may be drawn, or no page
      // may show it any more.
      if (fs.existsSync(cardPath(key)) || !shownCardKeys().has(key)) return;
      writePdfAtomically(cardPath(key), await renderCard(content));
    })
      .then(
        () => failedAt.delete(key),
        (err) => {
          failedAt.set(key, Date.now());
          console.error('Share card render failed:', err);
        }
      )
      .finally(() => {
        pending.delete(key);
        pruneCards();
      });
    pending.set(key, job);
    return job;
  }

  // The key of `content`'s card when it's on disk, else null, having
  // queued its render: the page's tags then name the photo instead, and
  // the next crawler to come by gets the card.
  function readyCardKey(content) {
    const key = cardKey(content);
    if (!key) return null;
    if (fs.existsSync(cardPath(key))) return key;
    scheduleCard(content);
    return null;
  }

  // Queues every public page's card that isn't drawn yet: after a publish,
  // and on boot. Resolves once those renders have settled, never rejects:
  // a publish mustn't fail over its card.
  function refreshShareCards() {
    try {
      return Promise.all(publicPages().map((page) => scheduleCard(page.card)).filter(Boolean));
    } catch (err) {
      console.error('Could not queue the share cards:', err);
      return Promise.resolve([]);
    }
  }

  // The image behind /api/public/images/<key>: `{ contentType, body }` for
  // a photo, `{ contentType, path }` for a card; null unless a public page
  // shows it.
  function shareImage(key) {
    if (!isImageKey(key)) return null;
    for (const page of publicPages()) {
      if (key.startsWith('p') && photoKey(page.photoUrl) === key) return parsePhoto(page.photoUrl);
      if (key.startsWith('c') && cardKey(page.card) === key && fs.existsSync(cardPath(key))) {
        return { contentType: 'image/png', path: cardPath(key) };
      }
    }
    return null;
  }

  return { readyCardKey, refreshShareCards, shareImage };
}
