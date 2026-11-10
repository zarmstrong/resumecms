import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { PhotoUpload } from './PhotoUpload.jsx';
import { LinksEditor } from './LinksEditor.jsx';
import { LandingAiPanel } from './LandingAiPanel.jsx';
import { introSectionId } from './landingAi.js';
import { SearchSharingFields } from './SearchSharingFields.jsx';
import { LandingLookFields } from './LandingLookFields.jsx';
import { IMAGE_TYPES, LandingImageField, imageFileProblem, withImageRef } from './LandingImageField.jsx';
import { carryItemKey } from './landingImages.js';
import { ACTION_LABELS, resolveLanding } from '../landing/resolveLanding.js';
import { landingPageMeta } from '../share/pageMeta.js';
import { inlineEdit } from '../landing/inlineText.js';
import { getLandingTemplate } from '../resume/templateRegistry.js';
import { hasPassed, utcToday } from '../landing/dateText.js';
import { applySectionDrop, liveCollapsedIds, moveSectionBy, projectSectionDrop } from './sectionDrag.js';

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
  { kind: 'divider', label: 'Divider', addLabel: 'Divider (a line between sections)', empty: () => ({}) },
  { kind: 'stats', label: 'Stats', addLabel: 'Stats (by the numbers)', empty: () => ({ stats: [emptyStat()] }) },
  { kind: 'faq', label: 'Questions and answers', addLabel: 'Questions and answers (FAQ)', empty: () => ({ entries: [emptyFaqEntry()] }) },
  {
    kind: 'education',
    label: 'Education',
    addLabel: 'Education (latest entries from a resume)',
    empty: (resumes) => ({ resumeId: (resumes.find((r) => r.isDefault) ?? resumes[0])?.id, count: 3, showDates: true }),
  },
  {
    kind: 'skills',
    label: 'Skills',
    addLabel: 'Skills (skill groups from a resume)',
    empty: (resumes) => ({ resumeId: (resumes.find((r) => r.isDefault) ?? resumes[0])?.id }),
  },
  {
    kind: 'credentials',
    label: 'Credentials',
    addLabel: 'Credentials (licenses, certifications, memberships)',
    empty: () => ({ credentials: [emptyCredential()] }),
  },
  { kind: 'gallery', label: 'Gallery', addLabel: 'Gallery (several images in a grid)', empty: () => ({ images: [] }) },
];
const kindLabel = (kind) => SECTION_KINDS.find((k) => k.kind === kind)?.label || kind;

const COLLAPSED_KEY = 'resumecms-landing-collapsed-sections';
// How far above or below the section list a drag may wander and still
// target its first or last section; beyond that the drop is cancelled.
const LIST_REACH_PX = 40;
// How long a move's announcement stays in the live region.
const LIVE_MESSAGE_MS = 2000;
const SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Press Up or Down to move this section. With a pointer, drag it to a new position.',
};

function emptyItem() {
  return { title: '', text: '', url: '', meta: '' };
}

function emptyQuote() {
  return { text: '', name: '', role: '', url: '' };
}

function emptyStat() {
  return { value: '', label: '' };
}

function emptyFaqEntry() {
  return { question: '', answer: '' };
}

function emptyCredential() {
  return { kind: 'certification', name: '', issuer: '', number: '', issued: '', expires: '', url: '' };
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
      return section.items.some(
        (item) => item.title.trim() || item.text.trim() || item.url.trim() || item.meta?.trim() || Boolean(item.image)
      );
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
    case 'stats':
      return section.stats.some((stat) => stat.value.trim() || stat.label.trim());
    case 'faq':
      return section.entries.some((entry) => entry.question.trim() || entry.answer.trim());
    case 'education':
    case 'skills':
      // Like experience: what they show comes from the resume.
      return false;
    case 'credentials':
      return section.credentials.some((c) => [c.name, c.issuer, c.number, c.issued, c.expires, c.url].some((value) => value.trim()));
    case 'gallery':
      return section.images.some((entry) => Boolean(entry.image) || Boolean(entry.caption.trim()));
    default:
      return false;
  }
}

