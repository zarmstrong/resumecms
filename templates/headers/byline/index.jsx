import { ContactInline, HeaderActions } from '@resume/headerParts.jsx';

export default function BylineHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-byline">
      <div>
        <h1 className="r-name-byline">
          {header.name}
          {header.title && (
            <>
              <span className="r-byline-sep" aria-hidden="true">
                ·
              </span>
              <span className="r-title-byline">{header.title}</span>
            </>
          )}
        </h1>
        {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
        <ContactInline header={header} className="r-contact" />
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
