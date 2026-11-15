import { useEffect, useRef, useState } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ChunkLoadError, claimReload, sessionStore } from './lazyRoute.js';

// What a lazily loaded route (App.jsx) shows around its chunk. A
// navigation inside the app keeps the old page up until the chunk is in;
// these are for a page opened directly, and for a chunk that failed.

const PAGE_STYLE = { padding: 40, fontFamily: 'var(--font-ui)' };

// Blank at first, so a chunk that arrives quickly never flashes anything;
// a line of text only once it's taking a while.
export const LOADING_DELAY_MS = 500;

// A reload that hasn't taken the page away by then was cancelled (a
// beforeunload prompt answered "stay"): show the error and its button.
export const RELOAD_GIVE_UP_MS = 3000;

export function RouteLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <div style={{ ...PAGE_STYLE, color: 'var(--slate)' }} role="status">
      Loading…
    </div>
  );
}

// The lazy routes' errorElement. A chunk that didn't load reloads the page
// once (see lazyRoute.js), by then at the URL it was going to, so the new
// shell names the chunks that exist. Nothing here sets __PDF_READY__: a
// PDF or share card render that can't load its page times out rather than
// capturing this.
export function RouteError() {
  const error = useRouteError();
  // Keyed by the error, so a second error on the same route (back and
  // forward between two of its URLs) starts over rather than inheriting
  // the first one's reload state. The reload itself is still once per
  // window (claimReload).
  return <RouteErrorView key={errorKey(error)} error={error} />;
}

const errorIds = new WeakMap();
let nextErrorId = 0;

function errorKey(error) {
  if (error === null || typeof error !== 'object') return `value:${String(error)}`;
  if (!errorIds.has(error)) errorIds.set(error, ++nextErrorId);
  return `error:${errorIds.get(error)}`;
}

function RouteErrorView({ error }) {
  const chunk = error instanceof ChunkLoadError;
  const [reloading, setReloading] = useState(chunk);
  const tried = useRef(false);

  useEffect(() => {
    if (!chunk || tried.current) return undefined;
    tried.current = true;
    // Offline, a reload only swaps this page for the browser's own error,
    // and would use up the one allowed: show the error and its button.
    if (navigator.onLine === false || !claimReload(sessionStore())) {
      setReloading(false);
      return undefined;
    }
    window.location.reload();
    // Not cleared on cleanup: StrictMode's dev re-run skips the body above
    // (tried), so a cleared timer would never be set again. A late call
    // after unmount does nothing.
    setTimeout(() => setReloading(false), RELOAD_GIVE_UP_MS);
    return undefined;
  }, [chunk]);

  if (reloading) return null;
  if (!chunk) {
    const message = isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`.trim()
      : (error?.message ?? String(error));
    return <div style={PAGE_STYLE}>Something went wrong: {message}</div>;
  }
  return (
    <div style={PAGE_STYLE} role="alert">
      <p style={{ marginTop: 0 }}>This page couldn't be loaded. Check your connection and try again.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