// What a section's header says next to its kind: its heading, or a hint of
// what's in it while it has none.
function sectionSummary(section, resumes) {
  const title = section.title.trim();
  if (title) return title;
  const count = (n, one) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  switch (section.kind) {
    case 'text':
      return shorten(section.body.trim().split('\n')[0]);
    case 'items':
      return count(section.items.length, 'item');
    case 'links':
      return count(section.links.length, 'link');
    case 'resumes':
      return count(section.cards.length, 'card');
    case 'quotes':
      return count(section.quotes.length, 'quote');
    case 'experience':
    case 'education':
    case 'skills': {
      const resume = resumes.find((r) => r.id === section.resumeId);
      return resume ? `From ${resume.name}` : '';
    }
    case 'image':
      return shorten(section.caption.trim() || section.image?.alt?.trim() || (section.image ? '' : 'No image yet'));
    case 'stats':
      return count(section.stats.length, 'stat');
    case 'faq':
      return count(section.entries.length, 'question');
    case 'credentials':
      return count(section.credentials.length, 'credential');
    case 'gallery':
      return count(section.images.length, 'image') || 'No images yet';
    default:
      return '';
  }
}

function shorten(text) {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Whether publishing would refuse over this section: an image it shows with
// no description, as server/src/landingImageFields.js's
// assertImagesDescribed() decides. Its header says so, since the field may
// be collapsed out of sight.
function needsDescription(section, images) {
  const blank = (ref) => Boolean(ref) && images.some((image) => image.id === ref.imageId) && !ref.alt?.trim();
  if (section.hidden) return false;
  if (section.kind === 'image') return blank(section.image);
  if (section.kind === 'items') return section.items.some((item) => (item.title?.trim() || item.text?.trim()) && blank(item.image));
  if (section.kind === 'gallery') return section.images.some((entry) => blank(entry.image));
  return false;
}

// Which sections this browser has collapsed (SectionList), by id.
function readCollapsed() {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

// A section in the given column; like the server, 'main' isn't stored.
function withColumn(section, column) {
  const { column: _old, ...rest } = section;
  return column === 'main' ? rest : { ...rest, column };
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
// `onUploadImage` its image upload (issue #92, see LandingImageField),
// `look` its "Apply to the default resume" ({ onApply, applyState }, issue
// #93, see LandingLookFields).
export function LandingForm({ landing, resumes, context, limits, onChange, ai, onUploadImage, look }) {
  const set = (patch) => onChange({ ...landing, ...patch });
  // Each field passes its own target to the upload (landingImages.js).
  const imageProps = (target) => ({ images: context.images || [], limits: limits?.images, onUpload: (file) => onUploadImage(file, target) });
  const sections = landing.sections;
  const introId = introSectionId(landing);
  // Whether the page's template has a side column to put a section in.
  const hasColumns = Boolean(getLandingTemplate(landing.template)?.columns);
  const setSections = (next) => set({ sections: next });
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
        <span className="ed-field-hint">
          Shown in this order under the headline{hasColumns ? ' (or under the photo, in the side column)' : ''}. One with nothing to show is left off the page.
        </span>
        <SectionList
          sections={sections}
          onChange={setSections}
          hasColumns={hasColumns}
          resumes={resumes}
          context={context}
          limits={limits}
          ai={ai}
          imageProps={imageProps}
        />
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

      <LandingLookFields landing={landing} site={context.site} onChange={set} onApply={look?.onApply} applyState={look?.applyState} />

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

// The sections, in order: each one collapsible, and dragged by its handle
// (or moved with Up/Down on it) to reorder them. A collapsed section's
// fields stay mounted, only hidden, so an upload in flight or an AI
// instruction half typed is still there when it's opened again. Which ones
// are collapsed is this browser's own convenience, kept in localStorage.
function SectionList({ sections, onChange, hasColumns, resumes, context, limits, ai, imageProps }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [liveMessage, setLiveMessage] = useState('');
  const liveTimer = useRef(null);
  const listRef = useRef(null);
  // Rows are keyed by id, but React may still take the focused control's
  // node out and back in on a move, which blurs it; refocus it (the handle,
  // or the ↑/↓ button pressed, unless that's now disabled at an end) once
  // the list we sent has rendered.
  const pendingFocus = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => () => clearTimeout(liveTimer.current), []);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if (sections !== pending.sections) return;
    const { control } = pending;
    if (control?.isConnected && !control.disabled) control.focus();
    else listRef.current?.querySelector(`[data-section-id="${CSS.escape(pending.id)}"] .ed-drag-handle`)?.focus();
  }, [sections]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(liveCollapsedIds(collapsed, sections)));
    } catch {
      // Storage unavailable (private browsing, etc.): it's only a convenience.
    }
  }, [collapsed]);

  // A new suggestion in a collapsed section opens it, so it isn't left
  // unseen behind the header (as useRowPanelOpen does for a row's panel).
  const suggestions = sections.map((section) => ai?.suggestionsIn?.(section.id) || '');
  // Only a suggestion id not seen before counts: one accepted or discarded
  // out of several doesn't reopen what was closed.
  const seenSuggestions = useRef(new Set());
  useEffect(() => {
    const seen = seenSuggestions.current;
    const ids = suggestions.map((joined) => joined.split(' ').filter(Boolean));
    const arrived = sections.filter((_, i) => ids[i].some((id) => !seen.has(id))).map((s) => s.id);
    seenSuggestions.current = new Set(ids.flat());
    if (arrived.length) setCollapsed((prev) => (arrived.some((id) => prev.has(id)) ? new Set([...prev].filter((id) => !arrived.includes(id))) : prev));
  }, [suggestions.join('|')]);

  function announce(message) {
    clearTimeout(liveTimer.current);
    setLiveMessage(message);
    liveTimer.current = setTimeout(() => setLiveMessage(''), LIVE_MESSAGE_MS);
  }
  function toggle(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function updateSection(id, update) {
    onChange(sections.map((section) => (section.id === id ? update(section) : section)));
  }
  function removeSection(id) {
    const section = sections.find((s) => s.id === id);
    if (hasContent(section) && !window.confirm(`Remove this ${kindLabel(section.kind).toLowerCase()} section?`)) return;
    onChange(sections.filter((s) => s.id !== id));
  }
  function moveSection(id, delta) {
    const moved = moveSectionBy(sections, id, delta);
    if (!moved) {
      announce(delta < 0 ? 'Already first.' : 'Already last.');
      return;
    }
    const control = listRef.current?.contains(document.activeElement) ? document.activeElement : null;
    pendingFocus.current = { id, sections: moved.sections, control };
    announce(`Moved to ${lowerFirst(moved.label)}.`);
    onChange(moved.sections);
  }

  // Like the bullets' (ExperienceForm): sections stay put while one is
  // dragged, and the pointer is projected onto the nearest other section,
  // before or after it by its middle, so the gaps between them and the space
  // past the last one resolve to a place. Rects are measured live, so a pane
  // that scrolls during the drag can't leave them stale. Too far from the
  // list cancels the drop.
  function collisionDetection({ active, pointerCoordinates, droppableContainers }) {
    const listRect = listRef.current?.getBoundingClientRect();
    if (!pointerCoordinates || !listRect) return [];
    const { x, y } = pointerCoordinates;
    if (x < listRect.left || x > listRect.right) return [];
    if (y < listRect.top - LIST_REACH_PX || y > listRect.bottom + LIST_REACH_PX) return [];
    let nearest = null;
    for (const container of droppableContainers) {
      if (container.id === active.id) continue;
      const rect = container.node.current?.getBoundingClientRect();
      if (!rect) continue;
      const distance = Math.max(rect.top - y, y - rect.bottom, 0);
      if (!nearest || distance < nearest.distance) nearest = { id: container.id, rect, distance };
    }
    if (!nearest) return [];
    const edge = y < nearest.rect.top + nearest.rect.height / 2 ? 'before' : 'after';
    const projection = projectSectionDrop(sections, active.id, nearest.id, edge);
    return projection ? [{ id: nearest.id, data: { projection } }] : [];
  }

  // dnd-kit reads the latest handler, so `sections` is the draft as it is at
  // the drop, which is what the projection is applied to (sectionDrag.js).
  function handleDragEnd({ collisions }) {
    const applied = applySectionDrop(sections, collisions?.[0]?.data?.projection);
    if (!applied) {
      announce('Section returned to its original position.');
      return;
    }
    announce(`Moved to ${lowerFirst(applied.label)}.`);
    onChange(applied.sections);
  }

  // Only the pick-up goes through dnd-kit's live region; positions and the
  // outcome are announced by the list's own (see SectionRows).
  const announcements = {
    onDragStart: ({ active }) => {
      const section = sections.find((s) => s.id === active.id);
      return section && `Picked up ${kindLabel(section.kind).toLowerCase()} section “${sectionSummary(section, resumes) || 'untitled'}”.`;
    },
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  };

  const anyOpen = sections.some((section) => !collapsed.has(section.id));
  return (
    <>
      {sections.length > 1 && (
        <div className="ed-landing-sections-tools">
          <button
            type="button"
            className="ed-btn ed-btn-ghost ed-btn-sub"
            onClick={() => setCollapsed(anyOpen ? new Set(sections.map((section) => section.id)) : new Set())}
          >
            {anyOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={() => liveMessage && announce('')}
        onDragEnd={handleDragEnd}
        onDragCancel={() => announce('Move cancelled. Section returned to its original position.')}
        accessibility={{ screenReaderInstructions: SCREEN_READER_INSTRUCTIONS, announcements }}
      >
        <SectionRows
          sections={sections}
          listRef={listRef}
          liveMessage={liveMessage}
          collapsed={collapsed}
          suggestions={suggestions}
          rowProps={{ hasColumns, resumes, context, limits, ai, imageProps, toggle, updateSection, removeSection, moveSection }}
        />
      </DndContext>
    </>
  );
}

function SectionRows({ sections, listRef, liveMessage, collapsed, suggestions, rowProps }) {
  const { active, collisions } = useDndContext();
  const drop = collisions?.[0]?.data?.projection;
  const dragged = active ? sections.find((s) => s.id === active.id) : null;
  const draggedSummary = dragged && sectionSummary(dragged, rowProps.resumes);
  return (
    <>
      <div className="ed-landing-section-list" ref={listRef}>
        {sections.map((section, i) => (
          <SectionEditor
            key={section.id}
            section={section}
            index={i}
            count={sections.length}
            collapsed={collapsed.has(section.id)}
            suggested={Boolean(suggestions[i])}
            dragging={dragged === section}
            dropEdge={drop?.anchorId === section.id ? drop.edge : null}
            dropLabel={drop?.anchorId === section.id ? drop.label : null}
            {...rowProps}
          />
        ))}
      </div>
      <div className="ed-sr-only" role="status" aria-live="polite">{drop?.label || liveMessage}</div>
      {/* Portaled and always mounted, like the bullets' (see ExperienceForm). */}
      {createPortal(
        <DragOverlay dropAnimation={null} zIndex={4}>
          {dragged ? <div className="ed-drag-preview">{kindLabel(dragged.kind)}{draggedSummary ? `: ${draggedSummary}` : ''}</div> : null}
        </DragOverlay>,
        document.body,
      )}
    </>
  );
}

// SectionRows re-renders on every pointer move, but a section's props only
// change when something about it does, so a drag doesn't re-render every
// section's fields per move. LandingForm itself doesn't render mid-drag, so
// the shared props (rowProps) keep their identity.
const SectionEditor = memo(function SectionEditor({
  section, index, count, collapsed, suggested, dragging, dropEdge, dropLabel,
  hasColumns, resumes, context, limits, ai, imageProps, toggle, updateSection, removeSection, moveSection,
}) {
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef } = useDraggable({ id: section.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: section.id });
  function setNodeRef(node) {
    setDragRef(node);
    setDropRef(node);
  }
  const bodyId = `ed-landing-section-${section.id}`;
  const summary = sectionSummary(section, resumes);
  // What the buttons call it, so a list of them reads apart.
  const name = `${kindLabel(section.kind).toLowerCase()} section${summary ? ` “${summary}”` : ''}`;
  const undescribed = needsDescription(section, context.images || []);
  const patch = (fields) => updateSection(section.id, (s) => ({ ...s, ...fields }));

  function handleHandleKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // As on a bullet's handle: modified keys are the browser's, and a held
    // key doesn't repeat the move.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    e.preventDefault();
    moveSection(section.id, e.key === 'ArrowUp' ? -1 : 1);
  }

  return (
    <div ref={setNodeRef} className={`ed-landing-section${dragging ? ' ed-landing-section-dragging' : ''}`} data-section-id={section.id}>
      {dropEdge && <div className={`ed-drop-indicator ed-drop-${dropEdge}`}><span>{dropLabel}</span></div>}
      <div className="ed-landing-section-head">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="ed-drag-handle"
          {...attributes}
          {...listeners}
          onKeyDown={handleHandleKeyDown}
          aria-label={`Drag ${name} to reorder, or press Up or Down to move`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          title="Drag to reorder, or press Up/Down to move"
        >
          ⠿
        </button>
        <button
          type="button"
          className="ed-landing-section-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => toggle(section.id)}
        >
          <span className="ed-landing-section-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <strong>{kindLabel(section.kind)}</strong>
          {summary && <span className="ed-landing-section-summary">{summary}</span>}
        </button>
        {section.hidden && <span className="ed-landing-section-badge">Hidden</span>}
        {hasColumns && section.column === 'side' && <span className="ed-landing-section-badge">Side column</span>}
        {collapsed && suggested && <span className="ed-landing-section-badge ed-landing-section-badge-ai">✨ Suggestion</span>}
        {undescribed && <span className="ed-landing-section-badge ed-landing-section-badge-warn">Needs a description</span>}
        {/* Buttons as well as the handle: a screen reader's browse mode and
            voice control can't press Up/Down on it. */}
        <RowActions
          index={index}
          count={count}
          onMove={(delta) => moveSection(section.id, delta)}
          onRemove={() => removeSection(section.id)}
          what={name}
        />
      </div>
      <div className="ed-landing-section-body" id={bodyId} hidden={collapsed}>
        <input
          className="ed-input"
          value={section.title}
          maxLength={limits?.sectionTitle}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={section.kind === 'divider' ? 'Label on the line (optional)' : 'Heading (optional)'}
          aria-label={section.kind === 'divider' ? 'Divider label' : 'Section heading'}
        />
        <label className="ed-field ed-checkbox-field">
          <input type="checkbox" checked={Boolean(section.hidden)} onChange={(e) => patch({ hidden: e.target.checked })} />
          Hide this section
        </label>
        {section.hidden && <span className="ed-field-hint">Kept here, but not shown on the page.</span>}
        {hasColumns && (
          <label className="ed-field ed-checkbox-field">
            <input
              type="checkbox"
              checked={section.column === 'side'}
              onChange={(e) => updateSection(section.id, (s) => withColumn(s, e.target.checked ? 'side' : 'main'))}
            />
            Show in the side column, under the headline
          </label>
        )}
        <SectionFields
          section={section}
          onChange={patch}
          resumes={resumes}
          context={context}
          limits={limits}
          ai={ai}
          imageProps={imageProps}
        />
      </div>
    </div>
  );
});

// The syntax a text section, an item's text and an FAQ answer take (issue #91).
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
    case 'divider':
      return <span className="ed-field-hint">A line across the page between the sections around it, with its label (if any) on it.</span>;
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
    case 'stats':
      return <StatsFields stats={section.stats} onChange={(stats) => onChange({ stats })} limits={limits} />;
    case 'faq':
      return <FaqFields sectionId={section.id} entries={section.entries} onChange={(entries) => onChange({ entries })} limits={limits} ai={ai} />;
    case 'education':
      return <EducationFields section={section} onChange={onChange} resumes={resumes} context={context} limits={limits} />;
    case 'skills':
      return <SkillsFields section={section} onChange={onChange} resumes={resumes} context={context} />;
    case 'credentials':
      return <CredentialsFields credentials={section.credentials} onChange={(credentials) => onChange({ credentials })} limits={limits} />;
    case 'gallery':
      return <GalleryFields sectionId={section.id} images={section.images} onChange={(images) => onChange({ images })} limits={limits} imageProps={imageProps} />;
    default:
      return null;
  }
}

