import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { LandingView } from '../landing/LandingView.jsx';
import { resolveLanding } from '../landing/resolveLanding.js';
import { LandingForm } from './LandingForm.jsx';
import { ResumeSelect } from './ResumeSelect.jsx';
import { createSaveQueue } from './saveQueue.js';
import { LANDING_PAGE, landingShown } from './resumeLinks.js';

const SAVE_DEBOUNCE_MS = 500;

// The editor for the install's landing page (issue #70), opened from the
// switcher as /editor?page=landing. Like EditorPage it's mounted fresh each
// time and keeps its edits in its own save queue, flushed before a switch,
// a publish, a discard and a logout, and sent on unmount. Its draft and
// publish are separate from every resume's. `onStatus(status)` tells
// ResumesEditor where it stands, so a resume's "View public site" knows
// whether the default is at / or /resume.
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
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // A save still waiting goes out on unmount (a switch it didn't start).
  useEffect(() => () => saves.runWaiting(), [saves]);

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
  const preview = resolveLanding(landing, loaded.context);

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
              />
            </div>
          </section>
        </div>
        <div className="ed-right-pane" style={{ borderLeft: '1px solid var(--line)' }}>
          <div className="ed-preview-label">
            Draft preview — colors and fonts come from your default resume's published site settings
          </div>
          <div className="ed-preview-frame">
            <LandingView landing={preview} preview />
          </div>
        </div>
      </div>
    </div>
  );
}
