import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function SideTagHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-sidetag">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <div className="r-sidetag-row">
            <h1 className="r-name r-name-sidetag">{header.name}</h1>
            {header.title && <span className="r-title-tag">{header.title}</span>}
          </div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact" />
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