// A few large figures, each with a short label (issue #125). No ✨ here
// either: an AI mustn't make up numbers.
function StatsFields({ stats, onChange, limits }) {
  const setStat = (i, patch) => onChange(stats.map((stat, idx) => (idx === i ? { ...stat, ...patch } : stat)));
  return (
    <>
      {stats.map((stat, i) => (
        <div className="ed-landing-card" key={i}>
          <div className="ed-landing-card-head">
            <span>Stat {i + 1}</span>
            <RowActions
              index={i}
              count={stats.length}
              onMove={(delta) => onChange(moved(stats, i, delta))}
              onRemove={() => onChange(stats.filter((_, idx) => idx !== i))}
              what="stat"
            />
          </div>
          <input
            className="ed-input"
            value={stat.value}
            maxLength={limits?.statValue}
            onChange={(e) => setStat(i, { value: e.target.value })}
            placeholder="The figure, e.g. 2,000+ or 15 years"
            aria-label="Stat value"
          />
          <input
            className="ed-input"
            value={stat.label}
            maxLength={limits?.statLabel}
            onChange={(e) => setStat(i, { label: e.target.value })}
            placeholder="What it counts, e.g. patients cared for"
            aria-label="Stat label"
          />
        </div>
      ))}
      {(!limits || stats.length < limits.stats) && (
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange([...stats, emptyStat()])}>
          + Add stat
        </button>
      )}
      <span className="ed-field-hint">Plain text, so 98%, $4.2M or #1 work too. A stat without a figure isn't shown.</span>
    </>
  );
}

