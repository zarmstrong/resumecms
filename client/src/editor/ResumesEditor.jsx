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

  // The default lives at plain /editor, any other resume at ?resume=<id>.
  // A `list` that knows a resume the shown one doesn't (a create whose
  // reload failed) is adopted, or pickResume would open the default.
  const switchTo = useCallback(
    (id, list = resumes) => {
      const target = list.find((r) => r.id === id);
      if (target) setResumes((shownList) => (shownList.some((r) => r.id === id) ? shownList : list));
      setSearchParams(target && !target.isDefault ? { resume: id } : {});
    },
    [resumes, setSearchParams]
  );

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
      onResumesChanged={reload}
      onLogout={onLogout}
    />
  );
}
