import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './createMcpServer.js';
import { BLOCK_TYPES, mergeShallow } from '../resumeStore.js';

// Drives the tools end to end through the SDK (client ↔ in-memory transport
// ↔ McpServer) against a fake store, so what's tested is the tool surface —
// names, schemas, merge semantics, error surfacing — not the SQL, which
// resumeStore.test.js covers.

const EXPECTED_TOOLS = [
  'create_block',
  'delete_block',
  'discard_draft',
  'get_block',
  'get_block_schemas',
  'get_draft',
  'get_header',
  'get_publish_status',
  'get_published_resume',
  'get_site_settings',
  'list_blocks',
  'move_block',
  'publish',
  'reorder_blocks',
  'update_block',
  'update_header',
  'update_site_settings',
];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fakeStore() {
  let seq = 0;
  const blocks = [];
  let header = { name: 'Zed', email: 'z@x', links: [{ type: 'github', label: 'gh', url: 'https://g' }] };
  let site = { title: 'T', font: 'inter', colors: { accent: '#111111', heading: '#222222' } };
  const calls = [];
  const find = (id) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) throw httpError(404, 'Block not found');
    return b;
  };
  const ordered = () => {
    const out = [];
    for (const b of blocks.filter((x) => x.parentId == null)) {
      out.push(b);
      out.push(...blocks.filter((x) => x.parentId === b.id));
    }
    return out.map((b) => ({ ...b }));
  };
  return {
    calls,
    blocks,
    getHeader: () => ({ ...header }),
    setHeader: (h, opts) => { header = opts?.merge ? mergeShallow(header, h, 'header') : h; return { ...header }; },
    getSite: () => ({ ...site }),
    setSite: (s, opts) => {
      if (opts?.merge) {
        const { colors, ...rest } = s;
        const next = mergeShallow(site, rest, 'site');
        if (colors === null) delete next.colors;
        else if (colors !== undefined) next.colors = mergeShallow(site.colors, colors, 'site.colors');
        site = next;
      } else {
        site = s;
      }
      return { ...site };
    },
    listBlocks: () => ordered(),
    getBlock: (id) => ({ ...find(id) }),
    createBlock: ({ type, data, parentId }) => {
      const b = { id: `b${++seq}`, type, position: 0, parentId: parentId ?? null, visibleWeb: true, visiblePrint: true, data };
      blocks.push(b);
      return { ...b };
    },
    updateBlock: (id, patch) => {
      calls.push(['updateBlock', id, patch]);
      const b = find(id);
      if (patch.data !== undefined) b.data = patch.mergeData ? mergeShallow(b.data, patch.data, 'data') : patch.data;
      if (patch.visibleWeb !== undefined) b.visibleWeb = patch.visibleWeb;
      if (patch.visiblePrint !== undefined) b.visiblePrint = patch.visiblePrint;
      if (Object.hasOwn(patch, 'parentId')) b.parentId = patch.parentId;
      return { ...b };
    },
    deleteBlock: (id) => {
      calls.push(['deleteBlock', id]);
      const i = blocks.findIndex((x) => x.id === id);
      if (i >= 0) blocks.splice(i, 1);
      return { ok: true };
    },
    reorderBlocks: (items) => {
      calls.push(['reorderBlocks', items]);
      const byId = new Map(blocks.map((b) => [b.id, b]));
      blocks.length = 0;
      for (const { id, parentId } of items) blocks.push({ ...byId.get(id), parentId: parentId ?? null });
      return ordered();
    },
    getPublishStatus: () => ({ publishedAt: null, isDirty: true }),
    publish: async () => { calls.push(['publish']); return { publishedAt: '2026-01-01T00:00:00.000Z' }; },
    discardDraft: () => { calls.push(['discardDraft']); return { header, site, blocks: ordered() }; },
    getPublishedResume: (mode) => ({ header, site, blocks: [], mode }),
  };
}

async function connect(store) {
  const logged = { info: [], error: [] };
  const log = { info: (line) => logged.info.push(JSON.parse(line)), error: (...args) => logged.error.push(args) };
  const server = createMcpServer({ store, log });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content.map((c) => c.text).join('');
    return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) };
  };
  return { client, server, call, logged, close: async () => { await client.close(); await server.close(); } };
}

test('exposes exactly the documented tools, with descriptions and instructions', async (t) => {
  const { client, call, close } = await connect(fakeStore());
  t.after(close);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), EXPECTED_TOOLS);
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
    assert.ok(tool.annotations, `${tool.name} needs annotations`);
  }
  assert.match(client.getInstructions(), /DRAFT/);
  const update = tools.find((x) => x.name === 'update_block');
  assert.ok(update.inputSchema.properties.data.description, 'zod .describe() must reach the schema');
  const schemas = await call('get_block_schemas');
  assert.deepEqual(Object.keys(schemas.json.blocks).sort(), [...BLOCK_TYPES].sort());
  assert.ok(schemas.json.header && schemas.json.site);
  const one = await call('get_block_schemas', { type: 'experience' });
  assert.equal(one.json.type, 'experience');
  assert.ok(one.json.schema.properties.bullets);
});

