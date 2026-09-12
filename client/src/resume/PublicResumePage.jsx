import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ResumeView } from './ResumeView.jsx';

export function PublicResumePage({ mode }) {
  const [state, setState] = useState({ loading: true, error: null, resume: null });

  useEffect(() => {
    let cancelled = false;
    api
      .getPublicResume(mode)
      .then((resume) => {
        if (!cancelled) setState({ loading: false, error: null, resume });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, resume: null });
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'print' && !state.loading) {
      // Signal to the Puppeteer PDF route that content has finished rendering.
      window.__PDF_READY__ = true;
    }
  }, [mode, state.loading]);

  if (state.loading) return null;
  if (state.error) {
    return <div style={{ padding: 40, fontFamily: 'var(--font-ui)' }}>Couldn't load resume: {state.error}</div>;
  }

  const { header, site, blocks } = state.resume;
  if (site?.title) document.title = site.title;

  return <ResumeView header={header} site={site} blocks={blocks} mode={mode} />;
}
