// Documentation of the JSON shapes the editor reads and writes, served by
// the get_block_schemas MCP tool. The server stores `data`, the header, and
// the site settings as free-form JSON and never validates them — these are
// the shapes the client (client/src/editor/blockForms/*.jsx,
// HeaderEditorForm.jsx, SiteSettingsForm.jsx) and the templates expect.
// Keep this in step with those forms when fields or options change.

const SPACING = ['', 'none', 'xsmall', 'small', 'medium', 'large', 'xlarge'];

const COMMON = {
  blockFields: {
    visibleWeb: 'boolean — show on the public web page (default true)',
    visiblePrint: 'boolean — show in the print/PDF version (default true)',
    parentId:
      'string | null — id of a top-level heading to nest under. Only experience, skills_group, education, and custom blocks can be nested, one level deep.',
  },
  dataStyle: {
    description: 'Optional `data.style` object on any block type for per-block spacing and emphasis.',
    properties: {
      spaceAbove: { enum: SPACING, description: "Extra space above; '' or omitted = template default" },
      spaceBelow: { enum: SPACING, description: "Extra space below; '' or omitted = template default" },
      highlight: { type: 'boolean', description: 'Draw the block with a highlight background' },
    },
  },
};

const BULLET = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    visibleWeb: { type: 'boolean', default: true },
    visiblePrint: { type: 'boolean', default: true },
    children: {
      type: 'array',
      description: 'Sub-bullets, one level deep (no further nesting)',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          visibleWeb: { type: 'boolean', default: true },
          visiblePrint: { type: 'boolean', default: true },
        },
      },
    },
  },
};

export const BLOCK_DATA_SCHEMAS = {
  heading: {
    description: 'A section heading. Top-level only; other blocks nest under it via parentId.',
    properties: {
      text: { type: 'string', description: 'Heading text, e.g. "Professional Experience"' },
      fontSize: { enum: ['', 'small', 'medium', 'large', 'xlarge'], description: "'' = template default" },
      column: {
        enum: ['auto', 'primary', 'secondary'],
        description: 'Which column this whole section goes in, for two-column layouts (sidebar, sidebar-right, split-columns). auto lets the layout decide.',
      },
      style: { $ref: 'dataStyle' },
    },
    example: { text: 'Professional Experience' },
  },
  summary: {
    description: 'A professional summary paragraph. Top-level only.',
    properties: {
      text: { type: 'string', description: 'Plain text; may contain multiple paragraphs separated by blank lines' },
      style: { $ref: 'dataStyle' },
    },
    example: { text: 'Infrastructure engineer with ten years of ...' },
  },
  skills_group: {
    description: 'One row of skills under a category label.',
    properties: {
      category: { type: 'string', description: 'e.g. "Languages"' },
      items: { type: 'string', description: 'Comma-separated list, e.g. "Go, Python, TypeScript"' },
      style: { $ref: 'dataStyle' },
    },
    example: { category: 'Cloud', items: 'AWS, GCP, Terraform' },
  },
  experience: {
    description: 'One job / role.',
    properties: {
      jobTitle: { type: 'string' },
      company: { type: 'string' },
      companyUrl: { type: 'string', description: 'Optional https URL; the company name links to it' },
      location: { type: 'string' },
      startDate: { type: 'string', description: 'Free text, e.g. "2022" or "Mar 2022"' },
      endDate: { type: 'string', description: 'Free text, e.g. "Current"' },
      tagline: { type: 'string', description: 'One line about the company, shown under the title' },
      description: { type: 'string', description: 'Optional paragraph before the bullets' },
      bullets: {
        type: 'array',
        items: BULLET,
        description: 'Accomplishment bullets; plain strings are also accepted and treated as { text }',
      },
      style: { $ref: 'dataStyle' },
    },
    example: {
      jobTitle: 'Senior Engineer',
      company: 'Example Corp',
      companyUrl: 'https://example.com',
      location: 'Remote',
      startDate: '2022',
      endDate: 'Current',
      tagline: '',
      bullets: [{ text: 'Cut deploy time by 60%', visibleWeb: true, visiblePrint: true, children: [] }],
    },
  },
  education: {
    description: 'One degree / program.',
    properties: {
      degree: { type: 'string' },
      institution: { type: 'string' },
      location: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      style: { $ref: 'dataStyle' },
    },
    example: { degree: 'B.S. Computer Science', institution: 'State University', location: 'City, ST', startDate: '2010', endDate: '2014' },
  },
  custom: {
    description: 'A freeform section: a title and a list of items, each with a heading and a body of one of four kinds.',
    properties: {
      title: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            bodyType: { enum: ['text', 'list', 'link', 'tags'] },
            text: { type: 'string', description: 'bodyType text: the paragraph' },
            items: { type: 'string', description: 'bodyType list: one entry per line. bodyType tags: comma-separated' },
            label: { type: 'string', description: 'bodyType link: link text' },
            url: { type: 'string', description: 'bodyType link: https URL' },
            tagColor: { type: 'string', description: 'bodyType tags: optional #rrggbb pill color' },
          },
        },
      },
      style: { $ref: 'dataStyle' },
    },
    example: {
      title: 'Certifications',
      items: [
        { heading: 'AWS', bodyType: 'tags', items: 'Solutions Architect, DevOps Engineer' },
        { heading: 'Portfolio', bodyType: 'link', label: 'example.dev', url: 'https://example.dev' },
      ],
    },
  },
};

