import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function CompactHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-compact">
      <HeadshotImage header={header} className="r-header-photo-compact" />
      <div className="r-header-compact-id">
        <span className="r-name r-name-compact">{header.name}</span>
        {header.title && <span className="r-title-compact">{header.title}</span>}
        {header.subtitle && <span className="r-subtitle-compact">{header.subtitle}</span>}
      </div>
      <ContactInline header={header} className="r-contact r-contact-compact" />
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
