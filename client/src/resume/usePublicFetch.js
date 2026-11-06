import { useEffect, useState } from 'react';

// Loads something the public site shows (a resume, or what `/` shows) and,
// with `refetch`, loads it again whenever the page comes back into view, so
// a tab left open across a Publish doesn't keep showing what it fetched on
// mount. Cheap, since an unchanged response is a 304. The print route is
// rendered once by headless Chromium and never revisited, so it doesn't
// refetch: a refetch mid-render could change what ends up in the PDF.
//
// `same(a, b)` says whether a refetch brought back what's on screen; if so
// the existing object is kept so nothing re-renders. A failed refetch keeps
// what's on screen, except a 404 when `dropOn404` (a /r/<slug> made
// private, unpublished or deleted, which comes off the screen too).
// `deps` restart it, as an effect's would.
export function usePublicFetch(load, deps, { refetch, same, dropOn404 = false }) {
  const [state, setState] = useState({ loading: true, error: null, notFound: false, data: null });

  useEffect(() => {
    let cancelled = false;
    // Only the most recent request may update the page: a refetch can be
    // triggered twice in a row (a bfcache restore fires both events below),
    // and a slow older response must not overwrite a newer one.
    let latest = 0;
    const run = () => {
      const seq = ++latest;
      load()
        .then((data) => {
          if (cancelled || seq !== latest) return;
          setState((prev) => (prev.data && same(prev.data, data) ? prev : { loading: false, error: null, notFound: false, data }));
        })
        .catch((err) => {
          if (cancelled || seq !== latest) return;
          const notFound = err.status === 404;
          setState((prev) =>
            prev.data && !(dropOn404 && notFound) ? prev : { loading: false, error: err.message, notFound, data: null }
          );
        });
    };
    run();

    const onPageShow = (event) => {
      if (event.persisted) run();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run();
    };
    if (refetch) {
      window.addEventListener('pageshow', onPageShow);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps
  }, deps);

  return state;
}
