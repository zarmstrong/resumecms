import { useEffect } from 'react';
import { api } from '../api.js';
import { ResumeView } from './ResumeView.jsx';
import { PDF_URL_PATH, publicPdfPath } from './pdfUrl.js';
import { usePublicFetch } from './usePublicFetch.js';
import { resumePageMeta } from '../share/pageMeta.js';
import { homeLinkOf, sameHomeLink } from './homeLink.js';
import { normalizeSiteColors } from './siteColors.js';

// A publish stamps the snapshot with publishedAt and a render changes
// pdfVersion, so those two identify what's on screen. Only a snapshot
// from before publishedAt existed (an install migrated from the pre-draft
// days, never re-published) has to fall back to comparing the content.
// The home link isn't part of the snapshot (switching the landing page on
// or off changes it without a publish), so it's compared as well.
export function sameResume(a, b) {
  if (a.publishedAt || b.publishedAt) {
    return a.publishedAt === b.publishedAt && a.pdfVersion === b.pdfVersion && sameHomeLink(a.home, b.home);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// `slug` (web only) shows the public resume at /r/<slug> instead of the
// one the server picks for this host.
export function PublicResumePage({ mode, slug = null }) {
  const state = usePublicFetch(() => api.getPublicResume(mode, slug), [mode, slug], {
    refetch: mode === 'web',
    same: sameResume,
    dropOn404: Boolean(slug),
  });

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
  if (state.error) return <LoadError message={state.error} />;
  return <PublishedResume resume={state.data} mode={mode} pdfPath={slug ? publicPdfPath(slug) : PDF_URL_PATH} />;
}

export function LoadError({ message }) {
  return <div style={{ padding: 40, fontFamily: 'var(--font-ui)' }}>Couldn't load resume: {message}</div>;
}

// A published resume as the public API sends it, under its "← Home" link
// when it has one (homeLink.js). The link sits outside ResumeView, so no
// header template draws it and the editor's preview never shows it.
export function PublishedResume({ resume, mode, pdfPath = PDF_URL_PATH }) {
  const { header, site, blocks, pdfVersion } = resume;
  // The same title the server put in the shell (share/pageMeta.js).
  document.title = resumePageMeta(header, site, blocks).title;
  const view = <ResumeView header={header} site={site} blocks={blocks} mode={mode} pdfVersion={pdfVersion} pdfPath={pdfPath} />;
  const home = homeLinkOf(resume, mode);
  if (!home) return view;
  return (
    <>
      <HomeLink home={home} site={site} />
      {view}
    </>
  );
}

// Drawn in the resume's own accent and background, like a link on the page.
function HomeLink({ home, site }) {
  const colors = normalizeSiteColors(site);
  return (
    <nav className="r-home-nav" aria-label="Site" style={{ '--r-accent': colors.accent, '--r-bg': colors.background }}>
      <a className="r-home-link" href={home.href}>
        <span aria-hidden="true">←</span> {home.label}
      </a>
    </nav>
  );
}
