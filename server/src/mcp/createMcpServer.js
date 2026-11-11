import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { BLOCK_TYPES } from '../resumeStore.js';
import { httpError } from '../httpError.js';
import { ACTION_ICONS, ACTION_OPENS, CREDENTIAL_KINDS, LANDING_LIMITS, LINK_TYPES, PHOTO_SOURCES, SECTION_COLUMNS } from '../landingFields.js';
import { FONT_IDS, LANDING_STYLE_SOURCES } from '../landingStyle.js';
import { LANDING_IMAGE_LIMITS } from '../landingImageFields.js';
import { PUBLICATION_KINDS, PUBLICATION_ORDERS } from '../publications.js';
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

Resumes: list_resumes shows them. Every content tool takes an optional resumeId; without it, it acts on the DEFAULT resume (the one the main domain shows). A new resume (create_resume, optionally copying another's draft with copyFrom) is private and unpublished; update_resume makes it public, gives it domains, or makes it the default. To tailor a resume for an audience or a job posting, copy it, rewrite the copy's blocks yourself (emphasis and wording only: never add a skill, technology or claim the resume doesn't already support), and record the brief as its tailoring. To leave something out of a tailored resume, hide it (visibleWeb/visiblePrint on the block, or on a bullet in its data) rather than deleting it, and reorder with move_block.

Content model: a resume is an ordered list of blocks ({ id, type, position, parentId, visibleWeb, visiblePrint, data }). Types: heading, summary, executive_summary, skills_group, experience, education, custom. An experience, skills_group, education, custom, or executive_summary block may be nested one level under a heading via parentId; heading and summary are always top-level. Call get_block_schemas for each type's data shape — the server type-checks the documented keys (e.g. bullets must be an array) and rejects a mismatch with a 400, but doesn't check enum values or unknown keys.

Draft vs published: every write tool changes the DRAFT only, of one resume. Nothing is visible on the public site or PDF until you call publish for that resume. get_publish_status reports whether unpublished changes exist; discard_draft throws the draft away. Prefer reading with get_draft (everything at once) and editing with update_block (which merges data keys) and move_block (which handles ordering for you).

Cover letters: each resume can keep cover letters (list_cover_letters, create_cover_letter, update_cover_letter, ...; resumeId as for content). A letter is drawn under its resume's header in its look, and is private: no draft/publish, never on the public site. To write one for a job posting, read the resume (get_draft) and its tailoring (get_resume), and claim nothing the resume doesn't support.

Landing page: the install can also have a short home page at / (a headline, a photo, and a list of sections: text, items such as projects, links, quotes, a short timeline of a resume's latest roles, images, cards linking to some of the resumes, dividers, a row of large figures with labels, questions and answers (faq), a resume's latest education entries or its skill groups, credentials (licenses, certifications and memberships, each leaving the page once its expiry date passes), galleries of images, services (what you offer, each with a short description, an optional price line and an optional button), a video or audio clip (media: one YouTube, Vimeo, SoundCloud or Spotify link, loaded only when a visitor presses play), publications (papers, articles, books, talks, podcasts and press, sorted newest first or grouped by kind if asked), and one contact section (email, phone, service area, address, hours and a "Save contact" vCard); any section can be hidden, and with the split template put in its side column with column: 'side'), which moves the default resume to /resume. It has its own draft and publish: get_landing_page, update_landing_page and publish_landing_page, independent of every resume's. set_landing_page_enabled switches it on or off at once; it only shows once published, and never on a resume's own domain. Its images are uploaded with upload_landing_image and referenced by the id it returns, as { imageId, alt }: the hero photo (photo: 'upload' with photoImage), an item's thumbnail, an image section, a gallery entry, a media section's poster, or seo.image for link previews.`;

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
      'Documents the `data` shape of each block type (and the header, site-settings, landing page and cover letter objects). These shapes come from the editor UI. The server type-checks the documented block keys on write (a wrong kind of value, e.g. bullets as a string, is a 400) but not enum values or unknown keys, and stores the header and site settings as-is — so follow the shapes to keep the editor and templates rendering correctly.',
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
        'Returns { publishedAt, isDirty, pdfStale, pdfVersion, pdfPending }. isDirty is true when the draft has changes that are not yet published; pdfStale is true when the PDF on disk was not rendered from the current published snapshot (a publish whose PDF render failed, or one still rendering) — a successful publish fixes it. pdfVersion identifies the PDF file currently on disk (null if none). pdfPending is true while a PDF render for this resume is queued or running; once it is false, pdfStale says whether the render worked.',
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
        'Adds a DRAFT block at the end of its sibling group (top level, or under the heading given by parentId). Only experience, skills_group, education, custom, and executive_summary blocks can be nested; parentId must be a top-level heading. Returns the created block; use move_block to position it.',
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
        'Makes the current DRAFT live: snapshots it for the public site and re-renders the PDF (this can take several seconds). Returns { publishedAt, pdfVersion, pdfPending }. If the response says the PDF render failed, the site content is already live and get_publish_status reports pdfStale: true; a later publish re-renders it. pdfPending: true means the site is live but the PDF is still rendering (it waited behind a slow render); check get_publish_status until pdfPending is false, and don\'t publish again for it.',
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

  // ---- cover letters (issue #71) -------------------------------------------
  {
    name: 'list_cover_letters',
    config: {
      title: 'List cover letters',
      description:
        "Returns the resume's cover letters, oldest first: { id, resumeId, title, data, createdAt, updatedAt }. See get_block_schemas (coverLetter) for the shape of data.",
      annotations: readOnly,
    },
    run: (store) => ({ coverLetters: store.listCoverLetters() }),
  },
  {
    name: 'get_cover_letter',
    config: {
      title: 'Get one cover letter',
      description: 'Returns one of the resume\'s cover letters by id.',
      inputSchema: { letterId: z.string().describe('Cover letter id.') },
      annotations: readOnly,
    },
    run: (store, { letterId }) => ({ coverLetter: store.getCoverLetter(letterId) }),
  },
  {
    name: 'create_cover_letter',
    config: {
      title: 'Create a cover letter',
      description:
        "Adds a cover letter to the resume. It's drawn under that resume's header in its look, and is private (never published, no draft/publish step). Send data (see get_block_schemas, coverLetter) to write it in one call, or omit it to start from an empty letter; or copyFrom another letter of the same resume to duplicate it. Write only what the resume supports: no skill, job or claim it doesn't have. Returns the letter.",
      inputSchema: {
        title: z.string().optional().describe('Internal name shown in the editor, e.g. "Acme SRE". Defaults to "Cover letter" (or "<source> (copy)").'),
        data: jsonObject().optional().describe('The letter; see get_block_schemas (coverLetter).'),
        copyFrom: z.string().optional().describe('Id of a cover letter of this resume to copy. Not together with data.'),
      },
      annotations: mutating,
    },
    run: (store, args) => ({ coverLetter: store.createCoverLetter(args) }),
  },
  {
    name: 'update_cover_letter',
    config: {
      title: 'Update a cover letter',
      description:
        "Edits a cover letter. `data` is shallow-merged into the letter's data by default: only the keys you send change, a key set to null is REMOVED, and paragraphs is replaced as a whole list (send every paragraph, in order). Pass replaceData: true to replace the whole data object instead. At least one of title or data is required.",
      inputSchema: {
        letterId: z.string().describe('Cover letter id.'),
        title: z.string().optional().describe('New internal name.'),
        data: jsonObject().optional().describe('Keys to merge into data (or the full data when replaceData is true).'),
        replaceData: z.boolean().optional().describe('Replace the whole data object instead of merging. Requires data. Default false.'),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, { letterId, title, data, replaceData }) => {
      if (replaceData && data === undefined) throw httpError(400, 'replaceData: true requires data');
      const patch = {};
      if (title !== undefined) patch.title = title;
      if (data !== undefined) patch.data = data;
      if (Object.keys(patch).length === 0) throw httpError(400, 'Nothing to update: send at least one of title or data');
      return { coverLetter: store.updateCoverLetter(letterId, patch, { mergeData: !replaceData }) };
    },
  },
  {
    name: 'delete_cover_letter',
    config: {
      title: 'Delete a cover letter',
      description: 'Permanently deletes one of the resume\'s cover letters, with its PDF.',
      inputSchema: { letterId: z.string().describe('Cover letter id.') },
      annotations: destructive,
    },
    run: (store, { letterId }) => store.deleteCoverLetter(letterId),
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
        "Adds a resume, private and unpublished. With copyFrom (a resume id) it starts as a copy of that resume's DRAFT (header, site settings and every block, with new block ids); without it, with the default resume's header and site settings and no blocks. slug (its /r/<slug> link name: lowercase letters, digits and single dashes) is derived from the name when omitted. A copy keeps its source's tailoring brief unless you send one (or null for none). Returns the new resume; edit it with the content tools and its resumeId, then publish it.",
      inputSchema: {
        name: z.string().describe('Name shown in the editor, e.g. "Sales".'),
        slug: z.string().optional().describe('Link name, e.g. "sales-2026". Must be unused; omit to derive one from the name.'),
        copyFrom: z.string().optional().describe('Id of a resume whose draft to copy. Omit to start without blocks.'),
        tailoring: tailoringArg().nullable().optional(),
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

// The install's landing page (issue #70; landingStore.js). Not per resume.
const landingLink = () =>
  z.object({
    type: z.enum(LINK_TYPES).optional().describe('Picks the badge it is drawn with; omit for a plain link.'),
    label: z.string().describe('Display text, e.g. "github.com/you".'),
    url: z.string().describe('An http, https, mailto or tel URL (an email link is mailto:you@example.com, a phone link tel:+15555550100).'),
  });
const landingCard = () =>
  z.object({
    resumeId: z.string().describe('A resume id from list_resumes.'),
    label: z.string().optional().describe("Card title, e.g. \"Engineering\". Empty uses the resume's published header title (never its internal name)."),
    blurb: z.string().optional().describe('A line or two about this resume.'),
    showPdf: z.boolean().optional().describe('Also link to its PDF, while it has one.'),
  });
const actionIcon = () =>
  z
    .enum(['', ...ACTION_ICONS])
    .optional()
    .describe("A Font Awesome icon drawn before the button text, e.g. 'envelope', 'calendar-days', 'file-pdf' or 'linkedin'; omitted or '' for none.");
const landingAction = () =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('link'),
      label: z.string().optional().describe('Button text, e.g. "Email me". Empty shows the URL.'),
      url: z.string().describe('An http, https, mailto or tel URL; mailto:you@example.com?subject=Hello prefills a subject.'),
      icon: actionIcon(),
    }),
    z.object({
      type: z.literal('resume'),
      label: z.string().optional().describe('Button text. Empty says "View my resume" or "Download my resume (PDF)".'),
      resumeId: z.string().describe('A resume id from list_resumes.'),
      open: z.enum(ACTION_OPENS).optional().describe("'page' (default) opens the resume, 'pdf' its PDF. Shown only while the resume is public and published, and for 'pdf' has a rendered PDF."),
      icon: actionIcon(),
    }),
  ]);
const landingImage = () =>
  z.object({
    imageId: z.string().describe("An id from upload_landing_image (or get_landing_page's context.images)."),
    alt: z.string().describe(`What the image shows, for screen readers and link previews (at most ${LANDING_IMAGE_LIMITS.alt} characters).`),
  });
const landingItem = () =>
  z.object({
    title: z.string().optional().describe('e.g. a project name.'),
    text: z.string().optional().describe('A line or two about it; may hold [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is.'),
    url: z.string().optional().describe('An optional http, https, mailto or tel link for its title.'),
    meta: z.string().optional().describe('An optional short line shown muted under the title, e.g. "2024 · Rust · Open source".'),
    image: landingImage().nullable().optional().describe('An optional thumbnail; null removes it.'),
  });
const landingGalleryEntry = () =>
  z.object({
    image: landingImage().nullable().optional().describe('The image; null while there is none yet.'),
    caption: z.string().optional().describe(`Plain text shown under it, at most ${LANDING_IMAGE_LIMITS.caption} characters.`),
  });
const landingQuote = () =>
  z.object({
    text: z.string().optional().describe("The quote itself, plain text. A quote without text isn't shown."),
    name: z.string().optional().describe('Who said it.'),
    role: z.string().optional().describe('e.g. "Engineering manager, Acme".'),
    url: z.string().optional().describe('An optional http, https, mailto or tel link for their name.'),
  });
const landingStat = () =>
  z.object({
    value: z.string().optional().describe(`The figure, plain text (at most 16 characters), e.g. "2,000+", "98%", "$4.2M", "15 years". A stat without a value isn't shown.`),
    label: z.string().optional().describe('What it counts, shown under it (at most 80 characters), e.g. "patients cared for".'),
  });
