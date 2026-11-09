import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router-dom';
import { leavesEditorPage } from './resumeLinks.js';
import { hasUnsavedWork, leaveQuestion, mustGuard } from './unsavedWork.js';

// The one guard every editor page leaves through (issue #105). `saves` is
// the page's save queue, `work` what it holds only on screen (one of
// unsavedWork.js's descriptions, from this render), `resumes` the list
// ResumesEditor picks pages from.
//
// - leave(next): the page's own ways out (the switcher, Back, Cover
//   letters, New resume, Log out). Flushes the queue, asks about a save
//   that failed as before, then asks about `work` (leaveQuestion), and runs
//   `next` only if both are confirmed. Resolves with whether it did.
// - leaveUnasked(next): a way out nothing on the page can survive (its
//   resume was just deleted), so there's nothing to ask about.
// - The browser's Back and Forward, and any navigation that skipped
//   leave(), are blocked (useBlocker) while the queue or `work` holds
//   anything, then asked about the same way. One that keeps the page (the
//   address rewritten to the same resume, see leavesEditorPage) never is.
// - A reload, a closed tab or another site get the browser's own prompt,
//   from a beforeunload handler registered only while there's something to
//   lose: an idle page keeps the back/forward cache.
//
// Logging out from the page goes through leave(); onLogout itself never
// asks, so whatever ends the session without the user (an expired one)
// just leaves.
export function useLeaveGuard({ saves, work, resumes }) {
  const idle = useSyncExternalStore(saves.subscribe, saves.isIdle);
  const workRef = useRef(work);
  workRef.current = work;
  const resumesRef = useRef(resumes);
  resumesRef.current = resumes;
  // True while a confirmed leave() runs, so its own navigation isn't
  // stopped and asked about a second time.
  const leavingRef = useRef(false);
  const holding = !idle || hasUnsavedWork(work);

  const confirmLeave = useCallback(async () => {
    const failed = await saves.flush();
    if (failed.length && !window.confirm(`A change didn't save (${failed[0].message || 'unknown error'}). Go on without it?`)) return false;
    // As rendered once the flush is done (workRef is the latest render's).
    const question = leaveQuestion(workRef.current);
    return !question || window.confirm(question);
  }, [saves]);

  // The navigation a confirmed leave starts is made synchronously inside
  // `next` (react-router checks blockers before its first await).
  const leaveUnasked = useCallback(async (next) => {
    leavingRef.current = true;
    try {
      await next();
    } finally {
      leavingRef.current = false;
    }
  }, []);

  const leave = useCallback(
    async (next) => {
      if (!(await confirmLeave())) return false;
      await leaveUnasked(next);
      return true;
    },
    [confirmLeave, leaveUnasked]
  );

  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }) =>
      !leavingRef.current &&
      leavesEditorPage(resumesRef.current, currentLocation, nextLocation) &&
      mustGuard(workRef.current, saves.pending()),
    [saves]
  );
  const blocker = useBlocker(shouldBlock);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const askingRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || askingRef.current) return;
    askingRef.current = true;
    confirmLeave()
      .then((ok) => {
        const current = blockerRef.current;
        if (current.state !== 'blocked') return;
        if (ok) current.proceed();
        else current.reset();
      })
      .finally(() => {
        askingRef.current = false;
      });
  }, [blocker, confirmLeave]);

  useEffect(() => {
    if (!holding) return undefined;
    function onBeforeUnload(e) {
      e.preventDefault();
      // Older browsers only prompt with a returnValue set.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [holding]);

  return { leave, leaveUnasked };
}
