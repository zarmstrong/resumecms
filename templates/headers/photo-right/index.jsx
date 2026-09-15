import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function PhotoRightHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-photoright">
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
      <div className="r-header-identity r-header-identity-right">
        <HeadshotImage header={header} />
        <div className="r-header-main r-header-main-right">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact r-contact-split" />
        </div>
      </div>
    </div>
  );
}
