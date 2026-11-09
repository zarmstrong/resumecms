import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './createMcpServer.js';
import { BLOCK_TYPES, mergeShallow } from '../resumeStore.js';
import { SECTION_KINDS } from '../landingFields.js';

// Drives the tools end to end through the SDK (client ↔ in-memory transport
// ↔ McpServer) against a fake store, so what's tested is the tool surface —
// names, schemas, merge semantics, error surfacing — not the SQL, which
// resumeStore.test.js covers.

const EXPECTED_TOOLS = [
  'create_block',
  'create_cover_letter',
  'create_resume',
  'delete_block',
  'delete_cover_letter',
  'delete_resume',
  'discard_draft',
  'discard_landing_draft',
  'get_block',
  'get_block_schemas',
  'get_cover_letter',
  'get_draft',
  'get_header',
  'get_landing_page',
  'get_publish_status',
  'get_published_resume',
  'get_resume',
  'get_site_settings',
  'list_blocks',
  'list_cover_letters',
  'list_resumes',
  'move_block',
  'publish',
  'publish_landing_page',
  'reorder_blocks',
  'set_landing_page_enabled',
  'update_block',
  'update_cover_letter',
  'update_header',
  'update_landing_page',
  'update_resume',
  'update_site_settings',
  'upload_landing_image',
];

const RESUME_TOOLS = ['create_resume', 'delete_resume', 'get_resume', 'list_resumes', 'update_resume'];
const LANDING_TOOLS = [
  'discard_landing_draft',
  'get_landing_page',
  'publish_landing_page',
  'set_landing_page_enabled',
  'update_landing_page',
  'upload_landing_image',
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
  // The other resumes forResume() hands out, by id: tests put fakes in it.
  const resumes = {};
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
    resumes,
    forResume: (id) => {
      if (!Object.hasOwn(resumes, id)) throw httpError(404, 'Resume not found');
      return resumes[id];
    },
    listResumes: () => [{ id: 'main', isDefault: true }, ...Object.keys(resumes).map((id) => ({ id, isDefault: false }))],
    getResume: (id) => ({ id }),
    createResume: (input) => { calls.push(['createResume', input]); return { id: 'new', ...input }; },
    updateResume: (id, patch) => {
      calls.push(['updateResume', id, patch]);
      if (patch.isDefault === false) throw httpError(409, 'Make another resume the default instead');
      return { id, ...patch };
    },
    deleteResume: (id) => { calls.push(['deleteResume', id]); return { deleted: id }; },
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
    updateBlock: (id, patch, { mergeData = false } = {}) => {
      calls.push(['updateBlock', id, patch, { mergeData }]);
      const b = find(id);
      if (patch.data !== undefined) b.data = mergeData ? mergeShallow(b.data, patch.data, 'data') : patch.data;
      if (patch.visibleWeb !== undefined) b.visibleWeb = patch.visibleWeb;
      if (patch.visiblePrint !== undefined) b.visiblePrint = patch.visiblePrint;
      if (Object.hasOwn(patch, 'parentId')) b.parentId = patch.parentId;
      return { ...b };
    },
    deleteBlock: (id) => {
      calls.push(['deleteBlock', id]);
      find(id); // 404
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
    getLanding: () => ({ headline: 'Zed' }),
    getLandingStatus: () => ({ enabled: false, publishedAt: null, isDirty: false }),
    getLandingContext: () => ({ photoUrl: '', site, resumes: [] }),
    setLanding: (patch, opts) => { calls.push(['setLanding', patch, opts]); return { headline: 'Zed', ...patch }; },
    publishLanding: () => { calls.push(['publishLanding']); return { enabled: false, publishedAt: '2026-01-01T00:00:00.000Z', isDirty: false }; },
    discardLandingDraft: () => { calls.push(['discardLandingDraft']); return { headline: 'Zed' }; },
    setLandingEnabled: (enabled) => { calls.push(['setLandingEnabled', enabled]); return { enabled, publishedAt: null, isDirty: false }; },
    uploadLandingImage: async (bytes, opts) => {
      calls.push(['uploadLandingImage', bytes, opts]);
      return { id: 'a'.repeat(64), mime: 'image/png', width: 1, height: 1, src: `/api/landing/images/${'a'.repeat(64)}` };
    },
    listCoverLetters: () => [{ id: 'l1', title: 'Acme', data: {} }],
    getCoverLetter: (id) => {
      if (id !== 'l1') throw httpError(404, 'Cover letter not found');
      return { id, title: 'Acme', data: {} };
    },
    createCoverLetter: (input) => { calls.push(['createCoverLetter', input]); return { id: 'l2', ...input }; },
    updateCoverLetter: (id, patch, opts) => { calls.push(['updateCoverLetter', id, patch, opts]); return { id, ...patch }; },
    deleteCoverLetter: (id) => { calls.push(['deleteCoverLetter', id]); return { deleted: id }; },
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
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { data: { jobTitle: 'Lead', company: null, bullets: ['two'] } }, { mergeData: true }]);

  out = (await call('update_block', { id: x.id, data: { jobTitle: 'Only' }, replaceData: true })).json.block;
  assert.deepEqual(out.data, { jobTitle: 'Only' });
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { data: { jobTitle: 'Only' } }, { mergeData: false }]);

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
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { visibleWeb: false }, { mergeData: true }]);

  // parentId null is forwarded as an explicit null; omitted is not sent
  out = (await call('update_block', { id: x.id, parentId: null })).json.block;
  assert.equal(out.parentId, null);
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { parentId: null }, { mergeData: true }]);
  await call('update_block', { id: x.id, parentId: h.id });
  assert.deepEqual(store.calls.at(-1), ['updateBlock', x.id, { parentId: h.id }, { mergeData: true }]);

  assert.deepEqual((await call('delete_block', { id: noData.id })).json, { ok: true });
  assert.deepEqual(store.calls.at(-1), ['deleteBlock', noData.id]);
  const gone = await call('delete_block', { id: 'nope' });
  assert.equal(gone.isError, true);
  assert.match(gone.text, /\[404\] Block not found/);
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