// Questions and answers (issue #123), each answer collapsed under its
// question on the page. Only the answer has a ✨: the question is what
// visitors ask.
function FaqFields({ sectionId, entries, onChange, limits, ai }) {
  const setEntry = (i, patch) => onChange(entries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)));
  return (
    <>
      {entries.map((entry, i) => (
        <div className="ed-landing-card" key={i}>
          <div className="ed-landing-card-head">
            <span>Question {i + 1}</span>
            <RowActions
              index={i}
              count={entries.length}
              onMove={(delta) => onChange(moved(entries, i, delta))}
              onRemove={() => onChange(entries.filter((_, idx) => idx !== i))}
              what="question"
            />
          </div>
          <input
            className="ed-input"
            value={entry.question}
            maxLength={limits?.faqQuestion}
            onChange={(e) => setEntry(i, { question: e.target.value })}
            placeholder="The question, e.g. Are you open to relocating?"
            aria-label="Question"
          />
          <textarea
            className="ed-input"
            rows={3}
            value={entry.answer}
            onChange={(e) => {
              const answer = inlineEdit(entry.answer, e.target.value, limits?.faqAnswer);
              if (answer !== entry.answer) setEntry(i, { answer });
            }}
            placeholder="The answer"
            aria-label="Answer"
          />
          <span className="ed-field-hint">{INLINE_HINT}</span>
          <AiField ai={ai} target={{ kind: 'answer', sectionId, index: i }} current={entry.answer} />
        </div>
      ))}
      {(!limits || entries.length < limits.faqEntries) && (
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange([...entries, emptyFaqEntry()])}>
          + Add question
        </button>
      )}
      <span className="ed-field-hint">Visitors open an answer by its question. One without both a question and an answer isn't shown.</span>
    </>
  );
}

