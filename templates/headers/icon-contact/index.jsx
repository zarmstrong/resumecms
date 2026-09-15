import { HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';
import { safeHref } from '@resume/safeUrl.js';
import { linkGlyph } from '@resume/linkTypes.js';

function IconContactItem({ glyph, children }) {
  return (
    <span className="r-icon-contact-item">
      <span className="r-link-badge" aria-hidden="true">{glyph}</span>
      {children}
    </span>
  );
}

export default function IconContactHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-iconcontact">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <div className="r-contact">
            {header.location && <IconContactItem glyph="a">{header.location}</IconContactItem>}
            {header.email && (
              <IconContactItem glyph="e">
                <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
              </IconContactItem>
            )}
            {header.phone && <IconContactItem glyph="p">{header.phone}</IconContactItem>}
            {(header.links || []).map((link, i) => (
              <IconContactItem key={i} glyph={linkGlyph(link)}>
                <a href={safeHref(link.url)} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </IconContactItem>
            ))}
          </div>
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
