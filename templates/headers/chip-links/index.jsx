import { HeadshotImage, HeaderActions, PhoneText } from '@resume/headerParts.jsx';
import { safeHref, linkProps } from '@resume/safeUrl.js';
import { linkGlyph } from '@resume/linkTypes.js';

export default function ChipLinksHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-chiplinks">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <div className="r-contact r-contact-chips">
            {header.location && <span className="r-contact-chip">{header.location}</span>}
            {header.email && (
              <a className="r-contact-chip" href={safeHref(`mailto:${header.email}`)}>
                {header.email}
              </a>
            )}
            {header.phone && <PhoneText className="r-contact-chip" phone={header.phone} />}
            {(header.links || []).map((link, i) => (
              <a key={i} className="r-contact-chip" {...linkProps(link.url)}>
                {linkGlyph(link)} {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
