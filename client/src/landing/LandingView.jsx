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
import { introParagraphs } from './resolveLanding.js';
import './landing.css';

// The landing page at `/` (issue #70), from the resolved shape the public
// API sends (server/src/landingFields.js's resolveLanding(); the editor's
// preview builds the same from its draft). It takes the default resume's
// colors and fonts, so the two pages match. Everything is rendered as text:
// the intro isn't markdown or HTML, and every href still goes through
// safeHref() although the server only stores safe ones.
export function LandingView({ landing, preview = false }) {
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
        <header className="l-hero">
          {landing.photoUrl && <img className="l-photo" src={landing.photoUrl} alt="" />}
          <div>
            {landing.headline && <h1 className="l-headline">{landing.headline}</h1>}
            {landing.subheadline && <p className="l-subheadline">{landing.subheadline}</p>}
          </div>
        </header>

        {introParagraphs(landing.intro).map((paragraph, i) => (
          <p key={i} className="l-intro">
            {paragraph}
          </p>
        ))}

        {landing.links.length > 0 && (
          <ul className="l-links">
            {landing.links.map((link, i) => {
              const external = !/^mailto:/i.test(link.url);
              return (
                <li key={i}>
                  <a
                    href={safeHref(link.url)}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span className="r-link-badge">{linkGlyph(link)}</span>
                    {link.label}
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {landing.resumes.length > 0 && (
          <nav className="l-cards" aria-label="Resumes">
            {landing.resumes.map((card, i) => (
              <a key={i} className="l-card" href={card.href}>
                <span className="l-card-label">{card.label}</span>
                {card.blurb && <span className="l-card-blurb">{card.blurb}</span>}
                <span className="l-card-cta" aria-hidden="true">
                  View resume →
                </span>
              </a>
            ))}
          </nav>
        )}
      </main>
    </div>
  );
}