test('every content tool takes an optional resumeId; the resume and landing page tools and get_block_schemas do not', async (t) => {
  const { client, close } = await connect(fakeStore());
  t.after(close);
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const { properties = {}, required = [] } = tool.inputSchema;
    if (tool.name === 'get_block_schemas' || LANDING_TOOLS.includes(tool.name)) {
      assert.equal(properties.resumeId, undefined, tool.name);
    } else if (RESUME_TOOLS.includes(tool.name)) {
      const takesOne = !['list_resumes', 'create_resume'].includes(tool.name);
      assert.equal(required.includes('resumeId'), takesOne, tool.name);
    } else {
      assert.ok(properties.resumeId?.description, `${tool.name} needs a resumeId`);
      assert.ok(!required.includes('resumeId'), `${tool.name}'s resumeId must be optional`);
    }
  }
});

test('a resumeId sends the call to that resume, without it to the default, and an unknown one is a 404', async (t) => {
  const store = fakeStore();
  const sales = fakeStore();
  store.resumes.sales = sales;
  const { call, logged, close } = await connect(store);
  t.after(close);

  const block = (await call('create_block', { resumeId: 'sales', type: 'summary', data: { text: 'Sells' } })).json.block;
  assert.deepEqual(sales.blocks.map((b) => b.id), [block.id]);
  assert.equal(store.blocks.length, 0);
  assert.deepEqual((await call('get_draft', { resumeId: 'sales' })).json.blocks.map((b) => b.id), [block.id]);
  assert.deepEqual((await call('get_draft')).json.blocks, []);

  // the tool itself never sees resumeId: the patch is what it was without one
  await call('update_block', { resumeId: 'sales', id: block.id, data: { text: 'Sells more' } });
  assert.deepEqual(sales.calls.at(-1), ['updateBlock', block.id, { data: { text: 'Sells more' } }, { mergeData: true }]);
  await call('move_block', { resumeId: 'sales', id: block.id, index: 0 });
  assert.equal(sales.calls.at(-1)[0], 'reorderBlocks');
  await call('publish', { resumeId: 'sales' });
  assert.equal(sales.calls.at(-1)[0], 'publish');
  assert.equal((await call('update_header', { resumeId: 'sales', header: { title: 'Seller' } })).json.header.title, 'Seller');
  assert.equal((await call('get_header')).json.header.title, undefined, "the default's header is untouched");
  assert.equal(store.calls.length, 0);

  const unknown = await call('delete_block', { resumeId: 'nope', id: block.id });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.text, '[404] Resume not found');
  assert.equal(sales.blocks.length, 1);

  const audited = logged.info.map(({ tool, resumeId, ok }) => [tool, resumeId, ok]);
  assert.deepEqual(audited.at(0), ['create_block', 'sales', true]);
  assert.deepEqual(audited.at(2), ['get_draft', undefined, true]);
  assert.deepEqual(audited.at(-1), ['delete_block', 'nope', false]);
});

