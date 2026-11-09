import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from './saveQueue.js';

// Timers that only fire when the test says so.
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    fireAll: () => {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
  };
}

// A request the test resolves or rejects by hand.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a save runs after its debounce, and a newer one under the same key replaces it', () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  const ran = [];
  q.schedule('header', () => ran.push('header v1'));
  q.schedule('header', () => ran.push('header v2'));
  q.schedule('block:1', () => ran.push('block 1'));
  assert.deepEqual(ran, []);
  assert.equal(timers.pending.size, 2);
  timers.fireAll();
  assert.deepEqual(ran, ['header v2', 'block 1']);
});

test('flush runs what is waiting now, and waits for every write in flight', async () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  const header = deferred();
  const reorder = deferred();
  q.track(reorder.promise);
  q.schedule('header', () => q.track(header.promise));

  let flushed = null;
  const flushing = q.flush().then((failed) => {
    flushed = failed;
  });
  assert.equal(timers.pending.size, 0, 'the waiting save ran right away and its timer is gone');
  await Promise.resolve();
  assert.equal(flushed, null);
  header.resolve({});
  await Promise.resolve();
  assert.equal(flushed, null, 'still waiting on the reorder');
  reorder.resolve({});
  await flushing;
  assert.deepEqual(flushed, []);

  // a save already run never runs again, from its timer or a later flush
  timers.fireAll();
  assert.deepEqual(await q.flush(), []);
});

test('an edit made while flush waits is flushed too', async () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  const first = deferred();
  const second = deferred();
  let flushed = false;
  q.schedule('block:1', () => q.track(first.promise, 'block:1'));
  const flushing = q.flush().then(() => {
    flushed = true;
  });
  q.schedule('block:1', () => q.track(second.promise, 'block:1'));
  first.resolve({});
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.pending.size, 0, 'the later edit was sent without waiting for its debounce');
  assert.equal(flushed, false, 'and flush waits for it');
  second.resolve({});
  await flushing;
});

test('flush reports an unkeyed write that failed while it waited, and only then', async () => {
  const q = createSaveQueue({ delayMs: 500, timers: fakeTimers() });
  const failing = deferred();
  q.track(failing.promise).catch(() => {});
  const flushing = q.flush();
  failing.reject(new Error('400 bad order'));
  const failed = await flushing;
  assert.deepEqual(failed.map((e) => e.message), ['400 bad order']);
  assert.deepEqual(await q.flush(), [], 'a settled unkeyed write is no longer in flight');
});

test('a keyed failure is reported by every later flush, until a newer write of that key succeeds', async () => {
  const q = createSaveQueue({ delayMs: 500, timers: fakeTimers() });
  const failing = deferred();
  // what EditorPage does: track the request, handle its result separately
  q.schedule('site', () => q.track(failing.promise, 'site').then(() => {}, () => {}));
  q.runWaiting();
  failing.reject(new Error('400 bad site'));
  await Promise.resolve();
  await Promise.resolve();

  // already settled before anyone flushed: still reported
  assert.deepEqual((await q.flush()).map((e) => e.message), ['400 bad site']);
  assert.deepEqual((await q.flush()).map((e) => e.message), ['400 bad site']);

  // another key succeeding changes nothing; the same key succeeding clears it
  await q.track(Promise.resolve({}), 'header');
  assert.equal((await q.flush()).length, 1);
  await q.track(Promise.resolve({}), 'site');
  assert.deepEqual(await q.flush(), []);
});

test('an older write of a key settling late says nothing about the newer one', async () => {
  const q = createSaveQueue({ delayMs: 500, timers: fakeTimers() });
  const older = deferred();
  const newer = deferred();
  q.track(older.promise, 'block:1').catch(() => {});
  q.track(newer.promise, 'block:1');
  newer.resolve({});
  older.reject(new Error('500'));
  assert.deepEqual(await q.flush(), []);

  const older2 = deferred();
  const newer2 = deferred();
  q.track(older2.promise, 'block:1');
  q.track(newer2.promise, 'block:1').catch(() => {});
  newer2.reject(new Error('400 newer'));
  older2.resolve({});
  assert.deepEqual((await q.flush()).map((e) => e.message), ['400 newer']);
});

