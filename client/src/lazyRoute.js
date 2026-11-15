// Loading a route's code on demand (App.jsx, issue #179), and what to do
// when that fails. After a deploy, a tab still holding the old index.html
// asks for chunk names the new build doesn't have, and the server 404s
// them (server/src/clientStatic.js) rather than sending the shell. A
// reload fetches the new shell, which names the new chunks; it's done once
// per RELOAD_WINDOW_MS, so a chunk that's really gone (or a server that's
// down) shows an error instead of reloading forever.

export const RELOAD_KEY = 'resumecms:chunk-reload';
export const RELOAD_WINDOW_MS = 60_000;

// What a route's `lazy` rejects with when its chunk (or a stylesheet or
// chunk it needs) didn't load, so RouteError can tell it from an error the
// page itself threw while rendering.
export class ChunkLoadError extends Error {
  constructor(cause) {
    super(`Couldn't load this page: ${cause?.message ?? String(cause)}`, { cause });
    this.name = 'ChunkLoadError';
  }
}

// window.sessionStorage, or null where reading it throws (storage
// disabled, a sandboxed frame); without it there's no guard, so no reload.
export function sessionStore() {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

// Whether `err` is a chunk that didn't arrive, as each browser words it
// (Chrome, Firefox, Safari; Vite's preload helper for a stylesheet), not
// an error the chunk's own code threw while it ran: only the first is
// fixed by reloading.
const FETCH_FAILURES = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

export function isChunkFetchError(err) {
  const message = typeof err?.message === 'string' ? err.message : '';
  return FETCH_FAILURES.some((pattern) => pattern.test(message));
}

// A data router route's `lazy`: `load()` is the `import()` of the page's
// module, `name` the export that is its component. A load that worked
// clears the reload mark, so the next deploy gets its reload too.
export function lazyRoute(load, name, { storage = sessionStore } = {}) {
  return () =>
    load().then(
      (module) => {
        forgetReload(storage());
        // A wrong name would render the route as nothing, silently (and a
        // PDF render would wait out its timeout): say so instead.
        // Any component counts, memo() and forwardRef() objects included.
        if (module[name] == null) throw new Error(`The page's module has no ${name} export`);
        return { Component: module[name] };
      },
      (err) => {
        // Anything else is the page's own error, shown as it is.
        throw isChunkFetchError(err) ? new ChunkLoadError(err) : err;
      }
    );
}

// True (and noted in `storage`) when a failed chunk may reload the page:
// not when another reload happened within RELOAD_WINDOW_MS of `now` (a
// clock that went back counts as recent), nor without working storage.
export function claimReload(storage, now = Date.now()) {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY));
    if (last > 0 && Math.abs(now - last) < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function forgetReload(storage) {
  try {
    storage?.removeItem(RELOAD_KEY);
  } catch {
    // Nothing to forget without storage.
  }
}