const landingFaqEntry = () =>
  z.object({
    question: z.string().optional().describe('Plain text, at most 200 characters.'),
    answer: z
      .string()
      .optional()
      .describe("Shown collapsed under the question, at most 1500 characters; may hold [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is. An entry without both a question and an answer isn't shown."),
  });
const landingCredential = () =>
  z.object({
    kind: z.enum(CREDENTIAL_KINDS).optional().describe("Only picks the label shown with it (default 'certification')."),
    name: z.string().optional().describe("e.g. \"Registered Nurse\". One without a name isn't shown."),
    issuer: z.string().optional().describe('Who issued it, e.g. "Oregon State Board of Nursing".'),
    number: z.string().optional().describe("An optional license or certificate number, shown as written. Some are public record, some aren't."),
    issued: z.string().optional().describe('When it was issued, shown as written, e.g. "Mar 2021".'),
    expires: z
      .string()
      .optional()
      .describe('When it expires. Read as YYYY, YYYY-MM, MM/YYYY, "Mar 2027", "March 2027" or YYYY-MM-DD, it leaves the page once that has passed (UTC); anything else is shown as written.'),
    url: z.string().optional().describe("An optional http, https, mailto or tel link, the issuer's page to verify it on, shown as \"Verify\"."),
  });
const landingService = () =>
  z.object({
    title: z.string().optional().describe(`What's offered, plain text (at most ${LANDING_LIMITS.serviceTitle} characters), e.g. "Private tutoring".`),
    text: z
      .string()
      .optional()
      .describe(`A short description (at most ${LANDING_LIMITS.serviceText} characters); may hold [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is. A service without a title or a text isn't shown.`),
    price: z.string().optional().describe(`Free text, never a number (at most ${LANDING_LIMITS.servicePrice} characters), e.g. "From $60/hour", "Free 15-minute consultation", "Sliding scale".`),
    action: z
      .object({
        type: z.literal('link').optional().describe("Always 'link'."),
        label: z.string().optional().describe('Button text, e.g. "Book a session". Empty shows the URL.'),
        url: z.string().describe('An http, https, mailto or tel URL; mailto:you@example.com?subject=Booking prefills a subject.'),
        icon: actionIcon(),
      })
      .nullable()
      .optional()
      .describe('An optional button for this service; null removes it. Shown only while its URL is a full http, https, mailto or tel link.'),
  });