test('block round trip: create, read, merge-update, replace, visibility, parent, delete', async (t) => {
  const store = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);

  const h = (await call('create_block', { type: 'heading', data: { text: 'Work' } })).json.block;
  assert.equal(h.type, 'heading');
  const x = (await call('create_block', { type: 'experience', data: { jobTitle: 'Dev', company: 'Co', bullets: ['one'] }, parentId: h.id })).json.block;
  assert.equal(x.parentId, h.id);
  const noData = (await call('create_block', { type: 'summary' })).json.block;
  assert.deepEqual(noData.data, {});

  const draft = (await call('get_draft')).json;
  assert.deepEqual(draft.blocks.map((b) => b.id), [h.id, x.id, noData.id]);
  assert.equal(draft.header.name, 'Zed');
  assert.deepEqual((await call('list_blocks')).json.blocks.map((b) => b.id), [h.id, x.id, noData.id]);
  assert.equal((await call('get_block', { id: x.id })).json.block.company, undefined);

  // merge keeps the other keys; null deletes; arrays replace wholesale
  let out = (await call('update_block', { id: x.id, data: { jobTitle: 'Lead', company: null, bullets: ['two'] } })).json.block;
  assert.deepEqual(out.data, { jobTitle: 'Lead', bullets: ['two'] });
  // the store received the patch flagged for merging and no parentId key
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { data: { jobTitle: 'Lead', company: null, bullets: ['two'] }, mergeData: true }]);

  out = (await call('update_block', { id: x.id, data: { jobTitle: 'Only' }, replaceData: true })).json.block;
  assert.deepEqual(out.data, { jobTitle: 'Only' });
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { data: { jobTitle: 'Only' } }]);

  // replaceData without data, or no fields at all, is a 400 — not a silent
  // no-op that still marks the draft dirty
  const callsBefore = store.calls.length;
  const noDataArg = await call('update_block', { id: x.id, replaceData: true });
  assert.equal(noDataArg.isError, true);
  assert.match(noDataArg.text, /\[400\] replaceData: true requires data/);
  const nothing = await call('update_block', { id: x.id });
  assert.equal(nothing.isError, true);
  assert.match(nothing.text, /\[400\] Nothing to update/);
  assert.equal(store.calls.length, callsBefore, 'the store must not be touched');

  out = (await call('update_block', { id: x.id, visibleWeb: false })).json.block;
  assert.equal(out.visibleWeb, false);
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { visibleWeb: false }]);

  // parentId null is forwarded as an explicit null; omitted is not sent
  out = (await call('update_block', { id: x.id, parentId: null })).json.block;
  assert.equal(out.parentId, null);
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { parentId: null }]);
  await call('update_block', { id: x.id, parentId: h.id });
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { parentId: h.id }]);

  assert.deepEqual((await call('delete_block', { id: noData.id })).json, { ok: true });
  assert.deepEqual(store.calls.at(-1), ['deleteBlock', noData.id]);
  const gone = await call('delete_block', { id: 'nope' });
  assert.equal(gone.isError, true);
  assert.match(gone.text, /\[404\] Block not found/);
  assert.ok(!store.calls.some((c) => c[0] === 'deleteBlock' && c[1] === 'nope'), 'unknown id must not reach the store');
});

test('move_block and reorder_blocks hand the store a complete order', async (t) => {
  const store = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);
  const s = (await call('create_block', { type: 'summary' })).json.block;
  const h = (await call('create_block', { type: 'heading' })).json.block;
  const a = (await call('create_block', { type: 'experience', parentId: h.id })).json.block;
  const b = (await call('create_block', { type: 'experience', parentId: h.id })).json.block;

  let out = (await call('move_block', { id: b.id, beforeId: a.id })).json;
  assert.equal(out.ok, true);
  assert.deepEqual(out.order.map((o) => o.id), [s.id, h.id, b.id, a.id]);
  assert.deepEqual(store.calls.at(-1), ['reorderBlocks', [{ id: s.id, parentId: null }, { id: h.id, parentId: null }, { id: b.id, parentId: h.id }, { id: a.id, parentId: h.id }]]);

  out = (await call('move_block', { id: h.id, index: 0 })).json;
  assert.deepEqual(out.order.map((o) => o.id), [h.id, b.id, a.id, s.id]);

  const bad = await call('move_block', { id: a.id, beforeId: b.id, afterId: b.id });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /\[400\]/);

  // omitted parentId → null is what the store sees
  out = (await call('reorder_blocks', { items: [{ id: s.id }, { id: h.id }, { id: a.id, parentId: h.id }, { id: b.id, parentId: h.id }] })).json;
  assert.deepEqual(out.order.map((o) => [o.id, o.parentId]), [[s.id, null], [h.id, null], [a.id, h.id], [b.id, h.id]]);
  assert.deepEqual(store.calls.at(-1)[1][0], { id: s.id, parentId: null });
});

