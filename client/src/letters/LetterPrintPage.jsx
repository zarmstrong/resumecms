import { useEffect } from 'react';
import { api } from '../api.js';
import { usePublicFetch } from '../resume/usePublicFetch.js';
import { LoadError } from '../resume/PublicResumePage.jsx';
import { CoverLetterView } from './CoverLetterView.jsx';

// /print/letter: the page the PDF renderer prints a cover letter from
// (issue #71). /api/public/letter serves it the letter its render cookie
// names, with the resume's header and look and the date to show; anyone
// else gets a 404. Fetched once, like /print.
export function LetterPrintPage() {
  const state = usePublicFetch(() => api.getLetterForRender(), [], { refetch: false, same: () => false });

  useEffect(() => {
    // Ready either way: the renderer checks it was served the letter it
    // asked for, so an error page never becomes a PDF.
    if (!state.loading) window.__PDF_READY__ = true;
  }, [state.loading]);

  if (state.loading) return null;
  if (state.error) return <LoadError message={state.error} />;
  const { header, site, letter, today } = state.data;
  return <CoverLetterView header={header} site={site} letter={letter.data} today={today} mode="print" />;
}
