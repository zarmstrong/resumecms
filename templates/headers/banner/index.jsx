import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function BannerHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-banner">
      <div className="r-header-banner-top">
        <div className="r-header-identity">
          <HeadshotImage header={header} className="r-header-photo-banner" />
          <div>
            <h1 className="r-name">{header.name}</h1>
            <div className="r-title">{header.title}</div>
            {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          </div>
        </div>
        {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
      </div>
      <ContactInline header={header} className="r-contact r-contact-banner" />
    </div>
  );
}
