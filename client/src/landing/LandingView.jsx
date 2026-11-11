import { linkProps } from '../resume/safeUrl.js';
import { linkGlyph } from '../resume/linkTypes.js';
import { getLandingTemplate } from '../resume/templateRegistry.js';
import { darkClass, landingPageStyle } from './landingStyle.js';
import { textParagraphs } from './resolveLanding.js';
import { dropStrayDividers } from './dividers.js';
import { renderInline } from './renderInline.js';
import { readDate } from './dateText.js';
import { LandingGallery } from './LandingGallery.jsx';
import { LandingMedia } from './LandingMedia.jsx';
import { formatFileSize } from './documents.js';
import { ActionIcon } from './ActionIcon.jsx';
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
// `dropStrayDividers(sections, { atStart })` to apply to each column. A
// template may give a section an `anchor`, which becomes its element's id.
// Everything is rendered as text,
// apart from the links and emphasis a text section, an item's text, an
// FAQ answer or a service's text may hold (issue #91, renderInline.js),
// which become elements,
// never HTML; every href still goes through safeHref() (by way of
// linkProps()) although the server only stores safe ones. `highlightIds`
// (editor preview only) outlines the parts an AI suggestion is shown in:
// 'hero' for the headline and subheadline, otherwise a section's id (the
// preview resolves its draft `withIds`). A section marked `hidden` (only
// the preview resolves those, `withHidden`) is dimmed and labelled, and so
// is an expired credential (issue #119), or a credentials section with
// nothing else (`expired`). A media section (issue #121) is a facade until
// a visitor presses play (LandingMedia.jsx), in the preview too.
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
                {action.icon && <ActionIcon name={action.icon} />}
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
    // An `anchor` is only set by a template that links to its sections
    // (directory's contents, sectionAnchors.js); focusable so a jump there
    // moves the keyboard too.
    return (
      <section
        key={section.id ?? i}
        id={section.anchor}
        tabIndex={section.anchor ? -1 : undefined}
        className={`l-section l-section-${section.kind}${hidden}${highlightIds?.has(section.id) ? ' l-ai-preview' : ''}`}
      >
        {section.hidden && <span className="l-hidden-label">{section.expired ? 'Not shown: every entry has expired' : 'Hidden'}</span>}
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
    case 'stats':
      // The comma is for a screen reader ("15 years, in commercial
      // kitchens"); on screen the label goes under the figure.
      return (
        <ul className="l-stats">
          {section.stats.map((stat, i) => (
            <li key={i} className="l-stat">
              <span className="l-stat-value">{stat.value}</span>
              {stat.label && (
                <>
                  <span className="l-sr-only">, </span>
                  <span className="l-stat-label">{stat.label}</span>
                </>
              )}
            </li>
          ))}
        </ul>
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
    case 'education':
      // Drawn on the experience timeline (issue #126).
      return (
        <>
          <ol className="l-roles l-schools">
            {section.entries.map((entry, i) => (
              <li key={i} className="l-role l-school">
                <span className="l-role-title">
                  {entry.degree}
                  {entry.degree && entry.institution && ' · '}
                  {entry.institution && <span className="l-school-institution">{entry.institution}</span>}
                </span>
                {(entry.location || entry.dates) && (
                  <span className="l-role-meta">{[entry.dates, entry.location].filter(Boolean).join(' · ')}</span>
                )}
              </li>
            ))}
          </ol>
          <a className="l-roles-more" {...hrefProps(section.href)}>
            Full resume →
          </a>
        </>
      );
    case 'skills':
      return (
        <>
          <ul className="l-skills">
            {section.groups.map((group, i) => (
              <li key={i} className="l-skill-group">
                {group.category && <span className="l-skill-category">{group.category}</span>}
                <ul className="l-skill-list" aria-label={group.category || undefined}>
                  {group.items.map((item, j) => (
                    <li key={j} className="l-skill">
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <a className="l-roles-more" {...hrefProps(section.href)}>
            Full resume →
          </a>
        </>
      );
    case 'credentials':
      return (
        <ul className="l-credentials">
          {section.credentials.map((credential, i) => (
            <li key={i} className={`l-credential${credential.expired ? ' l-credential-expired' : ''}`}>
              {credential.expired && <span className="l-hidden-label">Expired</span>}
              <span className="l-credential-head">
                <span className="l-credential-name">{credential.name}</span>
                <span className="l-credential-kind">{CREDENTIAL_LABELS[credential.kind] || CREDENTIAL_LABELS.certification}</span>
              </span>
              {credential.issuer && <span className="l-credential-issuer">{credential.issuer}</span>}
              <CredentialDetails credential={credential} />
            </li>
          ))}
        </ul>
      );
    case 'gallery':
      return <LandingGallery images={section.images} label={section.title} />;
    case 'media':
      return <LandingMedia section={section} />;
    case 'services':
      // What the person offers (issue #122): each one's name with its price
      // beside it, where a visitor finds it at a glance, then what it is,
      // then its button. The comma is for a screen reader ("Tutoring, From
      // $60/hour"), as a stat's.
      return (
        <ul className="l-services">
          {section.services.map((service, i) => (
            <li key={i} className="l-service">
              {(service.title || service.price) && (
                <span className="l-service-head">
                  {service.title && <span className="l-service-title">{service.title}</span>}
                  {service.title && service.price && <span className="l-sr-only">, </span>}
                  {service.price && <span className="l-service-price">{service.price}</span>}
                </span>
              )}
              {service.text && <p className="l-service-text">{renderInline(service.text)}</p>}
              {service.action && (
                <a className="l-action l-service-action" {...hrefProps(service.action.href)}>
                  {service.action.icon && <ActionIcon name={service.action.icon} />}
                  {service.action.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      );
    case 'publications':
      // Grouped (issue #127), each kind under a subheading of its own, and
      // then the kind isn't repeated on each entry's line.
      return section.groups ? (
        <div className="l-publication-groups">
          {section.groups.map((group) => (
            <div key={group.kind} className="l-publication-group">
              <h3 className="l-publication-group-title">{PUBLICATION_GROUP_LABELS[group.kind] || PUBLICATION_GROUP_LABELS.article}</h3>
              <PublicationList entries={group.entries} showKind={false} />
            </div>
          ))}
        </div>
      ) : (
        <PublicationList entries={section.entries} showKind />
      );
    case 'contact':
      return <ContactDetails contact={section} preview={preview} />;
    case 'documents':
      // Uploaded PDFs (issue #128), each opened in the browser's own viewer
      // from a path on this site, with its size so a visitor knows what
      // they're opening.
      return (
        <ul className="l-documents">
          {section.documents.map((doc, i) => (
            <li key={i} className="l-document">
              <span className="l-document-type" aria-hidden="true">
                PDF
              </span>
              <span className="l-document-body">
                <a className="l-document-link" {...hrefProps(doc.href)} type="application/pdf">
                  {doc.label}
                </a>
                <span className="l-document-meta">
                  <span className="l-sr-only">PDF, </span>
                  {formatFileSize(doc.size)}
                </span>
                {doc.description && <p className="l-document-description">{doc.description}</p>}
              </span>
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

// A contact section (issue #124): each thing it shows on a labelled line,
// the email and phone as mailto:/tel: links, the address as written with
// a "Directions" map search (a link, never an embedded map), and the
// "Save contact" vCard button. The editor's preview draws that button
// without a link: the card is built from the published page, not the
// draft on screen.
function ContactDetails({ contact, preview }) {
  return (
    <div className="l-contact">
      <dl className="l-contact-lines">
        {contact.emailHref && (
          <div className="l-contact-line">
            <dt className="l-contact-label">Email</dt>
            <dd className="l-contact-value">
              <a className="l-contact-link" href={contact.emailHref}>
                {contact.email}
              </a>
            </dd>
          </div>
        )}
        {contact.phoneHref && (
          <div className="l-contact-line">
            <dt className="l-contact-label">Phone</dt>
            <dd className="l-contact-value">
              <a className="l-contact-link" href={contact.phoneHref}>
                {contact.phone}
              </a>
            </dd>
          </div>
        )}
        {contact.area && (
          <div className="l-contact-line">
            <dt className="l-contact-label">Area</dt>
            <dd className="l-contact-value">{contact.area}</dd>
          </div>
        )}
        {contact.address && (
          <div className="l-contact-line">
            <dt className="l-contact-label">Address</dt>
            <dd className="l-contact-value">
              <span className="l-contact-address">{contact.address}</span>
              {contact.directionsHref && (
                <a className="l-contact-link l-contact-directions" {...linkProps(contact.directionsHref)}>
                  Directions
                </a>
              )}
            </dd>
          </div>
        )}
        {contact.hours.length > 0 && (
          <div className="l-contact-line">
            <dt className="l-contact-label">Hours</dt>
            <dd className="l-contact-value">
              <ul className="l-contact-hours">
                {contact.hours.map((entry, i) => (
                  <li key={i}>
                    {entry.days && <span className="l-contact-days">{entry.days}</span>}
                    {entry.days && entry.time && ' '}
                    {entry.time && <span className="l-contact-time">{entry.time}</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {contact.vcardHref &&
        (preview ? (
          <span className="l-action l-contact-save" title="Downloads the published page's contact card">
            Save contact
          </span>
        ) : (
          <a className="l-action l-contact-save" href={contact.vcardHref} download>
            Save contact
          </a>
        ))}
    </div>
  );
}

// The small label next to a credential's name.
const CREDENTIAL_LABELS = { license: 'License', certification: 'Certification', membership: 'Membership' };

// A credential's number, dates and "Verify" link, on one muted line. A date
// dateText.js can read gets a word before it ("Expires Dec 2027"); any
// other is shown just as written ("Renews yearly").
function CredentialDetails({ credential }) {
  const dated = (word, date) => (readDate(date) ? `${word} ${date}` : date);
  const parts = [
    credential.number && `No. ${credential.number}`,
    credential.issued && dated(credential.kind === 'membership' ? 'Since' : 'Issued', credential.issued),
    credential.expires && dated('Expires', credential.expires),
  ].filter(Boolean);
  if (!parts.length && !credential.url) return null;
  return (
    <span className="l-credential-meta">
      {parts.join(' · ')}
      {parts.length > 0 && credential.url && ' · '}
      {credential.url && (
        <a className="l-credential-verify" {...linkProps(credential.url)} aria-label={`Verify ${credential.name}`}>
          Verify
        </a>
      )}
    </span>
  );
}

// What an entry is, on its line, and a group's subheading.
const PUBLICATION_LABELS = { article: 'Article', paper: 'Paper', book: 'Book', chapter: 'Chapter', talk: 'Talk', podcast: 'Podcast', press: 'Press' };
const PUBLICATION_GROUP_LABELS = {
  article: 'Articles',
  paper: 'Papers',
  book: 'Books',
  chapter: 'Chapters',
  talk: 'Talks',
  podcast: 'Podcasts',
  press: 'Press',
};

// Publications as a citation reads: the title (linked to its URL or its
// DOI, which resolveLanding() has already chosen), a muted "Outlet · Date ·
// Kind" line, then the note, all plain text.
function PublicationList({ entries, showKind }) {
  return (
    <ul className="l-publications">
      {entries.map((entry, i) => {
        const meta = [entry.outlet, entry.date, showKind && (PUBLICATION_LABELS[entry.kind] || PUBLICATION_LABELS.article)].filter(Boolean);
        return (
          <li key={i} className="l-publication">
            {entry.url ? (
              <a className="l-publication-title" {...linkProps(entry.url)}>
                {entry.title}
              </a>
            ) : (
              <span className="l-publication-title">{entry.title}</span>
            )}
            {meta.length > 0 && <span className="l-publication-meta">{meta.join(' · ')}</span>}
            {entry.note && <p className="l-publication-note">{entry.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

// An uploaded image (issue #92) as resolveLanding() gives it: its size is
// known, so the page doesn't jump while it loads.
function LandingImage({ className, image }) {
  return <img className={className} src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" />;
}
