import { linkProps } from '../resume/safeUrl.js';
import { linkGlyph } from '../resume/linkTypes.js';
import {
  normalizeSiteColors,
  contrastTextFor,
  normalizeResumeFont,
  normalizeNameFont,
  normalizeFontSize,
  FONT_SIZE_CSS,
  fontCssFor,
} from '../resume/siteColors.js';
import { textParagraphs } from './resolveLanding.js';
import './landing.css';

// The landing page at `/` (issue #70), from the resolved shape the public
// API sends (server/src/landingFields.js's resolveLanding(); the editor's
// preview builds the same from its draft). It takes the default resume's
// colors and fonts, so the two pages match. Everything is rendered as text:
// a text section isn't markdown or HTML, and every href still goes through
// safeHref() (by way of linkProps()) although the server only stores safe ones. `highlightIds`
// (editor preview only) outlines the parts an AI suggestion is shown in:
// 'hero' for the headline and subheadline, otherwise a section's id (the
// preview resolves its draft `withIds`). A section marked `hidden` (only
// the preview resolves those, `withHidden`) is dimmed and labelled.
export function LandingView({ landing, preview = false, highlightIds = null }) {
  const { site } = landing;
  const colors = normalizeSiteColors(site);
  const style = {
    '--r-accent': colors.accent,
    '--r-heading': colors.heading,
    '--r-text': colors.text,
    '--r-bg': colors.background,
    '--r-on-accent': contrastTextFor(colors.accent),
    '--font-resume': fontCssFor(normalizeResumeFont(site)),
    '--r-font-size': FONT_SIZE_CSS[normalizeFontSize(site)],
  };
  const nameFont = normalizeNameFont(site);
  if (nameFont) style['--r-name-font'] = fontCssFor(nameFont);

  return (
    <div className={`l-page${preview ? ' l-preview' : ''}`} style={style}>
      <main className="l-main">
        <header className={`l-hero${highlightIds?.has('hero') ? ' l-ai-preview' : ''}`}>
          {landing.photoUrl && <img className="l-photo" src={landing.photoUrl} alt="" />}
          <div>
            {landing.availability && <p className="l-availability">{landing.availability}</p>}
            {landing.headline && <h1 className="l-headline">{landing.headline}</h1>}
            {landing.subheadline && <p className="l-subheadline">{landing.subheadline}</p>}
            {landing.actions?.length > 0 && (
              <div className="l-actions">
                {landing.actions.map((action, i) => (
                  <a key={i} className={`l-action${i === 0 ? ' l-action-primary' : ''}`} {...hrefProps(action.href)}>
                    {action.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </header>

        {landing.sections.map((section, i) => (
          <section
            key={section.id ?? i}
            className={`l-section l-section-${section.kind}${section.hidden ? ' l-section-hidden' : ''}${
              highlightIds?.has(section.id) ? ' l-ai-preview' : ''
            }`}
          >
            {section.hidden && <span className="l-hidden-label">Hidden</span>}
            {section.title && <h2 className="l-section-title">{section.title}</h2>}
            <SectionBody section={section} />
          </section>
        ))}
      </main>
    </div>
  );
}

// A link the server made (a resume's page or PDF, always a path on this
// site) opens here; anything else is a link someone typed, so linkProps().
function hrefProps(href) {
  return /^\/(?!\/)/.test(href) ? { href } : linkProps(href);
}

function SectionBody({ section }) {
  switch (section.kind) {
    case 'text':
      return textParagraphs(section.body).map((paragraph, i) => (
        <p key={i} className="l-text">
          {paragraph}
        </p>
      ));
    case 'items':
      return (
        <ul className="l-items">
          {section.items.map((item, i) => (
            <li key={i} className="l-item">
              {item.title &&
                (item.url ? (
                  <a className="l-item-title" {...linkProps(item.url)}>
                    {item.title}
                  </a>
                ) : (
                  <span className="l-item-title">{item.title}</span>
                ))}
              {item.meta && <p className="l-item-meta">{item.meta}</p>}
              {item.text && <p className="l-item-text">{item.text}</p>}
            </li>
          ))}
        </ul>
      );
    case 'links':
      return (
        <ul className="l-links">
          {section.links.map((link, i) => (
            <li key={i}>
              <a {...linkProps(link.url)}>
                <span className="r-link-badge">{linkGlyph(link)}</span>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      );
    case 'resumes':
      return (
        <nav className="l-cards" aria-label={section.title || 'Resumes'}>
          {section.cards.map((card, i) => (
            // The label's link covers the whole card (.l-card-link::after),
            // so the PDF link can sit inside it without nesting anchors.
            <div key={i} className="l-card">
              <a className="l-card-label l-card-link" {...hrefProps(card.href)}>
                {card.label}
              </a>
              {card.blurb && <span className="l-card-blurb">{card.blurb}</span>}
              <span className="l-card-cta">
                <span aria-hidden="true">View resume →</span>
                {card.pdfHref && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <a className="l-card-pdf" {...hrefProps(card.pdfHref)} aria-label={`${card.label} (PDF)`}>
                      PDF
                    </a>
                  </>
                )}
              </span>
            </div>
          ))}
        </nav>
      );
    case 'quotes':
      return (
        <div className="l-quotes">
          {section.quotes.map((quote, i) => (
            <figure key={i} className="l-quote">
              <blockquote className="l-quote-text">{quote.text}</blockquote>
              {(quote.name || quote.role) && (
                <figcaption className="l-quote-by">
                  {quote.name &&
                    (quote.url ? (
                      <a className="l-quote-name" {...linkProps(quote.url)}>
                        {quote.name}
                      </a>
                    ) : (
                      <span className="l-quote-name">{quote.name}</span>
                    ))}
                  {quote.name && quote.role && ', '}
                  {quote.role && <span className="l-quote-role">{quote.role}</span>}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      );
    case 'experience':
      return (
        <>
          <ol className="l-roles">
            {section.roles.map((role, i) => (
              <li key={i} className="l-role">
                <span className="l-role-title">
                  {role.jobTitle}
                  {role.jobTitle && role.company && ' · '}
                  {role.company &&
                    (role.companyUrl ? (
                      <a className="l-role-company" {...linkProps(role.companyUrl)}>
                        {role.company}
                      </a>
                    ) : (
                      <span className="l-role-company">{role.company}</span>
                    ))}
                </span>
                {(role.location || role.dates) && (
                  <span className="l-role-meta">{[role.dates, role.location].filter(Boolean).join(' · ')}</span>
                )}
              </li>
            ))}
          </ol>
          <a className="l-roles-more" {...hrefProps(section.href)}>
            Full resume →
          </a>
        </>
      );
    default:
      return null;
  }
}
