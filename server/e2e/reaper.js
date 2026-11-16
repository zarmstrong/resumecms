// Started by harness.js when the test process ends with a server still
// running (see its `cleanups`): it has already SIGTERMed the server but
// can't wait for it, since it's exiting. This waits for the server's own
// shutdown to finish, SIGKILLs it past the grace period, and only then
// removes its data dir, so nothing the server writes on its way out can
// recreate the dir after it's gone. Detached, so it outlives the test
// process.
//
// The server is our own child's PID, checked through /proc before a
// SIGKILL (production may share this host's PID namespace): it's killed
// only while its environment still names this data dir.
//
// Usage: node e2e/reaper.js <pid> <dataDir> <graceMs>
import { readFileSync, rmSync } from 'node:fs';

const [pidArg, dataDir, graceArg] = process.argv.slice(2);
const pid = Number(pidArg);
const grace = Number(graceArg);
const start = Date.now();
// Past this, give up and leave the dir: a server that can't be confirmed
// as ours and won't exit isn't something to delete from under.
const GIVE_UP_MS = grace + 10000;

function alive() {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // A zombie has exited; only its parent (init, once the test process
    // is gone) hasn't reaped it yet.
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM';
    }
  }
}

function isOurServer() {
  try {
    // UTF-8, as Node wrote the server's environment, so a temp dir with
    // non-ASCII characters still matches.
    return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`RESUMECMS_DATA_DIR=${dataDir}`);
  } catch {
    return false;
  }
}

if (Number.isInteger(pid) && pid > 0 && dataDir) {
  let killed = false;
  while (alive()) {
    const waited = Date.now() - start;
    if (waited > GIVE_UP_MS) process.exit(1);
    if (!killed && waited > grace) {
      killed = true;
      try {
        if (isOurServer()) process.kill(pid, 'SIGKILL');
      } catch {
        // It exited between the check and the kill (ESRCH): the loop sees
        // it gone and removes the dir.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  rmSync(dataDir, { recursive: true, force: true });
}
