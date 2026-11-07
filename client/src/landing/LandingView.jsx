import { safeHref } from '../resume/safeUrl.js';
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
// safeHref() although the server only stores safe ones. `highlightIds`
// (editor preview only) outlines the parts an AI suggestion is shown in:
// 'hero' for the headline and subheadline, otherwise a section's id (the
// preview resolves its draft `withIds`).
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
            {landing.headline && <h1 className="l-headline">{landing.headline}</h1>}
            {landing.subheadline && <p className="l-subheadline">{landing.subheadline}</p>}
          </div>
        </header>

        {landing.sections.map((section, i) => (
          <section
            key={section.id ?? i}
            className={`l-section l-section-${section.kind}${highlightIds?.has(section.id) ? ' l-ai-preview' : ''}`}
          >
            {section.title && <h2 className="l-section-title">{section.title}</h2>}
            <SectionBody section={section} />
          </section>
        ))}
      </main>
    </div>
  );
}

// Opens off-site links in a new tab; a mailto link opens the mail app as is.
function linkProps(url) {
  const external = !/^mailto:/i.test(url);
  return { href: safeHref(url), ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) };
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
            <a key={i} className="l-card" href={card.href}>
              <span className="l-card-label">{card.label}</span>
              {card.blurb && <span className="l-card-blurb">{card.blurb}</span>}
              <span className="l-card-cta" aria-hidden="true">
                View resume →
              </span>
            </a>
          ))}
        </nav>
      );
    default:
      return null;
  }
}
