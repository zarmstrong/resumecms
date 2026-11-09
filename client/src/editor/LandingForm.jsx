import { PhotoUpload } from './PhotoUpload.jsx';
import { LinksEditor } from './LinksEditor.jsx';
import { LandingAiPanel } from './LandingAiPanel.jsx';
import { introSectionId } from './landingAi.js';
import { SearchSharingFields } from './SearchSharingFields.jsx';
import { LandingImageField, withImageRef } from './LandingImageField.jsx';
import { carryItemKey } from './landingImages.js';
import { ACTION_LABELS, resolveLanding } from '../landing/resolveLanding.js';
import { landingPageMeta } from '../share/pageMeta.js';
import { inlineEdit } from '../landing/inlineText.js';

// The kinds of section the landing page can hold (server/src/landingFields.js's
// SECTION_KINDS), what each is called here, and what a new one starts with
// (given the editor's list of resumes).
const SECTION_KINDS = [
  { kind: 'text', label: 'Text', addLabel: 'Text', empty: () => ({ body: '' }) },
  { kind: 'items', label: 'List', addLabel: 'List (e.g. projects)', empty: () => ({ items: [emptyItem()] }) },
  { kind: 'links', label: 'Links', addLabel: 'Links', empty: () => ({ links: [] }) },
  { kind: 'resumes', label: 'Resume cards', addLabel: 'Resume cards', empty: () => ({ cards: [] }) },
  { kind: 'quotes', label: 'Quotes', addLabel: 'Quotes (testimonials)', empty: () => ({ quotes: [emptyQuote()] }) },
  {
    kind: 'experience',
    label: 'Experience',
    addLabel: 'Experience (latest roles from a resume)',
    empty: (resumes) => ({ resumeId: (resumes.find((r) => r.isDefault) ?? resumes[0])?.id, count: 3, showDates: true }),
  },
  { kind: 'image', label: 'Image', addLabel: 'Image', empty: () => ({ image: null, caption: '' }) },
];
const kindLabel = (kind) => SECTION_KINDS.find((k) => k.kind === kind)?.label || kind;

function emptyItem() {
  return { title: '', text: '', url: '', meta: '' };
}

function emptyQuote() {
  return { text: '', name: '', role: '', url: '' };
}

// Only tells sections apart (React keys, and the server keeps it); not
// crypto.randomUUID(), which a plain-http install's browser doesn't have.
function newSectionId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function hasContent(section) {
  if (section.title.trim()) return true;
  switch (section.kind) {
    case 'text':
      return Boolean(section.body.trim());
    case 'items':
      return section.items.some((item) => item.title.trim() || item.text.trim() || item.url.trim() || item.meta?.trim());
    case 'links':
      return section.links.length > 0;
    case 'resumes':
      return section.cards.length > 0;
    case 'quotes':
      return section.quotes.some((quote) => quote.text.trim() || quote.name.trim() || quote.role.trim() || quote.url.trim());
    case 'experience':
      // Nothing typed but its heading: its roles come from the resume.
      return false;
    case 'image':
      return Boolean(section.image) || Boolean(section.caption.trim());
    default:
      return false;
  }
}

function moved(list, i, delta) {
  const next = [...list];
  [next[i], next[i + delta]] = [next[i + delta], next[i]];
  return next;
}

// ↑ ↓ ✕ for one entry of a list.
function RowActions({ index, count, onMove, onRemove, what }) {
  return (
    <span className="ed-landing-card-actions">
      <button type="button" className="ed-icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${what} up`}>
        ↑
      </button>
      <button
        type="button"
        className="ed-icon-btn"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        aria-label={`Move ${what} down`}
      >
        ↓
      </button>
      <button type="button" className="ed-icon-btn" onClick={onRemove} aria-label={`Remove ${what}`}>
        ✕
      </button>
    </span>
  );
}

// Where a card's (or a button's) resume stands for visitors: shown, or why
// not. `context` lists the resumes a card can link to now (public and
// published).
function cardStatus(resumeId, resumes, context) {
  if (context.resumes.some((r) => r.id === resumeId)) return null;
  const resume = resumes.find((r) => r.id === resumeId);
  if (!resume) return 'Deleted: not shown';
  if (!resume.isPublic) return 'Private: not shown until it is made public';
  return 'Not shown until it is published';
}

// Whether a resume a visitor can open has a PDF to link to.
const hasPdf = (resumeId, context) => Boolean(context.resumes.find((r) => r.id === resumeId)?.pdfHref);

