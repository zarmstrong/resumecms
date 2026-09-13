import { safeHref } from './safeUrl.js';

// Single-letter tag shown before each contact value in the "labeled-header"
// template, e.g. "e: you@example.com". Derived from the link URL so users
// don't have to type it themselves.
function linkGlyph(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('linkedin.com')) return 'i';
  if (u.includes('github.com')) return 'g';
  return 'w';
}

function ContactRow({ label, children }) {
  return (
    <div className="r-contact-row">
      <span className="r-contact-label">{label}:</span>
      <span className="r-contact-value">{children}</span>
    </div>
  );
}

function HeaderActions({ onPrint, pdfHref }) {
  return (
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
  );
}

export function HeaderBlock({ header, showActions, onPrint, pdfHref, template = 'classic' }) {
  if (!header) return null;

  if (template === 'labeled-header') {
    return (
      <div className="r-header r-header-labeled">
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
        </div>
        <div className="r-header-side">
          {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
          <div className="r-contact r-contact-labeled">
            {header.location && <ContactRow label="a">{header.location}</ContactRow>}
            {header.email && (
              <ContactRow label="e">
                <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
              </ContactRow>
            )}
            {header.phone && <ContactRow label="p">{header.phone}</ContactRow>}
            {(header.links || []).map((link, i) => (
              <ContactRow key={i} label={linkGlyph(link.url)}>
                <a href={safeHref(link.url)} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </ContactRow>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
