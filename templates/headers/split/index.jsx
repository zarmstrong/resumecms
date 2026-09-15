import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function SplitHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-split">
      <div className="r-header-split-panel">
        <HeadshotImage header={header} className="r-header-photo-split" />
        <div>
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
        </div>
      </div>
      <div className="r-header-split-side">
        {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
        <ContactInline header={header} className="r-contact r-contact-split" />
      </div>
    </div>
  );
}