test('forget cancels what is waiting and drops failures, also of a write still in flight', async () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  const ran = [];
  q.track(Promise.reject(new Error('500 data')), 'block:1').catch(() => {});
  q.track(Promise.reject(new Error('500 site')), 'site').catch(() => {});
  const inFlight = deferred();
  q.track(inFlight.promise, 'block:1:visibleWeb').catch(() => {});
  q.schedule('block:1', () => ran.push('block 1'));
  q.schedule('block:10', () => ran.push('block 10'));
  await Promise.resolve();

  assert.equal(q.forget((key) => key === 'block:1' || key.startsWith('block:1:')), true, 'it cancelled a waiting save');
  inFlight.reject(new Error('500 visibility'));
  assert.deepEqual((await q.flush()).map((e) => e.message), ['500 site']);
  assert.deepEqual(ran, ['block 10'], 'the waiting save of the forgotten block never ran');

  assert.equal(q.forget(() => true), false, 'nothing was left waiting');
  assert.deepEqual(await q.flush(), []);
});

test('runWaiting sends what is waiting without waiting for it (unmount)', () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  const ran = [];
  q.schedule('block:1', () => ran.push('block 1'));
  q.runWaiting();
  assert.deepEqual(ran, ['block 1']);
  assert.equal(timers.pending.size, 0);
  q.runWaiting();
  assert.deepEqual(ran, ['block 1']);
});

test('pending counts what is waiting, in flight and failed, and isIdle is true only with none', async () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  let notified = 0;
  const unsubscribe = q.subscribe(() => {
    notified += 1;
  });
  assert.deepEqual(q.pending(), { waiting: 0, inFlight: 0, failed: 0 });
  assert.equal(q.isIdle(), true);

  const header = deferred();
  const site = deferred();
  q.schedule('header', () => q.track(header.promise, 'header'));
  q.schedule('site', () => q.track(site.promise, 'site').catch(() => {}));
  assert.deepEqual(q.pending(), { waiting: 2, inFlight: 0, failed: 0 }, 'on their debounce');
  assert.equal(q.isIdle(), false);

  timers.fireAll();
  assert.deepEqual(q.pending(), { waiting: 0, inFlight: 2, failed: 0 }, 'sent, not answered');

  header.resolve({});
  site.reject(new Error('400 bad site'));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(q.pending(), { waiting: 0, inFlight: 0, failed: 1 }, 'the failure is kept');
  assert.equal(q.isIdle(), false, 'a kept failure is still unsaved work');

  await q.track(Promise.resolve({}), 'site');
  await Promise.resolve();
  assert.equal(q.isIdle(), true, 'until a newer write of its key succeeds');
  assert.ok(notified >= 6, 'every change told the subscriber');

  unsubscribe();
  const before = notified;
  q.schedule('header', () => {});
  assert.equal(notified, before, 'not after unsubscribing');
});

test('an unkeyed write counts while in flight only, and forget clears what it drops', async () => {
  const timers = fakeTimers();
  const q = createSaveQueue({ delayMs: 500, timers });
  const upload = deferred();
  q.track(upload.promise).catch(() => {});
  assert.deepEqual(q.pending(), { waiting: 0, inFlight: 1, failed: 0 });
  upload.reject(new Error('413'));
  await new Promise((r) => setImmediate(r));
  assert.equal(q.isIdle(), true, 'its failure is only reported by a flush that waited on it');

  q.track(Promise.reject(new Error('500')), 'block:1').catch(() => {});
  q.schedule('block:2', () => {});
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(q.pending(), { waiting: 1, inFlight: 0, failed: 1 });
  q.forget(() => true);
  assert.equal(q.isIdle(), true);
});
