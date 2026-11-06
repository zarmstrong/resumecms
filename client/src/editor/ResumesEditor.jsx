import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { EditorPage } from './EditorPage.jsx';
import { pickResume } from './resumeLinks.js';

// The editor for whichever resume `?resume=<id>` names (issue #53), the
// default when it names none or one that's gone. EditorPage is keyed by
// the resume's id, so switching mounts a fresh one: nothing of the previous
// resume (its AI proposals, a debounce timer, a response still in flight)
// can land on the next. EditorPage flushes its waiting saves before it
// asks to switch, and again on unmount for a switch it didn't start (the
// browser's back button).
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

  const requestedId = searchParams.get('resume');
  const current = resumes && pickResume(resumes, requestedId);

  // A tailoring run asked for with a new copy ({ resumeId, brief, types }):
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
      const target = list.find((r) => r.id === id);
      if (target) setResumes((shownList) => (shownList.some((r) => r.id === id) ? shownList : list));
      pendingShown.current = false;
      setPendingTailor(tailor && target ? { resumeId: id, ...tailor } : null);
      setSearchParams(target && !target.isDefault ? { resume: id } : {});
    },
    [resumes, setSearchParams]
  );
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
    if (current && requestedId && (requestedId !== current.id || current.isDefault)) {
      setSearchParams({}, { replace: true });
    }
  }, [current, requestedId, setSearchParams]);

  if (error) return <div className="ed-loading">Couldn't load your resumes: {error}</div>;
  if (!current) return <div className="ed-loading">Loading editor…</div>;

  return (
    <EditorPage
      key={current.id}
      resume={current}
      resumes={resumes}
      onSwitch={switchTo}
      pendingTailor={pendingTailor?.resumeId === current.id ? pendingTailor : null}
      onPendingTailorTaken={takePendingTailor}
      onResumesChanged={reload}
      onLogout={onLogout}
    />
  );
}