// Licenses, certifications and memberships (issue #119). No ✨ here:
// they're facts, not prose.
function CredentialsFields({ credentials, onChange, limits }) {
  const setCredential = (i, patch) => onChange(credentials.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const today = utcToday();
  return (
    <>
      {credentials.map((credential, i) => (
        <div className="ed-landing-card" key={i}>
          <div className="ed-landing-card-head">
            <span>Credential {i + 1}</span>
            <RowActions
              index={i}
              count={credentials.length}
              onMove={(delta) => onChange(moved(credentials, i, delta))}
              onRemove={() => onChange(credentials.filter((_, idx) => idx !== i))}
              what="credential"
            />
          </div>
          <select
            className="ed-input"
            value={credential.kind}
            onChange={(e) => setCredential(i, { kind: e.target.value })}
            aria-label="Kind of credential"
          >
            <option value="license">License</option>
            <option value="certification">Certification</option>
            <option value="membership">Membership</option>
          </select>
          <input
            className="ed-input"
            value={credential.name}
            maxLength={limits?.credentialName}
            onChange={(e) => setCredential(i, { name: e.target.value })}
            placeholder="Name, e.g. Registered Nurse"
            aria-label="Credential name"
          />
          <input
            className="ed-input"
            value={credential.issuer}
            maxLength={limits?.credentialIssuer}
            onChange={(e) => setCredential(i, { issuer: e.target.value })}
            placeholder="Issued by, e.g. Oregon State Board of Nursing"
            aria-label="Issued by"
          />
          <input
            className="ed-input"
            value={credential.number}
            maxLength={limits?.credentialNumber}
            onChange={(e) => setCredential(i, { number: e.target.value })}
            placeholder="License or certificate number (optional)"
            aria-label="Credential number"
          />
          <div className="ed-landing-dates">
            <input
              className="ed-input"
              value={credential.issued}
              maxLength={limits?.credentialDate}
              onChange={(e) => setCredential(i, { issued: e.target.value })}
              placeholder={credential.kind === 'membership' ? 'Member since (optional)' : 'Issued (optional), e.g. Mar 2021'}
              aria-label="Issued"
            />
            <input
              className="ed-input"
              value={credential.expires}
              maxLength={limits?.credentialDate}
              onChange={(e) => setCredential(i, { expires: e.target.value })}
              placeholder="Expires (optional), e.g. Dec 2027"
              aria-label="Expires"
            />
          </div>
          {hasPassed(credential.expires, today) && (
            <span className="ed-field-hint ed-landing-card-status">Expired: not shown on the page. Renew it, or change the date.</span>
          )}
          <input
            className="ed-input"
            value={credential.url}
            maxLength={limits?.url}
            onChange={(e) => setCredential(i, { url: e.target.value })}
            placeholder="Link to verify it (optional), https://…"
            aria-label="Verification link"
          />
        </div>
      ))}
      {(!limits || credentials.length < limits.credentials) && (
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange([...credentials, emptyCredential()])}>
          + Add credential
        </button>
      )}
      <span className="ed-field-hint">
        One without a name isn't shown. Once its expiry date (a year, a month such as Dec 2027 or 12/2027, or a day such as
        2027-12-31) has passed, it leaves the page by itself; a date written any other way is shown as written. The link is
        shown as "Verify", for the issuer's public lookup page. Some license numbers are public record and some aren't: leave
        it out if yours isn't meant to be shared.
      </span>
    </>
  );
}

