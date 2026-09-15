import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function PhotoPanelHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-photopanel">
      <div className="r-header-identity">
        {header.photoUrl && (
          <div className="r-header-photopanel-block">
            <HeadshotImage header={header} className="r-header-photo-photopanel" />
          </div>
        )}
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact" />
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
