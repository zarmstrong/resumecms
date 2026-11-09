import { resumePageStyle } from '../resume/pageStyle.js';
import './shareCard.css';

// A link preview's share card (issue #87): the name, title and photo on
// the page's background, in its colors and fonts, at 1200×630. `content`
// is server/src/shareImages.js's cardContent() (or the editor's mirror in
// pageMeta.js). The server draws it through /print/card; the editor's
// preview shows it scaled down. Changing the design? Bump
// CARD_DESIGN_VERSION in shareImages.js so existing cards are redrawn.
export function ShareCard({ content }) {
  const { style } = resumePageStyle(content.site);
  const long = content.name.length > 40 ? 'is-longer' : content.name.length > 24 ? 'is-long' : '';
  return (
    <div className={`share-card${content.photoUrl ? ' has-photo' : ''}`} style={style}>
      <div className="share-card-band" />
      {content.photoUrl && <img className="share-card-photo" src={content.photoUrl} alt="" />}
      <div className="share-card-text">
        <div className={`share-card-name ${long}`}>{content.name}</div>
        {content.title && <div className="share-card-title">{content.title}</div>}
        <div className="share-card-rule" />
      </div>
    </div>
  );
}

// The card at `scale` of its size, for a preview.
export function ScaledShareCard({ content, scale }) {
  return (
    <div className="share-card-frame" style={{ width: 1200 * scale, height: 630 * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <ShareCard content={content} />
      </div>
    </div>
  );
}