const sectionBase = {
  id: z.string().optional().describe("Keep an existing section's id from get_landing_page; omit it for a new section."),
  title: z.string().optional().describe('Heading shown above the section; empty shows none.'),
  hidden: z.boolean().optional().describe('true keeps the section in the draft without showing it.'),
  column: z.enum(SECTION_COLUMNS).optional().describe("'side' draws it in the side column of a template that has one (split: under the hero); others draw it in order with the rest. Default 'main'."),
};
const landingPublication = () =>
  z.object({
    kind: z.enum(PUBLICATION_KINDS).optional().describe("What it is (default 'article'); picks the label on its line and, with group, its subheading."),
    title: z.string().optional().describe(`At most ${LANDING_LIMITS.publicationTitle} characters. One without a title isn't shown.`),
    outlet: z.string().optional().describe('Where it appeared: a journal, publisher, conference, show or paper.'),
    date: z
      .string()
      .optional()
      .describe('Shown as written. Read as YYYY, YYYY-MM, MM/YYYY, "Mar 2024", "March 2024" or YYYY-MM-DD, it sorts with order: \'newest\'; anything else ("Forthcoming") keeps its place.'),
    url: z.string().optional().describe('An optional http, https, mailto or tel link for the title.'),
    doi: z.string().optional().describe('An optional DOI, just 10.<registrant>/<suffix> (no https://doi.org/ or doi: in front); the title links to https://doi.org/<doi> when url is empty.'),
    note: z.string().optional().describe('Plain text under it: co-authors, "invited", "keynote".'),
  });
