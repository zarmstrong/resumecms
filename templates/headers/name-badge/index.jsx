import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function NameBadgeHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-namebadge">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <h1 className="r-name-badge-wrap">
            <span className="r-name-badge">{header.name}</span>
          </h1>
          <div className="r-title r-title-namebadge">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact" />
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
