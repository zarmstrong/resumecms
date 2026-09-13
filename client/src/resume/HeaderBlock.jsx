import { safeHref } from './safeUrl.js';

export function HeaderBlock({ header, showActions, onPrint, pdfHref }) {
  if (!header) return null;
  return (
    <div className="r-header">
      <div className="r-header-main">
        <h1 className="r-name">{header.name}</h1>
        <div className="r-title">{header.title}</div>
        <div className="r-contact">
          {header.location && <span>{header.location}</span>}
          {header.email && (
            <span>
              <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
            </span>
          )}
          {header.phone && <span>{header.phone}</span>}
          {(header.links || []).map((link, i) => (
            <span key={i}>
              <a href={safeHref(link.url)} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </span>
          ))}
        </div>
      </div>
      {showActions && (
        <div className="r-header-actions">
          {pdfHref && (
            <a className="r-action-btn" href={pdfHref}>
              Download PDF
            </a>
          )}
          <button className="r-action-btn" onClick={onPrint}>
            Print
          </button>
        </div>
      )}
    </div>
  );
}