const landingSection = () =>
  z.discriminatedUnion('kind', [
    z.object({ ...sectionBase, kind: z.literal('text'), body: z.string().optional().describe('Text with [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is; a blank line starts a new paragraph.') }),
    z.object({ ...sectionBase, kind: z.literal('items'), items: z.array(landingItem()).optional() }),
    z.object({ ...sectionBase, kind: z.literal('links'), links: z.array(landingLink()).optional() }),
    z.object({ ...sectionBase, kind: z.literal('resumes'), cards: z.array(landingCard()).optional() }),
    z.object({ ...sectionBase, kind: z.literal('quotes'), quotes: z.array(landingQuote()).optional().describe('Testimonials, at most 10.') }),
    z.object({
      ...sectionBase,
      kind: z.literal('experience'),
      resumeId: z.string().describe("A resume id from list_resumes: its latest roles are shown from its published version, while it's public."),
      count: z.number().int().optional().describe('How many roles to show, 1 to 10 (default 3).'),
      showDates: z.boolean().optional().describe("Show each role's dates (default true)."),
    }),
    z.object({
      ...sectionBase,
      kind: z.literal('image'),
      image: landingImage().nullable().optional().describe('The image; a section without one is left off the public page.'),
      caption: z.string().optional().describe('Plain text shown under it.'),
    }),
    z.object({ ...sectionBase, kind: z.literal('divider') }).describe('A rule across the page; its title, if any, is a label on the rule.'),
    z.object({ ...sectionBase, kind: z.literal('stats'), stats: z.array(landingStat()).optional().describe('A few large figures, at most 6.') }),
    z.object({ ...sectionBase, kind: z.literal('faq'), entries: z.array(landingFaqEntry()).optional().describe('Questions and answers, at most 15, each answer collapsed under its question.') }),
    z.object({
      ...sectionBase,
      kind: z.literal('education'),
      resumeId: z.string().describe("A resume id from list_resumes: its first education entries (degree, institution, location, dates) are shown from its published version, while it's public."),
      count: z.number().int().optional().describe('How many entries to show, 1 to 10 (default 3).'),
      showDates: z.boolean().optional().describe("Show each entry's dates (default true)."),
    }),
    z.object({
      ...sectionBase,
      kind: z.literal('skills'),
      resumeId: z.string().describe("A resume id from list_resumes: every skill group it shows on the web (category and items) is shown from its published version, while it's public."),
    }),
    z.object({
      ...sectionBase,
      kind: z.literal('credentials'),
      credentials: z.array(landingCredential()).optional().describe('Licenses, certifications and memberships, at most 20.'),
    }),
    z
      .object({
        ...sectionBase,
        kind: z.literal('gallery'),
        images: z
          .array(landingGalleryEntry())
          .optional()
          .describe(`At most ${LANDING_LIMITS.galleryImages}, in order. An entry without an image is left out, and a gallery with none is left off the public page.`),
      })
      .describe('Images in a grid, each opening larger when clicked. Never rewritten by AI.'),
    z
      .object({
        ...sectionBase,
        kind: z.literal('media'),
        url: z
          .string()
          .optional()
          .describe(
            "An https link to one YouTube or Vimeo video (a start time in it, t=90, t=1m30s or #t=, is kept), or a SoundCloud track or playlist or a Spotify track, album, playlist, episode or show, as copied from the address bar or the share button. Any other link is a 400; '' while there's none, and then the section is left off the public page."
          ),
        caption: z.string().optional().describe(`Plain text shown under it, at most ${LANDING_LIMITS.mediaCaption} characters.`),
        poster: landingImage().nullable().optional().describe("An optional uploaded image shown before it's played (the provider's own thumbnail is never fetched); null removes it."),
        transcript: z
          .string()
          .optional()
          .describe(`Optional plain text, at most ${LANDING_LIMITS.transcript} characters, shown under a "Transcript" disclosure; a blank line starts a new paragraph.`),
      })
      .describe(
        "One video or audio clip behind a click-to-load facade: nothing loads from the provider until a visitor presses play, and then it plays in the provider's privacy mode where it has one. Never rewritten by AI."
      ),
    z.object({
      ...sectionBase,
      kind: z.literal('services'),
      services: z.array(landingService()).optional().describe(`What you offer, at most ${LANDING_LIMITS.services}, in order.`),
    }),
    z
      .object({
        ...sectionBase,
        kind: z.literal('publications'),
        order: z.enum(PUBLICATION_ORDERS).optional().describe("'manual' (default): as listed; 'newest': entries with a readable date newest first, the others in their places."),
        group: z.boolean().optional().describe('Show each kind under a subheading of its own, in a fixed order (default false).'),
        entries: z.array(landingPublication()).optional().describe(`At most ${LANDING_LIMITS.publications}.`),
      })
      .describe('Published work and appearances, each a linked title over "Outlet · Date · Kind" and a note. Plain text; never rewritten by AI.'),
    z
      .object({
        ...sectionBase,
        kind: z.literal('contact'),
        email: z.string().optional().describe("An email address, linked with mailto:. Not shown until it's a whole address."),
        phone: z.string().optional().describe('A phone number as it should read, linked with tel:. Not shown without digits to dial.'),
        area: z.string().optional().describe('The area served, e.g. "Serving Travis and Williamson counties".'),
        address: z
          .string()
          .optional()
          .describe("A postal address, one line per line, shown with a \"Directions\" link to a map search. It's public: a service area is often better than a home address."),
        hours: z
          .array(z.object({ days: z.string().optional().describe('e.g. "Tue–Sat".'), time: z.string().optional().describe('e.g. "9–6" or "Evenings by appointment".') }))
          .optional()
          .describe(`Opening hours, at most ${LANDING_LIMITS.contactHours} lines, plain text.`),
        vcard: z.boolean().optional().describe('Show a "Save contact" button that downloads a vCard of what the section shows (default true).'),
      })
      .describe('How to reach the person. At most one per page. All plain text; never rewritten by AI.'),
  ]);