// A field's ✨ panel, or nothing while AI rewrites aren't set up.
function AiField({ ai, ...props }) {
  return ai?.available ? <LandingAiPanel ai={ai} {...props} /> : null;
}

// The landing page's fields (issue #70). `landing` is the draft, `context`
// and `limits` come from GET /api/landing, `resumes` is the editor's list,
// `ai` is LandingEditorPage's AI rewrite state and handlers (issue #73),
// `onUploadImage` its image upload (issue #92, see LandingImageField).
export function LandingForm({ landing, resumes, context, limits, onChange, ai, onUploadImage }) {
  const set = (patch) => onChange({ ...landing, ...patch });
  // Each field passes its own target to the upload (landingImages.js).
  const imageProps = (target) => ({ images: context.images || [], limits: limits?.images, onUpload: (file) => onUploadImage(file, target) });
  const sections = landing.sections;
  const introId = introSectionId(landing);
  const setSections = (next) => set({ sections: next });
  const setSection = (i, patch) => setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeSection = (i) => {
    if (hasContent(sections[i]) && !window.confirm(`Remove this ${kindLabel(sections[i].kind).toLowerCase()} section?`)) return;
    setSections(sections.filter((_, idx) => idx !== i));
  };
  const addSection = (kind) => {
    const config = SECTION_KINDS.find((k) => k.kind === kind);
    setSections([...sections, { id: newSectionId(), kind, title: '', ...config.empty(resumes) }]);
  };

  return (
    <div className="ed-form">
      {introId && (
        <AiField ai={ai} target={{ kind: 'intro', sectionId: introId }} label="✨ Draft headline and intro from my resume" />
      )}
      <label className="ed-field">
        <span>Headline</span>
        <input
          className="ed-input"
          value={landing.headline}
          maxLength={limits?.headline}
          onChange={(e) => set({ headline: e.target.value })}
          placeholder="Your name"
        />
      </label>
      <AiField ai={ai} target={{ kind: 'headline' }} current={landing.headline} />
      <label className="ed-field">
        <span>Subheadline</span>
        <input
          className="ed-input"
          value={landing.subheadline}
          maxLength={limits?.subheadline}
          onChange={(e) => set({ subheadline: e.target.value })}
          placeholder="e.g. Site reliability engineer"
        />
      </label>
      <AiField ai={ai} target={{ kind: 'subheadline' }} current={landing.subheadline} />
      <label className="ed-field">
        <span>Availability</span>
        <input
          className="ed-input"
          value={landing.availability ?? ''}
          maxLength={limits?.availability}
          onChange={(e) => set({ availability: e.target.value })}
          placeholder="e.g. Open to senior backend roles · Remote (optional)"
        />
        <span className="ed-field-hint">A short line shown above the headline. Leave it empty to show none.</span>
      </label>

      <div className="ed-field">
        <span>Photo</span>
        <select className="ed-input" value={landing.photo} onChange={(e) => set({ photo: e.target.value })}>
          <option value="resume">The default resume's photo</option>
          <option value="custom">A different photo</option>
          <option value="upload">An uploaded image, uncropped</option>
          <option value="none">No photo</option>
        </select>
        {landing.photo === 'resume' && !context.photoUrl && (
          <span className="ed-field-hint">The default resume's published header has no photo, so none is shown.</span>
        )}
      </div>
      {landing.photo === 'custom' && (
        <PhotoUpload label="Landing page photo" value={landing.photoUrl} onChange={(photoUrl) => set({ photoUrl })} />
      )}
      {landing.photo === 'upload' && (
        <LandingImageField
          label="Landing page photo"
          hint="Shown round, like the default photo. Larger images are scaled down to 1600 px, and their location data is removed."
          value={landing.photoImage ?? null}
          onChange={(ref) => onChange(withImageRef(landing, 'photoImage', ref))}
          {...imageProps({ kind: 'photo' })}
        />
      )}

      <ActionsFields
        actions={landing.actions ?? []}
        onChange={(actions) => set({ actions })}
        resumes={resumes}
        context={context}
        limits={limits}
      />

      <div className="ed-field">
        <span>Sections</span>
        <span className="ed-field-hint">Shown in this order under the headline. One with nothing to show is left off the page.</span>
        {sections.map((section, i) => (
          <div className="ed-landing-section" key={section.id}>
            <div className="ed-landing-card-head">
              <strong>{kindLabel(section.kind)}</strong>
              <RowActions
                index={i}
                count={sections.length}
                onMove={(delta) => setSections(moved(sections, i, delta))}
                onRemove={() => removeSection(i)}
                what="section"
              />
            </div>
            <input
              className="ed-input"
              value={section.title}
              maxLength={limits?.sectionTitle}
              onChange={(e) => setSection(i, { title: e.target.value })}
              placeholder="Heading (optional)"
              aria-label="Section heading"
            />
            <label className="ed-field ed-checkbox-field">
              <input type="checkbox" checked={Boolean(section.hidden)} onChange={(e) => setSection(i, { hidden: e.target.checked })} />
              Hide this section
            </label>
            {section.hidden && <span className="ed-field-hint">Kept here, but not shown on the page.</span>}
            <SectionFields
              section={section}
              onChange={(patch) => setSection(i, patch)}
              resumes={resumes}
              context={context}
              limits={limits}
              ai={ai}
              imageProps={imageProps}
            />
          </div>
        ))}
        {(!limits || sections.length < limits.sections) && (
          <select className="ed-input" value="" onChange={(e) => e.target.value && addSection(e.target.value)} aria-label="Add a section">
            <option value="">+ Add a section…</option>
            {SECTION_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.addLabel}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="ed-field">
        <label className="ed-field ed-checkbox-field">
          <input type="checkbox" checked={landing.homeLink !== false} onChange={(e) => set({ homeLink: e.target.checked })} />
          <span>Show a "← Home" link on resume pages</span>
        </label>
        {landing.homeLink !== false && (
          <input
            className="ed-input"
            value={landing.homeLinkLabel ?? ''}
            maxLength={limits?.homeLinkLabel}
            onChange={(e) => set({ homeLinkLabel: e.target.value })}
            placeholder="Home"
            aria-label="Home link text"
          />
        )}
        <span className="ed-field-hint">
          Above each resume at /resume and /r/&lt;link name&gt;, back to this page, while it's shown at /. Never on a resume's own
          domain or in its PDF. Leave the text empty to say "Home".
        </span>
      </div>

      <LandingSeoFields landing={landing} context={context} limits={limits} onChange={(seo) => set({ seo })} imageProps={imageProps} />
    </div>
  );
}

// The landing page's `seo` (issue #87), previewed as the page resolves,
// with its share image (issue #92).
function LandingSeoFields({ landing, context, limits, onChange, imageProps }) {
  const seo = { title: '', description: '', noindex: false, ...landing.seo };
  const metaOf = (s) => landingPageMeta(resolveLanding({ ...landing, seo: s }, context));
  return (
    <SearchSharingFields
      title={seo.title}
      description={seo.description}
      noindex={seo.noindex}
      onChange={(patch) => onChange({ ...seo, ...patch })}
      meta={metaOf(seo)}
      fallback={metaOf({ ...seo, title: '', description: '' })}
      limits={{ title: limits?.seoTitle, description: limits?.seoDescription }}
      hint="What search results and link previews say about this page. The preview card is drawn from the headline, subheadline and photo, unless you upload a share image."
    >
      <LandingImageField
        label="Share image (optional)"
        hint="Shown by link previews instead of the drawn card. 1200×630 suits most sites."
        value={seo.image ?? null}
        onChange={(ref) => onChange(withImageRef(seo, 'image', ref))}
        altHint="Say what it shows; link previews pass it on to screen readers."
        {...imageProps({ kind: 'seo' })}
      />
    </SearchSharingFields>
  );
}

// The hero's buttons (issue #88): a link, or a resume's page or PDF. The
// one select picks both what kind and which resume ('link', 'page:<id>' or
// 'pdf:<id>').
function ActionsFields({ actions, onChange, resumes, context, limits }) {
  const setAction = (i, next) => onChange(actions.map((a, idx) => (idx === i ? next : a)));
  const choose = (action, value) => {
    if (value === 'link') return { type: 'link', label: action.label, url: action.type === 'link' ? action.url : '' };
    const [open, ...rest] = value.split(':');
    return { type: 'resume', label: action.label, resumeId: rest.join(':'), open };
  };
  return (
    <div className="ed-field">
      <span>Buttons</span>
      <span className="ed-field-hint">Up to {limits?.actions ?? 3} buttons under the subheadline. The first is drawn as the main one.</span>
      {actions.map((action, i) => {
        const value = action.type === 'link' ? 'link' : `${action.open}:${action.resumeId}`;
        const known = action.type === 'link' || resumes.some((r) => r.id === action.resumeId);
        let status = action.type === 'resume' ? cardStatus(action.resumeId, resumes, context) : null;
        if (!status && action.type === 'resume' && action.open === 'pdf' && !hasPdf(action.resumeId, context)) {
          status = 'No PDF yet: not shown until one is rendered';
        }
        return (
          <div className="ed-landing-card" key={i}>
            <div className="ed-landing-card-head">
              <span>
                Button {i + 1}
                {i === 0 ? ' (main)' : ''}
              </span>
              <RowActions
                index={i}
                count={actions.length}
                onMove={(delta) => onChange(moved(actions, i, delta))}
                onRemove={() => onChange(actions.filter((_, idx) => idx !== i))}
                what="button"
              />
            </div>
            <select className="ed-input" value={value} onChange={(e) => setAction(i, choose(action, e.target.value))} aria-label="What the button opens">
              <option value="link">A link (email, calendar, website…)</option>
              {!known && <option value={value}>Deleted resume</option>}
              {resumes.map((r) => (
                <optgroup key={r.id} label={r.name}>
                  <option value={`page:${r.id}`}>{r.name}: the resume</option>
                  <option value={`pdf:${r.id}`}>{r.name}: its PDF</option>
                </optgroup>
              ))}
            </select>
            {status && <span className="ed-field-hint ed-landing-card-status">{status}</span>}
            <input
              className="ed-input"
              value={action.label}
              maxLength={limits?.actionLabel}
              onChange={(e) => setAction(i, { ...action, label: e.target.value })}
              placeholder={action.type === 'link' ? 'Button text, e.g. Email me' : ACTION_LABELS[action.open]}
              aria-label="Button text"
            />
            {action.type === 'link' && (
              <>
                <input
                  className="ed-input"
                  value={action.url}
                  maxLength={limits?.url}
                  onChange={(e) => setAction(i, { ...action, url: e.target.value })}
                  placeholder="mailto:you@example.com or https://…"
                  aria-label="Button link"
                />
                {/^\s*mailto:/i.test(action.url) && !action.url.includes('?') && (
                  <span className="ed-field-hint">
                    To fill in the subject, add it to the link: mailto:you@example.com?subject=Hello
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
      {(!limits || actions.length < limits.actions) && (
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange([...actions, { type: 'link', label: '', url: '' }])}>
          + Add button
        </button>
      )}
    </div>
  );
}

// The syntax a text section and an item's text take (issue #91).
const INLINE_HINT = '**bold**, *italic* and [a link](https://…) work; put a \\ before * or [ to show it as it is.';

function SectionFields({ section, onChange, resumes, context, limits, ai, imageProps }) {
  switch (section.kind) {
    case 'text':
      return (
        <>
          {/* A refused edit leaves the state as it is, so React puts the
              textarea back (inlineEdit(): exact where maxLength can't be). */}
          <textarea
            className="ed-input"
            rows={5}
            value={section.body}
            onChange={(e) => {
              const body = inlineEdit(section.body, e.target.value, limits?.text);
              if (body !== section.body) onChange({ body });
            }}
            placeholder="A few lines about yourself."
            aria-label="Text"
          />
          <span className="ed-field-hint">{INLINE_HINT} Leave a blank line to start a new paragraph.</span>
          <AiField ai={ai} target={{ kind: 'text', sectionId: section.id }} current={section.body} />
        </>
      );
    case 'items':
      return (
        <ItemsFields sectionId={section.id} items={section.items} onChange={(items) => onChange({ items })} limits={limits} ai={ai} imageProps={imageProps} />
      );
    case 'links':
      return <LinksEditor label={null} links={section.links} onChange={(links) => onChange({ links })} />;
    case 'resumes':
      return (
        <CardsFields
          sectionId={section.id}
          cards={section.cards}
          onChange={(cards) => onChange({ cards })}
          resumes={resumes}
          context={context}
          limits={limits}
          ai={ai}
        />
      );
    case 'quotes':
      return <QuotesFields quotes={section.quotes} onChange={(quotes) => onChange({ quotes })} limits={limits} />;
    case 'experience':
      return <ExperienceFields section={section} onChange={onChange} resumes={resumes} context={context} limits={limits} />;
    case 'image':
      return (
        <>
          <LandingImageField value={section.image} onChange={(image) => onChange({ image })} {...imageProps({ kind: 'section', sectionId: section.id })} />
          <textarea
            className="ed-input"
            rows={2}
            value={section.caption}
            maxLength={limits?.images?.caption}
            onChange={(e) => onChange({ caption: e.target.value })}
            placeholder="Caption (optional)"
            aria-label="Image caption"
          />
          <span className="ed-field-hint">A section with no image yet is left off the page.</span>
        </>
      );
    default:
      return null;
  }
}

// Testimonials (issue #90). No ✨ here: they're someone else's words.
function QuotesFields({ quotes, onChange, limits }) {
  const setQuote = (i, patch) => onChange(quotes.map((quote, idx) => (idx === i ? { ...quote, ...patch } : quote)));
  return (
    <>
      {quotes.map((quote, i) => (
        <div className="ed-landing-card" key={i}>
          <div className="ed-landing-card-head">
            <span>Quote {i + 1}</span>
            <RowActions
              index={i}
              count={quotes.length}
              onMove={(delta) => onChange(moved(quotes, i, delta))}
              onRemove={() => onChange(quotes.filter((_, idx) => idx !== i))}
              what="quote"
            />
          </div>
          <textarea
            className="ed-input"
            rows={3}
            value={quote.text}
            maxLength={limits?.quoteText}
            onChange={(e) => setQuote(i, { text: e.target.value })}
            placeholder="What they said"
            aria-label="Quote"
          />
          <input
            className="ed-input"
            value={quote.name}
            maxLength={limits?.quoteName}
            onChange={(e) => setQuote(i, { name: e.target.value })}
            placeholder="Who said it, e.g. Jane Smith"
            aria-label="Quote by"
          />
          <input
            className="ed-input"
            value={quote.role}
            maxLength={limits?.quoteRole}
            onChange={(e) => setQuote(i, { role: e.target.value })}
            placeholder="Their role (optional), e.g. Engineering manager, Acme"
            aria-label="Their role"
          />
          <input
            className="ed-input"
            value={quote.url}
            maxLength={limits?.url}
            onChange={(e) => setQuote(i, { url: e.target.value })}
            placeholder="Link for their name (optional), https://…"
            aria-label="Quote link"
          />
        </div>
      ))}
      {(!limits || quotes.length < limits.quotes) && (
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange([...quotes, emptyQuote()])}>
          + Add quote
        </button>
      )}
      <span className="ed-field-hint">A quote without text isn't shown.</span>
    </>
  );
}

// A short timeline of a resume's latest roles (issue #90), read from what
// it has published each time the page is shown: nothing is copied here.
function ExperienceFields({ section, onChange, resumes, context, limits }) {
  const known = resumes.some((r) => r.id === section.resumeId);
  const status = cardStatus(section.resumeId, resumes, context);
  const roles = context.resumes.find((r) => r.id === section.resumeId)?.experience ?? [];
  const max = limits?.experienceCount ?? 10;
  return (
    <>
      <select className="ed-input" value={section.resumeId} onChange={(e) => onChange({ resumeId: e.target.value })} aria-label="Which resume">
        {!known && <option value={section.resumeId}>Deleted resume</option>}
        {resumes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {status && <span className="ed-field-hint ed-landing-card-status">{status}</span>}
      {!status && roles.length === 0 && (
        <span className="ed-field-hint ed-landing-card-status">Its published version has no experience shown on the web, so nothing is shown.</span>
      )}
      <label className="ed-field">
        <span>Roles to show</span>
        <select className="ed-input" value={section.count} onChange={(e) => onChange({ count: Number(e.target.value) })}>
          {Array.from({ length: max }, (_, n) => n + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="ed-field ed-checkbox-field">
        <input type="checkbox" checked={Boolean(section.showDates)} onChange={(e) => onChange({ showDates: e.target.checked })} />
        Show dates
      </label>
      <span className="ed-field-hint">
        The first experience entries the resume shows on the web, as last published: title, company, location and dates, never
        descriptions or bullets. Ends with a link to the full resume.
      </span>
    </>
  );
}

function ItemsFields({ sectionId, items, onChange, limits, ai, imageProps }) {
  // An edited item stays the same item to an upload in flight (landingImages.js).
  const setItem = (i, patch) => onChange(items.map((item, idx) => (idx === i ? carryItemKey(item, { ...item, ...patch }) : item)));
  const setThumbnail = (i, ref) => onChange(items.map((item, idx) => (idx === i ? carryItemKey(item, withImageRef(item, 'image', ref)) : item)));
  return (
    <>
      {items.map((item, i) => (
        <div className="ed-landing-card" key={i}>
          <div className="ed-landing-card-head">
            <span>Item {i + 1}</span>
            <RowActions
              index={i}
              count={items.length}
              onMove={(delta) => onChange(moved(items, i, delta))}
              onRemove={() => onChange(items.filter((_, idx) => idx !== i))}
              what="item"
            />
          </div>
          <input
            className="ed-input"
            value={item.title}
            maxLength={limits?.itemTitle}
            onChange={(e) => setItem(i, { title: e.target.value })}
            placeholder="Title, e.g. a project's name"
            aria-label="Item title"
          />
          <input
            className="ed-input"
            value={item.meta ?? ''}
            maxLength={limits?.itemMeta}
            onChange={(e) => setItem(i, { meta: e.target.value })}
            placeholder="A short line under the title (optional), e.g. 2024 · Rust · Open source"
            aria-label="Item details"
          />
          <input
            className="ed-input"
            value={item.url}
            maxLength={limits?.url}
            onChange={(e) => setItem(i, { url: e.target.value })}
            placeholder="Link for the title (optional), https://…"
            aria-label="Item link"
          />
          <textarea
            className="ed-input"
            rows={2}
            value={item.text}
            onChange={(e) => {
              const text = inlineEdit(item.text, e.target.value, limits?.itemText);
              if (text !== item.text) setItem(i, { text });
            }}
            placeholder="A line or two about it (optional)"
            aria-label="Item text"
          />
          <span className="ed-field-hint">{INLINE_HINT}</span>
          <LandingImageField
            hint="Thumbnail (optional)"
            value={item.image ?? null}
            onChange={(ref) => setThumbnail(i, ref)}
            {...imageProps({ kind: 'item', sectionId, index: i })}
          />
          <AiField ai={ai} target={{ kind: 'item', sectionId, index: i }} current={item.text} />
        </div>
      ))}
      {(!limits || items.length < limits.items) && (
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange([...items, emptyItem()])}>
          + Add item
        </button>
      )}
    </>
  );
}

function CardsFields({ sectionId, cards, onChange, resumes, context, limits, ai }) {
  const setCard = (i, patch) => onChange(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const addable = resumes.filter((r) => !cards.some((c) => c.resumeId === r.id));
  const titleOf = (resumeId) => context.resumes.find((r) => r.id === resumeId)?.title;
  return (
    <>
      <span className="ed-field-hint">
        Cards linking to your resumes. Only public, published ones are shown; the default links to /resume.
      </span>
      {cards.map((card, i) => {
        const resume = resumes.find((r) => r.id === card.resumeId);
        const status = cardStatus(card.resumeId, resumes, context);
        return (
          <div className="ed-landing-card" key={card.resumeId}>
            <div className="ed-landing-card-head">
              <strong>{resume ? resume.name : 'Deleted resume'}</strong>
              <RowActions
                index={i}
                count={cards.length}
                onMove={(delta) => onChange(moved(cards, i, delta))}
                onRemove={() => onChange(cards.filter((_, idx) => idx !== i))}
                what="card"
              />
            </div>
            {status && <span className="ed-field-hint ed-landing-card-status">{status}</span>}
            <input
              className="ed-input"
              value={card.label}
              maxLength={limits?.cardLabel}
              onChange={(e) => setCard(i, { label: e.target.value })}
              placeholder={titleOf(card.resumeId) || 'Card title, e.g. Engineering'}
              aria-label="Card title"
            />
            <textarea
              className="ed-input"
              rows={2}
              value={card.blurb}
              maxLength={limits?.blurb}
              onChange={(e) => setCard(i, { blurb: e.target.value })}
              placeholder="A line about this resume (optional)"
              aria-label="Card text"
            />
            <label className="ed-field ed-checkbox-field">
              <input type="checkbox" checked={Boolean(card.showPdf)} onChange={(e) => setCard(i, { showPdf: e.target.checked })} />
              Also link to its PDF
            </label>
            {!status && card.showPdf && !hasPdf(card.resumeId, context) && (
              <span className="ed-field-hint">It has no PDF yet, so no PDF link is shown.</span>
            )}
            {!status && <AiField ai={ai} target={{ kind: 'card', sectionId, resumeId: card.resumeId }} current={card.blurb} />}
          </div>
        );
      })}
      {addable.length > 0 && (!limits || cards.length < limits.cards) && (
        <select
          className="ed-input"
          value=""
          onChange={(e) => e.target.value && onChange([...cards, { resumeId: e.target.value, label: '', blurb: '', showPdf: false }])}
          aria-label="Add a resume card"
        >
          <option value="">+ Add a resume…</option>
          {addable.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <span className="ed-field-hint">A card without a title uses the resume's published header title, never its name here.</span>
    </>
  );
}
