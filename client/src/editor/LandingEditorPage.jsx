import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { LandingView } from '../landing/LandingView.jsx';
import { resolveLanding } from '../landing/resolveLanding.js';
import { LandingForm } from './LandingForm.jsx';
import { ResumeSelect } from './ResumeSelect.jsx';
import { createSaveQueue } from './saveQueue.js';
import { LANDING_PAGE, landingShown } from './resumeLinks.js';
import {
  anchorFor,
  highlightIds,
  introParts,
  locateRequest,
  placeProposals,
  previewLanding,
  requestSpot,
  rewriteCopy,
  setLandingSlice,
  targetKey,
} from './landingAi.js';

const SAVE_DEBOUNCE_MS = 500;

// The editor for the install's landing page (issue #70), opened from the
// switcher as /editor?page=landing. Like EditorPage it's mounted fresh each
// time and keeps its edits in its own save queue, flushed before a switch,
// a publish, a discard and a logout, and sent on unmount. Its draft and
// publish are separate from every resume's. `onStatus(status)` tells
// ResumesEditor where it stands, so a resume's "View public site" knows
// whether the default is at / or /resume.
//
// AI rewrites (issue #73, landingAi.js) are held here, so the preview can
// show them: `aiRequests` by the spot each was asked for (its status, shown
// wherever that spot is now), and
// `aiProposals`, the suggestions that came back, until each is accepted or
// discarded. Nothing reaches the server until an accept saves the draft.
export function LandingEditorPage({ resumes, onSwitch, onStatus, onLogout }) {
  const saves = useMemo(() => createSaveQueue({ delayMs: SAVE_DEBOUNCE_MS }), []);
  const [loaded, setLoaded] = useState(null); // { context, limits }
  const [loadError, setLoadError] = useState(null);
  const [landing, setLanding] = useState(null);
  const [status, setStatusState] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [publishState, setPublishState] = useState('idle'); // idle | publishing | published
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const [aiRequests, setAiRequests] = useState({});
  const [aiProposals, setAiProposals] = useState([]);
  // The latest request per spot: a response to an older one (or one
  // cancelled since) is dropped.
  const aiLatestRef = useRef({});
  const aiCounterRef = useRef(0);
  const landingRef = useRef(landing);
  landingRef.current = landing;
  const mountedRef = useRef(true);

  function setStatus(next) {
    setStatusState(next);
    onStatus?.(next);
  }

  useEffect(() => {
    mountedRef.current = true;
    api
      .getLanding()
      .then(({ landing: draft, status: current, context, limits }) => {
        if (!mountedRef.current) return;
        setLanding(draft);
        setStatus(current);
        setLoaded({ context, limits });
      })
      .catch((err) => mountedRef.current && setLoadError(err.message));
    // Without them the ✨ buttons just stay hidden.
    api
      .getAiSettings()
      .then(({ ai }) => mountedRef.current && setAiSettings(ai))
      .catch((err) => console.error('Failed to load AI settings', err));
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // A save still waiting goes out on unmount (a switch it didn't start).
  useEffect(() => () => saves.runWaiting(), [saves]);

  // A suggestion whose spot is gone (its section, card or item removed) is
  // dropped rather than left where nothing shows it.
  useEffect(() => {
    if (!landing || !aiProposals.length) return;
    const kept = new Set(placeProposals(landing, aiProposals).map((p) => p.proposal.id));
    if (kept.size < aiProposals.length) setAiProposals((prev) => prev.filter((p) => kept.has(p.id)));
  }, [landing, aiProposals]);

  function flashSaved() {
    if (!mountedRef.current) return;
    setSaveState('saved');
    setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
  }

  function saveFailed(err) {
    if (!mountedRef.current) return;
    setSaveState('idle');
    setError(err.message || 'Save failed');
  }

  function handleChange(next) {
    setLanding(next);
    setStatus({ ...status, isDirty: true });
    setError(null);
    setSaveState('saving');
    saves.schedule('landing', () => saves.track(api.putLanding(next), 'landing').then(flashSaved, saveFailed));
  }

  // Gets every edit to the server first; a save that failed stops here
  // unless confirmed, so nothing goes on without an edit unnoticed.
  async function afterSaving(next, { confirmFailed = true } = {}) {
    setBusy(true);
    try {
      const failed = await saves.flush();
      if (failed.length) {
        const message = failed[0].message || 'unknown error';
        if (!confirmFailed) {
          setError(message);
          return;
        }
        if (!window.confirm(`A change didn't save (${message}). Go on without it?`)) return;
      }
      await next();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function handlePublish() {
    // Publishing past a failed save would publish something other than
    // what's on screen, so a failure stops it outright.
    return afterSaving(
      async () => {
        setPublishState('publishing');
        setError(null);
        try {
          setStatus(await api.publishLanding());
          setPublishState('published');
          setTimeout(() => setPublishState((s) => (s === 'published' ? 'idle' : s)), 1500);
        } catch (err) {
          setPublishState('idle');
          setError(err.message || 'Publish failed');
        }
      },
      { confirmFailed: false }
    );
  }

  async function handleDiscard() {
    await saves.flush();
    try {
      const { landing: draft, status: current } = await api.discardLandingDraft();
      if (saves.forget(() => true)) setSaveState('idle');
      clearAi();
      setLanding(draft);
      setStatus(current);
      setError(null);
    } catch (err) {
      setError(err.message || 'Discard failed');
    }
  }

  async function handleToggle(enabled) {
    const message = enabled
      ? `Show the landing page at / ?\n\nYour default resume moves to /resume.${
          status.publishedAt ? '' : ' Nothing changes until you publish the landing page.'
        } Resumes with their own domain keep showing there.`
      : 'Stop showing the landing page? / shows your default resume again.';
    if (!window.confirm(message)) return;
    setError(null);
    try {
      setStatus(await api.setLandingEnabled(enabled));
    } catch (err) {
      setError(err.message || "Couldn't change it");
    }
  }

  function clearAi() {
    aiLatestRef.current = {};
    setAiRequests({});
    setAiProposals([]);
  }

  // One request for `target`'s spot, on the draft as it is on screen,
  // tracked as `key`: the key of the request it replaces at that spot, or
  // one of its own. Its suggestions replace any already open for the spots
  // it writes (an intro's three, or just its own).
  async function handleAiRequest(target, instruction, replacing) {
    const id = ++aiCounterRef.current;
    const key = replacing ?? `${targetKey(target)}#${id}`;
    aiLatestRef.current[key] = id;
    const sent = landingRef.current;
    const request = { id, ...requestSpot(sent, target), instruction };
    setAiRequests((prev) => ({ ...prev, [key]: { ...request, status: 'loading' } }));
    let result;
    try {
      result = await api.landingRewrite(rewriteCopy(sent), target, instruction);
    } catch (err) {
      if (mountedRef.current && aiLatestRef.current[key] === id) {
        setAiRequests((prev) => ({ ...prev, [key]: { ...request, status: 'error', error: err.message } }));
      }
      return;
    }
    if (!mountedRef.current || aiLatestRef.current[key] !== id) return;
    const { proposals, explanation } = result;
    const parts = target.kind === 'intro' ? introParts(target.sectionId) : [target];
    setAiProposals((prev) => {
      // Where the spots it wrote are now: an item may have moved meanwhile.
      const now = landingRef.current;
      const spots = new Set(
        parts.flatMap((part) => {
          const at = locateRequest(now, requestSpot(sent, part));
          return at ? [targetKey(at)] : [];
        })
      );
      const replaced = new Set(
        placeProposals(now, prev)
          .filter((p) => spots.has(p.key))
          .map((p) => p.proposal.id)
      );
      return [
        ...prev.filter((p) => !replaced.has(p.id)),
        ...proposals.map((p) => ({
          ...p,
          id: `${id}:${targetKey(p.target)}`,
          requestKey: key,
          via: target.kind,
          explanation,
          anchor: anchorFor(sent, p.target),
        })),
      ];
    });
    setAiRequests((prev) => ({ ...prev, [key]: { ...request, status: 'ready', explanation, count: proposals.length } }));
  }

  // Drops a spot's request, so a response still on its way is ignored.
  function handleAiCancel(key) {
    delete aiLatestRef.current[key];
    setAiRequests(({ [key]: _gone, ...rest }) => rest);
  }

  // A field's own request is done with once its suggestion is; an intro's
  // stays until the last of its suggestions is.
  function dropProposals(ids) {
    const done = aiProposals.filter((p) => ids.has(p.id));
    const left = aiProposals.filter((p) => !ids.has(p.id));
    setAiProposals(left);
    for (const p of done) {
      if (p.via !== 'intro' || !left.some((q) => q.requestKey === p.requestKey)) handleAiCancel(p.requestKey);
    }
  }

  function handleAiAccept(proposalId) {
    const placed = placeProposals(landing, aiProposals).find((p) => p.proposal.id === proposalId);
    if (!placed) return dropProposals(new Set([proposalId]));
    if (placed.stale && !window.confirm("You've edited this since the AI wrote its suggestion. Replace your edits with it?")) return;
    handleChange(setLandingSlice(landing, placed.located, placed.proposal.after));
    dropProposals(new Set([proposalId]));
  }

  // Everything the preview shows; a suggestion for a spot edited since stays
  // open, to be accepted on its own.
  function handleAiAcceptAll() {
    const shown = placeProposals(landing, aiProposals).filter((p) => !p.stale);
    handleChange(previewLanding(landing, shown));
    dropProposals(new Set(shown.map((p) => p.proposal.id)));
  }

  function handleSwitch(id) {
    if (id === LANDING_PAGE) return;
    afterSaving(() => onSwitch(id));
  }

  function handleLogout() {
    return afterSaving(async () => {
      await api.logout();
      onLogout();
    });
  }

  if (loadError) return <div className="ed-loading">Couldn't load the landing page: {loadError}</div>;
  if (!landing || !loaded) return <div className="ed-loading">Loading editor…</div>;

  const shown = landingShown(status);
  const aiPlaced = placeProposals(landing, aiProposals);
  const aiPreviewed = aiPlaced.filter((p) => !p.stale);
  const preview = resolveLanding(previewLanding(landing, aiPlaced), loaded.context, { withIds: true, withHidden: true });
  // Each request by where its spot is now (the newest, should two meet),
  // with the key it's tracked by.
  const aiRequestAt = new Map();
  for (const [key, request] of Object.entries(aiRequests)) {
    const at = locateRequest(landing, request);
    const spot = at && targetKey(at);
    if (spot && !(aiRequestAt.get(spot)?.id > request.id)) aiRequestAt.set(spot, { ...request, key });
  }
  const ai = {
    available: Boolean(aiSettings?.available),
    requestFor: (key) => aiRequestAt.get(key) || null,
    // The newest suggestion for a spot, should two ever land on one.
    placedFor: (key) => aiPlaced.findLast((p) => p.key === key) || null,
    pendingFrom: (key) => {
      const tracked = aiRequestAt.get(key)?.key;
      return tracked ? aiProposals.filter((p) => p.requestKey === tracked).length : 0;
    },
    onRequest: (target, instruction) => handleAiRequest(target, instruction, aiRequestAt.get(targetKey(target))?.key),
    onAccept: handleAiAccept,
    onReject: (proposalId) => dropProposals(new Set([proposalId])),
    onCancel: (key) => handleAiCancel(aiRequestAt.get(key)?.key ?? key),
  };

  return (
    <div className="ed-shell">
      <header className="ed-topbar">
        <div className="ed-resume-switcher">
          <ResumeSelect resumes={resumes} value={LANDING_PAGE} onChange={handleSwitch} disabled={busy} />
          <label className="ed-landing-toggle" title="Whether / shows this page instead of your default resume">
            <input type="checkbox" checked={status.enabled} onChange={(e) => handleToggle(e.target.checked)} />
            Show at /
          </label>
        </div>
        <div className="ed-topbar-status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'idle' &&
            (status.isDirty || !status.publishedAt
              ? 'Unpublished changes'
              : `Published ${new Date(status.publishedAt).toLocaleString()}`)}
          {status.enabled && !status.publishedAt && <span className="ed-topbar-warning"> · Not shown until published</span>}
          {!status.enabled && status.publishedAt && ' · Switched off'}
          {error && <span className="ed-topbar-warning"> · {error}</span>}
        </div>
        <div className="ed-topbar-actions">
          {status.isDirty && status.publishedAt && (
            <button className="ed-btn ed-btn-ghost" onClick={handleDiscard} disabled={busy}>
              Discard changes
            </button>
          )}
          <button className="ed-btn ed-btn-primary" onClick={handlePublish} disabled={busy || publishState === 'publishing'}>
            {publishState === 'publishing' && 'Publishing…'}
            {publishState === 'published' && 'Published'}
            {publishState === 'idle' && 'Publish'}
          </button>
          {shown ? (
            <a className="ed-btn ed-btn-ghost" href="/" target="_blank" rel="noreferrer">
              View public site
            </a>
          ) : (
            <span className="ed-btn ed-btn-ghost ed-btn-inert" title="Publish it and switch on “Show at /” to show it.">
              Not shown
            </span>
          )}
          <button className="ed-btn ed-btn-ghost" onClick={handleLogout} disabled={busy}>
            Log out
          </button>
        </div>
      </header>

      <div className="ed-columns" style={{ gridTemplateColumns: '480px 1fr' }}>
        <div className="ed-left-pane">
          <section className="ed-panel">
            <div className="ed-panel-label">Landing page</div>
            <div className="ed-panel-body">
              <LandingForm
                landing={landing}
                resumes={resumes}
                context={loaded.context}
                limits={loaded.limits}
                onChange={handleChange}
                ai={ai}
              />
            </div>
          </section>
        </div>
        <div className="ed-right-pane" style={{ borderLeft: '1px solid var(--line)' }}>
          {aiPreviewed.length > 0 ? (
            <div className="ed-preview-label ed-ai-preview-banner">
              <span>
                {aiPreviewed.length === 1
                  ? 'Previewing an AI suggestion (outlined) — not saved yet.'
                  : `Previewing ${aiPreviewed.length} AI suggestions (outlined) — not saved yet.`}
                {aiPlaced.length > aiPreviewed.length &&
                  ` ${aiPlaced.length - aiPreviewed.length} more ${
                    aiPlaced.length - aiPreviewed.length === 1 ? 'is' : 'are'
                  } for text you've edited since: accept those under their fields.`}
              </span>
              <button type="button" className="ed-btn ed-btn-ghost" onClick={clearAi}>
                {aiProposals.length === 1 ? 'Discard' : 'Discard all'}
              </button>
              <button type="button" className="ed-btn ed-btn-primary" onClick={handleAiAcceptAll}>
                {aiPreviewed.length === 1 ? 'Accept' : `Accept all (${aiPreviewed.length})`}
              </button>
            </div>
          ) : (
            <div className="ed-preview-label">
              Draft preview — colors and fonts come from your default resume's published site settings
            </div>
          )}
          <div className="ed-preview-frame">
            <LandingView landing={preview} preview highlightIds={highlightIds(aiPlaced)} />
          </div>
        </div>
      </div>
    </div>
  );
}
