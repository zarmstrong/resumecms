import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkLoadError, RELOAD_KEY, RELOAD_WINDOW_MS, claimReload, forgetReload, isChunkFetchError, lazyRoute } from './lazyRoute.js';

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('SecurityError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

test('a failed chunk reloads once, then not again within the window', () => {
  const storage = memoryStorage();
  const now = 1_000_000;
  assert.equal(claimReload(storage, now), true);
  assert.equal(storage.getItem(RELOAD_KEY), String(now));
  // The reloaded page fails again: an error, not another reload.
  assert.equal(claimReload(storage, now + 2_000), false);
  assert.equal(claimReload(storage, now + RELOAD_WINDOW_MS - 1), false);
  // Long after, a later deploy gets its reload.
  assert.equal(claimReload(storage, now + RELOAD_WINDOW_MS), true);
});

test('a mark from the future (a clock that went back) counts as recent', () => {
  const storage = memoryStorage({ [RELOAD_KEY]: '5000000' });
  assert.equal(claimReload(storage, 5_000_000 - 1_000), false);
});

test('a garbled mark does not block the reload', () => {
  assert.equal(claimReload(memoryStorage({ [RELOAD_KEY]: 'nonsense' }), 1_000), true);
});

test('without working storage there is no guard, so no reload', () => {
  assert.equal(claimReload(null), false);
  assert.equal(claimReload(throwingStorage), false);
  assert.doesNotThrow(() => forgetReload(throwingStorage));
  assert.doesNotThrow(() => forgetReload(null));
});

test('a route that loads gives its component and clears the mark', async () => {
  const storage = memoryStorage({ [RELOAD_KEY]: '123' });
  function Page() {}
  const lazy = lazyRoute(async () => ({ Page }), 'Page', { storage: () => storage });
  assert.deepEqual(await lazy(), { Component: Page });
  assert.equal(storage.getItem(RELOAD_KEY), null);
});

test("a route that doesn't load rejects with a ChunkLoadError and keeps the mark", async () => {
  const storage = memoryStorage({ [RELOAD_KEY]: '123' });
  const cause = new TypeError('Failed to fetch dynamically imported module: /assets/EditorRoute-OLD.js');
  const lazy = lazyRoute(() => Promise.reject(cause), 'Page', { storage: () => storage });
  await assert.rejects(lazy(), (err) => {
    assert.ok(err instanceof ChunkLoadError);
    assert.equal(err.cause, cause);
    assert.match(err.message, /EditorRoute-OLD/);
    return true;
  });
  assert.equal(storage.getItem(RELOAD_KEY), '123');
});

test("an error the chunk's own code throws is passed on as it is, with no reload", async () => {
  const storage = memoryStorage();
  const cause = new ReferenceError("Cannot access 'x' before initialization");
  const lazy = lazyRoute(() => Promise.reject(cause), 'Page', { storage: () => storage });
  await assert.rejects(lazy(), (err) => err === cause);
});

test('each browser\'s wording for a chunk that did not arrive counts as one', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://x/assets/a.js',
    'error loading dynamically imported module: https://x/assets/a.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/a.css',
  ]) {
    assert.equal(isChunkFetchError(new TypeError(message)), true, message);
  }
  assert.equal(isChunkFetchError(new TypeError('x is not a function')), false);
  assert.equal(isChunkFetchError(null), false);
});

test('a module without the named export is an error, not a blank page', async () => {
  const lazy = lazyRoute(() => Promise.resolve({ Other: () => null }), 'Page', { storage: () => memoryStorage() });
  await assert.rejects(lazy(), /no Page export/);
});

test('a component that is an object (memo, forwardRef) is a page too', async () => {
  const Page = { $$typeof: Symbol.for('react.memo'), type: () => null };
  const lazy = lazyRoute(() => Promise.resolve({ Page }), 'Page', { storage: () => memoryStorage() });
  assert.deepEqual(await lazy(), { Component: Page });
});
