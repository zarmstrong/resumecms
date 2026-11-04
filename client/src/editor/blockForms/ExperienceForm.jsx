import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { MAX_BULLET_DEPTH, normalizeBullet } from '../../resume/bulletUtils.js';
import { VisibilityToggle } from '../VisibilityToggle.jsx';
import { targetKey } from '../aiReview.js';
import { useRowPanelOpen } from '../useRowPanelOpen.js';
import {
  bulletAt, dropTargetPath, moveAtPath, moveBulletBy, parsePath, pathKey, projectBulletDrop, removeAtPath, updateAtPath,
} from '../bulletDrag.js';

// How far above or below the sibling list a drag may wander and still
// target its first or last bullet; beyond that the drop is cancelled.
const LIST_REACH_PX = 40;
// How long a keyboard-move announcement stays in the live region. Clearing
// it lets the same message be announced again next time.
const LIVE_MESSAGE_MS = 2000;

const SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Press Up or Down to move this bullet among its siblings. With a pointer, drag it to a new position.',
};

const DESCRIPTION_TARGET = Object.freeze({ kind: 'description' });
function newBullet(text = '') {
  return { text, visibleWeb: true, visiblePrint: true, children: [] };
}

function previewText(bullet) {
  const text = (bullet?.text || '').trim();
  if (!text) return 'Empty bullet';
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// `aiPanel` and `aiEntries` come from SortableBlockRow when AI rewrites are
// available (both null otherwise): `aiPanel(target, props)` renders a
// rewrite panel for the description or one bullet, and `aiEntries` holds
// this block's open proposals by targetKey, so a bullet with one keeps its
// panel open.
export function ExperienceForm({ data, onChange, aiPanel = null, aiEntries = null }) {
  const bullets = (data.bullets || []).map((b) => normalizeBullet(b));
  const [importText, setImportText] = useState(null); // null = import panel hidden
  const [liveMessage, setLiveMessage] = useState('');
  const liveTimer = useRef(null);
  const listRef = useRef(null);
  // Rows are keyed by index (bullets have no ids, and a key that changed on
  // every keystroke would remount the textarea), so after a keyboard move
  // the focused DOM node shows a different bullet. Remember where the moved
  // bullet went and refocus its handle once the parent has rendered the
  // array we sent — or, if it normalized or cloned it on the way, an array
  // with the same text at the new path. Anything else drops the request.
  const pendingFocus = useRef(null);
  // The bullets as they were when a pointer drag started; a drop is only
  // applied if they still read the same (see handleDragEnd).
  const dragStartSnapshot = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const landed = data.bullets === pending.bullets
      || bulletAt((data.bullets || []).map((b) => normalizeBullet(b)), pending.path)?.text === pending.text;
    if (!landed) return;
    listRef.current?.querySelector(`[data-bullet-key="${pathKey(pending.path)}"] .ed-drag-handle`)?.focus();
  }, [data.bullets]);

  useEffect(() => () => clearTimeout(liveTimer.current), []);
  function announce(message) {
    clearTimeout(liveTimer.current);
    setLiveMessage(message);
    liveTimer.current = setTimeout(() => setLiveMessage(''), LIVE_MESSAGE_MS);
  }

  function updateBullets(next) {
    onChange({ ...data, bullets: next });
  }
  function patchBullet(path, patch) {
    updateBullets(updateAtPath(bullets, path, (b) => ({ ...b, ...patch })));
  }
  function addBullet() {
    updateBullets([...bullets, newBullet()]);
  }
  function addSubBullet(path) {
    updateBullets(updateAtPath(bullets, path, (b) => ({ ...b, children: [...b.children, newBullet()] })));
  }
  function removeBullet(path) {
    updateBullets(removeAtPath(bullets, path));
  }
  function moveBullet(path, delta) {
    const moved = moveBulletBy(bullets, path, delta);
    if (!moved) {
      announce(delta < 0 ? 'Already first.' : 'Already last.');
      return;
    }
    const pending = { path: moved.path, bullets: moved.bullets, text: bulletAt(bullets, path).text };
    pendingFocus.current = pending;
    // The parent applies the change synchronously (the keydown is a discrete
    // event), so the effect has already consumed this by the time the
    // timeout fires. If a parent ever defers or drops the edit instead, the
    // request expires rather than firing on some later, unrelated change.
    setTimeout(() => { if (pendingFocus.current === pending) pendingFocus.current = null; }, 200);
    announce(`Moved to ${lowerFirst(moved.label)}.`);
    updateBullets(moved.bullets);
  }
  const importLines = (importText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  function importBullets() {
    if (importLines.length === 0) return;
    updateBullets([...bullets, ...importLines.map((text) => newBullet(text))]);
    setImportText(null);
  }

  // Same idea as BlockList: rows stay put and the pointer is projected onto
  // a row, so the indicator and the saved order always agree. Rects are
  // measured live (not dnd-kit's cached ones) so a panel that scrolls during
  // the drag can't leave them stale. Only rows that stand for a legal
  // sibling are candidates, and the nearest one wins, so the gaps between
  // rows, the active bullet's own sub-bullets, and the space just past the
  // last sibling all resolve to a position instead of a dead zone. The
  // pointer must stay within the sibling list itself (for a sub-bullet, its
  // parent's group) so a far-away drop is cancelled rather than snapped.
  function collisionDetection({ active, pointerCoordinates, droppableContainers }) {
    const list = listRef.current;
    const activePath = parsePath(active.id);
    if (!pointerCoordinates || !list || !activePath) return [];
    const scope = activePath.length === 1
      ? list
      : list.querySelector(`[data-bullet-key="${pathKey(activePath.slice(0, -1))}"]`);
    const scopeRect = scope?.getBoundingClientRect();
    if (!scopeRect) return [];
    const listRect = list.getBoundingClientRect();
    const { x, y } = pointerCoordinates;
    if (x < listRect.left || x > listRect.right) return [];
    if (y < scopeRect.top - LIST_REACH_PX || y > scopeRect.bottom + LIST_REACH_PX) return [];
    let nearest = null;
    for (const container of droppableContainers) {
      const overPath = parsePath(container.id);
      const target = overPath && dropTargetPath(activePath, overPath);
      const rect = target && container.node.current?.getBoundingClientRect();
      if (!rect) continue;
      const distance = Math.max(rect.top - y, y - rect.bottom, 0);
      if (!nearest || distance < nearest.distance) nearest = { id: container.id, target, distance };
    }
    if (!nearest) return [];
    // Before/after is judged against the target's whole group (its row plus
    // any sub-bullets), which is also where the indicator is drawn.
    const groupRect = list.querySelector(`[data-bullet-key="${pathKey(nearest.target)}"]`)?.getBoundingClientRect();
    if (!groupRect) return [];
    const placement = y < groupRect.top + groupRect.height / 2 ? 'before' : 'after';
    const projection = projectBulletDrop(bullets, activePath, nearest.target, placement);
    return projection ? [{ id: nearest.id, data: { projection } }] : [];
  }

  function handleDragStart() {
    dragStartSnapshot.current = JSON.stringify(bullets);
    // Only clear a lingering keyboard message; an empty one would be a
    // pointless re-render of every row at the start of the drag.
    if (liveMessage) announce('');
  }

  function handleDragCancel() {
    dragStartSnapshot.current = null;
    announce('Move cancelled. Bullet returned to its original position.');
  }

  // dnd-kit reads the latest handler, so `bullets` here is the current list.
  // The projection's index paths only mean anything against the list the
  // drag started on (compared by content, so a parent that merely cloned the
  // array doesn't count), so if an edit landed mid-drag (an accepted AI
  // rewrite, a discard) the drop is cancelled rather than moving whatever now
  // sits at those indexes. The outcome is announced here, where it is known.
  function handleDragEnd({ collisions }) {
    const started = dragStartSnapshot.current;
    dragStartSnapshot.current = null;
    const projection = collisions?.[0]?.data?.projection;
    if (!projection) {
      announce('Bullet returned to its original position.');
      return;
    }
    if (JSON.stringify(bullets) !== started) {
      announce('Drop cancelled: the bullets changed during the drag.');
      return;
    }
    announce(`Moved to ${lowerFirst(projection.label)}.`);
    updateBullets(moveAtPath(bullets, projection.fromPath, projection.toIndex));
  }

  // Only the pick-up goes through dnd-kit's live region. Positions, the
  // drop's outcome, and cancels are announced by the form's own status
  // region (see BulletRows), which knows whether the move was applied.
  const announcements = {
    onDragStart: ({ active }) => `Picked up bullet “${previewText(bulletAt(bullets, parsePath(active.id)))}”.`,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  };

  return (
    <div className="ed-form">
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Job title</span>
          <input
            className="ed-input"
            value={data.jobTitle || ''}
            onChange={(e) => onChange({ ...data, jobTitle: e.target.value })}
          />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>Start</span>
          <input
            className="ed-input"
            value={data.startDate || ''}
            onChange={(e) => onChange({ ...data, startDate: e.target.value })}
            placeholder="2022"
          />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>End</span>
          <input
            className="ed-input"
            value={data.endDate || ''}
            onChange={(e) => onChange({ ...data, endDate: e.target.value })}
            placeholder="Current"
          />
        </label>
      </div>

      <div className="ed-field-row">
        <label className="ed-field">
          <span>Company</span>
          <input
            className="ed-input"
            value={data.company || ''}
            onChange={(e) => onChange({ ...data, company: e.target.value })}
          />
        </label>
        <label className="ed-field">
          <span>Company URL</span>
          <input
            className="ed-input"
            value={data.companyUrl || ''}
            onChange={(e) => onChange({ ...data, companyUrl: e.target.value })}
            placeholder="https://…"
          />
        </label>
      </div>

      <label className="ed-field">
        <span>Location</span>
        <input
          className="ed-input"
          value={data.location || ''}
          onChange={(e) => onChange({ ...data, location: e.target.value })}
        />
      </label>

      <label className="ed-field">
        <span>Tagline (what the company does)</span>
        <input
          className="ed-input"
          value={data.tagline || ''}
          onChange={(e) => onChange({ ...data, tagline: e.target.value })}
        />
      </label>

      <label className="ed-field">
        <span>Description (optional)</span>
        <textarea
          className="ed-textarea"
          rows={3}
          value={data.description || ''}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
          placeholder="A short blurb about the role, shown above the bullet points"
        />
      </label>
      {aiPanel?.(DESCRIPTION_TARGET, {
        label: data.description?.trim() ? '✨ Rewrite description with AI' : '✨ Write description with AI',
        className: 'ed-ai-panel-field',
      })}

      <div className="ed-field">
        <span>Bullet points</span>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          accessibility={{ screenReaderInstructions: SCREEN_READER_INSTRUCTIONS, announcements }}
        >
          <BulletRows
            bullets={bullets}
            listRef={listRef}
            liveMessage={liveMessage}
            patchBullet={patchBullet}
            addSubBullet={addSubBullet}
            removeBullet={removeBullet}
            moveBullet={moveBullet}
            aiPanel={aiPanel}
            aiEntries={aiEntries}
          />
        </DndContext>
        <div className="ed-bullet-actions">
          <button type="button" className="ed-btn ed-btn-ghost" onClick={addBullet}>
            + Add bullet
          </button>
          <button
            type="button"
            className="ed-btn ed-btn-ghost"
            onClick={() => setImportText(importText === null ? '' : null)}
          >
            {importText === null ? 'Import bullets' : 'Cancel import'}
          </button>
        </div>
        {importText !== null && (
          <div className="ed-bullet-import">
            <textarea
              className="ed-textarea"
              rows={6}
              placeholder="Paste bullet points here, one per line…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              autoFocus
            />
            <div className="ed-bullet-import-hint">
              Each line becomes its own bullet. Nested sub-bullets aren't supported here — add
              those individually below.
            </div>
            <button
              type="button"
              className="ed-btn ed-btn-primary"
              disabled={importLines.length === 0}
              onClick={importBullets}
            >
              Add {importLines.length || ''} bullet{importLines.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BulletRows({ bullets, listRef, liveMessage, ...callbacks }) {
  const { active, collisions } = useDndContext();
  const drop = collisions?.[0]?.data?.projection;
  const activeKey = active ? String(active.id) : null;
  const draggedBullet = activeKey ? bulletAt(bullets, parsePath(activeKey)) : null;
  return (
    <>
      <div className="ed-bullet-list" ref={listRef}>
        {bullets.map((b, i) => (
          <BulletEditor
            key={i}
            bullet={b}
            path={[i]}
            activeKey={activeKey}
            drop={drop}
            {...callbacks}
          />
        ))}
      </div>
      <div className="ed-sr-only" role="status" aria-live="polite">{drop?.label || liveMessage}</div>
      {/* Portaled so no transformed or scrolling ancestor can offset or clip
          the preview. Mounted all the time, like BlockList's, so dnd-kit has
          the overlay in place when the drag starts (it renders nothing while
          idle). z-index 4 keeps it under the indicator's 5. */}
      {createPortal(
        <DragOverlay dropAnimation={null} zIndex={4}>
          {draggedBullet ? <div className="ed-drag-preview">{previewText(draggedBullet)}</div> : null}
        </DragOverlay>,
        document.body,
      )}
    </>
  );
}

// The drop projection only matters to the subtree it is anchored in, and
// then only by what it displays: a fresh projection object per pointer move
// that says the same thing must not re-render the anchored rows.
function dropWithin(drop, key) {
  if (!drop || (drop.anchorKey !== key && !drop.anchorKey.startsWith(`${key}.`))) return '';
  return `${drop.anchorKey}|${drop.edge}|${drop.label}`;
}

// BulletRows re-renders on every pointer move (useDndContext), so without
// this every textarea in the block would re-render per move. The memo only
// pays off during a drag: ExperienceForm doesn't re-render then, so the
// bullet objects and callbacks it created keep their identity. A render of
// ExperienceForm itself (a keystroke, say) re-creates both and re-renders
// every row, exactly as the form did before drag support.
function bulletPropsEqual(a, b) {
  const key = pathKey(a.path);
  return key === pathKey(b.path)
    && a.bullet === b.bullet
    && a.activeKey === b.activeKey
    && dropWithin(a.drop, key) === dropWithin(b.drop, key)
    && a.patchBullet === b.patchBullet
    && a.addSubBullet === b.addSubBullet
    && a.removeBullet === b.removeBullet
    && a.moveBullet === b.moveBullet
    && a.aiPanel === b.aiPanel
    && a.aiEntries === b.aiEntries;
}

const BulletEditor = memo(function BulletEditor({
  bullet, path, activeKey, drop, patchBullet, addSubBullet, removeBullet, moveBullet, aiPanel, aiEntries,
}) {
  const depth = path.length - 1;
  const key = pathKey(path);
  // The panel opens when this bullet gets a rewrite (and on remount while it
  // has one), and the ✨ button toggles it; see useRowPanelOpen.
  const aiEntry = aiEntries?.[targetKey({ kind: 'bullet', path })];
  const [aiOpen, setAiOpen] = useRowPanelOpen(aiEntry);
  const aiShown = Boolean(aiPanel && aiOpen);
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef } = useDraggable({ id: key });
  const { setNodeRef: setDropRef } = useDroppable({ id: key });
  function setNodeRef(node) {
    setDragRef(node);
    setDropRef(node);
  }
  // The wrapper holds the children too, so dimming it dims the whole group,
  // and an "after" indicator on it sits below the group's last sub-bullet.
  const dragging = activeKey === key;
  const groupDrop = drop?.anchorKey === key ? drop : null;

  function handleHandleKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // Leave modified keys to the browser and screen reader, and ignore
    // auto-repeat so a held key can't act on a row that has since re-rendered
    // as a different bullet.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    e.preventDefault();
    moveBullet(path, e.key === 'ArrowUp' ? -1 : 1);
  }

  return (
    <div className={`ed-bullet${dragging ? ' ed-bullet-dragging' : ''}`} data-bullet-key={key}>
      {groupDrop && <div className={`ed-drop-indicator ed-drop-${groupDrop.edge}`}><span>{groupDrop.label}</span></div>}
      <div ref={setNodeRef} className={`ed-bullet-row ed-bullet-depth-${depth}`}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="ed-drag-handle"
          {...attributes}
          {...listeners}
          onKeyDown={handleHandleKeyDown}
          aria-label="Drag to reorder, or press Up or Down to move"
          aria-keyshortcuts="ArrowUp ArrowDown"
          title="Drag to reorder, or press Up/Down to move"
        >
          ⠿
        </button>
        <textarea
          className="ed-textarea"
          rows={2}
          value={bullet.text}
          onChange={(e) => patchBullet(path, { text: e.target.value })}
        />
        <div className="ed-bullet-side">
          <div className="ed-visibility-toggles">
            <VisibilityToggle
              label="Web"
              active={bullet.visibleWeb}
              onClick={() => patchBullet(path, { visibleWeb: !bullet.visibleWeb })}
            />
            <VisibilityToggle
              label="Print/PDF"
              active={bullet.visiblePrint}
              onClick={() => patchBullet(path, { visiblePrint: !bullet.visiblePrint })}
            />
          </div>
          {depth < MAX_BULLET_DEPTH && (
            <button
              type="button"
              className="ed-btn ed-btn-ghost ed-btn-sub"
              onClick={() => addSubBullet(path)}
            >
              + Add sub-bullet
            </button>
          )}
        </div>
        <button type="button" className="ed-icon-btn" onClick={() => removeBullet(path)} aria-label="Remove bullet">
          ✕
        </button>
        {aiPanel && (
          <button
            type="button"
            className={`ed-icon-btn${aiShown ? ' ed-icon-btn-active' : ''}`}
            onClick={() => setAiOpen((open) => !open)}
            aria-label={depth ? 'Rewrite sub-bullet with AI' : 'Rewrite bullet with AI'}
            aria-expanded={aiShown}
            title={depth ? 'Rewrite this sub-bullet with AI' : 'Rewrite this bullet (and its sub-bullets) with AI'}
          >
            ✨
          </button>
        )}
      </div>
      {/* Outside the row, so the panel is never part of the drag handle's
          node or a drop target. */}
      {aiShown &&
        aiPanel({ kind: 'bullet', path }, { open: true, onClose: () => setAiOpen(false), className: 'ed-ai-panel-inline' })}
      {bullet.children.length > 0 && (
        <div className="ed-bullet-children">
          {bullet.children.map((child, i) => (
            <BulletEditor
              key={i}
              bullet={child}
              path={[...path, i]}
              activeKey={activeKey}
              drop={drop}
              patchBullet={patchBullet}
              addSubBullet={addSubBullet}
              removeBullet={removeBullet}
              moveBullet={moveBullet}
              aiPanel={aiPanel}
              aiEntries={aiEntries}
            />
          ))}
        </div>
      )}
    </div>
  );
}, bulletPropsEqual);
