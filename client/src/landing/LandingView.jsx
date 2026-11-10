import { linkProps } from '../resume/safeUrl.js';
import { linkGlyph } from '../resume/linkTypes.js';
import { getLandingTemplate } from '../resume/templateRegistry.js';
import { darkClass, landingPageStyle } from './landingStyle.js';
import { textParagraphs } from './resolveLanding.js';
import { dropStrayDividers } from './dividers.js';
import { renderInline } from './renderInline.js';
import './landing.css';

// The landing page at `/` (issue #70), from the resolved shape the public
// API sends (server/src/landingFields.js's resolveLanding(); the editor's
// preview builds the same from its draft). It's drawn in the page's `site`
// colors and fonts (the default resume's, unless it has its own) and, when
// it has a dark palette, in that one under the visitor's dark setting;
// `scheme` ('auto', 'light' or 'dark') lets the editor's preview choose
// instead. Its template (templates/landing/<id>/, issue #93) arranges the
// parts: one with an index.jsx is handed the page, renderHero() and
// renderSection(section, index) and lays them out, one without gets the
// hero and then each section in an .l-main; either way its style.css,
// scoped under .l-template-<id>, does the rest. A template whose
// template.json says `columns: true` puts a section with `column: 'side'`
// in its side column; the others ignore `column`. A divider is a
// separator rather than a <section>, its title a label on the rule, and
// is only drawn between two things it divides (dividers.js): LandingView
// sees to that for a template without columns, and hands one with columns
// `dropStrayDividers(sections, { atStart })` to apply to each column.
// Everything is rendered as text,
// apart from the links and emphasis a text section, an item's text or an
// FAQ answer may hold (issue #91, renderInline.js), which become elements,
// never HTML; every href still goes through safeHref() (by way of
// linkProps()) although the server only stores safe ones. `highlightIds`
// (editor preview only) outlines the parts an AI suggestion is shown in:
// 'hero' for the headline and subheadline, otherwise a section's id (the
// preview resolves its draft `withIds`). A section marked `hidden` (only
// the preview resolves those, `withHidden`) is dimmed and labelled.
export function LandingView({ landing, preview = false, highlightIds = null, scheme = 'auto' }) {
  const template = getLandingTemplate(landing.template);
  const { colors, style } = landingPageStyle(landing.site, landing.darkColors);
  const dark = darkClass(landing.darkColors, scheme);
  const Arrangement = template.Component || DefaultArrangement;

  const renderHero = () => (
    <header className={`l-hero${highlightIds?.has('hero') ? ' l-ai-preview' : ''}`}>
      {landing.photoUrl && <img className="l-photo" src={landing.photoUrl} alt={landing.photoAlt || ''} />}
      <div className="l-hero-text">
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
  );

  const renderSection = (section, i) => {
    const hidden = section.hidden ? ' l-section-hidden' : '';
    if (section.kind === 'divider') {
      // A stray one (dividers.js) is only in the editor's preview.
      return (
        <div key={section.id ?? i} className={`l-section l-section-divider${section.stray ? ' l-section-hidden' : hidden}`}>
          {section.hidden && <span className="l-hidden-label">Hidden</span>}
          {section.stray && !section.hidden && <span className="l-hidden-label">Not shown: nothing to divide</span>}
          <div className="l-divider" role="separator" aria-label={section.title || undefined}>
            {section.title && <span className="l-divider-label">{section.title}</span>}
          </div>
        </div>
      );
    }
    return (
      <section
        key={section.id ?? i}
        className={`l-section l-section-${section.kind}${hidden}${highlightIds?.has(section.id) ? ' l-ai-preview' : ''}`}
      >
        {section.hidden && <span className="l-hidden-label">Hidden</span>}
        {section.title && <h2 className="l-section-title">{section.title}</h2>}
        <SectionBody section={section} preview={preview} />
      </section>
    );
  };

  return (
    <div className={`l-page l-template-${template.id}${preview ? ' l-preview' : ''}${dark ? ` ${dark}` : ''}`} style={style}>
      <Arrangement
        landing={template.columns ? landing : { ...landing, sections: dropStrayDividers(landing.sections, { preview }) }}
        dropStrayDividers={(sections, { atStart = true } = {}) => dropStrayDividers(sections, { atStart, preview })}
        renderHero={renderHero}
        renderSection={renderSection}
        colors={colors}
        darkColors={landing.darkColors}
        preview={preview}
      />
    </div>
  );
}

// A template with no component of its own: the hero, then each section.
function DefaultArrangement({ landing, renderHero, renderSection }) {
  return (
    <main className="l-main">
      {renderHero()}
      {landing.sections.map(renderSection)}
    </main>
  );
}

// A link the server made (a resume's page or PDF, always a path on this
// site) opens here; anything else is a link someone typed, so linkProps().
function hrefProps(href) {
  return /^\/(?!\/)/.test(href) ? { href } : linkProps(href);
}

function SectionBody({ section, preview }) {
  switch (section.kind) {
    case 'text':
      return textParagraphs(section.body).map((paragraph, i) => (
        <p key={i} className="l-text">
          {renderInline(paragraph)}
        </p>
      ));
    case 'items':
      return (
        <ul className="l-items">
          {section.items.map((item, i) => (
            <li key={i} className={`l-item${item.image ? ' l-item-with-image' : ''}`}>
              {item.image && <LandingImage className="l-item-image" image={item.image} />}
              {item.title &&
                (item.url ? (
                  <a className="l-item-title" {...linkProps(item.url)}>
                    {item.title}
                  </a>
                ) : (
                  <span className="l-item-title">{item.title}</span>
                ))}
              {item.meta && <p className="l-item-meta">{item.meta}</p>}
              {item.text && <p className="l-item-text">{renderInline(item.text)}</p>}
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
    case 'image':
      return (
        <figure className="l-figure">
          <LandingImage className="l-figure-image" image={section.image} />
          {section.caption && <figcaption className="l-figure-caption">{section.caption}</figcaption>}
        </figure>
      );
    case 'faq':
      // Each answer collapsed under its question (issue #123): <details>
      // needs no script, works with a keyboard and a screen reader, and a
      // browser's find opens it. The editor's preview shows them all open.
      return (
        <div className="l-faq">
          {section.entries.map((entry, i) => (
            <details key={i} className="l-faq-entry" open={preview}>
              <summary className="l-faq-question">{entry.question}</summary>
              <p className="l-faq-answer">{renderInline(entry.answer)}</p>
            </details>
          ))}
        </div>
      );
    default:
      return null;
  }
}

// An uploaded image (issue #92) as resolveLanding() gives it: its size is
// known, so the page doesn't jump while it loads.
function LandingImage({ className, image }) {
  return <img className={className} src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" />;
}
