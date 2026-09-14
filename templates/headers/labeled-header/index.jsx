import { ContactRow, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';
import { safeHref } from '@resume/safeUrl.js';
import { linkGlyph } from '@resume/linkTypes.js';

export default function LabeledHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-labeled">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
        </div>
      </div>
      <div className="r-header-side">
        {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
        <div className="r-contact r-contact-labeled">
          {header.location && <ContactRow label="a">{header.location}</ContactRow>}
          {header.email && (
            <ContactRow label="e">
              <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
            </ContactRow>
          )}
          {header.phone && <ContactRow label="p">{header.phone}</ContactRow>}
          {(header.links || []).map((link, i) => (
            <ContactRow key={i} label={linkGlyph(link)}>
              <a href={safeHref(link.url)} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </ContactRow>
          ))}
        </div>
      </div>
    </div>
  );
}
