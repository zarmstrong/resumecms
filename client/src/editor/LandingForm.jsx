import { PhotoUpload } from './PhotoUpload.jsx';
import { LinksEditor } from './LinksEditor.jsx';
import { LandingAiPanel } from './LandingAiPanel.jsx';
import { introSectionId } from './landingAi.js';
import { SearchSharingFields } from './SearchSharingFields.jsx';
import { resolveLanding } from '../landing/resolveLanding.js';
import { landingPageMeta } from '../share/pageMeta.js';

// The kinds of section the landing page can hold (server/src/landingFields.js's
// SECTION_KINDS), what each is called here, and what a new one starts with.
const SECTION_KINDS = [
  { kind: 'text', label: 'Text', addLabel: 'Text', empty: () => ({ body: '' }) },
  { kind: 'items', label: 'List', addLabel: 'List (e.g. projects)', empty: () => ({ items: [emptyItem()] }) },
  { kind: 'links', label: 'Links', addLabel: 'Links', empty: () => ({ links: [] }) },
  { kind: 'resumes', label: 'Resume cards', addLabel: 'Resume cards', empty: () => ({ cards: [] }) },
];
const kindLabel = (kind) => SECTION_KINDS.find((k) => k.kind === kind)?.label || kind;

function emptyItem() {
  return { title: '', text: '', url: '' };
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
      return section.items.some((item) => item.title.trim() || item.text.trim() || item.url.trim());
    case 'links':
      return section.links.length > 0;
    case 'resumes':
      return section.cards.length > 0;
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

// Where a card's resume stands for visitors: shown, or why not. `context`
// lists the resumes a card can link to now (public and published).
function cardStatus(resumeId, resumes, context) {
  if (context.resumes.some((r) => r.id === resumeId)) return null;
  const resume = resumes.find((r) => r.id === resumeId);
  if (!resume) return 'Deleted: not shown';
  if (!resume.isPublic) return 'Private: not shown until it is made public';
  return 'Not shown until it is published';
}

// A field's ✨ panel, or nothing while AI rewrites aren't set up.
function AiField({ ai, ...props }) {
  return ai?.available ? <LandingAiPanel ai={ai} {...props} /> : null;
}

// The landing page's fields (issue #70). `landing` is the draft, `context`
// and `limits` come from GET /api/landing, `resumes` is the editor's list,
// `ai` is LandingEditorPage's AI rewrite state and handlers (issue #73).
export function LandingForm({ landing, resumes, context, limits, onChange, ai }) {
  const set = (patch) => onChange({ ...landing, ...patch });
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
    setSections([...sections, { id: newSectionId(), kind, title: '', ...config.empty() }]);
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

      <div className="ed-field">
        <span>Photo</span>
        <select className="ed-input" value={landing.photo} onChange={(e) => set({ photo: e.target.value })}>
          <option value="resume">The default resume's photo</option>
          <option value="custom">A different photo</option>
          <option value="none">No photo</option>
        </select>
        {landing.photo === 'resume' && !context.photoUrl && (
          <span className="ed-field-hint">The default resume's published header has no photo, so none is shown.</span>
        )}
      </div>
      {landing.photo === 'custom' && (
        <PhotoUpload label="Landing page photo" value={landing.photoUrl} onChange={(photoUrl) => set({ photoUrl })} />
      )}

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
            <SectionFields
              section={section}
              onChange={(patch) => setSection(i, patch)}
              resumes={resumes}
              context={context}
              limits={limits}
              ai={ai}
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

      <LandingSeoFields landing={landing} context={context} limits={limits} onChange={(seo) => set({ seo })} />
    </div>
  );
}

// The landing page's `seo` (issue #87), previewed as the page resolves.
function LandingSeoFields({ landing, context, limits, onChange }) {
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
      hint="What search results and link previews say about this page. The preview card is drawn from the headline, subheadline and photo."
    />
  );
}

function SectionFields({ section, onChange, resumes, context, limits, ai }) {
  switch (section.kind) {
    case 'text':
      return (
        <>
          <textarea
            className="ed-input"
            rows={5}
            value={section.body}
            maxLength={limits?.text}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="A few lines about yourself."
            aria-label="Text"
          />
          <span className="ed-field-hint">Plain text. Leave a blank line to start a new paragraph.</span>
          <AiField ai={ai} target={{ kind: 'text', sectionId: section.id }} current={section.body} />
        </>
      );
    case 'items':
      return <ItemsFields sectionId={section.id} items={section.items} onChange={(items) => onChange({ items })} limits={limits} ai={ai} />;
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
    default:
      return null;
  }
}

function ItemsFields({ sectionId, items, onChange, limits, ai }) {
  const setItem = (i, patch) => onChange(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
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
            maxLength={limits?.itemText}
            onChange={(e) => setItem(i, { text: e.target.value })}
            placeholder="A line or two about it (optional)"
            aria-label="Item text"
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
            {!status && <AiField ai={ai} target={{ kind: 'card', sectionId, resumeId: card.resumeId }} current={card.blurb} />}
          </div>
        );
      })}
      {addable.length > 0 && (!limits || cards.length < limits.cards) && (
        <select
          className="ed-input"
          value=""
          onChange={(e) => e.target.value && onChange([...cards, { resumeId: e.target.value, label: '', blurb: '' }])}
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
