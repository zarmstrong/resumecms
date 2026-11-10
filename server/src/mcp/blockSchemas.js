// Documentation of the JSON shapes the editor reads and writes, served by
// the get_block_schemas MCP tool. These are the shapes the client
// (client/src/editor/blockForms/*.jsx, HeaderEditorForm.jsx,
// SiteSettingsForm.jsx) and the templates expect. The store type-checks a
// block's documented `data` keys on write via BLOCK_DATA_VALIDATORS in
// server/src/blockData.js — its keys must match BLOCK_DATA_SCHEMAS below
// (blockData.test.js enforces that), so change both together — but not
// enum values or unknown keys; the header and site settings are stored
// as-is. Keep this in step with the forms when fields or options change
// (COVER_LETTER_SCHEMA with CoverLetterForm.jsx and coverLetterFields.js).

const SPACING = ['', 'none', 'xsmall', 'small', 'medium', 'large', 'xlarge'];

const COMMON = {
  blockFields: {
    visibleWeb: 'boolean — show on the public web page (default true)',
    visiblePrint: 'boolean — show in the print/PDF version (default true)',
    parentId:
      'string | null — id of a top-level heading to nest under. Only experience, skills_group, education, custom, and executive_summary blocks can be nested, one level deep.',
  },
  dataStyle: {
    description: 'Optional `data.style` object on any block type for per-block spacing, alignment, and emphasis.',
    properties: {
      spaceAbove: { enum: SPACING, description: "Extra space above; '' or omitted = template default" },
      spaceBelow: { enum: SPACING, description: "Extra space below; '' or omitted = template default" },
      align: {
        enum: ['', 'left', 'center', 'right'],
        description:
          "Text alignment for the block; '' or omitted = template default. Honored on heading, summary, executive_summary, skills_group, and custom blocks; ignored on experience and education. A custom block with no title and one centered text or link item makes a one-line footer such as 'More work history at example.com'.",
      },
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
  executive_summary: {
    description:
      'An executive summary: a one-line headline, a short overview paragraph, and a list of key career highlights. Can be nested under a heading (e.g. "Executive Summary").',
    properties: {
      headline: { type: 'string', description: 'One line on who the person is and the value they bring; optional' },
      text: { type: 'string', description: 'Overview paragraph, plain text; may contain multiple paragraphs separated by blank lines' },
      highlights: {
        type: 'array',
        items: { type: 'string' },
        description: 'Key career highlights, one short line each, shown as a list; blank entries are skipped',
      },
      style: { $ref: 'dataStyle' },
    },
    example: {
      headline: 'Engineering leader who scales platform teams and the systems they run',
      text: 'Fifteen years building and leading infrastructure organizations ...',
      highlights: ['Grew the platform group from 6 to 40 engineers across three regions', 'Cut cloud spend by 30% in one year'],
    },
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
          type: {
            // The link types of client/src/resume/linkTypes.js and
            // landingFields.js's LINK_TYPES (linkTypes.test.js compares them).
            enum: [
              'website', 'portfolio', 'email', 'phone', 'booking', 'shop', 'publications', 'newsletter',
              'linkedin', 'twitter', 'facebook', 'tiktok', 'threads', 'bluesky', 'mastodon', 'substack', 'medium',
              'github', 'gitlab', 'stackoverflow',
              'instagram', 'behance', 'dribbble', 'artstation', 'vimeo', 'youtube',
              'soundcloud', 'bandcamp', 'spotify',
              'orcid', 'googlescholar', 'researchgate',
              'imdb',
              'houzz', 'nextdoor', 'googlebusiness',
              'custom',
            ],
            description: 'Picks the one-letter badge the link is drawn with; custom for any other link. twitter means Twitter / X.',
          },
          label: { type: 'string', description: 'Display text, e.g. "github.com/you", or the address/number for an email/phone link' },
          url: { type: 'string', description: 'https URL; mailto:you@example.com for an email link, tel:+15555550100 for a phone link' },
        },
      },
    },
  },
};

