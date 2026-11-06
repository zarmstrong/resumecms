import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { BLOCK_TYPES } from '../resumeStore.js';
import { httpError } from '../httpError.js';
import { BLOCK_SCHEMAS, blockSchemaFor } from './blockSchemas.js';
import { moveBlockOrder } from './moveBlock.js';

const { version } = createRequire(import.meta.url)('../../package.json');

// Builds the MCP server that exposes the resume editor as tools. It takes
// the store as a parameter (see resumeStore.js / store.js) instead of
// importing it, so createMcpServer.test.js can drive the tools against an
// in-memory fake over the SDK's InMemoryTransport. The tools are thin: merge
// semantics and validation live in the store, so a tool is one call.
//
// routes/mcp.js creates a fresh instance per HTTP request — the SDK binds a
// server to a single transport, so that's unavoidable — but the tool
// definitions (names, descriptions, zod schemas) in TOOLS below are built
// once at module load; createMcpServer() only registers them.
//
// Every tool returns its result as pretty-printed JSON text. Store errors
// propagate as thrown exceptions; the SDK turns them into `isError` tool
// results, and the `[status]` prefix keeps the http-ish status visible to
// the agent (404 → the id is wrong, 400 → the input is wrong, 409/500 →
// state problem). Errors without a status are internal failures: they're
// logged and surfaced as a generic [500]. Every call is also logged as one
// JSON line — the audit trail for a token that grants full editor access.
//
// The install holds several resumes (issue #53). Every content tool takes an
// optional resumeId (scopedToResume below): omitted, it acts on the default
// resume, as the unprefixed REST routes do; given, on that one, through
// store.forResume() (an unknown id is a 404). The resume tools manage the
// resumes themselves.

const INSTRUCTIONS = `resumecms edits a single-user resume site that can hold several resumes (e.g. one tailored per kind of job).

Resumes: list_resumes shows them. Every content tool takes an optional resumeId; without it, it acts on the DEFAULT resume (the one the main domain shows). A new resume (create_resume, optionally copying another's draft with copyFrom) is private and unpublished; update_resume makes it public, gives it domains, or makes it the default. To tailor a resume for an audience or a job posting, copy it, rewrite the copy's blocks yourself (emphasis and wording only: never add a skill, technology or claim the resume doesn't already support), and record the brief as its tailoring.

Content model: a resume is an ordered list of blocks ({ id, type, position, parentId, visibleWeb, visiblePrint, data }). Types: heading, summary, skills_group, experience, education, custom. An experience, skills_group, education, or custom block may be nested one level under a heading via parentId; heading and summary are always top-level. Call get_block_schemas for each type's data shape — the server type-checks the documented keys (e.g. bullets must be an array) and rejects a mismatch with a 400, but doesn't check enum values or unknown keys.

Draft vs published: every write tool changes the DRAFT only, of one resume. Nothing is visible on the public site or PDF until you call publish for that resume. get_publish_status reports whether unpublished changes exist; discard_draft throws the draft away. Prefer reading with get_draft (everything at once) and editing with update_block (which merges data keys) and move_block (which handles ordering for you).`;

const BLOCK_TYPE_ENUM = z.enum(BLOCK_TYPES);
const jsonObject = () => z.record(z.string(), z.unknown());
const nullableParentId = () =>
  z.string().nullable().describe('Id of a top-level heading block to nest under, or null for top level.');

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutating = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const resumeIdArg = () =>
  z.string().describe('Resume to act on (an id from list_resumes). Omit for the default resume, the one the main domain shows.');
// The required resumeId of the tools that manage a resume rather than its content.
const requiredResumeId = () => z.string().describe('Resume id.');
// The brief a resume is tailored for (ai/brief.js checks it and its caps).
// Only a note on the resume: it changes nothing in the content.
const tailoringArg = () =>
  z
    .object({
      audience: z.string().describe('Who it is for, e.g. "security engineering roles". Required.'),
      posting: z.string().optional().describe('The job posting it targets, pasted.'),
      guidance: z.string().optional().describe('Extra guidance for tailoring.'),
    })
    .describe(
      'The brief this resume is tailored for, which the editor shows and pre-fills when re-tailoring. Record it when you tailor a resume\'s content for an audience or job.'
    );