const landingColor = (what) => z.string().nullable().optional().describe(`${what}: #rrggbb, or '' (or null) for the default.`);
const landingColors = () =>
  z.object({
    accent: landingColor('Buttons, links and the subheadline'),
    heading: landingColor('The headline and headings'),
    text: landingColor('Body text'),
    background: landingColor('The page'),
  });
const landingStyle = () =>
  z.object({
    source: z
      .enum(LANDING_STYLE_SOURCES)
      .nullable()
      .optional()
      .describe("'resume' (default) draws the page in the default resume's published colors and fonts, 'custom' in colors, font and nameFont below."),
    colors: landingColors().nullable().optional().describe("The page's own colors, used with source: 'custom'; merged key by key."),
    font: z.string().nullable().optional().describe(`With source: 'custom', one of ${FONT_IDS.join(', ')}; '' for the default (source-serif).`),
    nameFont: z.string().nullable().optional().describe("The same choices, for the headline and headings; '' matches font."),
    darkColors: landingColors()
      .nullable()
      .optional()
      .describe("An optional dark palette, used whatever the source for visitors whose device is set to dark; '' keys take the dark defaults, and null removes it."),
  });

// base64 as sent: optionally a data: URL, whitespace ignored.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function decodeImage(data) {
  const body = data.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  if (body.length > Math.ceil(LANDING_IMAGE_LIMITS.mcpUploadBytes / 3) * 4) {
    throw httpError(413, `That image is too large to send here (at most ${LANDING_IMAGE_LIMITS.mcpUploadBytes} bytes before base64)`);
  }
  if (!body || !BASE64.test(body)) throw httpError(400, 'data must be the image file, base64-encoded');
  return Buffer.from(body, 'base64');
}

