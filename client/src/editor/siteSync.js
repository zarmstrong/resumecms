// The editor's site settings saves (issue #234). A save is the whole site
// object, sent with the revision it was made from (`If-Match`, the
// server's siteRevision.js), and the server refuses it with a 409 when the
// stored settings have changed since: another tab, an MCP client's
// update_site_settings, the landing editor's "Apply to the default resume"
// or its preset offer. The editor doesn't ask then and loses nothing: it
// reads the stored settings again, replays on top of them each edit it made
// since what the server last confirmed, shows that, and sends it again.
// An edit is replayed by what it meant, not by the values on screen: by
// default the keys it changed (rebaseSite(), removed keys included), but a
// color picked sets that one color, and a preset is presetSite() again
// (which resets keys whatever their value), so the form hands its own
// replay where the value diff would say more or less than the edit did.
// Pure apart from the calls it's given (dependency-free: the server's
// resumeStore.test.js imports it too).

// Keys merged one level deeper, as the server's setSite() merge does.
const NESTED_KEYS = ['colors'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

function rebaseObject(base, local, stored, nested) {
  // A Map, then Object.fromEntries, so an own "__proto__" key stays a key.
  const next = new Map(Object.entries(stored));
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    const had = Object.hasOwn(base, key);
    const has = Object.hasOwn(local, key);
    if (had && has && sameValue(base[key], local[key])) continue; // not ours
    if (!has) {
      next.delete(key);
      continue;
    }
    const theirs = next.get(key);
    if (
      nested.includes(key) &&
      isPlainObject(local[key]) &&
      (!had || isPlainObject(base[key])) &&
      (theirs === undefined || isPlainObject(theirs))
    ) {
      next.set(key, rebaseObject(had ? base[key] : {}, local[key], theirs ?? {}, []));
      continue;
    }
    next.set(key, local[key]);
  }
  return Object.fromEntries(next);
}

// `stored` with the changes that turned `base` into `local` put back on
// top: a key `local` set differently from `base` takes `local`'s value, a
// key it dropped is dropped, and every other key is `stored`'s, so a change
// made elsewhere to a key this side didn't touch survives. `colors` is
// compared key by key. Where both sides changed the same key, this side's
// value wins: it's what its screen shows.
export function rebaseSite(base, local, stored) {
  const obj = (v) => (isPlainObject(v) ? v : {});
  return rebaseObject(obj(base), obj(local), obj(stored), NESTED_KEYS);
}

// An edit's replay: what turned `before` into `after`, applied to other
// settings. The default for a form edit.
export function replayChange(before, after) {
  return (site) => rebaseSite(before, after, site);
}

// The replay of picking one color. The form writes every color as it's
// drawn (defaults filled in), so a value diff would also claim the ones it
// only filled in.
export function replayColor(key, value) {
  return (site) => {
    const s = isPlainObject(site) ? site : {};
    return { ...s, colors: { ...(isPlainObject(s.colors) ? s.colors : {}), [key]: value } };
  };
}

// How many 409s one save rides out before it fails like any other save
// (and is retried by the next edit).
export const SITE_SAVE_ATTEMPTS = 4;

// One resume's site saves, one at a time, so a later save never overtakes
// an earlier one and no save is made from a revision another of them has
// moved on. `getSite()` and `putSite(site, revision)` are that resume's
// calls (resumeApi(id)); `read()` is the settings on screen and `write(site)`
// replaces them (after a 409). `reset({ site, revision })` is what the
// server holds after a load or a discard. `record(replay)` notes an edit
// made on screen, with its replay (above). `save()` sends what's on screen
// when its turn comes and resolves with the server's copy; on a 409 it
// shows, and sends, the fresh settings with every edit not yet confirmed
// replayed on them, in order. A failure other than a 409 rejects and keeps
// its edits for the next save's replay (if it was applied after all, that
// save's 409 and replay change nothing).
export function createSiteSync({ getSite, putSite, read, write, attempts = SITE_SAVE_ATTEMPTS }) {
  let server = { site: null, revision: undefined };
  let edits = []; // replays of the edits on screen the server hasn't confirmed
  let chain = Promise.resolve();

  function reset({ site, revision }) {
    server = { site, revision };
    edits = [];
  }

  function record(replay) {
    edits.push(replay);
  }

  async function run() {
    for (let attempt = 1; ; attempt += 1) {
      const local = read();
      const sent = new Set(edits);
      try {
        const saved = await putSite(local, server.revision);
        server = { site: saved.site, revision: saved.revision };
        // Those it carried are confirmed; an edit made meanwhile isn't.
        edits = edits.filter((edit) => !sent.has(edit));
        return saved.site;
      } catch (err) {
        if (err?.status !== 409 || attempt >= attempts) throw err;
      }
      const fresh = await getSite();
      // Edits typed during the round trip included.
      write(edits.reduce((site, replay) => replay(site), fresh.site));
      server = { site: fresh.site, revision: fresh.revision };
    }
  }

  function save() {
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  return { reset, record, save };
}