const orderOf = (blocks) => blocks.map((b) => ({ id: b.id, type: b.type, parentId: b.parentId ?? null }));

// Each entry: the registerTool config plus `run(store, args)`.
const SCHEMA_TOOL = {
  name: 'get_block_schemas',
  config: {
    title: 'Describe block data shapes',
    description:
      'Documents the `data` shape of each block type (and the header and site-settings objects). These shapes come from the editor UI. The server type-checks the documented block keys on write (a wrong kind of value, e.g. bullets as a string, is a 400) but not enum values or unknown keys, and stores the header and site settings as-is — so follow the shapes to keep the editor and templates rendering correctly.',
    inputSchema: {
      type: BLOCK_TYPE_ENUM.optional().describe('Return only this block type (omit for everything, including header and site).'),
    },
    annotations: readOnly,
  },
  run: (store, { type }) => (type ? blockSchemaFor(type) : BLOCK_SCHEMAS),
};

// The tools that act on one resume's content; scopedToResume() gives each
// its resumeId argument, so `store` in their run() is already the right one.
const CONTENT_TOOLS = [
  // ---- reading -------------------------------------------------------------
  {
    name: 'get_draft',
    config: {
      title: 'Get the whole draft',
      description:
        'Returns the current DRAFT in one call: { header, site, blocks } with blocks in display order (a heading followed by its nested children), including blocks hidden on web or print. This is what the editor shows, not necessarily what is published.',
      annotations: readOnly,
    },
    run: (store) => ({ header: store.getHeader(), site: store.getSite(), blocks: store.listBlocks() }),
  },
  {
    name: 'list_blocks',
    config: {
      title: 'List draft blocks',
      description: 'Returns all DRAFT blocks in display order (a heading followed by its nested children), including hidden ones.',
      annotations: readOnly,
    },
    run: (store) => ({ blocks: store.listBlocks() }),
  },
  {
    name: 'get_block',
    config: {
      title: 'Get one block',
      description: 'Returns a single DRAFT block by id.',
      inputSchema: { id: z.string().describe('Block id.') },
      annotations: readOnly,
    },
    run: (store, { id }) => ({ block: store.getBlock(id) }),
  },
  {
    name: 'get_header',
    config: {
      title: 'Get the header',
      description: 'Returns the DRAFT header (name, title, contact details, links). See get_block_schemas for the shape.',
      annotations: readOnly,
    },
    run: (store) => ({ header: store.getHeader() }),
  },
  {
    name: 'get_site_settings',
    config: {
      title: 'Get site settings',
      description: 'Returns the DRAFT site settings (title, header template, layout, fonts, sizes, colors). See get_block_schemas for the shape.',
      annotations: readOnly,
    },
    run: (store) => ({ site: store.getSite() }),
  },
  {
    name: 'get_publish_status',
    config: {
      title: 'Get publish status',
      description:
        'Returns { publishedAt, isDirty, pdfStale, pdfVersion }. isDirty is true when the draft has changes that are not yet published; pdfStale is true when the PDF on disk was not rendered from the current published snapshot (a publish whose PDF render failed) — a successful publish fixes it. pdfVersion identifies the PDF file currently on disk (null if none).',
      annotations: readOnly,
    },
    run: (store) => store.getPublishStatus(),
  },
  {
    name: 'get_published_resume',
    config: {
      title: 'Get the published resume',
      description:
        'Returns the last PUBLISHED snapshot as the public site (mode "web") or the PDF (mode "print") renders it. Blocks hidden in that mode are returned as content-free placeholders with hidden: true. Use get_draft to see unpublished edits.',
      inputSchema: {
        mode: z.enum(['web', 'print']).default('web').describe('Which visibility flag to apply.'),
      },
      annotations: readOnly,
    },
    run: (store, { mode }) => store.getPublishedResume(mode),
  },

  // ---- writing -------------------------------------------------------------
  {
    name: 'create_block',
    config: {
      title: 'Create a block',
      description:
        'Adds a DRAFT block at the end of its sibling group (top level, or under the heading given by parentId). Only experience, skills_group, education, and custom blocks can be nested; parentId must be a top-level heading. Returns the created block; use move_block to position it.',
      inputSchema: {
        type: BLOCK_TYPE_ENUM.describe('Block type.'),
        data: jsonObject().optional().describe('Block data; see get_block_schemas for the shape of this type.'),
        parentId: nullableParentId().optional(),
      },
      annotations: mutating,
    },
    run: (store, { type, data, parentId }) => ({ block: store.createBlock({ type, data: data || {}, parentId: parentId ?? null }) }),
  },
  {
    name: 'update_block',
    config: {
      title: 'Update a block',
      description:
        "Edits a DRAFT block. `data` is shallow-merged into the block's existing data by default: only the keys you send change, a key set to null is REMOVED (so a literal null can't be stored this way), and arrays (e.g. experience bullets, custom items) are replaced wholesale, so send the full array when changing one entry. Pass replaceData: true (together with data) to replace the whole data object instead. Omit parentId to leave nesting alone; null promotes to top level; a heading id nests the block (it goes to the end of that section — use move_block for placement). At least one of data, visibleWeb, visiblePrint, or parentId is required.",
      inputSchema: {
        id: z.string().describe('Block id.'),
        data: jsonObject().optional().describe('Keys to merge into data (or the full data when replaceData is true).'),
        replaceData: z.boolean().optional().describe('Replace the whole data object instead of merging. Requires data. Default false.'),
        visibleWeb: z.boolean().optional().describe('Show this block on the public web page.'),
        visiblePrint: z.boolean().optional().describe('Show this block in the print/PDF version.'),
        parentId: nullableParentId().optional(),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, args) => {
      const patch = {};
      if (args.data !== undefined) {
        patch.data = args.data;
      } else if (args.replaceData) {
        throw httpError(400, 'replaceData: true requires data (send data: {} to clear the block)');
      }
      if (args.visibleWeb !== undefined) patch.visibleWeb = args.visibleWeb;
      if (args.visiblePrint !== undefined) patch.visiblePrint = args.visiblePrint;
      if (args.parentId !== undefined) patch.parentId = args.parentId;
      if (Object.keys(patch).length === 0) {
        throw httpError(400, 'Nothing to update: send at least one of data, visibleWeb, visiblePrint, or parentId');
      }
      return { block: store.updateBlock(args.id, patch, { mergeData: !args.replaceData }) };
    },
  },
  {
    name: 'move_block',
    config: {
      title: 'Move a block',
      description:
        'Repositions one DRAFT block (a heading moves together with its nested children). Omit parentId to stay in the current section; null promotes to top level; a heading id nests under that heading. Place it with at most one of beforeId / afterId (a sibling in the target group) or index (0-based within the group); with none it goes to the end of the group. Returns the resulting order.',
      inputSchema: {
        id: z.string().describe('Block id to move.'),
        parentId: nullableParentId().optional(),
        beforeId: z.string().optional().describe('Place immediately before this sibling.'),
        afterId: z.string().optional().describe('Place immediately after this sibling.'),
        index: z.number().int().min(0).optional().describe('0-based position within the target sibling group.'),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, args) => {
      const items = moveBlockOrder(store.listBlocks(), args);
      return { ok: true, order: orderOf(store.reorderBlocks(items)) };
    },
  },
  {
    name: 'delete_block',
    config: {
      title: 'Delete a block',
      description: 'Deletes a DRAFT block. Deleting a heading promotes its nested children to top level in place rather than deleting them.',
      inputSchema: { id: z.string().describe('Block id.') },
      annotations: destructive,
    },
    run: (store, { id }) => {
      return store.deleteBlock(id); // 404 for an unknown id
    },
  },
  {
    name: 'reorder_blocks',
    config: {
      title: 'Reorder all blocks',
      description:
        "Sets the complete DRAFT display order. `items` must list EVERY block exactly once, each heading immediately followed by its children, and an item's parentId is the heading it nests under — an OMITTED parentId means top level (this differs from update_block). For moving a single block, move_block is simpler.",
      inputSchema: {
        items: z
          .array(
            z.object({
              id: z.string().describe('Block id.'),
              parentId: z.string().nullable().optional().describe('Heading id to nest under; omit or null for top level.'),
            })
          )
          .describe('Every block, in the desired display order.'),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, { items }) => ({
      ok: true,
      order: orderOf(store.reorderBlocks(items.map(({ id, parentId }) => ({ id, parentId: parentId ?? null })))),
    }),
  },
  {
    name: 'update_header',
    config: {
      title: 'Update the header',
      description:
        'Shallow-merges the given keys into the DRAFT header: only the keys you send change, a key set to null is removed, and `links` is replaced wholesale (send the full array). See get_block_schemas for the shape.',
      inputSchema: { header: jsonObject().describe('Header keys to merge.') },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, { header }) => ({ header: store.setHeader(header, { merge: true }) }),
  },
  {
    name: 'update_site_settings',
    config: {
      title: 'Update site settings',
      description:
        'Shallow-merges the given keys into the DRAFT site settings; `colors` is itself merged one level deep (send only the colors you want to change). A key set to null is removed. See get_block_schemas for the shape and allowed values.',
      inputSchema: {
        site: z
          .looseObject({
            colors: jsonObject().nullable().optional().describe('Color keys to merge into the existing colors (null removes them all).'),
          })
          .describe('Site-setting keys to merge.'),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, { site }) => ({ site: store.setSite(site, { merge: true }) }),
  },
  {
    name: 'publish',
    config: {
      title: 'Publish the draft',
      description:
        'Makes the current DRAFT live: snapshots it for the public site and re-renders the PDF (this can take several seconds). If the response says the PDF render failed, the site content is already live and get_publish_status reports pdfStale: true; a later publish re-renders it.',
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store) => store.publish(),
  },
  {
    name: 'discard_draft',
    config: {
      title: 'Discard the draft',
      description: 'Throws away all unpublished DRAFT changes, restoring the draft from the last published snapshot. Returns the restored draft.',
      annotations: destructive,
    },
    run: (store) => store.discardDraft(),
  },
];

const RESUME_TOOLS = [
  {
    name: 'list_resumes',
    config: {
      title: 'List resumes',
      description:
        'Returns every resume, the default first: { id, slug, name, isDefault, isPublic, hostnames, createdAt, updatedAt, publishedAt, isDirty, pdfStale }. Pass an id as resumeId to the other tools to work on that resume. A public, published resume is shown at /r/<slug> and on its hostnames; the default is what the main domain shows.',
      annotations: readOnly,
    },
    run: (store) => ({ resumes: store.listResumes() }),
  },
  {
    name: 'get_resume',
    config: {
      title: 'Get one resume',
      description: "Returns one resume's settings and publish status (the same shape as list_resumes). Use get_draft with its resumeId for its content.",
      inputSchema: { resumeId: requiredResumeId() },
      annotations: readOnly,
    },
    run: (store, { resumeId }) => ({ resume: store.getResume(resumeId) }),
  },
  {
    name: 'create_resume',
    config: {
      title: 'Create a resume',
      description:
        "Adds a resume, private and unpublished. With copyFrom (a resume id) it starts as a copy of that resume's DRAFT (header, site settings and every block, with new block ids); without it, with the default resume's header and site settings and no blocks. slug (its /r/<slug> link name: lowercase letters, digits and single dashes) is derived from the name when omitted. A copy keeps its source's tailoring brief unless you send one. Returns the new resume; edit it with the content tools and its resumeId, then publish it.",
      inputSchema: {
        name: z.string().describe('Name shown in the editor, e.g. "Sales".'),
        slug: z.string().optional().describe('Link name, e.g. "sales-2026". Must be unused; omit to derive one from the name.'),
        copyFrom: z.string().optional().describe('Id of a resume whose draft to copy. Omit to start without blocks.'),
        tailoring: tailoringArg().optional(),
      },
      annotations: mutating,
    },
    run: (store, args) => ({ resume: store.createResume(args) }),
  },
  {
    name: 'update_resume',
    config: {
      title: 'Update a resume',
      description:
        "Changes a resume's settings; send only what changes. isPublic: true shows a published resume at /r/<slug> (false hides it again and removes its hostnames). hostnames REPLACES its domains (send the full list, [] to remove them all): a request for one of them gets this resume once it's published, and giving it any makes it public. isDefault: true makes it the resume the main domain shows; it must have been published, the default is always public, and there's no un-defaulting (make another one the default instead). tailoring replaces the brief it's tailored for (null removes it). Returns the updated resume.",
      inputSchema: {
        resumeId: requiredResumeId(),
        name: z.string().optional().describe('New name.'),
        slug: z.string().optional().describe('New link name (lowercase letters, digits and single dashes).'),
        isPublic: z.boolean().optional().describe('Whether /r/<slug> (and its hostnames) show it once published.'),
        isDefault: z.boolean().optional().describe('true makes it the default resume.'),
        hostnames: z
          .array(z.string())
          .optional()
          .describe('Its complete list of domains, e.g. ["sales.example.com"]; DNS and the reverse proxy must point them at this server.'),
        tailoring: tailoringArg().nullable().optional(),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    // The SDK's zod parse drops keys that weren't sent, so `patch` holds
    // exactly the fields to change, as a REST PATCH body would.
    run: (store, { resumeId, ...patch }) => {
      if (Object.keys(patch).length === 0) {
        throw httpError(400, 'Nothing to update: send at least one of name, slug, isPublic, isDefault, hostnames, or tailoring');
      }
      return { resume: store.updateResume(resumeId, patch) };
    },
  },
  {
    name: 'delete_resume',
    config: {
      title: 'Delete a resume',
      description:
        "Permanently deletes a resume with its blocks, settings, domains, published version and PDF. The default resume can't be deleted (make another one the default first).",
      inputSchema: { resumeId: requiredResumeId() },
      annotations: destructive,
    },
    run: (store, { resumeId }) => store.deleteResume(resumeId),
  },
];

// A content tool with an optional resumeId: run() gets the store bound to
// that resume (forResume 404s an unknown id), or the default-bound store
// itself when it's omitted, and never sees the argument.
function scopedToResume(tool) {
  return {
    ...tool,
    config: { ...tool.config, inputSchema: { ...tool.config.inputSchema, resumeId: resumeIdArg().optional() } },
    run: (store, { resumeId, ...args }) => tool.run(resumeId === undefined ? store : store.forResume(resumeId), args),
  };
}

const TOOLS = [SCHEMA_TOOL, ...CONTENT_TOOLS.map(scopedToResume), ...RESUME_TOOLS];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

function ok(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export function createMcpServer({ store, log = console }) {
  const server = new McpServer({ name: 'resumecms', version }, { instructions: INSTRUCTIONS });

  const audit = (entry) => log.info(JSON.stringify({ time: new Date().toISOString(), event: 'mcp_tool', ...entry }));

  for (const { name, config, run } of TOOLS) {
    // Zod input errors are handled by the SDK before the callback runs.
    server.registerTool(name, config, async (args) => {
      const startedAt = Date.now();
      // The resume the call named, if any (none means the default).
      const resumeId = typeof args?.resumeId === 'string' ? args.resumeId : undefined;
      try {
        const result = ok(await run(store, args || {}));
        audit({ tool: name, resumeId, ok: true, durationMs: Date.now() - startedAt });
        return result;
      } catch (err) {
        if (err && err.status) {
          audit({ tool: name, resumeId, ok: false, status: err.status, error: err.message, durationMs: Date.now() - startedAt });
          if (err.cause) log.error(`MCP tool ${name}:`, err.cause); // e.g. the Chromium error behind a failed publish
          throw new Error(`[${err.status}] ${err.message}`);
        }
        audit({ tool: name, resumeId, ok: false, status: 500, error: 'internal', durationMs: Date.now() - startedAt });
        log.error(`MCP tool ${name} failed:`, err);
        throw new Error('[500] Internal server error');
      }
    });
  }

  return server;
}
