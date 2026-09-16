import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BlockList } from './BlockList.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
import { HeaderEditorForm } from './HeaderEditorForm.jsx';
import { SiteSettingsForm } from './SiteSettingsForm.jsx';
import { SettingsModal } from './SettingsModal.jsx';
import { ResumeView } from '../resume/ResumeView.jsx';
import { defaultDataForType } from './blockDefaults.js';

const SAVE_DEBOUNCE_MS = 500;

const LEFT_PANE_WIDTH_KEY = 'resumecms-editor-left-pane-width';
const LEFT_PANE_MIN = 340;
const LEFT_PANE_MAX = 760;
const LEFT_PANE_DEFAULT = 480;
const RESIZE_STEP = 16;

function loadLeftPaneWidth() {
  try {
    const stored = Number(localStorage.getItem(LEFT_PANE_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= LEFT_PANE_MIN && stored <= LEFT_PANE_MAX) return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) — fall back below.
  }
  return LEFT_PANE_DEFAULT;
}

function timeAgo(iso) {
  if (!iso) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function EditorPage({ onLogout }) {
  const [header, setHeader] = useState(null);
  const [site, setSite] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [publishedAt, setPublishedAt] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [publishState, setPublishState] = useState('idle'); // idle | publishing | published
  const [leftWidth, setLeftWidth] = useState(loadLeftPaneWidth);
  const [resizingPane, setResizingPane] = useState(false);

  const debounceTimers = useRef({});
  const columnsRef = useRef(null);
  // Tracks the in-progress width during a drag so handleUp can persist the
  // final value directly — avoids a synchronous localStorage write on every
  // pointermove (one per pixel dragged), which was making the resize feel
  // janky. React state (leftWidth) still updates every move for live visual
  // feedback; only the persistence is deferred to drag end.
  const leftWidthRef = useRef(leftWidth);

  function persistLeftWidth(width) {
    try {
      localStorage.setItem(LEFT_PANE_WIDTH_KEY, String(width));
    } catch {
      // ignore — nothing to persist to
    }
  }

  function handleResizerPointerDown(e) {
    e.preventDefault();
    setResizingPane(true);
  }

  // Arrow keys move the pane boundary in fixed steps, Home/End jump to the
  // min/max — the keyboard equivalent of the pointer drag below, since
  // role="separator" alone doesn't make an element operable.
  function handleResizerKeyDown(e) {
    let next;
    if (e.key === 'ArrowLeft') next = leftWidth - RESIZE_STEP;
    else if (e.key === 'ArrowRight') next = leftWidth + RESIZE_STEP;
    else if (e.key === 'Home') next = LEFT_PANE_MIN;
    else if (e.key === 'End') next = LEFT_PANE_MAX;
    else return;
    e.preventDefault();
    next = Math.min(LEFT_PANE_MAX, Math.max(LEFT_PANE_MIN, next));
    leftWidthRef.current = next;
    setLeftWidth(next);
    persistLeftWidth(next);
  }

  useEffect(() => {
    if (!resizingPane) return undefined;
    function handleMove(e) {
      if (!columnsRef.current) return;
      const left = columnsRef.current.getBoundingClientRect().left;
      const next = Math.min(LEFT_PANE_MAX, Math.max(LEFT_PANE_MIN, e.clientX - left));
      leftWidthRef.current = next;
      setLeftWidth(next);
    }
    function handleUp() {
      setResizingPane(false);
      persistLeftWidth(leftWidthRef.current);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [resizingPane]);

  useEffect(() => {
    Promise.all([
      api.getHeader(),
      api.getSite(),
      api.getBlocks(),
      api.publishStatus(),
      api.getCredentials(),
    ]).then(([h, s, b, status, credentials]) => {
      setHeader(h.header);
      setSite(s.site);
      setBlocks(b.blocks);
      setPublishedAt(status.publishedAt);
      setIsDirty(status.isDirty);
      setUsername(credentials.username);
      setLoading(false);
    });
  }, []);

  function flashSaved() {
    setSaveState('saved');
    setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
  }

  async function handlePublish() {
    setPublishState('publishing');
    try {
      const { publishedAt: newPublishedAt } = await api.publish();
      setPublishedAt(newPublishedAt);
      setIsDirty(false);
      setPublishState('published');
      setTimeout(() => setPublishState((s) => (s === 'published' ? 'idle' : s)), 1500);
    } catch {
      setPublishState('idle');
    }
  }

  async function handleDiscard() {
    const draft = await api.discardDraft();
    setHeader(draft.header);
    setSite(draft.site);
    setBlocks(draft.blocks);
    setIsDirty(false);
  }

  function handleHeaderChange(newHeader) {
    setHeader(newHeader);
    setIsDirty(true);
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__header);
    debounceTimers.current.__header = setTimeout(async () => {
      await api.putHeader(newHeader);
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  function handleBlockDataChange(id, newData) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, data: newData } : b)));
    setIsDirty(true);
    setSaveState('saving');
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(async () => {
      await api.updateBlock(id, { data: newData });
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  function handleSiteChange(newSite) {
    setSite(newSite);
    setIsDirty(true);
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__site);
    debounceTimers.current.__site = setTimeout(async () => {
      await api.putSite(newSite);
      flashSaved();
    }, SAVE_DEBOUNCE_MS);
  }

  async function handleVisibilityChange(id, patch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setIsDirty(true);
    setSaveState('saving');
    await api.updateBlock(id, patch);
    flashSaved();
  }

  async function handleReorder(reordered) {
    // Optimistic update first so the drag feels instant, then reconcile
    // with the server's response: it re-derives canonical order via
    // orderBlocksHierarchically, which isn't guaranteed to exactly match
    // what the client sent (e.g. reparentMovedBlock only recomputes the
    // dragged block's parentId, so the rest of the list's ordering is
    // whatever it already was) — without this the UI could keep showing a
    // stale order until the next reload.
    setBlocks(reordered);
    setIsDirty(true);
    setSaveState('saving');
    const { blocks: canonical } = await api.reorderBlocks(reordered.map((b) => ({ id: b.id, parentId: b.parentId || null })));
    setBlocks(canonical);
    flashSaved();
  }

  async function handleAdd(type) {
    const { block } = await api.createBlock(type, defaultDataForType(type));
    setBlocks((prev) => [...prev, block]);
    setIsDirty(true);
  }

  async function handleDelete(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await api.deleteBlock(id);
    setIsDirty(true);
  }

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  if (loading) return <div className="ed-loading">Loading editor…</div>;

  return (
    <div className="ed-shell" style={resizingPane ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
      <header className="ed-topbar">
        <div className="ed-topbar-title">Resume Editor</div>
        <div className="ed-topbar-status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'idle' && (isDirty ? 'Unpublished changes' : `Published ${timeAgo(publishedAt) || 'never'}`)}
        </div>
        <div className="ed-topbar-actions">
          {isDirty && (
            <button className="ed-btn ed-btn-ghost" onClick={handleDiscard}>
              Discard changes
            </button>
          )}
          <button className="ed-btn ed-btn-primary" onClick={handlePublish} disabled={publishState === 'publishing'}>
            {publishState === 'publishing' && 'Publishing…'}
            {publishState === 'published' && 'Published'}
            {publishState === 'idle' && 'Publish'}
          </button>
          <a className="ed-btn ed-btn-ghost" href="/" target="_blank" rel="noreferrer">
            View public site
          </a>
          <a className="ed-btn ed-btn-ghost" href="/api/public/resume.pdf">
            Download PDF
          </a>
          <button className="ed-btn ed-btn-ghost" onClick={() => setSettingsOpen(true)}>
            Account Settings
          </button>
          <button className="ed-btn ed-btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <div className="ed-columns" ref={columnsRef} style={{ gridTemplateColumns: `${leftWidth}px 6px 1fr` }}>
        <div className="ed-left-pane">
          <section className="ed-panel">
            <button className="ed-panel-toggle" onClick={() => setHeaderOpen((v) => !v)}>
              <span>Header &amp; Contact Info</span>
              <span>{headerOpen ? '−' : '+'}</span>
            </button>
            {headerOpen && (
              <div className="ed-panel-body">
                <HeaderEditorForm header={header} onChange={handleHeaderChange} />
              </div>
            )}
          </section>

          <section className="ed-panel">
            <button className="ed-panel-toggle" onClick={() => setSiteOpen((v) => !v)}>
              <span>Site Settings &amp; Colors</span>
              <span>{siteOpen ? '−' : '+'}</span>
            </button>
            {siteOpen && (
              <div className="ed-panel-body">
                <SiteSettingsForm header={header} site={site} blocks={blocks} onChange={handleSiteChange} />
              </div>
            )}
          </section>

          <section className="ed-panel">
            <div className="ed-panel-label">Resume Sections</div>
            <BlockList
              blocks={blocks}
              onReorder={handleReorder}
              onChangeData={handleBlockDataChange}
              onChangeVisibility={handleVisibilityChange}
              onDelete={handleDelete}
            />
            <AddBlockMenu onAdd={handleAdd} />
          </section>
        </div>

        <div
          className={`ed-resizer${resizingPane ? ' ed-resizer-active' : ''}`}
          onPointerDown={handleResizerPointerDown}
          onKeyDown={handleResizerKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor panel"
          aria-valuenow={leftWidth}
          aria-valuemin={LEFT_PANE_MIN}
          aria-valuemax={LEFT_PANE_MAX}
          tabIndex={0}
        />

        <div className="ed-right-pane">
          <div className="ed-preview-label">Draft preview — dimmed blocks are hidden from web and/or print</div>
          <div className="ed-preview-frame">
            <ResumeView header={header} site={site} blocks={blocks} mode="preview" />
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          username={username}
          onUsernameChange={setUsername}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
