import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteSync, rebaseSite, SITE_SAVE_ATTEMPTS } from './siteSync.js';

test('rebaseSite puts only this side\'s changes on top of the stored settings', () => {
  const base = { title: 'Jo', font: 'inter', layout: 'flat', colors: { accent: '#111111', heading: '#222222' } };
  // This side changed the font, removed the layout and changed one color.
  const local = { title: 'Jo', font: 'lora', colors: { accent: '#111111', heading: '#333333' } };
  // Elsewhere: a new title, page numbers on, the accent changed and the layout changed.
  const stored = { title: 'Jo Smith', font: 'inter', layout: 'sidebar', pdfPageNumbers: true, colors: { accent: '#abcdef', heading: '#222222' } };
  assert.deepEqual(rebaseSite(base, local, stored), {
    title: 'Jo Smith',
    font: 'lora',
    pdfPageNumbers: true,
    colors: { accent: '#abcdef', heading: '#333333' },
  });
});

test('rebaseSite with nothing changed is the stored settings, and with nothing stored only this side', () => {
  const base = { title: 'Jo', colors: { accent: '#111111' } };
  const stored = { title: 'Other', pdfPageNumbers: true };
  assert.deepEqual(rebaseSite(base, structuredClone(base), stored), stored);
  assert.deepEqual(rebaseSite(base, { ...base, font: 'lora' }, null), { font: 'lora' });
  assert.deepEqual(rebaseSite(null, { title: 'Jo' }, { title: 'X', font: 'inter' }), { title: 'Jo', font: 'inter' });
});

test('rebaseSite takes colors key by key, and drops them when this side removed them', () => {
  assert.deepEqual(rebaseSite({}, { colors: { text: '#000000' } }, { colors: { accent: '#ffffff' } }), {
    colors: { accent: '#ffffff', text: '#000000' },
  });
  assert.deepEqual(rebaseSite({ colors: { accent: '#111111' } }, {}, { colors: { accent: '#111111', text: '#222222' } }), {});
  // A key removed inside colors (a preset resetting one) is removed.
  assert.deepEqual(
    rebaseSite({ colors: { accent: '#111111', text: '#222222' } }, { colors: { accent: '#111111' } }, { colors: { accent: '#999999', text: '#222222' } }),
    { colors: { accent: '#999999' } }
  );
  // Where the stored value isn't an object, this side's colors replace it.
  assert.deepEqual(rebaseSite({}, { colors: { accent: '#111111' } }, { colors: 'red' }), { colors: { accent: '#111111' } });
});

test('rebaseSite compares values, not object identity, and keeps a "__proto__" key a key', () => {
  const base = { order: ['a', 'b'] };
  assert.deepEqual(rebaseSite(base, { order: ['a', 'b'] }, { order: ['b', 'a'] }), { order: ['b', 'a'] });
  const local = JSON.parse('{"__proto__": {"polluted": true}}');
  const out = rebaseSite({}, local, {});
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(out), ['__proto__']);
  assert.equal(({}).polluted, undefined);
});

// A server that checks revisions like the real one: `edit(fn)` is a write
// made elsewhere (another tab, an MCP merge).
function fakeServer(site) {
  let stored = site;
  let revision = 1;
  const calls = [];
  return {
    calls,
    get stored() {
      return stored;
    },
    edit(fn) {
      stored = fn(stored);
      revision += 1;
    },
    getSite: async () => {
      calls.push(['get']);
      return { site: stored, revision: `r${revision}` };
    },
    putSite: async (next, asked) => {
      calls.push(['put', asked]);
      if (asked !== undefined && asked !== `r${revision}`) {
        throw Object.assign(new Error('changed elsewhere'), { status: 409 });
      }
      stored = next;
      revision += 1;
      return { site: stored, revision: `r${revision}` };
    },
  };
}

