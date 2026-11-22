// The editor's debounced saves plus every write still in flight, so it can
// wait for all of its edits to reach the server before doing something that
// reads the server's copy: switching to another resume, or saving this one
// as a new one (the server copies its stored draft). Pure apart from the
// timers it's given, so saveQueue.test.js drives it with fake ones.
//
// schedule(key, save) runs `save` after `delayMs`, replacing whatever was
// waiting under the same key (one header, one site, one per block). track()
// registers a write's promise (save() should track its request). flush()
// runs everything still waiting right away and resolves, once every tracked
// write has settled, with the errors of those that failed. runWaiting() is
// the fire-and-forget half, for when there's no time to wait (unmount).
//
// track(promise, key) with a key is for a write whose failure leaves the
// edit only on screen (a debounced save, a visibility toggle): its error is
// kept, and every later flush() reports it, until a newer write under the
// same key succeeds. An unkeyed write's failure is only reported by a flush
// running when it settled; those writes resync, or never applied locally.
//
// hold() is for an operation that flushes before sending a write the next
// page reads (issue #235: "Apply to the default resume" waits for the
// landing saves, then writes the resume's site settings). Take it before
// the first await: until its release(), flush() goes round for it too, so
// a leave whose flush resolves with the operation's can't navigate before
// its request is even sent. The operation's own wait is the hold's
// flush(), which waits for every save and write but for no hold (its own
// would never come, and two operations each waiting on the other's would
// never end); calling the queue's flush() while holding never resolves.
// release() is idempotent; call it once the request is tracked, or in a
// finally once the operation is done or stopped.
//
// pending() says what leaving now would put at risk (issue #105): saves
// still waiting, writes in flight, kept failures and holds, as counts.
// isIdle() is true when all four are none, and subscribe(listener) calls
// the listener whenever that may have changed (React's
// useSyncExternalStore).
export function createSaveQueue({ delayMs, timers = globalThis }) {
  const waiting = new Map(); // key -> { timer, run }
  const inFlight = new Map(); // promise -> key (undefined for an unkeyed write)
  const latest = new Map(); // key -> the newest promise tracked under it
  const failed = new Map(); // key -> error
  const holds = new Set(); // a promise per hold, resolved by its release()
  // The unkeyed failures each flush still running has seen settle: a write
  // tracked while it waits (a holder's request) is reported too.
  const draining = new Set();
  const listeners = new Set();

  function changed() {
    for (const listener of [...listeners]) listener();
  }

  function track(promise, key) {
    inFlight.set(promise, key);
    if (key !== undefined) latest.set(key, promise);
    // An upload tracked on its own sets no page state, so the guard learns
    // of it only from here.
    changed();
    const settle = (err) => {
      inFlight.delete(promise);
      if (err && key === undefined) for (const unkeyed of draining) unkeyed.push(err);
      // An older write settling late says nothing about the newer one.
      if (key !== undefined && latest.get(key) === promise) {
        if (err) failed.set(key, err);
        else failed.delete(key);
      }
      changed();
    };
    promise.then(
      () => settle(null),
      (err) => settle(err || new Error('Save failed'))
    );
    return promise;
  }

  function schedule(key, save) {
    const previous = waiting.get(key);
    if (previous) timers.clearTimeout(previous.timer);
    const entry = {
      run: () => {
        timers.clearTimeout(entry.timer);
        waiting.delete(key);
        save();
        changed();
      },
    };
    entry.timer = timers.setTimeout(entry.run, delayMs);
    waiting.set(key, entry);
    changed();
  }

  function runWaiting() {
    for (const { run } of [...waiting.values()]) run();
  }

  // Drops every key `match(key)` accepts: a save still waiting is cancelled,
  // and a failure is no longer reported, nor one of a write still in
  // flight. For edits that stopped mattering (a deleted block, a discarded
  // draft). Returns whether it cancelled a waiting save, whose own
  // callbacks (the editor's "Saving…") will then never run.
  function forget(match) {
    let cancelled = false;
    for (const [key, { timer }] of [...waiting]) {
      if (!match(key)) continue;
      timers.clearTimeout(timer);
      waiting.delete(key);
      cancelled = true;
    }
    for (const key of [...latest.keys()]) if (match(key)) latest.delete(key);
    for (const key of [...failed.keys()]) if (match(key)) failed.delete(key);
    changed();
    return cancelled;
  }

  // Goes round until nothing is waiting or in flight (nor held, unless
  // it's a hold's own): the editor stays editable meanwhile, and an edit
  // typed during the wait, or by the operation that held it, must not miss
  // it.
  // An unkeyed write's failure is reported if it settles while this runs,
  // whether it was in flight when it started or tracked since.
  async function drain(withHolds) {
    const unkeyed = [];
    draining.add(unkeyed);
    try {
      while (waiting.size || inFlight.size || (withHolds && holds.size)) {
        runWaiting();
        await Promise.allSettled([...inFlight.keys(), ...(withHolds ? holds : [])]);
      }
    } finally {
      draining.delete(unkeyed);
    }
    return [...failed.values(), ...unkeyed];
  }

  function flush() {
    return drain(true);
  }

  function hold() {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    holds.add(held);
    changed();
    return {
      flush: () => drain(false),
      release() {
        if (!holds.delete(held)) return;
        release();
        changed();
      },
    };
  }

  function pending() {
    return { waiting: waiting.size, inFlight: inFlight.size, failed: failed.size, held: holds.size };
  }

  function isIdle() {
    return waiting.size === 0 && inFlight.size === 0 && failed.size === 0 && holds.size === 0;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { schedule, track, flush, hold, runWaiting, forget, pending, isIdle, subscribe };
}
