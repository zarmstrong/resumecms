import { useEffect, useMemo, useRef, useState } from 'react';
import { api, resumeApi } from '../api.js';
import { BlockList } from './BlockList.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
import { HeaderEditorForm } from './HeaderEditorForm.jsx';
import { SiteSettingsForm } from './SiteSettingsForm.jsx';
import { SettingsModal } from './SettingsModal.jsx';
import { ResumeView } from '../resume/ResumeView.jsx';
import { pdfUrl } from '../resume/pdfUrl.js';
import { BLOCK_TYPE_LABELS, defaultDataForType } from './blockDefaults.js';
import { createBlockReorderItems } from './blockDrag.js';
import { createSaveQueue } from './saveQueue.js';
import { publicUrl } from './resumeLinks.js';
import { ResumeSelect } from './ResumeSelect.jsx';
import { NewResumeModal, ResumeSettingsModal } from './ResumeModals.jsx';
import { TailorModal } from './TailorModal.jsx';
import { createTailorRun, tailorItems } from './tailorRun.js';
import {
  acceptAllPlan,
  applyProposal,
  describeTarget,
  isProposalStale,
  previewedProposals,
  proposalKey,
  relocateTarget,
  targetSlice,
} from './aiReview.js';

const SAVE_DEBOUNCE_MS = 500;
// How often the publish status is asked for while a PDF render is pending.
const PDF_PENDING_POLL_MS = 3000;

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

