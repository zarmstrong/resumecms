import { useEffect } from 'react';
import { ShareCard } from './ShareCard.jsx';

// /print/card: the page the server screenshots for a share card (issue
// #87, server/src/pdfRenderer.js's renderShareCard). The renderer hands it
// the card's content as window.__SHARE_CARD__ before any script runs, so
// it fetches nothing; opened any other way it shows nothing.
export function ShareCardPrintPage() {
  const content = typeof window !== 'undefined' ? window.__SHARE_CARD__ : null;

  useEffect(() => {
    if (!content) return undefined;
    let cancelled = false;
    const photo = document.querySelector('.share-card-photo');
    // The renderer screenshots once this is set: after the photo has
    // decoded and the fonts it's drawn in have loaded.
    Promise.all([photo ? photo.decode().catch(() => {}) : null, document.fonts?.ready]).then(() => {
      if (!cancelled) window.__PDF_READY__ = true;
    });
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (!content) return null;
  return <ShareCard content={content} />;
}