export const SITE_SCHEMA = {
  description: 'Site-wide settings: templates, typography, colors (a singleton).',
  properties: {
    title: {
      type: 'string',
      description:
        "The page's title: browser tab, search results and link previews (about 70 characters at most). '' = the header's name and title",
    },
    description: {
      type: 'string',
      description:
        "What search results and link previews say about the resume (about 200 characters at most). '' = the first summary or executive summary shown on the web",
    },
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

// The install's landing page (issue #70); landingFields.js checks it and
// holds the caps.
// An uploaded image (issue #92), by the id upload_landing_image returns.
const LANDING_IMAGE_REF = {
  type: 'object',
  description: "An uploaded image: { imageId, alt }, both required. A new one must name a stored image; one whose image is gone shows nothing",
  properties: {
    imageId: { type: 'string', description: "From upload_landing_image or get_landing_page's context.images" },
    alt: { type: 'string', description: 'What it shows, at most 200 characters' },
  },
};

// The landing page's four colors (issue #93), as in the site settings.
const LANDING_COLORS = {
  type: 'object',
  properties: {
    accent: { type: 'string', description: '#rrggbb: buttons, links, the subheadline' },
    heading: { type: 'string', description: '#rrggbb: the headline and headings' },
    text: { type: 'string', description: '#rrggbb: body text' },
    background: { type: 'string', description: '#rrggbb: the page' },
  },
};

const LANDING_SECTION_BASE = {
  id: { type: 'string', description: 'Tells sections apart; omit for a new section, keep for an existing one' },
  title: { type: 'string', description: "Heading above the section; '' shows none" },
  hidden: { type: 'boolean', description: 'true keeps it in the draft without showing it (default false)' },
  column: {
    enum: ['main', 'side'],
    description: "'side' draws it in the side column of a template that has one (split: under the hero); the others draw it in order with the rest. Stored only when 'side'",
  },
};

export const LANDING_SCHEMA = {
  description:
    'The optional home page at / (a singleton for the whole install, not part of any resume). Checked strictly on write: unknown keys, wrong types, over-long values and links other than http/https/mailto/tel are a 400.',
  properties: {
    headline: { type: 'string', description: 'Usually your name' },
    subheadline: { type: 'string' },
    availability: { type: 'string', description: "A short line above the headline, e.g. 'Open to senior backend roles · Remote'; '' shows none" },
    homeLink: {
      type: 'boolean',
      description: "Default true: while the landing page is shown at /, resume pages on that host (/resume, /r/<slug>, never a resume's own domain or its PDF) show a '← Home' link back to it. Takes effect on publish",
    },
    homeLinkLabel: { type: 'string', description: "At most 40 characters: what that link says after the arrow; '' says 'Home'. Takes effect on publish" },
    actions: {
      type: 'array',
      description: "At most 3 buttons under the subheadline, the first drawn as the primary one; replaced whole by update_landing_page. One for a resume is shown only while it's public and published (for open: 'pdf', only while it has a PDF)",
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { const: 'link' },
              label: { type: 'string', description: "e.g. 'Email me'; '' shows the URL" },
              url: { type: 'string', description: 'An http, https, mailto or tel link (mailto:you@example.com?subject=Hello prefills a subject)' },
            },
          },
          {
            type: 'object',
            properties: {
              type: { const: 'resume' },
              label: { type: 'string', description: "'' says 'View my resume' or 'Download my resume (PDF)'" },
              resumeId: { type: 'string' },
              open: { enum: ['page', 'pdf'], description: "Its page (default) or its PDF" },
            },
          },
        ],
      },
    },
    photo: { enum: ['resume', 'custom', 'upload', 'none'], description: "'resume' = the default resume's published header photo" },
    photoUrl: { type: 'string', description: "base64 data: URL (JPEG, PNG or WebP), used when photo is 'custom'" },
    photoImage: { ...LANDING_IMAGE_REF, description: "Used when photo is 'upload'; optional (absent for none)" },
    sections: {
      type: 'array',
      description: 'Shown in order under the headline; one with nothing to show is left out, and a divider is only drawn between two shown sections (or the hero and a section) in the same column. Each has the fields of its kind only',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: { ...LANDING_SECTION_BASE, kind: { const: 'text' }, body: { type: 'string', description: 'Text with [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is; a blank line starts a new paragraph' } },
          },
          {
            type: 'object',
            description: 'A list of entries, e.g. projects',
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'items' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    text: { type: 'string', description: 'Text with [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is' },
                    url: { type: 'string', description: 'Optional http, https, mailto or tel link for the title' },
                    meta: { type: 'string', description: "Optional short line shown muted under the title, e.g. '2024 · Rust · Open source' (at most 80 characters)" },
                    image: { ...LANDING_IMAGE_REF, description: 'Optional thumbnail (absent for none)' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'links' },
              links: { type: 'array', items: { type: 'object', properties: HEADER_SCHEMA.properties.links.items.properties } },
            },
          },
          {
            type: 'object',
            description: 'Cards linking to resumes, in order; only public, published ones are shown',
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'resumes' },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    resumeId: { type: 'string' },
                    label: { type: 'string', description: "Card title; '' uses the resume's published header title" },
                    blurb: { type: 'string' },
                    showPdf: { type: 'boolean', description: 'Also link to its PDF, while it has one (default false)' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            description: "Testimonials, at most 10; one without text isn't shown. Never rewritten by AI",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'quotes' },
              quotes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', description: 'Plain text, at most 600 characters' },
                    name: { type: 'string', description: 'Who said it' },
                    role: { type: 'string', description: "e.g. 'Engineering manager, Acme'" },
                    url: { type: 'string', description: 'Optional http, https, mailto or tel link for the name' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            description:
              "A short timeline of a resume's latest roles (title, company, location, dates; never descriptions or bullets) and a link to it, read from its published version when the page is requested, and shown only while it's public and published",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'experience' },
              resumeId: { type: 'string' },
              count: { type: 'integer', description: 'How many of its first experience entries shown on the web, 1 to 10 (default 3)' },
              showDates: { type: 'boolean', description: 'Show dates (default true)' },
            },
          },
          {
            type: 'object',
            description: 'One uploaded image with an optional caption; left out until it has an image',
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'image' },
              image: { ...LANDING_IMAGE_REF, description: 'null until one is uploaded' },
              caption: { type: 'string', description: 'Plain text under the image, at most 300 characters' },
            },
          },
          {
            type: 'object',
            description: 'A rule across the page between two sections; its title, if any, is a label on the rule',
            properties: { ...LANDING_SECTION_BASE, kind: { const: 'divider' } },
          },
          {
            type: 'object',
            description:
              "A few large figures, each with a short label under it ('15 years' over 'in commercial kitchens'), at most 6; one without a value isn't shown. Never rewritten by AI",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'stats' },
              stats: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string', description: "Plain text, not a number, at most 16 characters: '2,000+', '98%', '$4.2M', '#1'" },
                    label: { type: 'string', description: 'Plain text, at most 80 characters' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            description: "Questions and answers, at most 15, each answer collapsed under its question; an entry without both isn't shown",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'faq' },
              entries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    question: { type: 'string', description: 'Plain text, at most 200 characters' },
                    answer: { type: 'string', description: 'At most 1500 characters; text with [label](url) links (http, https, mailto or tel), **bold** and *italic*; a backslash before * or [ shows it as is' },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            description:
              "A resume's first education entries (degree, institution, location, dates) and a link to it, read from its published version when the page is requested, and shown only while it's public and published",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'education' },
              resumeId: { type: 'string' },
              count: { type: 'integer', description: 'How many of its first education entries shown on the web, 1 to 10 (default 3)' },
              showDates: { type: 'boolean', description: 'Show dates (default true)' },
            },
          },
          {
            type: 'object',
            description:
              "Every skill group a resume shows on the web (its category and items, split on commas like the resume's chips) and a link to it, read from its published version when the page is requested, and shown only while it's public and published",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'skills' },
              resumeId: { type: 'string' },
            },
          },
          {
            type: 'object',
            description:
              "Licenses, certifications and memberships, at most 20; one without a name isn't shown, nor one whose expires date has passed (read when the page is requested). Never rewritten by AI",
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'credentials' },
              credentials: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { enum: ['license', 'certification', 'membership'], description: "Only picks the label shown with it (default 'certification')" },
                    name: { type: 'string', description: "e.g. 'Registered Nurse' (at most 120 characters)" },
                    issuer: { type: 'string', description: "Who issued it, e.g. 'Oregon State Board of Nursing' (at most 120 characters)" },
                    number: { type: 'string', description: "Optional license or certificate number, shown as written (at most 60 characters); some are public record, some aren't" },
                    issued: { type: 'string', description: "When it was issued, free-form, shown as written, e.g. 'Mar 2021'" },
                    expires: {
                      type: 'string',
                      description:
                        "When it expires, free-form (at most 40 characters). Read as YYYY, YYYY-MM, MM/YYYY, 'Mar 2027', 'March 2027' or YYYY-MM-DD, the entry leaves the page once that has passed (UTC); anything else is shown as written",
                    },
                    url: { type: 'string', description: "Optional http, https, mailto or tel link, the issuer's page to verify it on, shown as 'Verify'" },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            description: 'Uploaded images in a grid, each opening larger when clicked; left out until one has an image. Captions are never rewritten by AI',
            properties: {
              ...LANDING_SECTION_BASE,
              kind: { const: 'gallery' },
              images: {
                type: 'array',
                description: 'At most 24, in order; an entry without an image is left out',
                items: {
                  type: 'object',
                  properties: {
                    image: { ...LANDING_IMAGE_REF, description: 'null until one is uploaded' },
                    caption: { type: 'string', description: 'Plain text under the image, at most 300 characters' },
                  },
                },
              },
            },
          },
        ],
      },
    },
    seo: {
      type: 'object',
      description: "Search results and link previews; merged one level deep by update_landing_page",
      properties: {
        title: { type: 'string', description: "At most 70 characters; '' = the headline" },
        description: { type: 'string', description: "At most 200 characters; '' = the subheadline, else the first text section" },
        noindex: { type: 'boolean', description: 'Ask search engines not to list the page (X-Robots-Tag: noindex)' },
        image: { ...LANDING_IMAGE_REF, description: 'Optional share image for link previews (ideally 1200×630), shown instead of the drawn card' },
      },
    },
    template: {
      type: 'string',
      description: "Landing template id, a folder name under templates/landing/: 'classic' (default), 'centered' (hero centered, cards in a grid), 'split' (photo and hero in a left column, sticky unless sections are placed there with column: 'side') or 'bold' (oversized type, every other section on a band tinted with the accent). An unknown id is drawn as classic",
    },
    style: {
      type: 'object',
      description: "Its colors and fonts; merged one level deep by update_landing_page, colors and darkColors one more. Checked strictly: a color that isn't #rrggbb or '', or an unknown font, is a 400",
      properties: {
        source: { enum: ['resume', 'custom'], description: "'resume' (default) = the default resume's published site settings; 'custom' = colors, font and nameFont here" },
        colors: { ...LANDING_COLORS, description: "Used with source 'custom'; '' = the site settings' default" },
        font: { type: 'string', description: "Same options as the site settings' font; '' = source-serif" },
        nameFont: { type: 'string', description: "Same options, for the headline and headings; '' = match font" },
        darkColors: {
          ...LANDING_COLORS,
          optional: true,
          description: "Optional dark palette for visitors whose device is set to dark, used with either source (a resume has none); '' = the dark default, absent = none",
        },
      },
    },
  },
};

