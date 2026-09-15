import { ContactInline, HeaderActions } from '@resume/headerParts.jsx';

export default function RuledHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-ruled">
      <div>
        <h1 className="r-name r-name-ruled">{header.name}</h1>
        <div className="r-header-ruled-mark" aria-hidden="true" />
        <div className="r-title">{header.title}</div>
        {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
        <ContactInline header={header} className="r-contact" />
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