export const HEADER_SCHEMA = {
  description: 'The name/title/contact block at the top of the resume (a singleton, not a block).',
  properties: {
    name: { type: 'string' },
    title: { type: 'string', description: 'Professional title' },
    subtitle: { type: 'string', description: 'Optional second line under the title' },
    location: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    photoUrl: { type: 'string', description: 'Optional photo as a data: URL (the editor crops and embeds it); only some header templates show it' },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { enum: ['linkedin', 'github', 'gitlab', 'website', 'twitter', 'stackoverflow', 'medium', 'youtube', 'custom'] },
          label: { type: 'string', description: 'Display text, e.g. "github.com/you"' },
          url: { type: 'string', description: 'https URL' },
        },
      },
    },
  },
};

export const SITE_SCHEMA = {
  description: 'Site-wide settings: templates, typography, colors (a singleton).',
  properties: {
    title: { type: 'string', description: 'Browser tab title' },
    template: {
      type: 'string',
      description: 'Header template id — a folder name under templates/headers/ (e.g. classic, centered, banner, compact)',
    },
    layout: {
      type: 'string',
      description: 'Layout template id — a folder name under templates/layouts/ (e.g. classic, sidebar, sidebar-right, split-columns, timeline)',
    },
    font: {
      enum: ['source-serif', 'pt-serif', 'lora', 'merriweather', 'eb-garamond', 'libre-baskerville', 'playfair-display', 'crimson-text', 'georgia', 'ibm-plex-sans', 'inter', 'roboto', 'open-sans', 'montserrat', 'work-sans'],
    },
    nameFont: { type: 'string', description: "Same options as font, for the name and title; '' = match font" },
    fontSize: { enum: ['smallest', 'small', 'normal', 'large', 'largest'] },
    fontWeight: { enum: ['light', 'normal', 'medium'] },
    lineSpacing: { enum: ['tight', 'snug', 'normal', 'relaxed', 'loose'] },
    pillPadding: { enum: ['compact', 'snug', 'cozy', 'roomy', 'spacious'] },
    bulletStyle: { enum: ['disc', 'circle', 'square', 'dash', 'arrow', 'none'] },
    colors: {
      type: 'object',
      description: "#rrggbb values; the optional ones accept '' for \"not set\"",
      properties: {
        accent: { type: 'string' },
        heading: { type: 'string' },
        text: { type: 'string' },
        background: { type: 'string' },
        skillsCategoryText: { type: 'string', optional: true },
        skillsCategoryPill: { type: 'string', optional: true },
        datesText: { type: 'string', optional: true },
        datesPill: { type: 'string', optional: true },
        sidebarBackground: { type: 'string', optional: true, description: 'Sidebar layouts only' },
      },
    },
  },
};

export const BLOCK_SCHEMAS = {
  common: COMMON,
  blocks: BLOCK_DATA_SCHEMAS,
  header: HEADER_SCHEMA,
  site: SITE_SCHEMA,
};

export function blockSchemaFor(type) {
  return { common: COMMON, type, schema: BLOCK_DATA_SCHEMAS[type] };
}