// A cover letter's `data` (issue #71); coverLetterFields.js type-checks
// these keys (its COVER_LETTER_DATA_VALIDATOR must list the same ones).
export const COVER_LETTER_SCHEMA = {
  description:
    "A cover letter's `data`. It belongs to one resume and is drawn under that resume's header, in its colors and fonts. Every key is optional and type-checked on write (a wrong kind of value is a 400). Private: never published.",
  properties: {
    date: { type: 'string', description: "Shown as written, e.g. \"March 3, 2026\"; '' shows the date it's exported" },
    recipientName: { type: 'string', description: 'e.g. "Jane Smith"' },
    recipientTitle: { type: 'string', description: 'e.g. "Engineering Manager"' },
    company: { type: 'string' },
    address: { type: 'string', description: "The recipient's address, one line per line (\\n between them)" },
    salutation: { type: 'string', description: 'e.g. "Dear Ms. Smith,"' },
    paragraphs: { type: 'array', items: { type: 'string' }, description: 'The body, one plain-text string per paragraph, in order' },
    closing: { type: 'string', description: 'e.g. "Sincerely,"' },
    signature: { type: 'string', description: "The name it's signed with; '' uses the resume header's name" },
  },
  example: {
    date: '',
    recipientName: 'Jane Smith',
    recipientTitle: 'Engineering Manager',
    company: 'Acme',
    address: '1 Main St\nSpringfield',
    salutation: 'Dear Ms. Smith,',
    paragraphs: ['I am writing to apply for…', 'At my last role I…'],
    closing: 'Sincerely,',
    signature: '',
  },
};

export const BLOCK_SCHEMAS = {
  common: COMMON,
  blocks: BLOCK_DATA_SCHEMAS,
  header: HEADER_SCHEMA,
  site: SITE_SCHEMA,
  landing: LANDING_SCHEMA,
  coverLetter: COVER_LETTER_SCHEMA,
};

export function blockSchemaFor(type) {
  return { common: COMMON, type, schema: BLOCK_DATA_SCHEMAS[type] };
}
