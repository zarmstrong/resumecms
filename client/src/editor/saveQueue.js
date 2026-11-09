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
// that waited on it; those writes resync, or never applied locally.
//
// pending() says what leaving now would put at risk (issue #105): saves
// still waiting, writes in flight, and kept failures, as counts. isIdle()
// is true when all three are none, and subscribe(listener) calls the
// listener whenever that may have changed (React's useSyncExternalStore).
export function createSaveQueue({ delayMs, timers = globalThis }) {
  const waiting = new Map(); // key -> { timer, run }
  const inFlight = new Map(); // promise -> key (undefined for an unkeyed write)
  const latest = new Map(); // key -> the newest promise tracked under it
  const failed = new Map(); // key -> error
  const listeners = new Set();

  function changed() {
    for (const listener of [...listeners]) listener();
  }

  function track(promise, key) {
    inFlight.set(promise, key);
    if (key !== undefined) latest.set(key, promise);
    const settle = (err) => {
      inFlight.delete(promise);
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

  // Goes round until nothing is waiting or in flight: the editor stays
  // editable meanwhile, and an edit typed during the wait must not miss it.
  async function flush() {
    const unkeyed = [];
    while (waiting.size || inFlight.size) {
      runWaiting();
      const writes = [...inFlight];
      const results = await Promise.allSettled(writes.map(([promise]) => promise));
      results.forEach((r, i) => {
        if (r.status === 'rejected' && writes[i][1] === undefined) unkeyed.push(r.reason);
      });
    }
    return [...failed.values(), ...unkeyed];
  }

  function pending() {
    return { waiting: waiting.size, inFlight: inFlight.size, failed: failed.size };
  }

  function isIdle() {
    return waiting.size === 0 && inFlight.size === 0 && failed.size === 0;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { schedule, track, flush, runWaiting, forget, pending, isIdle, subscribe };
}