// A gallery (issue #120): its images in order, each with a caption. "Add
// images" takes several files at once: each gets an entry of its own
// straight away, with an empty description, and its upload lands on that
// entry (known by its key, landingImages.js) wherever it has moved by then,
// or nowhere if it was removed. No ✨: captions are plain text, never
// rewritten by AI.
function GalleryFields({ sectionId, images, onChange, limits, imageProps }) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const max = limits?.galleryImages ?? 24;
  // An edited entry stays the same entry to an upload in flight.
  const setEntry = (i, patch) => onChange(images.map((entry, idx) => (idx === i ? carryItemKey(entry, { ...entry, ...patch }) : entry)));

  async function handleFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = ''; // so picking the same files again still uploads them
    if (!files.length) return;
    const problems = files.map((file) => imageFileProblem(file, limits?.images)).filter(Boolean);
    const fine = files.filter((file) => !imageFileProblem(file, limits?.images));
    const taken = fine.slice(0, Math.max(0, max - images.length));
    const notes = [...new Set(problems)];
    if (problems.length) notes.unshift(problems.length === 1 ? "1 file wasn't added:" : `${problems.length} files weren't added:`);
    if (taken.length < fine.length) notes.push(`A gallery holds at most ${max} images, so ${fine.length - taken.length} more weren't added.`);
    setError(notes.join(' '));
    if (!taken.length) return;
    // The new entries go into the draft first, so each upload has its own
    // entry to find (uploadSpot() reads the draft as it is now).
    const start = images.length;
    onChange([...images, ...taken.map(() => ({ image: null, caption: '' }))]);
    setUploading((n) => n + taken.length);
    const results = await Promise.allSettled(taken.map((file, j) => imageProps({ kind: 'gallery', sectionId, index: start + j }).onUpload(file)));
    setUploading((n) => n - taken.length);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) setError(`${failed.length} of the images couldn't be uploaded: ${failed[0].reason?.message || 'Upload failed'}`);
  }

  return (
    <>
      {images.map((entry, i) => (
        <div className="ed-landing-card" key={i}>
          <div className="ed-landing-card-head">
            <span>Image {i + 1}</span>
            <RowActions
              index={i}
              count={images.length}
              onMove={(delta) => onChange(moved(images, i, delta))}
              onRemove={() => onChange(images.filter((_, idx) => idx !== i))}
              what="image"
            />
          </div>
          <LandingImageField value={entry.image} onChange={(image) => setEntry(i, { image })} {...imageProps({ kind: 'gallery', sectionId, index: i })} />
          <textarea
            className="ed-input"
            rows={2}
            value={entry.caption}
            maxLength={limits?.images?.caption}
            onChange={(e) => setEntry(i, { caption: e.target.value })}
            placeholder="Caption (optional)"
            aria-label={`Caption of image ${i + 1}`}
          />
        </div>
      ))}
      {images.length < max && (
        <label className={`ed-btn ed-btn-ghost${uploading ? ' ed-btn-inert' : ''}`}>
          {uploading ? `Uploading ${uploading} image${uploading === 1 ? '' : 's'}…` : '+ Add images'}
          <input type="file" accept={IMAGE_TYPES.join(',')} multiple onChange={handleFiles} disabled={uploading > 0} hidden />
        </label>
      )}
      {error && <div className="ed-field-error">{error}</div>}
      <span className="ed-field-hint">
        Up to {max} images, shown in a grid that opens each one larger. Pick several files at once if you like. Each needs a
        description before publishing; one with no image yet is left off the page.
      </span>
    </>
  );
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

