import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BlockList } from './BlockList.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
import { HeaderEditorForm } from './HeaderEditorForm.jsx';
import { SiteSettingsForm } from './SiteSettingsForm.jsx';
import { SettingsModal } from './SettingsModal.jsx';
import { ResumeView } from '../resume/ResumeView.jsx';
import { pdfUrl } from '../resume/pdfUrl.js';
import { BLOCK_TYPE_LABELS, defaultDataForType } from './blockDefaults.js';
import { createBlockReorderItems } from './blockDrag.js';
import {
  applyProposal,
  describeTarget,
  isProposalStale,
  previewedProposals,
  proposalKey,
  relocateTarget,
  targetSlice,
} from './aiReview.js';

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
  const [pdfVersion, setPdfVersion] = useState(null); // cache-busts the Download PDF link, see pdfUrl.js
  const [isDirty, setIsDirty] = useState(false);
  const [publishState, setPublishState] = useState('idle'); // idle | publishing | published
  const [publishError, setPublishError] = useState(null);
  // True when the PDF on disk wasn't rendered from the current published
  // snapshot (a publish whose PDF render failed) — see the server's
  // getPublishStatus().
  const [pdfStale, setPdfStale] = useState(false);
  const [leftWidth, setLeftWidth] = useState(loadLeftPaneWidth);
  const [resizingPane, setResizingPane] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  // Open AI rewrites, keyed by proposalKey(blockId, target), so each block
  // (and each bullet, description, or item within one) can have its own in
  // flight or under review at the same time:
  // { blockId, target, instruction, status: 'loading' | 'ready' | 'error', proposal, error }
  const [aiProposals, setAiProposals] = useState({});

  const debounceTimers = useRef({});
  const columnsRef = useRef(null);
  const reorderRequestIdRef = useRef(0);
  // Requests still in flight, per proposal key ({ id, blockId, target,
  // status: 'loading' }, the fields dropAiProposals' predicates can rely on).
  // A response is applied only if its request is still the latest for that
  // key; the entry is removed once it settles.
  const aiRequestsRef = useRef({});
  const aiRequestCounterRef = useRef(0);
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
      setPdfVersion(status.pdfVersion ?? null);
      setIsDirty(status.isDirty);
      setPdfStale(!!status.pdfStale);
      setUsername(credentials.username);
      setLoading(false);
    });
    // Kept out of the Promise.all above: the editor must still load if this
    // fails — AI rewrites just stay hidden.
    api
      .getAiSettings()
      .then(({ ai }) => setAiSettings(ai))
      .catch((err) => console.error('Failed to load AI settings', err));
  }, []);

  // Any edit or discard supersedes the message from the last publish; the
  // lasting state (an out-of-date PDF) is carried by pdfStale instead.
  // Counts edits so a publish can tell whether anything changed while it
  // was in flight (see handlePublish).
  const editSeq = useRef(0);
  function markDirty() {
    editSeq.current += 1;
    setIsDirty(true);
    setPublishError(null);
  }

  function flashSaved() {
    setSaveState('saved');
    setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
  }

  async function handlePublish() {
    setPublishState('publishing');
    setPublishError(null);
    const editsBefore = editSeq.current;
    try {
      const { publishedAt: newPublishedAt, pdfVersion: newPdfVersion } = await api.publish();
      setPublishedAt(newPublishedAt);
      setPdfVersion(newPdfVersion ?? null);
      setPdfStale(false);
      // The server snapshots the draft when the publish request arrives, so
      // an edit made while the PDF rendered is still unpublished: ask the
      // server rather than assuming, and count local edits too in case a
      // debounced save is still on its way.
      let stillDirty = editSeq.current !== editsBefore;
      try {
        const status = await api.publishStatus();
        stillDirty = stillDirty || status.isDirty;
        setPdfStale(!!status.pdfStale);
        setPdfVersion(status.pdfVersion ?? null);
      } catch {
        // keep the local answer
      }
      setIsDirty(stillDirty);
      setPublishState('published');
      setTimeout(() => setPublishState((s) => (s === 'published' ? 'idle' : s)), 1500);
    } catch (err) {
      setPublishState('idle');
      setPublishError(err.message || 'Publish failed');
      // The snapshot may have gone live even though the PDF render failed,
      // so don't guess — ask the server what state it's actually in.
      try {
        const status = await api.publishStatus();
        setPublishedAt(status.publishedAt);
        setPdfVersion(status.pdfVersion ?? null);
        setIsDirty(status.isDirty);
        setPdfStale(!!status.pdfStale);
      } catch {
        // leave the indicator as it was
      }
    }
  }

  async function handleDiscard() {
    const draft = await api.discardDraft();
    // Every block's data changes out from under its proposals.
    dropAiProposals(() => true);
    setHeader(draft.header);
    setSite(draft.site);
    setBlocks(draft.blocks);
    setIsDirty(false);
    setPublishError(null);
  }

  function handleHeaderChange(newHeader) {
    setHeader(newHeader);
    markDirty();
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__header);
    debounceTimers.current.__header = setTimeout(() => {
      api.putHeader(newHeader).then(flashSaved, saveFailed);
    }, SAVE_DEBOUNCE_MS);
  }

  function handleBlockDataChange(id, newData) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, data: newData } : b)));
    markDirty();
    setSaveState('saving');
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(() => {
      api.updateBlock(id, { data: newData }).then(flashSaved, saveFailed);
    }, SAVE_DEBOUNCE_MS);
  }

  function handleSiteChange(newSite) {
    setSite(newSite);
    markDirty();
    setSaveState('saving');
    clearTimeout(debounceTimers.current.__site);
    debounceTimers.current.__site = setTimeout(() => {
      api.putSite(newSite).then(flashSaved, saveFailed);
    }, SAVE_DEBOUNCE_MS);
  }

  async function handleVisibilityChange(id, patch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    markDirty();
    setSaveState('saving');
    await api.updateBlock(id, patch);
    flashSaved();
  }

  async function handleReorder(reordered) {
    // Show the projected drop immediately, then reconcile with the saved order.
    setBlocks(reordered);
    markDirty();
    setSaveState('saving');
    // A second drag can fire before the first request's response lands;
    // only apply a response if it's still the most recent request, so an
    // in-flight earlier response can't clobber a later optimistic update.
    const requestId = ++reorderRequestIdRef.current;
    try {
      const { blocks: canonical } = await api.reorderBlocks(
        createBlockReorderItems(reordered, blocks)
      );
      if (reorderRequestIdRef.current !== requestId) return;
      setBlocks(canonical);
      flashSaved();
    } catch (err) {
      console.error('Failed to save block order', err);
      if (reorderRequestIdRef.current !== requestId) return;
      // The optimistic order may now be invalid (e.g. it references a
      // parentId the server rejected) — refetch the real state instead of
      // leaving the UI stuck showing an order that was never actually
      // saved.
      const { blocks: fresh } = await api.getBlocks();
      if (reorderRequestIdRef.current !== requestId) return;
      setBlocks(fresh);
      setSaveState('idle');
    }
  }

  async function handleAdd(type) {
    const { block } = await api.createBlock(type, defaultDataForType(type));
    setBlocks((prev) => [...prev, block]);
    markDirty();
  }

  async function handleDelete(id) {
    // The server promotes a deleted heading's children to top-level (see
    // DELETE /blocks/:id) — mirror that here too, or the client's copy of
    // those blocks keeps pointing at a now-deleted heading id until the
    // next full refetch, which the next reorder would send back to the
    // server and get rejected as an invalid parentId.
    setBlocks((prev) =>
      prev.filter((b) => b.id !== id).map((b) => (b.parentId === id ? { ...b, parentId: null } : b))
    );
    dropAiProposals((entry) => entry.blockId === id);
    try {
      await api.deleteBlock(id);
    } catch (err) {
      // Already gone (deleted from another session or an MCP client): the
      // optimistic removal above is the right end state, and whoever
      // deleted it already marked the draft.
      if (err.status === 404) return;
      // Anything else means the block still exists on the server: put the
      // list back the way the server has it rather than leave them apart.
      await resyncBlocks();
      throw err;
    }
    markDirty();
  }

  // Re-reads the draft's blocks after a save that may have failed, so the
  // preview matches what's actually stored.
  async function resyncBlocks() {
    try {
      const { blocks: fresh } = await api.getBlocks();
      setBlocks(fresh);
    } catch {
      // keep the local copy; a reload sorts it out
    }
  }

  // A debounced save failing (e.g. the server refusing the data) would
  // otherwise leave "Saving…" up forever while the edit is silently lost.
  function saveFailed(err) {
    setSaveState('idle');
    setPublishError(err.message || 'Save failed');
  }

  // An AI rewrite is only a proposal held here until accepted: the preview
  // pane renders it in place of that part of the block's real data, and
  // nothing reaches the server until handleAiAccept saves it like any other
  // block edit.
  //
  // Drops every proposal `match` returns true for, and forgets their
  // requests so a response still in flight for one is ignored. `match` sees
  // both state entries and in-flight request entries; both carry blockId,
  // target, and status.
  function dropAiProposals(match) {
    for (const [key, request] of Object.entries(aiRequestsRef.current)) {
      if (match(request)) delete aiRequestsRef.current[key];
    }
    setAiProposals((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, entry]) => !match(entry)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }

  // Keeps open proposals attached to what they were made for. A bullet or
  // item proposal follows its bullet or item when the list shifts (a drag,
  // or a delete or insert above it): it's re-keyed to the new position, so
  // its panel and preview move with it. One whose position is gone and can't
  // be found, or whose block is gone, is dropped, since it would otherwise
  // stay counted in the banner with no panel to reject it from. Loading
  // entries are left alone until their response lands (they have no
  // baseData yet); this runs again then.
  useEffect(() => {
    const moved = [];
    const dropped = new Set();
    for (const [key, entry] of Object.entries(aiProposals)) {
      const block = blocks.find((b) => b.id === entry.blockId);
      if (!block) {
        dropped.add(key);
        continue;
      }
      if (entry.status !== 'ready') continue;
      const target = relocateTarget(block.type, entry.proposal, block.data);
      if (target === null) dropped.add(key);
      else if (target !== entry.proposal.target) moved.push([key, target]);
    }
    if (moved.length === 0 && dropped.size === 0) return;
    for (const key of dropped) delete aiRequestsRef.current[key];
    setAiProposals((prev) => {
      const gone = new Set([...dropped, ...moved.map(([key]) => key)]);
      const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !gone.has(key)));
      for (const [key, target] of moved) {
        const entry = prev[key];
        if (!entry) continue;
        const newKey = proposalKey(entry.blockId, target);
        // Two proposals can't share a position; the one already there wins.
        if (next[newKey]) continue;
        const origin = entry.proposal.origin || entry.proposal.target;
        next[newKey] = { ...entry, target, proposal: { ...entry.proposal, target, origin } };
      }
      return next;
    });
  }, [blocks, aiProposals]);

  function handleAiReject(key) {
    dropAiProposals((entry) => proposalKey(entry.blockId, entry.target) === key);
  }

  // `tense` is what a custom block's rewrite is sent with; `pickedTense` is
  // the user's own pick in the panel, or null when the picker was left on the
  // setting's default, so a reopened panel restores only a real pick. Both
  // are kept on the entry for that block and target.
  async function handleAiRequest(blockId, target, instruction, tense, pickedTense = null) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    // A newer request for the same block and target (or a discard)
    // supersedes any response still in flight for it; other keys are left
    // alone.
    const key = proposalKey(blockId, target);
    const id = ++aiRequestCounterRef.current;
    aiRequestsRef.current[key] = { id, blockId, target, status: 'loading' };
    const settle = (patch) => {
      if (aiRequestsRef.current[key]?.id !== id) return;
      if (patch.status !== 'loading') delete aiRequestsRef.current[key];
      setAiProposals((prev) => ({
        ...prev,
        // requestId tells a panel which request it's showing (see
        // AiRewritePanel), since relocation can move another one under it.
        [key]: { blockId, target, instruction, tense, pickedTense, requestId: id, proposal: null, error: null, ...patch },
      }));
    };
    settle({ status: 'loading' });
    try {
      const { proposal } = await api.aiRewrite(blockId, block.data, instruction, target, tense);
      settle({ status: 'ready', proposal });
    } catch (err) {
      settle({ status: 'error', error: err.message });
    }
  }

  function handleAiAccept(key) {
    const proposal = aiProposals[key]?.proposal;
    const block = proposal && blocks.find((b) => b.id === proposal.blockId);
    if (!block) return handleAiReject(key);
    if (targetSlice(block.type, block.data, proposal.target) === null) {
      window.alert(`The ${describeTarget(proposal.target)} this rewrite was for is no longer there, so it can't be applied.`);
      return handleAiReject(key);
    }
    if (
      isProposalStale(block.type, proposal, block.data) &&
      !window.confirm(
        `You've edited this ${describeTarget(proposal.target) || 'block'} since the rewrite was generated. Replace your edits with the rewrite?`
      )
    ) {
      return;
    }
    handleBlockDataChange(block.id, applyProposal(block.type, block.data, proposal));
    handleAiReject(key);
  }

  const readyProposals = Object.values(aiProposals)
    .filter((entry) => entry.status === 'ready')
    .map((entry) => entry.proposal);
  // What the preview actually shows: a ready proposal can be left out (its
  // part was edited since, or a restructuring rewrite moved positions; see
  // previewedProposals), and the banner and outline only count these.
  const previewedByBlock = new Map();
  for (const b of blocks) {
    const mine = readyProposals.filter((p) => p.blockId === b.id);
    const shown = mine.length ? previewedProposals(b.type, b.data, mine) : [];
    if (shown.length) previewedByBlock.set(b.id, shown);
  }
  const previewed = [...previewedByBlock.values()].flat();
  const aiHighlightIds = new Set(previewedByBlock.keys());
  const previewBlocks = previewed.length
    ? blocks.map((b) =>
        previewedByBlock.has(b.id)
          ? { ...b, data: previewedByBlock.get(b.id).reduce((data, p) => applyProposal(b.type, data, p), b.data) }
          : b
      )
    : blocks;
  // With exactly one rewrite in the preview, the banner can accept it directly.
  const soleReadyKey = previewed.length === 1 ? proposalKey(previewed[0].blockId, previewed[0].target) : null;
  const soleReadyBlock = soleReadyKey && blocks.find((b) => b.id === previewed[0].blockId);
  const openRewriteCount = Object.keys(aiProposals).length;

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
          {publishError && <span className="ed-topbar-warning"> · {publishError}</span>}
          {!publishError && pdfStale && (
            <span className="ed-topbar-warning" title="The last publish updated the site but its PDF render failed. Publish again to re-render it.">
              {' '}
              · PDF out of date
            </span>
          )}
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
          <a className="ed-btn ed-btn-ghost" href={pdfUrl(pdfVersion)}>
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
              ai={{
                available: Boolean(aiSettings?.available),
                // The custom-block tense picker's block types, options, and
                // starting value all come from the server's settings.
                pickedTenseTypes: aiSettings?.pickedTenseTypes,
                pickedTenses: aiSettings?.pickedTenses,
                pickedTenseDefault: aiSettings?.pickedTenseDefault,
                proposals: aiProposals,
                onRequest: handleAiRequest,
                onAccept: handleAiAccept,
                onReject: handleAiReject,
              }}
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
          {previewed.length > 0 ? (
            <div className="ed-preview-label ed-ai-preview-banner">
              <span>
                {soleReadyBlock
                  ? `Previewing AI rewrite of ${BLOCK_TYPE_LABELS[soleReadyBlock.type] || 'block'}${
                      describeTarget(previewed[0].target) ? ` (${describeTarget(previewed[0].target)})` : ''
                    }, outlined — not saved yet`
                  : `Previewing ${previewed.length} AI rewrites (outlined) — not saved yet. Accept each in its block.`}
              </span>
              <button
                type="button"
                className="ed-btn ed-btn-ghost"
                // Every rewrite, not just the ready ones: one still in flight
                // would otherwise turn up in the preview after "Discard all".
                onClick={() => dropAiProposals(() => true)}
              >
                {openRewriteCount === 1 ? 'Discard' : 'Discard all'}
              </button>
              {soleReadyKey && (
                <button type="button" className="ed-btn ed-btn-primary" onClick={() => handleAiAccept(soleReadyKey)}>
                  Accept
                </button>
              )}
            </div>
          ) : (
            <div className="ed-preview-label">Draft preview — dimmed blocks are hidden from web and/or print</div>
          )}
          <div className="ed-preview-frame">
            <ResumeView
              header={header}
              site={site}
              blocks={previewBlocks}
              mode="preview"
              highlightBlockIds={aiHighlightIds}
            />
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          username={username}
          onUsernameChange={setUsername}
          onAiSettingsChange={setAiSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