test('header and site updates merge (colors one level deep) and null clears a key', async (t) => {
  const { call, close } = await connect(fakeStore());
  t.after(close);
  let header = (await call('update_header', { header: { title: 'Engineer', email: null } })).json.header;
  assert.deepEqual(header, { name: 'Zed', title: 'Engineer', links: [{ type: 'github', label: 'gh', url: 'https://g' }] });
  header = (await call('update_header', { header: { links: [] } })).json.header;
  assert.deepEqual(header.links, []);
  assert.deepEqual((await call('get_header')).json.header, header);

  let site = (await call('update_site_settings', { site: { layout: 'sidebar', colors: { accent: '#abcdef' } } })).json.site;
  assert.deepEqual(site, { title: 'T', font: 'inter', layout: 'sidebar', colors: { accent: '#abcdef', heading: '#222222' } });
  site = (await call('update_site_settings', { site: { font: null, colors: { heading: null } } })).json.site;
  assert.deepEqual(site, { title: 'T', layout: 'sidebar', colors: { accent: '#abcdef' } });
  assert.deepEqual((await call('get_site_settings')).json.site, site);

  // a non-object colors patch is rejected (merging a string would spread its
  // characters into the colors object), and nothing is written
  for (const colors of ['red', ['#fff'], 7]) {
    const bad = await call('update_site_settings', { site: { colors } });
    assert.equal(bad.isError, true, `colors ${JSON.stringify(colors)} must be rejected`);
    assert.match(bad.text, /colors/);
  }
  assert.deepEqual((await call('get_site_settings')).json.site, site);
  site = (await call('update_site_settings', { site: { colors: null } })).json.site;
  assert.deepEqual(site, { title: 'T', layout: 'sidebar' });
});

test('publish, status, discard, and the published view go through the store', async (t) => {
  const store = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);
  assert.deepEqual((await call('get_publish_status')).json, { publishedAt: null, isDirty: true });
  assert.deepEqual((await call('publish')).json, { publishedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal((await call('get_published_resume')).json.mode, 'web');
  assert.equal((await call('get_published_resume', { mode: 'print' })).json.mode, 'print');
  const bad = await call('get_published_resume', { mode: 'pdf' });
  assert.equal(bad.isError, true);
  assert.ok((await call('discard_draft')).json.header);
  assert.deepEqual(store.calls.map((c) => c[0]), ['publish', 'discardDraft']);
});

test('store errors surface as isError results with their status, and bad input never reaches the store', async (t) => {
  const store = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);
  const missing = await call('get_block', { id: 'zzz' });
  assert.equal(missing.isError, true);
  assert.equal(missing.text, '[404] Block not found');
  const badType = await call('create_block', { type: 'poem' });
  assert.equal(badType.isError, true);
  assert.equal(store.blocks.length, 0);
  const badShape = await call('update_block', { id: 'x', data: 'not-an-object' });
  assert.equal(badShape.isError, true);
});

test('errors without a status are logged and surfaced as a generic [500]', async (t) => {
  const store = fakeStore();
  store.getBlock = () => { throw new Error('SqliteError: database is locked'); };
  const { call, logged, close } = await connect(store);
  t.after(close);
  const res = await call('get_block', { id: 'x' });
  assert.equal(res.isError, true);
  assert.equal(res.text, '[500] Internal server error');
  assert.equal(logged.error.length, 1);
  assert.match(String(logged.error[0][1]), /database is locked/);
});

test('every tool call leaves an audit log line', async (t) => {
  const { call, logged, close } = await connect(fakeStore());
  t.after(close);
  await call('get_header');
  await call('update_header', { header: { name: 'New' } });
  await call('get_block', { id: 'missing' });
  assert.deepEqual(
    logged.info.map(({ event, tool, ok, status }) => [event, tool, ok, status]),
    [
      ['mcp_tool', 'get_header', true, undefined],
      ['mcp_tool', 'update_header', true, undefined],
      ['mcp_tool', 'get_block', false, 404],
    ]
  );
  for (const line of logged.info) {
    assert.ok(line.time && typeof line.durationMs === 'number');
  }
});
