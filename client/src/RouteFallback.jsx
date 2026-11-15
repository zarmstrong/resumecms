import { useEffect, useRef, useState } from 'react';
import { useRouteError } from 'react-router-dom';
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
  const chunk = error instanceof ChunkLoadError;
  const [reloading, setReloading] = useState(chunk);
  const tried = useRef(false);

  useEffect(() => {
    if (!chunk || tried.current) return undefined;
    tried.current = true;
    if (!claimReload(sessionStore())) {
      setReloading(false);
      return undefined;
    }
    window.location.reload();
    const timer = setTimeout(() => setReloading(false), RELOAD_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [chunk]);

  if (reloading) return null;
  if (!chunk) {
    return <div style={PAGE_STYLE}>Something went wrong: {error?.message ?? String(error)}</div>;
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
