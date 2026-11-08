// Graceful shutdown on SIGTERM/SIGINT (issue #68). In Docker, Node is the
// container's PID 1, and Linux drops a signal sent to PID 1 unless the
// process handles it, so without this `docker stop` always waited out its
// grace period and force-killed. Puppeteer's own signal handlers are off
// (pdfRenderer.js), so this is the only place that decides when to exit.

// How long in-flight requests get to finish before their connections are
// cut. A publish waiting on a render doesn't need it: the browser is closed
// at the same time, which fails the render and answers that request.
export const DRAIN_MS = 3000;

// Exit regardless after this long, comfortably inside Docker's default
// 10 s grace period, in case closing something hangs.
export const FORCE_EXIT_MS = 8000;

// Stops accepting connections and resolves once every open one has closed:
// idle keep-alive ones straight away, any still busy after `drainMs` cut.
export function closeServer(server, drainMs = DRAIN_MS) {
  return new Promise((resolve, reject) => {
    const cut = setTimeout(() => server.closeAllConnections(), drainMs);
    server.close((err) => {
      clearTimeout(cut);
      if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

// Returns the handler for both signals. A second signal while shutting down
// exits at once, for someone pressing Ctrl+C twice.
export function createShutdown({
  server,
  closeBrowser,
  closeDb,
  exit = (code) => process.exit(code),
  log = console,
  drainMs = DRAIN_MS,
  forceExitMs = FORCE_EXIT_MS,
}) {
  let shuttingDown = false;
  return async function shutdown(signal) {
    if (shuttingDown) {
      log.warn(`${signal} received again, exiting now`);
      exit(1);
      return;
    }
    shuttingDown = true;
    log.log(`${signal} received, shutting down`);
    const forceExit = setTimeout(() => {
      log.error(`Shutdown still not done after ${forceExitMs} ms, exiting anyway`);
      exit(1);
    }, forceExitMs);
    forceExit.unref();

    let code = 0;
    const results = await Promise.allSettled([closeServer(server, drainMs), closeBrowser()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Shutdown step failed:', result.reason);
        code = 1;
      }
    }
    try {
      closeDb();
    } catch (err) {
      log.error('Closing the database failed:', err);
      code = 1;
    }
    clearTimeout(forceExit);
    exit(code);
  };
}
