import { safeHref } from './safeUrl.js';
import { linkGlyph } from './linkTypes.js';

function ContactRow({ label, children }) {
  return (
    <div className="r-contact-row">
      <span className="r-contact-label">{label}:</span>
      <span className="r-contact-value">{children}</span>
    </div>
  );
}

// The plain inline contact list (no letter labels) shared by every template
// except "labeled-header", which uses ContactRow instead.
function ContactInline({ header, className }) {
  return (
    <div className={className}>
      {header.location && <span>{header.location}</span>}
      {header.email && (
        <span>
          <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
        </span>
      )}
      {header.phone && <span>{header.phone}</span>}
      {(header.links || []).map((link, i) => (
        <span key={i}>
          <span className="r-link-badge">{linkGlyph(link)}</span>
          <a href={safeHref(link.url)} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        </span>
      ))}
    </div>
  );
}

function HeadshotImage({ header, className = '' }) {
  if (!header.photoUrl) return null;
  return <img className={`r-header-photo ${className}`.trim()} src={header.photoUrl} alt="" />;
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

  const actions = showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />;

  if (template === 'labeled-header') {
    return (
      <div className="r-header r-header-labeled">
        <div className="r-header-identity">
          <HeadshotImage header={header} />
          <div className="r-header-main">
            <h1 className="r-name">{header.name}</h1>
            <div className="r-title">{header.title}</div>
            {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          </div>
        </div>
        <div className="r-header-side">
          {actions}
          <div className="r-contact r-contact-labeled">
            {header.location && <ContactRow label="a">{header.location}</ContactRow>}
            {header.email && (
              <ContactRow label="e">
                <a href={safeHref(`mailto:${header.email}`)}>{header.email}</a>
              </ContactRow>
            )}
            {header.phone && <ContactRow label="p">{header.phone}</ContactRow>}
            {(header.links || []).map((link, i) => (
              <ContactRow key={i} label={linkGlyph(link)}>
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

  if (template === 'centered') {
    return (
      <div className="r-header r-header-centered">
        {actions}
        <HeadshotImage header={header} className="r-header-photo-centered" />
        <h1 className="r-name">{header.name}</h1>
        <div className="r-title">{header.title}</div>
        {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
        <ContactInline header={header} className="r-contact r-contact-centered" />
      </div>
    );
  }

  if (template === 'compact') {
    return (
      <div className="r-header r-header-compact">
        <HeadshotImage header={header} className="r-header-photo-compact" />
        <div className="r-header-compact-id">
          <span className="r-name r-name-compact">{header.name}</span>
          {header.title && <span className="r-title-compact">{header.title}</span>}
          {header.subtitle && <span className="r-subtitle-compact">{header.subtitle}</span>}
        </div>
        <ContactInline header={header} className="r-contact r-contact-compact" />
        {actions}
      </div>
    );
  }

  if (template === 'banner') {
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
          {actions}
        </div>
        <ContactInline header={header} className="r-contact r-contact-banner" />
      </div>
    );
  }

  return (
    <div className="r-header">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact" />
        </div>
      </div>
      {actions}
    </div>
  );
}