const LANDING_TOOLS = [
  {
    name: 'get_landing_page',
    config: {
      title: 'Get the landing page',
      description:
        "Returns the landing page's DRAFT (`landing`), its status ({ enabled, publishedAt, isDirty }), and `context`: the resumes a card can currently link to (public and published; a card for any other resume is left out of the public page), the default resume's published photo and site settings, which the page reuses, and the uploaded images (images: id, width, height) a reference can name. Before anything is saved, the draft is built from the default resume's published header.",
      annotations: readOnly,
    },
    run: (store) => ({ landing: store.getLanding(), status: store.getLandingStatus(), context: store.getLandingContext() }),
  },
  {
    name: 'update_landing_page',
    config: {
      title: 'Update the landing page',
      description:
        "Merges fields into the landing page's DRAFT: send only what changes (sections and actions are each replaced as a whole list, so send every entry to keep, in order; null resets a field). Nothing is public until publish_landing_page. Returns the draft.",
      inputSchema: {
        headline: z.string().nullable().optional().describe('Big heading, usually your name.'),
        subheadline: z.string().nullable().optional().describe('One line under it, e.g. a title.'),
        availability: z.string().nullable().optional().describe('A short line above the headline, e.g. "Open to senior backend roles · Remote". Empty shows none.'),
        homeLink: z
          .boolean()
          .nullable()
          .optional()
          .describe("Whether resume pages show a '← Home' link back to the landing page while it's shown at / (default true)."),
        homeLinkLabel: z
          .string()
          .nullable()
          .optional()
          .describe("What that link says after the arrow, at most 40 characters; empty says 'Home'."),
        actions: z
          .array(landingAction())
          .nullable()
          .optional()
          .describe('At most 3 buttons under the subheadline, the first drawn as the primary one. Replaced as a whole list.'),
        photo: z
          .enum(PHOTO_SOURCES)
          .nullable()
          .optional()
          .describe("'resume' uses the default resume's published header photo, 'custom' uses photoUrl, 'upload' uses photoImage, 'none' shows none."),
        photoUrl: z.string().nullable().optional().describe("A base64 data: URL of a JPEG, PNG or WebP image, for photo: 'custom'."),
        photoImage: landingImage().nullable().optional().describe("An uploaded image, for photo: 'upload'."),
        sections: z
          .array(landingSection())
          .nullable()
          .optional()
          .describe('The complete list of sections, in the order they show under the headline. A section with nothing to show is left off the public page.'),
        seo: z
          .object({
            title: z.string().nullable().optional().describe("The page's title in search results and link previews; '' uses the headline."),
            description: z.string().nullable().optional().describe("What search results and link previews say; '' uses the subheadline, else the first text section."),
            noindex: z.boolean().nullable().optional().describe('true asks search engines not to list the page.'),
            image: landingImage()
              .nullable()
              .optional()
              .describe('An uploaded image link previews show (ideally 1200×630) instead of the card drawn from the headline and photo; null removes it.'),
          })
          .nullable()
          .optional()
          .describe('Search and link-preview settings, merged one level deep (send only what changes).'),
        template: z
          .string()
          .nullable()
          .optional()
          .describe("The landing template, a folder name under templates/landing/: 'classic' (default), 'bold', 'centered', 'editorial', 'formal' or 'split'. An unknown id is drawn as classic."),
        style: landingStyle()
          .nullable()
          .optional()
          .describe('Its colors and fonts, merged one level deep, colors and darkColors one more (send only what changes).'),
      },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, patch) => {
      if (Object.keys(patch).length === 0) throw httpError(400, 'Nothing to update: send at least one landing page field');
      return { landing: store.setLanding(patch, { merge: true }) };
    },
  },
  {
    name: 'upload_landing_image',
    config: {
      title: 'Upload a landing page image',
      description: `Stores an image for the landing page and returns { id, mime, width, height } (src is the editor's own path to it). Send the JPEG, PNG or WebP file base64-encoded, at most ${LANDING_IMAGE_LIMITS.mcpUploadBytes} bytes before encoding. It's re-encoded on the server, which drops its metadata (EXIF, GPS position) and scales it down to ${LANDING_IMAGE_LIMITS.longSide} px on its long side. Nothing is shown until a reference to it ({ imageId: id, alt }) is saved with update_landing_page and published; an image nothing references is removed a week after it was uploaded.`,
      inputSchema: { data: z.string().describe('The image file, base64-encoded (a data: URL works too).') },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, { data }) => store.uploadLandingImage(decodeImage(data), { maxInputBytes: LANDING_IMAGE_LIMITS.mcpUploadBytes }),
  },
  {
    name: 'publish_landing_page',
    config: {
      title: 'Publish the landing page',
      description:
        "Snapshots the landing page's DRAFT to the public site. It shows at / only while the landing page is enabled. Refused (400, naming the field) while an image the page would show has an empty alt. Returns its status.",
      annotations: mutating,
    },
    run: (store) => store.publishLanding(),
  },
  {
    name: 'discard_landing_draft',
    config: {
      title: 'Discard the landing page draft',
      description: 'Throws away unpublished landing page changes, restoring the draft from its last published snapshot. Returns the restored draft.',
      annotations: destructive,
    },
    run: (store) => ({ landing: store.discardLandingDraft() }),
  },
  {
    name: 'apply_landing_style_to_resume',
    config: {
      title: "Apply the landing page's colors and fonts to the default resume",
      description:
        "Copies the landing page DRAFT's own colors (accent, heading, text, background) and fonts (font, nameFont) into the default resume's site settings DRAFT, merged so its other site settings and colors stay; never the dark palette. A 400 unless the draft's style.source is 'custom'. Nothing is published: publish the default resume to show it. Returns { resumeId, site }, the resume's new site settings draft.",
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store) => store.applyLandingStyleToResume(),
  },
  {
    name: 'set_landing_page_enabled',
    config: {
      title: 'Switch the landing page on or off',
      description:
        "Takes effect on the public site at once. On: / shows the published landing page (once there is one) on every host that isn't a resume's own domain, and the default resume moves to /resume. Off: / shows the default resume again. Returns its status.",
      inputSchema: { enabled: z.boolean() },
      annotations: { ...mutating, idempotentHint: true },
    },
    run: (store, { enabled }) => store.setLandingEnabled(enabled),
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

const TOOLS = [SCHEMA_TOOL, ...CONTENT_TOOLS.map(scopedToResume), ...RESUME_TOOLS, ...LANDING_TOOLS];

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
