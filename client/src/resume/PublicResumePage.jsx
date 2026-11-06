import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ResumeView } from './ResumeView.jsx';
import { PDF_URL_PATH, publicPdfPath } from './pdfUrl.js';

// A publish stamps the snapshot with publishedAt and a render changes
// pdfVersion, so those two identify what's on screen. Only a snapshot
// from before publishedAt existed (an install migrated from the pre-draft
// days, never re-published) has to fall back to comparing the content.
function sameResume(a, b) {
  if (a.publishedAt || b.publishedAt) return a.publishedAt === b.publishedAt && a.pdfVersion === b.pdfVersion;
  return JSON.stringify(a) === JSON.stringify(b);
}

// `slug` (web only) shows the public resume at /r/<slug> instead of the
// one the server picks for this host.
export function PublicResumePage({ mode, slug = null }) {
  const [state, setState] = useState({ loading: true, error: null, resume: null });

  useEffect(() => {
    let cancelled = false;
    // Only the most recent request may update the page: a refetch can be
    // triggered twice in a row (a bfcache restore fires both events below),
    // and a slow older response must not overwrite a newer one.
    let latest = 0;
    const load = () => {
      const seq = ++latest;
      api
        .getPublicResume(mode, slug)
        .then((resume) => {
          if (cancelled || seq !== latest) return;
          // Same snapshot and PDF as what's on screen (the usual case for a
          // refetch): keep the existing object so nothing re-renders.
          setState((prev) => (prev.resume && sameResume(prev.resume, resume) ? prev : { loading: false, error: null, resume }));
        })
        .catch((err) => {
          if (cancelled || seq !== latest) return;
          // Keep whatever is on screen if a background refetch fails; only
          // the initial load has nothing better to show than the error.
          setState((prev) =>
            prev.resume ? prev : { loading: false, error: err.message, notFound: err.status === 404, resume: null }
          );
        });
    };
    load();

    // A web tab left open across a Publish would otherwise keep showing
    // what it fetched on mount: refetch when the browser restores the page
    // from its back/forward cache or the tab comes back into view. Cheap,
    // since an unchanged snapshot is a 304. The print route is rendered
    // once by headless Chromium and never revisited, so it gets no
    // listeners — a refetch mid-render could change what ends up in the PDF.
    const onPageShow = (event) => {
      if (event.persisted) load();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };
    if (mode === 'web') {
      window.addEventListener('pageshow', onPageShow);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mode, slug]);

  useEffect(() => {
    if (mode === 'print' && !state.loading) {
      // Signal to the Puppeteer PDF route that content has finished rendering.
      window.__PDF_READY__ = true;
    }
  }, [mode, state.loading]);

  if (state.loading) return null;
  // A private, unpublished or unknown /r/<slug> all 404 alike on the server.
  if (state.notFound && slug) {
    return <div style={{ padding: 40, fontFamily: 'var(--font-ui)' }}>This resume isn't available.</div>;
  }
  if (state.error) {
    return <div style={{ padding: 40, fontFamily: 'var(--font-ui)' }}>Couldn't load resume: {state.error}</div>;
  }

  const { header, site, blocks, pdfVersion } = state.resume;
  if (site?.title) document.title = site.title;

  return (
    <ResumeView
      header={header}
      site={site}
      blocks={blocks}
      mode={mode}
      pdfVersion={pdfVersion}
      pdfPath={slug ? publicPdfPath(slug) : PDF_URL_PATH}
    />
  );
}
