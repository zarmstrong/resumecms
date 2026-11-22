import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteSync, rebaseSite, replayChange, replayColor, SITE_SAVE_ATTEMPTS } from './siteSync.js';
import { presetSite } from '../resume/resumePresets.js';

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

// An editor page over `server`: `edit(next, replay)` is a form edit, as
// EditorPage's handleSiteChange() records it.
function editorOn(server, loaded) {
  const screen = { site: loaded.site };
  const sync = createSiteSync({
    getSite: () => server.getSite(),
    putSite: (site, revision) => server.putSite(site, revision),
    read: () => screen.site,
    write: (s) => {
      screen.site = s;
    },
  });
  sync.reset(loaded);
  const edit = (next, replay = replayChange(screen.site, next)) => {
    screen.site = next;
    sync.record(replay);
  };
  return { screen, sync, edit };
}

test('a save after a change made elsewhere keeps both, and shows the other one', async () => {
  const server = fakeServer({ title: 'Jo', colors: { accent: '#111111' } });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, title: 'Jo Smith', pdfPageNumbers: true }));
  edit({ ...screen.site, colors: { accent: '#222222' } });
  const saved = await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo Smith', pdfPageNumbers: true, colors: { accent: '#222222' } });
  assert.deepEqual(saved, server.stored);
  assert.deepEqual(screen.site, server.stored);
  assert.deepEqual(server.calls.slice(1), [['put', 'r1'], ['get'], ['put', 'r2']]);
  // The next save goes from the revision it was given.
  edit({ ...screen.site, font: 'lora' });
  await sync.save();
  assert.deepEqual(server.calls.at(-1), ['put', 'r3']);
  assert.equal(server.stored.font, 'lora');
});

test('a key this side removed stays removed through the retry', async () => {
  const server = fakeServer({ template: 'classic', accent: '#111111', nameFont: 'lora' });
  const { sync, edit } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, title: 'T' }));
  edit({ template: 'banner' });
  await sync.save();
  assert.deepEqual(server.stored, { template: 'banner', title: 'T' });
});

test('a color picked is replayed alone, not the defaults the form filled in beside it', async () => {
  const server = fakeServer({ colors: { accent: '#111111' } });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, colors: { ...s.colors, heading: '#ff0000' } }));
  // What SiteSettingsForm's setColor() sends: every color as drawn.
  edit({ colors: { accent: '#222222', heading: '#14181c', text: '#14181c' } }, replayColor('accent', '#222222'));
  await sync.save();
  assert.deepEqual(server.stored, { colors: { accent: '#222222', heading: '#ff0000' } });
  assert.deepEqual(screen.site, server.stored);
  assert.deepEqual(replayColor('text', '#000000')(null), { colors: { text: '#000000' } });
  assert.deepEqual(replayColor('text', '#000000')({ colors: 'red', font: 'x' }), { font: 'x', colors: { text: '#000000' } });
});

test('an edit with its own replay (a preset) is made again on the fresh settings', async () => {
  // presetSite() resets the type settings whatever their value, which is
  // what TemplatePickerModal's "Use this preset" replays.
  const TRADES = { id: 'trades', label: 'Trades', header: 'banner', layout: 'rule-entries', colors: { accent: '#8a4b00' }, font: 'inter' };
  const replay = (s) => presetSite(s || {}, TRADES);
  const server = fakeServer({ title: 'Jo', font: 'inter' });
  const { sync, edit } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, font: 'lora', nameFont: 'lora', description: 'Hi' }));
  // The font on screen already matched the preset's, so a value diff
  // wouldn't claim it, nor the nameFont it never saw.
  edit(replay({ title: 'Jo', font: 'inter' }), replay);
  await sync.save();
  assert.deepEqual(server.stored, presetSite({ title: 'Jo', font: 'lora', nameFont: 'lora', description: 'Hi' }, TRADES));
  assert.equal(server.stored.font, 'inter');
  assert.equal('nameFont' in server.stored, false);
  assert.equal(server.stored.description, 'Hi');
});

