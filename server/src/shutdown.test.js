import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { closeServer, createShutdown } from './shutdown.js';

const quietLog = { log() {}, warn() {}, error() {} };

function fakeServer({ closeError = null } = {}) {
  const calls = [];
  return {
    calls,
    close(cb) {
      calls.push('close');
      this.onClosed = () => cb(closeError);
      if (!this.holdOpen) this.onClosed();
    },
    closeIdleConnections() {
      calls.push('closeIdle');
    },
    closeAllConnections() {
      calls.push('closeAll');
      this.onClosed?.();
    },
  };
}

function run(options) {
  const exits = [];
  let resolveExit;
  const exited = new Promise((resolve) => (resolveExit = resolve));
  const shutdown = createShutdown({
    log: quietLog,
    closeBrowser: async () => {},
    closeDb: () => {},
    exit: (code) => {
      exits.push(code);
      resolveExit(code);
    },
    ...options,
  });
  return { shutdown, exits, exited };
}

test('closes the server, the browser and the database, then exits 0', async () => {
  const steps = [];
  const server = fakeServer();
  const { shutdown, exited } = run({
    server,
    closeBrowser: async () => steps.push('browser'),
    closeDb: () => steps.push('db'),
  });
  shutdown('SIGTERM');
  assert.equal(await exited, 0);
  assert.deepEqual(server.calls, ['close', 'closeIdle']);
  assert.deepEqual(steps, ['browser', 'db']);
});

test('cuts connections still open after the drain period', async () => {
  const server = fakeServer();
  server.holdOpen = true;
  const { shutdown, exited } = run({ server, drainMs: 10 });
  shutdown('SIGTERM');
  assert.equal(await exited, 0);
  assert.deepEqual(server.calls, ['close', 'closeIdle', 'closeAll']);
});

test('a failed step still closes the rest, and exits 1', async () => {
  let dbClosed = false;
  const { shutdown, exited } = run({
    server: fakeServer(),
    closeBrowser: async () => {
      throw new Error('browser gone');
    },
    closeDb: () => (dbClosed = true),
  });
  shutdown('SIGTERM');
  assert.equal(await exited, 1);
  assert.equal(dbClosed, true);
});

test('a second signal exits at once', async () => {
  const server = fakeServer();
  server.holdOpen = true;
  const { shutdown, exits } = run({ server, drainMs: 60_000, forceExitMs: 60_000 });
  shutdown('SIGTERM');
  shutdown('SIGINT');
  assert.deepEqual(exits, [1]);
  server.onClosed();
});

test('exits anyway when a step hangs', async () => {
  const { shutdown, exited } = run({
    server: fakeServer(),
    closeBrowser: () => new Promise(() => {}),
    forceExitMs: 10,
  });
  shutdown('SIGTERM');
  assert.equal(await exited, 1);
});

test('closeServer resolves for a real server with an idle keep-alive connection', async () => {
  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve, reject) => {
    http
      .get({ port: server.address().port, host: '127.0.0.1', agent }, (res) => res.resume().on('end', resolve))
      .on('error', reject);
  });
  const started = Date.now();
  await closeServer(server, 5000);
  assert.ok(Date.now() - started < 1000, 'an idle connection should not wait out the drain period');
  agent.destroy();
});
