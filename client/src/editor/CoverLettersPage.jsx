import { useEffect, useMemo, useRef, useState } from 'react';
import { api, resumeApi } from '../api.js';
import { CoverLetterView } from '../letters/CoverLetterView.jsx';
import { letterText, letterToday } from '../letters/letterParts.js';
import {
  applyLetterProposal,
  isLetterProposalStale,
  letterProposalKey,
  letterSlice,
  letterTargetKey,
  previewLetterData,
  previewedLetterProposals,
  relocateParagraph,
} from '../letters/letterAi.js';
import { CoverLetterForm } from './CoverLetterForm.jsx';
import { ResumeSelect } from './ResumeSelect.jsx';
import { createSaveQueue } from './saveQueue.js';
import { useLeaveGuard } from './useLeaveGuard.js';
import { lettersUnsavedWork } from './unsavedWork.js';
import { AppVersion } from './AppVersion.jsx';

const SAVE_DEBOUNCE_MS = 500;
// A download stuck behind another render is a 503 after the server's wait
// (about 20 s); it's asked for again this often, this many times, which
// covers two full render timeouts before giving up.
const PDF_RETRY_MS = 3000;
const PDF_RETRIES = 10;

const letterKey = (id) => `letter:${id}`;

// One resume's cover letters (issue #71), at /editor?page=letters (with
// the resume's ?resume=). ResumesEditor mounts a fresh one per resume, like
// EditorPage, and every edit goes through this page's save queue: a switch,
// Back, a duplicate (the server copies the stored letter), a PDF download
// and Log out all flush it first, and unmounting sends what's still
// waiting. Leaving goes through useLeaveGuard, which also asks before
// dropping an AI proposal not accepted yet. Letters aren't drafted or
// published, so there's no Publish: a saved edit is the letter. The
// preview uses the resume's draft header and look, as the PDF does.
//
// With an AI provider set up, a letter can be drafted or rewritten whole,
// or a paragraph at a time (letters/letterAi.js). Proposals are held here,
// per letter and target, shown in the preview, and saved through the same
// save queue when accepted; nothing reaches the server before that.
export function CoverLettersPage({ resume, resumes, onSwitch, onBack, onLogout }) {
  const rapi = useMemo(() => resumeApi(resume.id), [resume.id]);
  const saves = useMemo(() => createSaveQueue({ delayMs: SAVE_DEBOUNCE_MS }), []);
  const [letters, setLetters] = useState(null);
  const [header, setHeader] = useState(null);
  const [site, setSite] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [notice, setNotice] = useState(null); // a short-lived "Copied" and the like
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const mountedRef = useRef(true);
  const noticeTimer = useRef(null);
  // Letters deleted here: a save of one still in flight then fails, and
  // that's no news.
  const deletedRef = useRef(new Set());
  const [aiSettings, setAiSettings] = useState(null);
  // Open AI requests and proposals, by letterProposalKey(letterId, target):
  // { letterId, target, instruction, brief, requestId, status: 'loading' |
  // 'ready' | 'error', proposal, error }.
  const [aiEntries, setAiEntries] = useState({});
  // The request each key is waiting on, so a newer one (or a discard)
  // supersedes a response still in flight.
  const aiRequestsRef = useRef({});
  const aiCounterRef = useRef(0);
  // The letters as last rendered, for a request reading the data to send.
  const lettersRef = useRef(letters);
  lettersRef.current = letters;
  const guard = useLeaveGuard({ saves, resumes, work: lettersUnsavedWork({ letters, aiEntries }) });

  useEffect(() => {
    mountedRef.current = true;
    Promise.all([rapi.listCoverLetters(), rapi.getHeader(), rapi.getSite()])
      .then(([{ coverLetters }, { header: h }, { site: s }]) => {
        if (!mountedRef.current) return;
        setLetters(coverLetters);
        setHeader(h);
        setSite(s);
      })
      .catch((err) => mountedRef.current && setLoadError(err.message));
    // Without them there's no AI writing; the letters work as before.
    api
      .getAiSettings()
      .then(({ ai }) => mountedRef.current && setAiSettings(ai))
      .catch((err) => console.error('Failed to load AI settings', err));
    return () => {
      mountedRef.current = false;
      clearTimeout(noticeTimer.current);
    };
  }, [rapi]);

  // A save still waiting goes out on unmount (a switch it didn't start).
  useEffect(() => () => saves.runWaiting(), [saves]);

  function flash(message) {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => mountedRef.current && setNotice(null), 2000);
  }

  function flashSaved() {
    if (!mountedRef.current) return;
    setSaveState('saved');
    setTimeout(() => mountedRef.current && setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
  }

  function failed(err, fallback) {
    if (!mountedRef.current) return;
    setError(err?.message || fallback);
  }

  function handleChange(next) {
    setLetters((list) => list.map((l) => (l.id === next.id ? next : l)));
    setError(null);
    setSaveState('saving');
    // A blank title can't be saved (the server needs one): the stored one
    // stays until there's a new one to send.
    const patch = next.title.trim() ? { title: next.title, data: next.data } : { data: next.data };
    saves.schedule(letterKey(next.id), () =>
      saves.track(rapi.updateCoverLetter(next.id, patch), letterKey(next.id)).then(flashSaved, (err) => {
        if (mountedRef.current) setSaveState('idle');
        if (!deletedRef.current.has(next.id)) failed(err, 'Save failed');
      })
    );
  }

  // Gets every edit to the server first, then does `next`. A save that
  // failed stops it unless confirmed.
  async function afterSaving(next) {
    setBusy(true);
    try {
      const failures = await saves.flush();
      if (failures.length && !window.confirm(`A change didn't save (${failures[0].message || 'unknown error'}). Go on without it?`)) return;
      await next();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function create(input) {
    try {
      const { coverLetter } = await saves.track(rapi.createCoverLetter(input));
      if (!mountedRef.current) return;
      setLetters((list) => [...list, coverLetter]);
      setSelectedId(coverLetter.id);
      setError(null);
    } catch (err) {
      failed(err, "Couldn't create the cover letter");
    }
  }

  function handleNew() {
    return create({});
  }

  // The server copies the letter as stored, so its edits go first.
  function handleDuplicate(letter) {
    return afterSaving(() => create({ copyFrom: letter.id }));
  }

  async function handleDelete(letter) {
    if (!window.confirm(`Delete “${letter.title.trim() || 'Untitled'}”? This can't be undone.`)) return;
    deletedRef.current.add(letter.id);
    if (saves.forget((key) => key === letterKey(letter.id))) setSaveState('idle');
    try {
      await saves.track(rapi.deleteCoverLetter(letter.id));
    } catch (err) {
      // Already gone is what was asked for.
      if (err.status !== 404) {
        deletedRef.current.delete(letter.id);
        return failed(err, "Couldn't delete it");
      }
    }
    if (!mountedRef.current) return;
    dropAi((entry) => entry.letterId === letter.id);
    setLetters((list) => list.filter((l) => l.id !== letter.id));
  }

  function dropAi(match) {
    for (const [key, request] of Object.entries(aiRequestsRef.current)) {
      if (match(request)) delete aiRequestsRef.current[key];
    }
    setAiEntries((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, entry]) => !match(entry)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }

  // Sends what's on screen for the letter (its save may still be waiting),
  // and keeps the result unless a newer request for the same spot, or a
  // discard, came since.
  async function handleAiRequest(letterId, target, { instruction, brief }) {
    const letter = lettersRef.current.find((l) => l.id === letterId);
    if (!letter) return;
    const key = letterProposalKey(letterId, target);
    const id = ++aiCounterRef.current;
    aiRequestsRef.current[key] = { id, letterId, target };
    const settle = (patch) => {
      if (aiRequestsRef.current[key]?.id !== id || !mountedRef.current) return;
      if (patch.status !== 'loading') delete aiRequestsRef.current[key];
      setAiEntries((prev) => ({
        ...prev,
        [key]: { letterId, target, instruction, brief, requestId: id, proposal: null, error: null, ...patch },
      }));
    };
    settle({ status: 'loading' });
    try {
      const { proposal } = await rapi.rewriteCoverLetter(letterId, { data: letter.data, target, instruction, brief });
      settle({ status: 'ready', proposal });
    } catch (err) {
      settle({ status: 'error', error: err.message || 'AI writing failed' });
    }
  }

  function handleAiReject(letterId, target) {
    const key = letterProposalKey(letterId, target);
    dropAi((entry) => letterProposalKey(entry.letterId, entry.target) === key);
  }

  // True once the proposal is applied (and on its way to the server).
  function handleAiAccept(letterId, target) {
    const entry = aiEntries[letterProposalKey(letterId, target)];
    const letter = letters.find((l) => l.id === letterId);
    if (!letter || !entry?.proposal) {
      handleAiReject(letterId, target);
      return false;
    }
    const { proposal } = entry;
    if (letterSlice(letter.data, proposal.target) === null) {
      window.alert("The paragraph this rewrite was for is no longer there, so it can't be applied.");
      handleAiReject(letterId, target);
      return false;
    }
    if (
      isLetterProposalStale(proposal, letter.data) &&
      !window.confirm(
        proposal.target.kind === 'paragraph'
          ? "You've edited this paragraph since the rewrite was written. Replace your edits with the rewrite?"
          : "You've edited the letter since this was written. Replace its salutation, body and closing with it?"
      )
    ) {
      return false;
    }
    handleChange({ ...letter, data: applyLetterProposal(letter.data, proposal) });
    handleAiReject(letterId, target);
    return true;
  }

  // Keeps a paragraph proposal on its paragraph when paragraphs move (a
  // drag, a removal, one added above): each change to a letter is checked
  // against the data the proposal was last placed against (anchorData),
  // which then advances, so every check resolves a single change (see
  // relocateParagraph). One whose paragraph is gone is dropped.
  useEffect(() => {
    if (!letters) return;
    const moves = [];
    const dropped = [];
    for (const [key, entry] of Object.entries(aiEntries)) {
      if (entry.status !== 'ready' || entry.target.kind !== 'paragraph') continue;
      const letter = letters.find((l) => l.id === entry.letterId);
      if (!letter || (entry.proposal.anchorData ?? entry.proposal.baseData) === letter.data) continue;
      const target = relocateParagraph(entry.proposal, letter.data);
      if (target === null) dropped.push(key);
      else moves.push({ key, entry, target, anchorData: letter.data });
    }
    if (!moves.length && !dropped.length) return;
    setAiEntries((prev) => {
      const next = { ...prev };
      for (const key of dropped) delete next[key];
      for (const { key } of moves) delete next[key];
      for (const { entry, target, anchorData } of moves) {
        const newKey = letterProposalKey(entry.letterId, target);
        // Two proposals can't share a paragraph; the one already there wins.
        if (next[newKey]) continue;
        const origin = entry.proposal.origin || entry.proposal.target;
        next[newKey] = { ...entry, target, proposal: { ...entry.proposal, target, origin, anchorData } };
      }
      return next;
    });
  }, [letters, aiEntries]);

  // Rendered by the server on request, so it's fetched rather than linked:
  // a render takes a few seconds, and an error is shown here instead of
  // leaving the editor for a JSON page. A 503 means the render is still
  // queued behind another one and carries on without us, so it's asked for
  // again until it's done (or the page is closed).
  function handleDownload(letter) {
    return afterSaving(async () => {
      setRendering(true);
      setError(null);
      try {
        let res = await fetch(rapi.coverLetterPdfPath(letter.id), { credentials: 'include' });
        for (let tries = 0; res.status === 503 && tries < PDF_RETRIES; tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, PDF_RETRY_MS));
          if (!mountedRef.current) return;
          res = await fetch(rapi.coverLetterPdfPath(letter.id), { credentials: 'include' });
        }
        if (!mountedRef.current) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed: ${res.status}`);
        }
        const blob = await res.blob();
        const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Cover-Letter.pdf';
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        failed(err, "Couldn't make the PDF");
      } finally {
        if (mountedRef.current) setRendering(false);
      }
    });
  }

  async function handleCopyText(letter) {
    const text = letterText(letter.data, header, letterToday());
    try {
      await copyToClipboard(text);
      flash('Copied the letter as text');
    } catch {
      setError("Couldn't copy: your browser didn't allow it");
    }
  }

  // Leaves through the guard: saves first, then asks about a failed save
  // and about proposals not accepted yet.
  async function leaveFor(next) {
    setBusy(true);
    try {
      await guard.leave(next);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function handleSwitch(id) {
    leaveFor(() => onSwitch(id));
  }

  function handleLogout() {
    return leaveFor(async () => {
      await api.logout();
      onLogout();
    });
  }

  if (loadError) return <div className="ed-loading">Couldn't load the cover letters: {loadError}</div>;
  if (!letters) return <div className="ed-loading">Loading cover letters…</div>;

  // The one picked, or the first (none picked yet, or it was deleted).
  const selected = letters.find((l) => l.id === selectedId) || letters[0] || null;

  // The selected letter's AI writing, for its form and the preview.
  const selectedEntries = selected
    ? Object.fromEntries(
        Object.values(aiEntries)
          .filter((entry) => entry.letterId === selected.id)
          .map((entry) => [letterTargetKey(entry.target), entry])
      )
    : {};
  const readyProposals = Object.values(selectedEntries)
    .filter((entry) => entry.status === 'ready')
    .map((entry) => entry.proposal);
  const previewed = selected ? previewedLetterProposals(selected.data, readyProposals) : [];
  const ai =
    selected && aiSettings?.available
      ? {
          entries: selectedEntries,
          previewedKeys: new Set(previewed.map((p) => letterTargetKey(p.target))),
          tailoring: resume.tailoring || null,
          briefLimits: aiSettings.briefLimits,
          onRequest: (target, request) => handleAiRequest(selected.id, target, request),
          onAccept: (target) => handleAiAccept(selected.id, target),
          onReject: (target) => handleAiReject(selected.id, target),
        }
      : null;

  return (
    <div className="ed-shell">
      <header className="ed-topbar">
        <div className="ed-resume-switcher">
          <ResumeSelect resumes={resumes} value={resume.id} onChange={handleSwitch} disabled={busy} />
          <button className="ed-btn ed-btn-ghost" onClick={() => leaveFor(onBack)} disabled={busy}>
            ← Back to resume
          </button>
        </div>
        <div className="ed-topbar-status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'idle' && (rendering ? 'Rendering PDF…' : notice || 'Cover letters are private')}
          {error && <span className="ed-topbar-warning"> · {error}</span>}
        </div>
        <div className="ed-topbar-actions">
          {/* Kept together so the version never wraps onto a line alone. */}
          <span className="ed-topbar-end">
            <button className="ed-btn ed-btn-ghost" onClick={handleLogout} disabled={busy}>
              Log out
            </button>
            <AppVersion />
          </span>
        </div>
      </header>

      <div className="ed-columns" style={{ gridTemplateColumns: '480px 1fr' }}>
        <div className="ed-left-pane">
          <section className="ed-panel">
            <div className="ed-panel-label">Cover letters for {resume.name}</div>
            <div className="ed-panel-body">
              {letters.length === 0 && <p className="ed-field-hint">None yet. Each one is drawn under this resume's header, in its look.</p>}
              <ul className="ed-letter-list">
                {letters.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      className={`ed-letter-item${l.id === selected?.id ? ' ed-letter-item-active' : ''}`}
                      aria-current={l.id === selected?.id ? 'true' : undefined}
                      onClick={() => setSelectedId(l.id)}
                    >
                      {l.title.trim() || 'Untitled'}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="ed-btn ed-btn-ghost" onClick={handleNew} disabled={busy}>
                + New cover letter
              </button>
            </div>
          </section>

          {selected && (
            <section className="ed-panel">
              <div className="ed-panel-label">{selected.title.trim() || 'Untitled'}</div>
              <div className="ed-panel-body">
                <div className="ed-letter-actions">
                  <button type="button" className="ed-btn ed-btn-primary" onClick={() => handleDownload(selected)} disabled={busy || rendering}>
                    {rendering ? 'Rendering…' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    className="ed-btn ed-btn-ghost"
                    onClick={() => handleCopyText(selected)}
                    title="Copies the letter from the salutation to the signature, for an application form's text box"
                  >
                    Copy text
                  </button>
                  <button type="button" className="ed-btn ed-btn-ghost" onClick={() => handleDuplicate(selected)} disabled={busy}>
                    Duplicate
                  </button>
                  <button type="button" className="ed-btn ed-btn-ghost" onClick={() => handleDelete(selected)} disabled={busy}>
                    Delete
                  </button>
                </div>
                <CoverLetterForm key={selected.id} letter={selected} headerName={header?.name} onChange={handleChange} ai={ai} />
              </div>
            </section>
          )}
        </div>
        <div className="ed-right-pane" style={{ borderLeft: '1px solid var(--line)' }}>
          {selected ? (
            <>
              <div className="ed-preview-label">
                {previewed.length
                  ? 'Previewing the AI’s suggestion (outlined): not saved until you accept it'
                  : "Preview — this resume's draft header, colors and fonts"}
              </div>
              <div className="ed-preview-frame">
                <CoverLetterView
                  header={header}
                  site={site}
                  letter={previewed.length ? previewLetterData(selected.data, previewed) : selected.data}
                  today={letterToday()}
                  mode="preview"
                  highlighted={previewed.length > 0}
                />
              </div>
            </>
          ) : (
            <div className="ed-preview-label">Create a cover letter to see it here.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// The Clipboard API needs a secure context (https or localhost); an editor
// reached over plain http on a LAN address falls back to a hidden textarea.
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy refused');
}