test('edits are replayed in order, and only those a save confirmed are dropped', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  edit({ title: 'Jo', font: 'lora' });
  edit({ title: 'Jo', font: 'inter' });
  await sync.save();
  // Confirmed: a later conflict doesn't replay them over the other writer.
  server.edit((s) => ({ ...s, font: 'serif' }));
  edit({ ...screen.site, layout: 'sidebar' });
  await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo', font: 'serif', layout: 'sidebar' });
});

test('an edit typed during the round trip is kept, and saves run one at a time', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  server.edit((s) => ({ ...s, description: 'Hi' }));
  const realGet = server.getSite;
  server.getSite = async () => {
    const answer = await realGet();
    edit({ ...screen.site, font: 'inter' }); // typed meanwhile
    return answer;
  };
  edit({ title: 'Jo', layout: 'sidebar' });
  const first = sync.save();
  const second = sync.save();
  await Promise.all([first, second]);
  assert.deepEqual(server.stored, { title: 'Jo', description: 'Hi', layout: 'sidebar', font: 'inter' });
  assert.deepEqual(screen.site, server.stored);
  // The second waited for the first, so it went from its revision: no 409.
  assert.deepEqual(server.calls.slice(1).map((c) => c[0]), ['put', 'get', 'put', 'put']);
});

test('an edit made while a save is in flight is kept for the next one', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  const realPut = server.putSite;
  server.putSite = async (next, asked) => {
    const answer = await realPut(next, asked);
    edit({ ...screen.site, font: 'lora' }); // typed while it was out
    return answer;
  };
  edit({ title: 'Jo', layout: 'sidebar' });
  await sync.save();
  server.putSite = realPut;
  server.edit((s) => ({ ...s, description: 'Hi' }));
  await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo', layout: 'sidebar', font: 'lora', description: 'Hi' });
});

test('it gives up after its attempts, and a failure doesn\'t stop the next save', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { sync, edit } = editorOn(server, await server.getSite());
  const realPut = server.putSite;
  server.putSite = async (next, asked) => {
    server.edit((s) => ({ ...s, n: (s.n || 0) + 1 })); // someone always got there first
    return realPut(next, asked);
  };
  edit({ title: 'Jo', font: 'lora' });
  await assert.rejects(sync.save(), (e) => e.status === 409);
  assert.equal(server.calls.filter((c) => c[0] === 'put').length, SITE_SAVE_ATTEMPTS);
  server.putSite = realPut;
  await sync.save();
  assert.equal(server.stored.font, 'lora');
  assert.equal(server.stored.n, SITE_SAVE_ATTEMPTS);
});

test('a save that failed for another reason rejects, and the next one still replays it', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  const realPut = server.putSite;
  // Applied on the server, but the answer never arrived.
  server.putSite = async (next, asked) => {
    await realPut(next, asked);
    throw Object.assign(new Error('Network down'), { status: 0 });
  };
  edit({ title: 'Jo', font: 'lora' });
  await assert.rejects(sync.save(), /Network down/);
  server.putSite = realPut;
  server.edit((s) => ({ ...s, description: 'Hi' }));
  edit({ ...screen.site, layout: 'sidebar' });
  await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo', font: 'lora', description: 'Hi', layout: 'sidebar' });
});

test('reset forgets the edits a discard replaced', async () => {
  const server = fakeServer({ title: 'Jo' });
  const { screen, sync, edit } = editorOn(server, await server.getSite());
  edit({ title: 'Lost', font: 'lora' });
  sync.reset(await server.getSite());
  screen.site = server.stored;
  server.edit((s) => ({ ...s, description: 'Hi' }));
  edit({ ...screen.site, layout: 'sidebar' });
  await sync.save();
  assert.deepEqual(server.stored, { title: 'Jo', description: 'Hi', layout: 'sidebar' });
});
