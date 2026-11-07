// Shared building blocks for header templates (built-in and contributed —
// see templates/headers/*/index.jsx). Centralized here so every header
// reuses the same safe-link handling and contact markup instead of each
// reimplementing it.
import { safeHref, linkProps, telHref } from './safeUrl.js';
import { linkGlyph } from './linkTypes.js';

export function ContactRow({ label, children }) {
  return (
    <div className="r-contact-row">
      <span className="r-contact-label">{label}:</span>
      <span className="r-contact-value">{children}</span>
    </div>
  );
}

// The plain inline contact list (no letter labels) shared by most headers —
// "labeled-header" uses ContactRow instead.
export function ContactInline({ header, className }) {
  return (
    <div className={className}>
      {header.location && <span>{header.location}</span>}
      {header.email && (
        <span>
          <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
        </span>
      )}
      {header.phone && (
        <span>
          <PhoneText phone={header.phone} />
        </span>
      )}
      {(header.links || []).map((link, i) => (
        <span key={i}>
          <span className="r-link-badge">{linkGlyph(link)}</span>
          <a {...linkProps(link.url)}>{link.label}</a>
        </span>
      ))}
    </div>
  );
}

// The header's phone number as typed, linked to the dialer when it has
// digits to dial.
export function PhoneText({ phone, className }) {
  const href = telHref(phone);
  return href ? (
    <a className={className} href={href}>
      {phone}
    </a>
  ) : className ? (
    <span className={className}>{phone}</span>
  ) : (
    phone
  );
}

export function HeadshotImage({ header, className = '' }) {
  if (!header.photoUrl) return null;
  return <img className={`r-header-photo ${className}`.trim()} src={header.photoUrl} alt="" />;
}

export function HeaderActions({ onPrint, pdfHref }) {
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