function editorOn(server, loaded) {
  const screen = { site: loaded.site, writes: 0 };
  const sync = createSiteSync({
    getSite: () => server.getSite(),
    putSite: (site, revision) => server.putSite(site, revision),
    read: () => screen.site,
    write: (s) => {
      screen.site = s;
      screen.writes += 1;
    },
  });
  sync.reset(loaded);
  return { screen, sync };
}

test('a save after a change made elsewhere keeps both, and shows the other one', async () => {
  const server = fakeServer({ title: 'Jo', colors: { accent: '#111111' } });
  const { screen, sync } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, title: 'Jo Smith', pdfPageNumbers: true }));
  screen.site = { ...screen.site, colors: { accent: '#222222' } };
  const saved = await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo Smith', pdfPageNumbers: true, colors: { accent: '#222222' } });
  assert.deepEqual(saved, server.stored);
  assert.deepEqual(screen.site, server.stored);
  assert.deepEqual(server.calls.slice(1), [['put', 'r1'], ['get'], ['put', 'r2']]);
  // The next save goes from the revision it was given.
  screen.site = { ...screen.site, font: 'lora' };
  await sync.save();
  assert.deepEqual(server.calls.at(-1), ['put', 'r3']);
  assert.equal(server.stored.font, 'lora');
});

test('a key this side removed stays removed through the rebase', async () => {
  const server = fakeServer({ template: 'classic', accent: '#111111', nameFont: 'lora' });
  const { screen, sync } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, title: 'T' }));
  // A preset applied in the picker drops the keys it doesn't set.
  screen.site = { template: 'banner' };
  await sync.save();
  assert.deepEqual(server.stored, { template: 'banner', title: 'T' });
});

test('an edit typed during the round trip is kept, and saves run one at a time', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, description: 'Hi' }));
  const realGet = server.getSite;
  server.getSite = async () => {
    const answer = await realGet();
    screen.site = { ...screen.site, font: 'inter' }; // typed meanwhile
    return answer;
  };
  screen.site = { title: 'Jo', layout: 'sidebar' };
  const first = sync.save();
  const second = sync.save();
  await Promise.all([first, second]);
  assert.deepEqual(server.stored, { title: 'Jo', description: 'Hi', layout: 'sidebar', font: 'inter' });
  assert.deepEqual(screen.site, server.stored);
  // The second waited for the first, so it went from its revision: no 409.
  assert.deepEqual(server.calls.slice(1).map((c) => c[0]), ['put', 'get', 'put', 'put']);
});

test('it gives up after its attempts, and a failure doesn\'t stop the next save', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync } = editorOn(server, await server.getSite());
  const realPut = server.putSite;
  server.putSite = async (next, asked) => {
    server.edit((s) => ({ ...s, n: (s.n || 0) + 1 })); // someone always got there first
    return realPut(next, asked);
  };
  screen.site = { title: 'Jo', font: 'lora' };
  await assert.rejects(sync.save(), (e) => e.status === 409);
  assert.equal(server.calls.filter((c) => c[0] === 'put').length, SITE_SAVE_ATTEMPTS);
  server.putSite = realPut;
  await sync.save();
  assert.equal(server.stored.font, 'lora');
  assert.equal(server.stored.n, SITE_SAVE_ATTEMPTS);
});

test('a save that failed for another reason rejects, and the next one still rebases', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync } = editorOn(server, await server.getSite());
  const realPut = server.putSite;
  // Applied on the server, but the answer never arrived.
  server.putSite = async (next, asked) => {
    await realPut(next, asked);
    throw Object.assign(new Error('Network down'), { status: 0 });
  };
  screen.site = { title: 'Jo', font: 'lora' };
  await assert.rejects(sync.save(), /Network down/);
  server.putSite = realPut;
  server.edit((s) => ({ ...s, description: 'Hi' }));
  screen.site = { ...screen.site, layout: 'sidebar' };
  await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo', font: 'lora', description: 'Hi', layout: 'sidebar' });
});
