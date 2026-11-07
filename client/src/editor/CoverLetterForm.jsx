import { useEffect, useRef, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { moveParagraph } from '../letters/letterParts.js';
import { letterTargetKey } from '../letters/letterAi.js';
import { LetterDraftPanel, ParagraphAiPanel } from './LetterAiPanels.jsx';
import { useRowPanelOpen } from './useRowPanelOpen.js';

// How long a keyboard-move announcement stays in the live region (as in
// ExperienceForm).
const LIVE_MESSAGE_MS = 3000;

// The form for one cover letter (issue #71): its internal title and every
// field of its data (see server/src/coverLetterFields.js, and
// mcp/blockSchemas.js's COVER_LETTER_SCHEMA, which documents the same
// fields). `onChange(letter)` gets the whole letter back, { title, data }.
// `headerName` is what a blank signature signs with. `ai` (null without an
// AI provider) is the page's AI writing for this letter; see
// LetterAiPanels.jsx.
export function CoverLetterForm({ letter, headerName, onChange, ai = null }) {
  const data = letter.data || {};
  const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
  const setData = (patch) => onChange({ ...letter, data: { ...data, ...patch } });
  const field = (key) => ({ value: typeof data[key] === 'string' ? data[key] : '', onChange: (e) => setData({ [key]: e.target.value }) });

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Title (only you see it)</span>
        <input className="ed-input" value={letter.title} onChange={(e) => onChange({ ...letter, title: e.target.value })} />
      </label>
      <label className="ed-field">
        <span>Date</span>
        <input className="ed-input" placeholder="Today's date, when you export it" {...field('date')} />
      </label>

      <div className="ed-block-style-heading">Recipient</div>
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Name</span>
          <input className="ed-input" {...field('recipientName')} />
        </label>
        <label className="ed-field">
          <span>Title</span>
          <input className="ed-input" {...field('recipientTitle')} />
        </label>
      </div>
      <label className="ed-field">
        <span>Company</span>
        <input className="ed-input" {...field('company')} />
      </label>
      <label className="ed-field">
        <span>Address</span>
        <textarea className="ed-textarea" rows={3} {...field('address')} />
      </label>

      <div className="ed-block-style-heading">Letter</div>
      {ai && <LetterDraftPanel letter={letter} ai={ai} />}
      <label className="ed-field">
        <span>Salutation</span>
        <input className="ed-input" placeholder="Dear Hiring Manager," {...field('salutation')} />
      </label>
      <Paragraphs letter={letter} paragraphs={paragraphs} onChange={(next) => setData({ paragraphs: next })} ai={ai} />
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Closing</span>
          <input className="ed-input" placeholder="Sincerely," {...field('closing')} />
        </label>
        <label className="ed-field">
          <span>Signature</span>
          <input className="ed-input" placeholder={headerName || 'Your name'} {...field('signature')} />
        </label>
      </div>
    </div>
  );
}

// The body, one textarea per paragraph, reordered by dragging a handle or
// with Up/Down on it. Paragraphs have no ids, so rows are keyed by index; a
// drop only applies if the list is still the one the drag picked up
// (moveParagraph), so an edit landing mid-drag can't move the wrong one.
function Paragraphs({ letter, paragraphs, onChange, ai }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const snapshot = useRef(null);
  const [liveMessage, setLiveMessage] = useState('');
  const liveTimer = useRef(null);
  useEffect(() => () => clearTimeout(liveTimer.current), []);
  const ids = paragraphs.map((_, i) => `p${i}`);
  const indexOf = (id) => ids.indexOf(id);

  function announce(message) {
    clearTimeout(liveTimer.current);
    setLiveMessage(message);
    liveTimer.current = setTimeout(() => setLiveMessage(''), LIVE_MESSAGE_MS);
  }

  function move(from, to, base = paragraphs) {
    const next = moveParagraph(paragraphs, from, to, base);
    if (!next) return false;
    onChange(next);
    return true;
  }

  function moveBy(index, delta) {
    if (move(index, index + delta)) {
      announce(`Paragraph moved to position ${index + delta + 1} of ${paragraphs.length}`);
      // The handle that was focused now belongs to the row it moved into.
      requestAnimationFrame(() => document.querySelector(`[data-paragraph-handle="${index + delta}"]`)?.focus());
    }
  }

  return (
    <div className="ed-field">
      <span>Paragraphs</span>
      <div className="ed-sr-only" role="status" aria-live="polite">
        {liveMessage}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          snapshot.current = paragraphs;
        }}
        onDragCancel={() => {
          snapshot.current = null;
        }}
        onDragEnd={({ active, over }) => {
          const base = snapshot.current;
          snapshot.current = null;
          if (over && base) move(indexOf(active.id), indexOf(over.id), base);
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {paragraphs.map((text, i) => (
            <ParagraphRow
              key={ids[i]}
              id={ids[i]}
              index={i}
              text={text}
              count={paragraphs.length}
              onText={(value) => onChange(paragraphs.map((p, j) => (j === i ? value : p)))}
              onRemove={() => onChange(paragraphs.filter((_, j) => j !== i))}
              onMove={(delta) => moveBy(i, delta)}
              aiPanel={ai && ((props) => <ParagraphAiPanel letter={letter} index={i} ai={ai} {...props} />)}
              aiEntry={ai?.entries[letterTargetKey({ kind: 'paragraph', index: i })] || null}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button type="button" className="ed-btn ed-btn-ghost ed-btn-sub" onClick={() => onChange([...paragraphs, ''])}>
        + Add paragraph
      </button>
    </div>
  );
}

// `aiPanel`/`aiEntry`: the paragraph's AI rewrite panel and its request, as
// for ExperienceForm's bullets; the panel opens when a request lands here
// and the ✨ button toggles it (useRowPanelOpen).
function ParagraphRow({ id, index, text, count, onText, onRemove, onMove, aiPanel, aiEntry }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [aiOpen, setAiOpen] = useRowPanelOpen(aiEntry);
  const aiShown = Boolean(aiPanel && aiOpen);

  function handleKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    if (index + delta >= 0 && index + delta < count) onMove(delta);
  }

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'ed-bullet-dragging' : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="ed-bullet-row">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="ed-drag-handle"
          data-paragraph-handle={index}
          {...attributes}
          {...listeners}
          onKeyDown={handleKeyDown}
          aria-label={`Paragraph ${index + 1} of ${count}: drag to reorder, or press Up or Down to move`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          title="Drag to reorder, or press Up/Down to move"
        >
          ⠿
        </button>
        <textarea
          className="ed-textarea"
          rows={4}
          value={text}
          aria-label={`Paragraph ${index + 1}`}
          onChange={(e) => onText(e.target.value)}
        />
        <button type="button" className="ed-icon-btn" onClick={onRemove} aria-label={`Remove paragraph ${index + 1}`}>
          ✕
        </button>
        {aiPanel && (
          <button
            type="button"
            className={`ed-icon-btn${aiShown ? ' ed-icon-btn-active' : ''}`}
            onClick={() => setAiOpen((open) => !open)}
            aria-label={`Rewrite paragraph ${index + 1} with AI`}
            aria-expanded={aiShown}
            title="Rewrite this paragraph with AI"
          >
            ✨
          </button>
        )}
      </div>
      {aiShown && aiPanel({ onClose: () => setAiOpen(false) })}
    </div>
  );
}