test('the resume tools hand the store exactly what was sent', async (t) => {
  const store = fakeStore();
  store.resumes.sales = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);

  assert.deepEqual((await call('list_resumes')).json.resumes.map((r) => r.id), ['main', 'sales']);
  assert.deepEqual((await call('get_resume', { resumeId: 'sales' })).json.resume, { id: 'sales' });

  await call('create_resume', { name: 'Sales' });
  assert.deepEqual(store.calls.at(-1), ['createResume', { name: 'Sales' }]);
  await call('create_resume', { name: 'Ops', slug: 'ops', copyFrom: 'sales' });
  assert.deepEqual(store.calls.at(-1), ['createResume', { name: 'Ops', slug: 'ops', copyFrom: 'sales' }]);
  assert.equal((await call('create_resume', {})).isError, true, 'name is required');

  const updated = (await call('update_resume', { resumeId: 'sales', hostnames: ['sales.example.com'], isPublic: true })).json.resume;
  assert.deepEqual(updated, { id: 'sales', isPublic: true, hostnames: ['sales.example.com'] });
  assert.deepEqual(store.calls.at(-1), ['updateResume', 'sales', { isPublic: true, hostnames: ['sales.example.com'] }]);
  await call('update_resume', { resumeId: 'sales', hostnames: [] });
  assert.deepEqual(store.calls.at(-1), ['updateResume', 'sales', { hostnames: [] }]);

  // the tailoring brief goes through as sent, and null clears it
  const brief = { audience: 'SRE roles', posting: 'We need on-call experience.' };
  await call('create_resume', { name: 'Acme', copyFrom: 'sales', tailoring: brief });
  assert.deepEqual(store.calls.at(-1), ['createResume', { name: 'Acme', copyFrom: 'sales', tailoring: brief }]);
  await call('create_resume', { name: 'Fresh', copyFrom: 'sales', tailoring: null });
  assert.deepEqual(store.calls.at(-1), ['createResume', { name: 'Fresh', copyFrom: 'sales', tailoring: null }], "null opts a copy out of its source's");
  await call('update_resume', { resumeId: 'sales', tailoring: brief });
  assert.deepEqual(store.calls.at(-1), ['updateResume', 'sales', { tailoring: brief }]);
  await call('update_resume', { resumeId: 'sales', tailoring: null });
  assert.deepEqual(store.calls.at(-1), ['updateResume', 'sales', { tailoring: null }]);
  assert.equal((await call('update_resume', { resumeId: 'sales', tailoring: { posting: 'x' } })).isError, true, 'audience is required');

  const callsBefore = store.calls.length;
  const nothing = await call('update_resume', { resumeId: 'sales' });
  assert.equal(nothing.isError, true);
  assert.match(nothing.text, /\[400\] Nothing to update/);
  assert.equal(store.calls.length, callsBefore, 'the store must not be touched');

  const conflict = await call('update_resume', { resumeId: 'main', isDefault: false });
  assert.equal(conflict.text, '[409] Make another resume the default instead');

  assert.deepEqual((await call('delete_resume', { resumeId: 'sales' })).json, { deleted: 'sales' });
  assert.deepEqual(store.calls.at(-1), ['deleteResume', 'sales']);
});

test('landing page tools: merge-update, publish, discard, enable', async (t) => {
  const store = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);

  const got = (await call('get_landing_page')).json;
  assert.deepEqual(Object.keys(got).sort(), ['context', 'landing', 'status']);

  const links = [{ type: 'github', label: 'gh', url: 'https://github.com/zed' }];
  const sections = [{ kind: 'text', body: 'Hello' }, { id: 'l', kind: 'links', title: 'Find me', links }];
  await call('update_landing_page', { headline: 'Hi', subheadline: null, sections });
  assert.deepEqual(store.calls.at(-1), ['setLanding', { headline: 'Hi', subheadline: null, sections }, { merge: true }]);
  // a section's kind picks its fields
  assert.equal((await call('update_landing_page', { sections: [{ kind: 'html', body: '<b>' }] })).isError, true);
  const more = [
    { kind: 'quotes', hidden: true, quotes: [{ text: 'Great', name: 'Ann', role: 'Manager', url: '' }] },
    { kind: 'experience', resumeId: 'sales', count: 2, showDates: false },
    { kind: 'items', items: [{ title: 'Tool', meta: '2024 · Rust' }] },
  ];
  await call('update_landing_page', { sections: more });
  assert.deepEqual(store.calls.at(-1), ['setLanding', { sections: more }, { merge: true }]);
  assert.equal((await call('update_landing_page', { sections: [{ kind: 'experience' }] })).isError, true);
  // a resumeId isn't a landing page field (the page belongs to the install)
  await call('update_landing_page', { headline: 'Hi', resumeId: 'sales' });
  assert.deepEqual(store.calls.at(-1), ['setLanding', { headline: 'Hi' }, { merge: true }]);

  const callsBefore = store.calls.length;
  const nothing = await call('update_landing_page', {});
  assert.match(nothing.text, /\[400\] Nothing to update/);
  assert.equal(store.calls.length, callsBefore);
  assert.equal((await call('update_landing_page', { photo: 'gravatar' })).isError, true);

  assert.ok((await call('publish_landing_page')).json.publishedAt);
  assert.deepEqual((await call('discard_landing_draft')).json, { landing: { headline: 'Zed' } });
  assert.equal((await call('set_landing_page_enabled', { enabled: true })).json.enabled, true);
  assert.deepEqual(store.calls.at(-1), ['setLandingEnabled', true]);
  assert.equal((await call('set_landing_page_enabled', {})).isError, true);

  const schemas = (await call('get_block_schemas')).json;
  assert.deepEqual(schemas.landing.properties.sections.items.oneOf.map((s) => s.properties.kind.const), SECTION_KINDS);
});

