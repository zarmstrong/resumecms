import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { usePublicFetch } from '../resume/usePublicFetch.js';
import { LoadError, PublicResumePage, PublishedResume, sameResume } from '../resume/PublicResumePage.jsx';
import { LandingView } from './LandingView.jsx';

// What `/` shows: the landing page or the resume, as the server decides
// for this host (GET /api/public/home, issue #70). One request either way,
// so a cold load never shows the resume and then swaps to the landing page.
// A landing page's cards are resolved per request (a resume made private
// drops off without a publish), so it's compared whole, not by publishedAt.
function sameHome(a, b) {
  if (a.kind !== b.kind) return false;
  return a.kind === 'resume' ? sameResume(a.resume, b.resume) : JSON.stringify(a.landing) === JSON.stringify(b.landing);
}

export function HomePage() {
  const state = usePublicFetch(() => api.getPublicHome(), [], { refetch: true, same: sameHome });
  if (state.loading) return null;
  if (state.error) return <LoadError message={state.error} />;
  if (state.data.kind === 'landing') {
    const { landing } = state.data;
    document.title = landing.headline || landing.site?.title || document.title;
    return <LandingView landing={landing} />;
  }
  return <PublishedResume resume={state.data.resume} mode="web" />;
}

// /resume: the default resume while the landing page holds `/`. Anywhere
// `/` would show a resume itself (the landing page is off, unpublished, or
// this is a resume's own domain), it goes to `/` instead, so a link saved
// while the landing page was on keeps working after it's switched off.
export function ResumeRoute() {
  const [kind, setKind] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getPublicHome()
      .then((home) => !cancelled && setKind(home.kind))
      // Can't tell: show the resume rather than nothing.
      .catch(() => !cancelled && setKind('landing'));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!kind) return null;
  if (kind === 'resume') return <Navigate to="/" replace />;
  return <PublicResumePage mode="web" />;
}