// Which resume an education or skills section reads from (issue #126), and
// where it stands for visitors: an experience section's picker.
function SectionResumeFields({ section, onChange, resumes, context, nothing }) {
  const known = resumes.some((r) => r.id === section.resumeId);
  const status = cardStatus(section.resumeId, resumes, context);
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
      {!status && nothing && <span className="ed-field-hint ed-landing-card-status">{nothing}</span>}
    </>
  );
}

// A resume's latest education entries (issue #126), read from what it has
// published each time the page is shown, like ExperienceFields.
function EducationFields({ section, onChange, resumes, context, limits }) {
  const entries = context.resumes.find((r) => r.id === section.resumeId)?.education ?? [];
  const max = limits?.educationCount ?? 10;
  return (
    <>
      <SectionResumeFields
        section={section}
        onChange={onChange}
        resumes={resumes}
        context={context}
        nothing={entries.length === 0 ? 'Its published version has no education shown on the web, so nothing is shown.' : null}
      />
      <label className="ed-field">
        <span>Entries to show</span>
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
        The first education entries the resume shows on the web, as last published: degree, institution, location and dates. Ends
        with a link to the full resume.
      </span>
    </>
  );
}

// Every skill group a resume shows on the web (issue #126), as last
// published: its category and its items, one chip each.
function SkillsFields({ section, onChange, resumes, context }) {
  const groups = context.resumes.find((r) => r.id === section.resumeId)?.skills ?? [];
  return (
    <>
      <SectionResumeFields
        section={section}
        onChange={onChange}
        resumes={resumes}
        context={context}
        nothing={groups.length === 0 ? 'Its published version has no skills shown on the web, so nothing is shown.' : null}
      />
      <span className="ed-field-hint">
        Every skill group the resume shows on the web, as last published, in its order: the category and its items, split on commas.
        Ends with a link to the full resume.
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
