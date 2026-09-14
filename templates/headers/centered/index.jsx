import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function CenteredHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-centered">
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
      <HeadshotImage header={header} className="r-header-photo-centered" />
      <h1 className="r-name">{header.name}</h1>
      <div className="r-title">{header.title}</div>
      {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
      <ContactInline header={header} className="r-contact r-contact-centered" />
    </div>
  );
}