test('upload_landing_image decodes base64 (or a data: URL) under its own cap, and image references pass through', async (t) => {
  const store = fakeStore();
  const { call, close } = await connect(store);
  t.after(close);

  const bytes = Buffer.from('not really a png, the store re-encodes');
  const uploaded = await call('upload_landing_image', { data: bytes.toString('base64') });
  assert.equal(uploaded.json.id, 'a'.repeat(64));
  const [name, sent, opts] = store.calls.at(-1);
  assert.equal(name, 'uploadLandingImage');
  assert.ok(sent.equals(bytes));
  assert.ok(opts.maxInputBytes < 2 * 1024 * 1024); // the JSON-RPC body's own cap
  await call('upload_landing_image', { data: `data:image/png;base64,${bytes.toString('base64')}` });
  assert.ok(store.calls.at(-1)[1].equals(bytes));

  const callsBefore = store.calls.length;
  assert.match((await call('upload_landing_image', { data: 'not base64!' })).text, /\[400\]/);
  assert.match((await call('upload_landing_image', { data: '' })).text, /\[400\]/);
  assert.match((await call('upload_landing_image', { data: 'A'.repeat(2_000_000) })).text, /\[413\]/);
  assert.equal(store.calls.length, callsBefore);

  const image = { imageId: 'a'.repeat(64), alt: 'Me' };
  const sections = [{ kind: 'image', image, caption: 'Hi' }, { kind: 'items', items: [{ title: 'P', image }] }];
  await call('update_landing_page', { photo: 'upload', photoImage: image, sections, seo: { image } });
  assert.deepEqual(store.calls.at(-1), ['setLanding', { photo: 'upload', photoImage: image, sections, seo: { image } }, { merge: true }]);
  // alt is required
  assert.equal((await call('update_landing_page', { photoImage: { imageId: 'a'.repeat(64) } })).isError, true);
});

test('cover letter tools: create, merge or replace on update, delete, scoped by resumeId', async (t) => {
  const store = fakeStore();
  const sales = fakeStore();
  store.resumes.sales = sales;
  const { call, close } = await connect(store);
  t.after(close);

  assert.equal((await call('list_cover_letters')).json.coverLetters[0].id, 'l1');
  assert.match((await call('get_cover_letter', { letterId: 'nope' })).text, /^\[404\]/);

  const data = { salutation: 'Dear Jane,', paragraphs: ['One', 'Two'] };
  await call('create_cover_letter', { title: 'Acme', data, resumeId: 'sales' });
  // the resumeId picked the store; it never reaches the letter
  assert.deepEqual(sales.calls.at(-1), ['createCoverLetter', { title: 'Acme', data }]);

  await call('update_cover_letter', { letterId: 'l1', data: { closing: null } });
  assert.deepEqual(store.calls.at(-1), ['updateCoverLetter', 'l1', { data: { closing: null } }, { mergeData: true }]);
  await call('update_cover_letter', { letterId: 'l1', title: 'Acme SRE', data, replaceData: true });
  assert.deepEqual(store.calls.at(-1), ['updateCoverLetter', 'l1', { title: 'Acme SRE', data }, { mergeData: false }]);

  const callsBefore = store.calls.length;
  assert.match((await call('update_cover_letter', { letterId: 'l1' })).text, /\[400\] Nothing to update/);
  assert.match((await call('update_cover_letter', { letterId: 'l1', replaceData: true })).text, /\[400\] replaceData/);
  assert.equal(store.calls.length, callsBefore);

  assert.deepEqual((await call('delete_cover_letter', { letterId: 'l1' })).json, { deleted: 'l1' });
  assert.ok((await call('get_block_schemas')).json.coverLetter.properties.paragraphs);
});
