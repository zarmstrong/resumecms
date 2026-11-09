import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { EditorPage } from './EditorPage.jsx';
import { LandingEditorPage } from './LandingEditorPage.jsx';
import { CoverLettersPage } from './CoverLettersPage.jsx';
import { LANDING_PAGE, LETTERS_PAGE, editorParams, landingShown, pickResume } from './resumeLinks.js';

// The editor for whichever resume `?resume=<id>` names (issue #53), the
// default when it names none or one that's gone. EditorPage is keyed by
// the resume's id, so switching mounts a fresh one: nothing of the previous
// resume (its AI proposals, a debounce timer, a response still in flight)
// can land on the next. Each page leaves through useLeaveGuard (issue
// #105): it flushes its waiting saves and asks before dropping what it
// can't save, both for its own switches and for the browser's Back and
// Forward, which the guard blocks until then; this component's own
// rewriting of the address below stays on the same page, so it never
// is. A resume's cover letters (issue #71) are its ?page=letters, mounted
// the same way.
export function ResumesEditor({ onLogout }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [resumes, setResumes] = useState(null);
  const [error, setError] = useState(null);

  // Resolves with the new list, so a caller can switch to a resume it just
  // created only once the list knows it (pickResume would fall back to
  // the default otherwise). Reloads can overlap (publishing reloads without
  // waiting), so a response older than the list already shown is dropped:
  // it could lack a resume just created and send the editor to the default.
  const requested = useRef(0);
  const shown = useRef(0);
  const reload = useCallback(() => {
    const seq = ++requested.current;
    return api.listResumes().then(({ resumes: list }) => {
      if (seq > shown.current) {
        shown.current = seq;
        setResumes(list);
      }
      return list;
    });
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [reload]);

  // Whether the landing page holds `/` (issue #70), so the default resume's
  // public link points at /resume while it does. The landing page's own
  // editor keeps it current; failing to load it only costs that link.
  const [landingStatus, setLandingStatus] = useState(null);
  useEffect(() => {
    api.landingStatus().then(setLandingStatus, () => {});
  }, []);

  // The landing page has its own editor, at ?page=landing; a resume's
  // cover letters are at ?page=letters (with its ?resume=).
  const page = searchParams.get('page');
  const onLandingPage = page === LANDING_PAGE;
  const onLettersPage = page === LETTERS_PAGE;
  const requestedId = searchParams.get('resume');
  const current = resumes && pickResume(resumes, requestedId);

  // A tailoring run asked for with a new copy ({ resumeId, brief, types,
  // plan }, plan being the tailoring plan's options or null):
  // it runs in the copy's EditorPage, which only exists once the switch
  // below has mounted it, so it waits here until that one takes it.
  const [pendingTailor, setPendingTailor] = useState(null);
  // Whether the copy a pending run is for has been shown yet: once it has,
  // leaving it without the run starting (Back before it loaded, a load
  // error) drops the run rather than leave it to start on a later visit.
  const pendingShown = useRef(false);

  // The default lives at plain /editor, any other resume at ?resume=<id>.
  // A `list` that knows a resume the shown one doesn't (a create whose
  // reload failed) is adopted, or pickResume would open the default.
  const switchTo = useCallback(
    (id, list = resumes, tailor = null) => {
      if (id === LANDING_PAGE) {
        setPendingTailor(null);
        setSearchParams({ page: LANDING_PAGE });
        return;
      }
      const target = list.find((r) => r.id === id);
      if (target) setResumes((shownList) => (shownList.some((r) => r.id === id) ? shownList : list));
      pendingShown.current = false;
      setPendingTailor(tailor && target ? { resumeId: id, ...tailor } : null);
      setSearchParams(editorParams(target));
    },
    [resumes, setSearchParams]
  );
  const openLetters = useCallback((resume) => setSearchParams(editorParams(resume, LETTERS_PAGE)), [setSearchParams]);
  const takePendingTailor = useCallback(() => setPendingTailor(null), []);
  const currentId = current?.id;
  useEffect(() => {
    if (!pendingTailor || !currentId) return;
    if (currentId === pendingTailor.resumeId) pendingShown.current = true;
    else if (pendingShown.current) setPendingTailor(null);
  }, [currentId, pendingTailor]);

  // A ?resume= that names nothing (a deleted resume, an old bookmark) or
  // the default opens the default: drop it so the address matches.
  useEffect(() => {
    if (onLandingPage) return;
    if (current && requestedId && (requestedId !== current.id || current.isDefault)) {
      setSearchParams(editorParams(current, onLettersPage ? LETTERS_PAGE : null), { replace: true });
    }
  }, [current, requestedId, setSearchParams, onLandingPage, onLettersPage]);

  if (error) return <div className="ed-loading">Couldn't load your resumes: {error}</div>;
  if (!current) return <div className="ed-loading">Loading editor…</div>;

  if (onLandingPage) {
    return <LandingEditorPage resumes={resumes} onSwitch={switchTo} onStatus={setLandingStatus} onLogout={onLogout} />;
  }

  if (onLettersPage) {
    return (
      <CoverLettersPage
        key={current.id}
        resume={current}
        resumes={resumes}
        onSwitch={switchTo}
        onBack={() => switchTo(current.id)}
        onLogout={onLogout}
      />
    );
  }

  return (
    <EditorPage
      key={current.id}
      resume={current}
      resumes={resumes}
      onSwitch={switchTo}
      pendingTailor={pendingTailor?.resumeId === current.id ? pendingTailor : null}
      onPendingTailorTaken={takePendingTailor}
      onResumesChanged={reload}
      onOpenLetters={() => openLetters(current)}
      landingShown={landingShown(landingStatus)}
      onLogout={onLogout}
    />
  );
}