// The editor for one resume (`resume`, as GET /api/resumes lists it).
// ResumesEditor mounts a fresh one per resume, so everything below belongs
// to that resume alone; every content call goes through resumeApi(its id).
// `onSwitch(id, list?, tailor?)` opens another resume, `onResumesChanged()`
// reloads the list (resolving with it). `pendingTailor` is a tailoring run
// to start once this has loaded (a copy made with "Tailor the copy"), and
// `onPendingTailorTaken()` says it has been. `landingShown`: the landing
// page holds `/` (issue #70), so the default resume is at /resume.
// `onOpenLetters()` opens this resume's cover letters (issue #71).
export function EditorPage({
  resume,
  resumes,
  onSwitch,
  pendingTailor,
  onPendingTailorTaken,
  onResumesChanged,
  onOpenLetters,
  landingShown = false,
  onLogout,
}) {
  const rapi = useMemo(() => resumeApi(resume.id), [resume.id]);
  const saves = useMemo(() => createSaveQueue({ delayMs: SAVE_DEBOUNCE_MS }), []);
  const [newResumeOpen, setNewResumeOpen] = useState(false);
  const [resumeSettingsOpen, setResumeSettingsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [header, setHeader] = useState(null);
  const [site, setSite] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
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
  // True while a render for this resume is queued or running on the server
  // (a publish that answered before its PDF was done); polled until it isn't.
  const [pdfPending, setPdfPending] = useState(false);
  const [leftWidth, setLeftWidth] = useState(loadLeftPaneWidth);
  const [resizingPane, setResizingPane] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  // Open AI rewrites, keyed by proposalKey(blockId, target), so each block
  // (and each bullet, description, or item within one) can have its own in
  // flight or under review at the same time:
  // { blockId, target, instruction, status: 'loading' | 'ready' | 'error', proposal, error }
  const [aiProposals, setAiProposals] = useState({});
  const [tailorOpen, setTailorOpen] = useState(false);
  // The tailoring run on screen: createTailorRun's state plus its brief and
  // items (for Retry), or null.
  const [tailorRun, setTailorRun] = useState(null);

  const columnsRef = useRef(null);
  // The current blocks, for requests a tailoring run sends after the
  // render that started it.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const runnerRef = useRef(null);
  const runTokenRef = useRef(null);
  const mountedRef = useRef(true);
  // The current proposals, for a tailoring run deciding whether a spot was
  // taken by a newer request since it started.
  const aiProposalsRef = useRef(aiProposals);
  aiProposalsRef.current = aiProposals;
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
      rapi.getHeader(),
      rapi.getSite(),
      rapi.getBlocks(),
      rapi.publishStatus(),
      api.getCredentials(),
    ]).then(([h, s, b, status, credentials]) => {
      setHeader(h.header);
      setSite(s.site);
      setBlocks(b.blocks);
      setPublishedAt(status.publishedAt);
      setPdfVersion(status.pdfVersion ?? null);
      setIsDirty(status.isDirty);
      setPdfStale(!!status.pdfStale);
      setPdfPending(!!status.pdfPending);
      setUsername(credentials.username);
      setLoading(false);
    }).catch((err) => {
      // Deleted since the list was loaded (another tab, an MCP client): a
      // fresh list no longer has it, so ResumesEditor opens the default.
      if (err.status === 404) onResumesChanged().catch((e) => setLoadError(e.message));
      else setLoadError(err.message);
    });
    // Kept out of the Promise.all above: the editor must still load if this
    // fails — AI rewrites just stay hidden.
    api
      .getAiSettings()
      .then(({ ai }) => setAiSettings(ai))
      .catch((err) => console.error('Failed to load AI settings', err));
  }, [rapi]);

  // While a render is pending, ask the server every few seconds until it
  // lands (or fails: pdfStale stays set). Only the PDF fields are taken, so
  // an edit or publish meanwhile keeps its own idea of the draft.
  useEffect(() => {
    if (!pdfPending) return undefined;
    let cancelled = false;
    let timer;
    function poll() {
      timer = setTimeout(async () => {
        try {
          const status = await rapi.publishStatus();
          if (cancelled) return;
          setPdfVersion(status.pdfVersion ?? null);
          setPdfStale(!!status.pdfStale);
          if (status.pdfPending) poll();
          else setPdfPending(false);
        } catch {
          if (!cancelled) poll();
        }
      }, PDF_PENDING_POLL_MS);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdfPending, rapi]);

  // Unmounting (another resume opened, or logging out) sends whatever is
  // still waiting on its debounce rather than dropping it. A switch started
  // here has already waited for them (leaveFor), so this is for one that
  // wasn't, like the browser's back button.
  useEffect(() => () => saves.runWaiting(), [saves]);

  // A tailoring run sends nothing more once this resume is closed, and one
  // that would start after that (handleTailor's save outlasting the page)
  // doesn't start.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runnerRef.current?.cancel();
    };
  }, []);

  // A copy made with "Tailor the copy" starts its run here, once loaded.
  // From a timer, so StrictMode's mount-unmount-mount in development
  // starts it once, not twice.
  useEffect(() => {
    if (loading || !pendingTailor) return undefined;
    const timer = setTimeout(() => {
      onPendingTailorTaken();
      startTailoring(pendingTailor.brief, tailorItems(blocksRef.current, pendingTailor.types));
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it has loaded
  }, [loading]);

  // Gets every edit to the server, then does `next`: for whatever reads
  // the server's copy (opening another resume, copying this one). A save
  // that failed is reported, and only a confirm goes on without it.
  async function afterSaving(next) {
    setSwitching(true);
    try {
      const failed = await saves.flush();
      if (failed.length && !window.confirm(`A change didn't save (${failed[0].message || 'unknown error'}). Go on without it?`)) return;
      await next();
    } finally {
      setSwitching(false);
    }
  }

  function handleSwitch(id) {
    afterSaving(() => onSwitch(id));
  }

  // `tailor` ({ brief, types }) tailors the copy once it's open.
  async function handleCreateResume(input, tailor = null) {
    let created;
    await afterSaving(async () => {
      ({ resume: created } = await api.createResume(input));
    });
    if (!created) return;
    // It exists now, so a failed reload mustn't read as a failed create (a
    // retry would make a second one): open it from the list we have.
    const list = await onResumesChanged().catch(() => [...resumes, created]);
    onSwitch(created.id, list, tailor);
  }

  // AI tailoring (issue #53): one rewrite per item (tailorRun.js), each a
  // normal proposal under review, `brief` sent with every one. Starting a
  // run replaces one still going; its open proposals stay.
  function startTailoring(brief, items) {
    if (!mountedRef.current) return;
    runnerRef.current?.cancel();
    // Only the latest run updates the bar; it reports its first state
    // before createTailorRun returns.
    const token = {};
    runTokenRef.current = token;
    // A rewrite asked for in a panel after the run started wins over the
    // run's own for that spot, which is skipped when its turn comes.
    const startedAt = aiRequestCounterRef.current;
    const takenSince = (key) =>
      Math.max(aiRequestsRef.current[key]?.id ?? 0, aiProposalsRef.current[key]?.requestId ?? 0) > startedAt;
    runnerRef.current = createTailorRun({
      items,
      run: (item) =>
        takenSince(proposalKey(item.blockId, item.target))
          ? { superseded: true }
          : handleAiRequest(item.blockId, item.target, '', undefined, null, { brief }),
      onUpdate: (state) => {
        if (runTokenRef.current === token) setTailorRun({ ...state, brief, items });
      },
    });
  }

  function cancelTailoring() {
    const abandoned = runnerRef.current?.cancel() ?? [];
    // Their requests are forgotten too, so a late one doesn't turn up.
    const keys = new Set(abandoned.map((item) => proposalKey(item.blockId, item.target)));
    dropAiProposals((entry) => entry.status === 'loading' && keys.has(proposalKey(entry.blockId, entry.target)));
  }

  // "Tailor…": saves the brief on the resume, then runs.
  async function handleTailor(brief, types) {
    await api.updateResume(resume.id, { tailoring: brief });
    onResumesChanged().catch(() => {});
    startTailoring(brief, tailorItems(blocksRef.current, types));
  }

  async function handleResumeDeleted() {
    // It's gone either way, so a failed reload still opens the default.
    const list = await onResumesChanged().catch(() => resumes.filter((r) => r.id !== resume.id));
    onSwitch(list.find((r) => r.isDefault).id, list);
  }
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
      const { publishedAt: newPublishedAt, pdfVersion: newPdfVersion, pdfPending: newPdfPending } = await rapi.publish();
      setPublishedAt(newPublishedAt);
      setPdfVersion(newPdfVersion ?? null);
      setPdfStale(!!newPdfPending);
      setPdfPending(!!newPdfPending);
      // The server snapshots the draft when the publish request arrives, so
      // an edit made while the PDF rendered is still unpublished: ask the
      // server rather than assuming, and count local edits too in case a
      // debounced save is still on its way.
      let stillDirty = editSeq.current !== editsBefore;
      try {
        const status = await rapi.publishStatus();
        stillDirty = stillDirty || status.isDirty;
        setPdfStale(!!status.pdfStale);
        setPdfPending(!!status.pdfPending);
        setPdfVersion(status.pdfVersion ?? null);
      } catch {
        // keep the local answer
      }
      setIsDirty(stillDirty);
      setPublishState('published');
      // The list shows when each resume was published (its link, and
      // whether it can become the default, depend on it).
      onResumesChanged().catch(() => {});
      setTimeout(() => setPublishState((s) => (s === 'published' ? 'idle' : s)), 1500);
    } catch (err) {
      setPublishState('idle');
      setPublishError(err.message || 'Publish failed');
      // The snapshot may have gone live even though the PDF render failed,
      // so don't guess — ask the server what state it's actually in.
      try {
        const status = await rapi.publishStatus();
        setPublishedAt(status.publishedAt);
        setPdfVersion(status.pdfVersion ?? null);
        setIsDirty(status.isDirty);
        setPdfStale(!!status.pdfStale);
        setPdfPending(!!status.pdfPending);
      } catch {
        // leave the indicator as it was
      }
      // Same for the list: a failed render still published it.
      onResumesChanged().catch(() => {});
    }
  }

  async function handleDiscard() {
    // Every save goes out first, so none lands on top of the discarded
    // draft; once it's discarded, a save that failed is moot (and one
    // typed meanwhile is replaced on screen below).
    await saves.flush();
    let draft;
    try {
      draft = await rapi.discardDraft();
    } catch (err) {
      setPublishError(err.message || 'Discard failed');
      return;
    }
    if (saves.forget(() => true)) setSaveState('idle');
    // Every block's data changes out from under its proposals, and a
    // tailoring run would go on adding more.
    runnerRef.current?.cancel();
    dropAiProposals(() => true);
    setTailorRun(null); // it pointed at rewrites that are gone
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
    saves.schedule('header', () => saves.track(rapi.putHeader(newHeader), 'header').then(flashSaved, saveFailed));
  }

  function handleBlockDataChange(id, newData) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, data: newData } : b)));
    markDirty();
    setSaveState('saving');
    saves.schedule(`block:${id}`, () =>
      saves.track(rapi.updateBlock(id, { data: newData }), `block:${id}`).then(flashSaved, saveFailed)
    );
  }

  function handleSiteChange(newSite) {
    setSite(newSite);
    markDirty();
    setSaveState('saving');
    saves.schedule('site', () => saves.track(rapi.putSite(newSite), 'site').then(flashSaved, saveFailed));
  }

  async function handleVisibilityChange(id, patch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    markDirty();
    setSaveState('saving');
    await saves.track(rapi.updateBlock(id, patch), `block:${id}:${Object.keys(patch).sort().join(',')}`);
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
      const { blocks: canonical } = await saves.track(rapi.reorderBlocks(createBlockReorderItems(reordered, blocks)));
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
      const { blocks: fresh } = await rapi.getBlocks();
      if (reorderRequestIdRef.current !== requestId) return;
      setBlocks(fresh);
      setSaveState('idle');
    }
  }

  async function handleAdd(type) {
    const { block } = await saves.track(rapi.createBlock(type, defaultDataForType(type)));
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
    // Its edits stop mattering: a save still waiting would only 404 after
    // the delete, and a failed one would be reported on every switch.
    if (saves.forget((key) => key === `block:${id}` || key.startsWith(`block:${id}:`))) setSaveState('idle');
    try {
      await saves.track(rapi.deleteBlock(id));
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
      const { blocks: fresh } = await rapi.getBlocks();
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
  //
  // Each check compares the block against the proposal's anchorData, the
  // data it was last placed against, and then advances the anchor (see
  // relocateTarget), so a run of edits and moves is resolved one change at
  // a time. A proposal whose anchor is already the block's current data is
  // skipped, which also keeps this from looping on its own update.
  useEffect(() => {
    const placed = [];
    const dropped = new Set();
    for (const [key, entry] of Object.entries(aiProposals)) {
      const block = blocks.find((b) => b.id === entry.blockId);
      if (!block) {
        dropped.add(key);
        continue;
      }
      if (entry.status !== 'ready') continue;
      const kind = entry.proposal.target?.kind;
      if (kind !== 'bullet' && kind !== 'item') continue;
      if ((entry.proposal.anchorData ?? entry.proposal.baseData) === block.data) continue;
      const target = relocateTarget(block.type, entry.proposal, block.data);
      if (target === null) dropped.add(key);
      else placed.push({ key, entry, target, anchorData: block.data });
    }
    if (placed.length === 0 && dropped.size === 0) return;
    for (const key of dropped) delete aiRequestsRef.current[key];
    setAiProposals((prev) => {
      const gone = new Set([...dropped, ...placed.map(({ key }) => key)]);
      const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !gone.has(key)));
      for (const { key, entry, target, anchorData } of placed) {
        // A newer request for this key landed since; leave it to the next run.
        if (prev[key] !== entry) {
          if (prev[key]) next[key] = prev[key];
          continue;
        }
        const newKey = proposalKey(entry.blockId, target);
        // Two proposals can't share a position; the one already there wins.
        if (next[newKey]) continue;
        const origin = entry.proposal.origin || entry.proposal.target;
        next[newKey] = { ...entry, target, proposal: { ...entry.proposal, target, origin, anchorData } };
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
  // are kept on the entry for that block and target. `brief` tailors the
  // rewrite (the entry keeps `tailored` for the panel's checkbox).
  //
  // Resolves with how it ended, for a tailoring run: { ok: true },
  // { ok: false, error }, or { superseded: true } when a newer request for
  // the same spot (or a discard) took over, or the block is gone.
  async function handleAiRequest(blockId, target, instruction, tense, pickedTense = null, { brief = null } = {}) {
    // The latest blocks: a tailoring run sends requests renders after the
    // one that started it.
    const block = blocksRef.current.find((b) => b.id === blockId);
    // Deleted since (a tailoring run's item): nothing to retry.
    if (!block) return { superseded: true };
    // A newer request for the same block and target (or a discard)
    // supersedes any response still in flight for it; other keys are left
    // alone.
    const key = proposalKey(blockId, target);
    const id = ++aiRequestCounterRef.current;
    aiRequestsRef.current[key] = { id, blockId, target, status: 'loading' };
    const tailored = Boolean(brief);
    const settle = (patch) => {
      if (aiRequestsRef.current[key]?.id !== id) return false;
      if (patch.status !== 'loading') delete aiRequestsRef.current[key];
      setAiProposals((prev) => ({
        ...prev,
        // requestId tells a panel which request it's showing (see
        // AiRewritePanel), since relocation can move another one under it.
        [key]: { blockId, target, instruction, tense, pickedTense, tailored, requestId: id, proposal: null, error: null, ...patch },
      }));
      return true;
    };
    settle({ status: 'loading' });
    try {
      const { proposal } = await rapi.aiRewrite(blockId, block.data, instruction, target, tense, brief);
      return settle({ status: 'ready', proposal }) ? { ok: true } : { superseded: true };
    } catch (err) {
      return settle({ status: 'error', error: err.message }) ? { ok: false, error: err.message } : { superseded: true };
    }
  }

  // "Accept all" in the preview banner: saves what the preview shows
  // (acceptAllPlan), except whole-block rewrites whose block was edited
  // since, which stay open to be accepted one by one.
  function handleAcceptAll() {
    const { changes, accepted } = acceptAllPlan(blocks, readyProposals);
    for (const { blockId, data } of changes) handleBlockDataChange(blockId, data);
    const keys = new Set(accepted.map((p) => proposalKey(p.blockId, p.target)));
    dropAiProposals((entry) => entry.status === 'ready' && keys.has(proposalKey(entry.blockId, entry.target)));
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
  const tailoringNow = Boolean(tailorRun && !tailorRun.finished);
  // With several in the preview, the banner can accept them all at once.
  const acceptAll = previewed.length > 1 ? acceptAllPlan(blocks, readyProposals) : null;

  function handleLogout() {
    // Before the session ends, or the waiting saves would go out without it.
    return afterSaving(async () => {
      await api.logout();
      onLogout();
    });
  }

  if (loadError) return <div className="ed-loading">Couldn't load this resume: {loadError}</div>;
  if (loading) return <div className="ed-loading">Loading editor…</div>;

  const defaultResume = resumes.find((r) => r.isDefault) || resume;
  const viewUrl = publicUrl(resume, window.location, { landingShown });

  return (
    <div className="ed-shell" style={resizingPane ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
      <header className="ed-topbar">
        <div className="ed-resume-switcher">
          <ResumeSelect resumes={resumes} value={resume.id} onChange={handleSwitch} disabled={switching} />
          <button className="ed-btn ed-btn-ghost" onClick={() => setResumeSettingsOpen(true)} disabled={switching}>
            Resume settings
          </button>
          <button className="ed-btn ed-btn-ghost" onClick={() => setNewResumeOpen(true)} disabled={switching}>
            New resume
          </button>
          <button
            className="ed-btn ed-btn-ghost"
            onClick={() => afterSaving(onOpenLetters)}
            disabled={switching}
            title="Write cover letters that go with this resume"
          >
            Cover letters
          </button>
          {aiSettings?.available && (
            <button
              className="ed-btn ed-btn-ghost"
              onClick={() => setTailorOpen(true)}
              disabled={switching || tailoringNow}
              title="Rewrite this resume's sections for an audience or a job posting, for you to review"
            >
              Tailor…
            </button>
          )}
          {resume.tailoring && (
            <span className="ed-tailored-chip" title={resume.tailoring.posting ? 'Tailored for a job posting too' : undefined}>
              Tailored for {resume.tailoring.audience}
            </span>
          )}
        </div>
        <div className="ed-topbar-status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'idle' && (isDirty ? 'Unpublished changes' : `Published ${timeAgo(publishedAt) || 'never'}`)}
          {publishError && <span className="ed-topbar-warning"> · {publishError}</span>}
          {!publishError && pdfPending && (
            <span title="The site is updated. Its PDF is waiting for an earlier render to finish, and the Download PDF link still gets the previous one.">
              {' '}
              · PDF rendering…
            </span>
          )}
          {!publishError && !pdfPending && pdfStale && (
            <span className="ed-topbar-warning" title="The last publish updated the site but its PDF render failed. Publish again to re-render it.">
              {' '}
              · PDF out of date
            </span>
          )}
        </div>
        <div className="ed-topbar-actions">
          {/* A resume never published has nothing to go back to (and is
              always "dirty": a new one starts that way). */}
          {isDirty && publishedAt && (
            <button className="ed-btn ed-btn-ghost" onClick={handleDiscard}>
              Discard changes
            </button>
          )}
          <button className="ed-btn ed-btn-primary" onClick={handlePublish} disabled={publishState === 'publishing'}>
            {publishState === 'publishing' && 'Publishing…'}
            {publishState === 'published' && 'Published'}
            {publishState === 'idle' && 'Publish'}
          </button>
          {viewUrl ? (
            <a className="ed-btn ed-btn-ghost" href={viewUrl} target="_blank" rel="noreferrer">
              View public site
            </a>
          ) : (
            <span
              className="ed-btn ed-btn-ghost ed-btn-inert"
              title={resume.isPublic ? 'Publish it to give it a public page.' : 'Private: only you can see it, here and in its PDF.'}
            >
              {resume.isPublic ? 'Not published yet' : 'Private'}
            </span>
          )}
          {/* No file yet (never published, or its only render failed): the
              link would leave the editor for a JSON 404. */}
          {pdfVersion ? (
            <a className="ed-btn ed-btn-ghost" href={pdfUrl(pdfVersion, rapi.pdfPath)}>
              Download PDF
            </a>
          ) : (
            <span className="ed-btn ed-btn-ghost ed-btn-inert" title="Publish it to render its PDF.">
              No PDF yet
            </span>
          )}
          <button className="ed-btn ed-btn-ghost" onClick={() => setSettingsOpen(true)}>
            Account Settings
          </button>
          <button className="ed-btn ed-btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {tailorRun && (
        <div className="ed-tailor-bar" role="status">
          <span className="ed-tailor-bar-text">
            {!tailorRun.finished
              ? `Tailoring for “${tailorRun.brief.audience}”: ${tailorRun.done + tailorRun.skipped + tailorRun.failed.length} of ${tailorRun.total}…`
              : tailorRun.cancelled
                ? tailorRun.done === 0
                  ? 'Tailoring cancelled before any rewrite came back.'
                  : `Tailoring cancelled: ${tailorRun.done} of ${tailorRun.total} rewritten. Review them in the preview.`
                : tailorRun.total === 0
                  ? 'Nothing to tailor: no section of the chosen kinds has text to work from.'
                  : `Tailored for “${tailorRun.brief.audience}”: ${tailorRun.done} of ${tailorRun.total} ready to review in the preview.${
                      tailorRun.skipped
                        ? ` ${tailorRun.skipped} skipped: rewritten some other way or deleted meanwhile.`
                        : ''
                    }`}
          </span>
          {tailorRun.finished && tailorRun.failed.length > 0 && (
            <span className="ed-tailor-bar-failed">
              {tailorRun.failed.length} failed: {tailorRun.failed.map(({ item, error }) => `${item.label} (${error})`).join('; ')}
            </span>
          )}
          {!tailorRun.finished ? (
            <button type="button" className="ed-btn ed-btn-ghost" onClick={cancelTailoring}>
              Cancel
            </button>
          ) : (
            <>
              {tailorRun.failed.length > 0 && !tailorRun.cancelled && (
                <button
                  type="button"
                  className="ed-btn ed-btn-ghost"
                  // Not one rewritten some other way since it failed: its
                  // panel holds a request in flight or a rewrite to review.
                  onClick={() =>
                    startTailoring(
                      tailorRun.brief,
                      tailorRun.failed
                        .map(({ item }) => item)
                        .filter((item) => !['loading', 'ready'].includes(aiProposals[proposalKey(item.blockId, item.target)]?.status))
                    )
                  }
                >
                  Retry {tailorRun.failed.length === 1 ? 'it' : 'them'}
                </button>
              )}
              <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setTailorRun(null)}>
                Dismiss
              </button>
            </>
          )}
        </div>
      )}

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
                // The brief this resume was tailored for: a panel offers to
                // tailor its rewrite to it ("Tailor for …", on by default).
                tailoring: resume.tailoring,
                onRequest: (blockId, target, instruction, tense, pickedTense, { tailored = false } = {}) =>
                  handleAiRequest(blockId, target, instruction, tense, pickedTense, {
                    brief: tailored ? resume.tailoring : null,
                  }),
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
                  : `Previewing ${previewed.length} AI rewrites (outlined) — not saved yet.`}
                {acceptAll?.skipped.length > 0 &&
                  ` ${acceptAll.skipped.length} ${acceptAll.skipped.length === 1 ? 'is' : 'are'} for a part you've edited since or can't be previewed: accept ${
                    acceptAll.skipped.length === 1 ? 'it' : 'those'
                  } in ${acceptAll.skipped.length === 1 ? 'its' : 'their'} block.`}
              </span>
              <button
                type="button"
                className="ed-btn ed-btn-ghost"
                // Every rewrite, not just the ready ones: one still in flight
                // would otherwise turn up in the preview after "Discard all",
                // and so would the rest of a tailoring run.
                onClick={() => {
                  runnerRef.current?.cancel();
                  dropAiProposals(() => true);
                  setTailorRun(null); // it pointed at rewrites that are gone
                }}
              >
                {openRewriteCount === 1 ? 'Discard' : 'Discard all'}
              </button>
              {soleReadyKey && (
                <button type="button" className="ed-btn ed-btn-primary" onClick={() => handleAiAccept(soleReadyKey)}>
                  Accept
                </button>
              )}
              {acceptAll?.accepted.length > 0 && (
                <button type="button" className="ed-btn ed-btn-primary" onClick={handleAcceptAll}>
                  Accept all ({acceptAll.accepted.length})
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

      {newResumeOpen && (
        <NewResumeModal
          resume={resume}
          defaultResume={defaultResume}
          blocks={blocks}
          ai={aiSettings}
          onCreate={handleCreateResume}
          onClose={() => setNewResumeOpen(false)}
        />
      )}
      {tailorOpen && (
        <TailorModal
          resume={resume}
          blocks={blocks}
          limits={aiSettings?.briefLimits}
          onTailor={handleTailor}
          onClose={() => setTailorOpen(false)}
        />
      )}
      {resumeSettingsOpen && (
        <ResumeSettingsModal
          resume={resume}
          defaultResume={defaultResume}
          landingShown={landingShown}
          onChanged={onResumesChanged}
          onDeleted={handleResumeDeleted}
          onClose={() => setResumeSettingsOpen(false)}
        />
      )}
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
