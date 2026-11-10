import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './uploadLimit.js';

// A task the test finishes by hand, recording when it started.
function deferredTasks(log) {
  const pending = {};
  const make = (name) => () => {
    log.push(`start ${name}`);
    return new Promise((resolve, reject) => {
      pending[name] = { resolve, reject };
    });
  };
  return { make, pending };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('no more than max tasks run at once, the rest start in order as slots free', async () => {
  const log = [];
  const { make, pending } = deferredTasks(log);
  const run = createLimiter(2);
  const results = ['a', 'b', 'c', 'd', 'e'].map((name) => run(make(name)));
  await tick();
  assert.deepEqual(log, ['start a', 'start b']);

  pending.b.resolve('B');
  await tick();
  assert.deepEqual(log, ['start a', 'start b', 'start c']);
  assert.equal(await results[1], 'B');

  // A failure frees its slot too, and reaches only its own caller.
  const failed = assert.rejects(results[0], /too large/);
  pending.a.reject(new Error('too large'));
  await tick();
  assert.deepEqual(log.slice(3), ['start d']);
  await failed;

  pending.c.resolve('C');
  pending.d.resolve('D');
  await tick();
  assert.deepEqual(log.slice(4), ['start e']);
  pending.e.resolve('E');
  assert.deepEqual(await Promise.all(results.slice(1)), ['B', 'C', 'D', 'E']);
});

test('a task that throws, or returns a plain value, is handled like any other', async () => {
  const run = createLimiter(1);
  const thrown = run(() => {
    throw new Error('boom');
  });
  const plain = run(() => 42);
  await assert.rejects(thrown, /boom/);
  assert.equal(await plain, 42);
  // The limiter is still usable afterwards.
  assert.equal(await run(async () => 'later'), 'later');
});
