import { ScaledShareCard } from '../share/ShareCard.jsx';

// Roughly what LinkedIn, Slack or iMessage show for a link to the page
// (issue #87): `meta` is share/pageMeta.js's resumePageMeta() or
// landingPageMeta() of the draft, so it shows the share card (or, with no
// name for one, the photo), title and description the page will carry
// once it's published, fallbacks included.
export function LinkPreview({ meta }) {
  const host = window.location.host;
  return (
    <div className="ed-link-preview" aria-label="Link preview">
      {meta.card ? (
        <ScaledShareCard content={meta.card} scale={0.3} />
      ) : (
        meta.photoUrl && <img className="ed-link-preview-photo" src={meta.photoUrl} alt="" />
      )}
      <div className="ed-link-preview-text">
        <span className="ed-link-preview-title">{meta.title}</span>
        {meta.description && <span className="ed-link-preview-description">{meta.description}</span>}
        <span className="ed-link-preview-host">{host}</span>
      </div>
    </div>
  );
}
