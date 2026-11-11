import { LANDING_LIMITS } from '../landingFields.js';
import { AiError, callProvider } from './providers.js';
import { inlineLength, mapLinks } from '../inlineText.js';
import { hasPassed, utcToday } from '../dateText.js';

// AI rewrites on the landing page (issue #73). Like a block rewrite
// (rewrite.js) it only proposes: the editor shows each proposal in its
// preview and saves an accepted one through PUT /api/landing like any edit.
//
// Every landing field the AI can write is one string, so a proposal is just
// `{ target, before, after }`: the target's text when the request was made
// and what the AI suggests in its place. The targets (an explicit
// allowlist, as REWRITABLE_TYPES is for blocks):
//   { kind: 'headline' }
//   { kind: 'subheadline' }
//   { kind: 'text', sectionId }             a text section's body
//   { kind: 'item', sectionId, index }      an item's text (never its title)
//   { kind: 'card', sectionId, resumeId }   a resume card's blurb
//   { kind: 'intro', sectionId }            headline, subheadline and that
//                                           text section's body together
//   { kind: 'answer', sectionId, index }    an FAQ entry's answer (issue
//                                           #123; never its question)
//   { kind: 'service', sectionId, index }   a service's text (issue #122;
//                                           never its title, price or
//                                           button)
// Sections and cards are addressed by id, so moving them doesn't move a
// proposal onto something else; items, FAQ entries and services have no
// ids, so theirs is a position.
// Deliberately not targets (issue #90): a quote, which is someone else's
// words; an experience section, which is read from a resume as published,
// and so are an education or skills section (issue #126); an item's meta
// line; and an FAQ question. Nor is a stat (issue #125): a
// model mustn't make up figures, so it only ever reads them, in the page
// context.
// Nor is a credential (issue #119): its name, issuer, number and dates
// are facts, not prose.
// Nor are an image section's or a gallery's captions (issue #120): plain
// text about a picture the model can't see, so the page context gives
// either only its kind and title.
// Nor is a media section (issue #121): its caption and transcript are
// about a recording the model can't hear, so it gets only its kind and
// title too, never the link.
// Nor are a service's title, price and button (issue #122): what's offered
// and on what terms are the person's to say, so the model only reads them.
//
// The page is shown to every visitor, so what the AI may draw on is too:
// the profile (landingProfile) is built from a resume's *published*
// snapshot, never its draft, and the route only passes one for a resume
// that's public and published. A resume's internal name and its tailoring
// brief are never part of it.
//
// A text section's body, an item's text, an FAQ answer and a service's
// text may hold links (issue #91), and the model must never be able to put a URL on the page.
// It never sees one: in the text it rewrites, each link's URL becomes a
// placeholder (`#L1`, `#L2`, … linkPlaceholders()), and in the rest of the
// page a link is just its label. Its answer gets the URLs back
// (unmaskLinks()), and a link to anything but one of those placeholders
// makes the whole answer an error. It may reword a label, move a link or
// drop it.

export const LANDING_TARGET_KINDS = ['headline', 'subheadline', 'text', 'item', 'card', 'intro', 'answer', 'service'];

export class InvalidLandingTargetError extends Error {}

// What `intro` asks for with no instruction of its own.
export const INTRO_INSTRUCTION =
  'Write a headline, a subheadline and a short intro for my home page, drawing on my resume.';

const FIELD_LIMITS = {
  headline: LANDING_LIMITS.headline,
  subheadline: LANDING_LIMITS.subheadline,
  text: LANDING_LIMITS.text,
  item: LANDING_LIMITS.itemText,
  card: LANDING_LIMITS.blurb,
  answer: LANDING_LIMITS.faqAnswer,
  service: LANDING_LIMITS.serviceText,
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The single-field targets whose text may hold links and emphasis, and how
// the page finds its links (a text section's one paragraph at a time).
const INLINE_KINDS = ['text', 'item', 'answer', 'service'];
const linkScope = (kind) => ({ paragraphs: kind === 'text' });

function findSection(landing, sectionId, kind) {
  if (typeof sectionId !== 'string') throw new InvalidLandingTargetError('target.sectionId is required');
  const section = landing.sections.find((s) => s.id === sectionId);
  if (!section) throw new InvalidLandingTargetError('That section is no longer on the page');
  if (section.kind !== kind) throw new InvalidLandingTargetError(`That section isn't a ${kind} section`);
  return section;
}

// The target, checked against `landing` (a validated draft) and reduced to
// its own fields, or an InvalidLandingTargetError saying what's wrong.
export function normalizeLandingTarget(landing, target) {
  if (!isPlainObject(target) || !LANDING_TARGET_KINDS.includes(target.kind)) {
    throw new InvalidLandingTargetError(`target.kind must be one of ${LANDING_TARGET_KINDS.join(', ')}`);
  }
  switch (target.kind) {
    case 'headline':
    case 'subheadline':
      return { kind: target.kind };
    case 'text':
    case 'intro':
      findSection(landing, target.sectionId, 'text');
      return { kind: target.kind, sectionId: target.sectionId };
    case 'item': {
      const section = findSection(landing, target.sectionId, 'items');
      if (!Number.isInteger(target.index) || target.index < 0 || target.index >= section.items.length) {
        throw new InvalidLandingTargetError('That item is no longer in its section');
      }
      return { kind: 'item', sectionId: target.sectionId, index: target.index };
    }
    case 'card': {
      const section = findSection(landing, target.sectionId, 'resumes');
      if (!section.cards.some((card) => card.resumeId === target.resumeId)) {
        throw new InvalidLandingTargetError('That card is no longer in its section');
      }
      return { kind: 'card', sectionId: target.sectionId, resumeId: target.resumeId };
    }
    case 'answer': {
      const section = findSection(landing, target.sectionId, 'faq');
      if (!Number.isInteger(target.index) || target.index < 0 || target.index >= section.entries.length) {
        throw new InvalidLandingTargetError('That question is no longer in its section');
      }
      return { kind: 'answer', sectionId: target.sectionId, index: target.index };
    }
    case 'service': {
      const section = findSection(landing, target.sectionId, 'services');
      if (!Number.isInteger(target.index) || target.index < 0 || target.index >= section.services.length) {
        throw new InvalidLandingTargetError('That service is no longer in its section');
      }
      return { kind: 'service', sectionId: target.sectionId, index: target.index };
    }
    default:
      throw new InvalidLandingTargetError('Unknown target');
  }
}

// The single-field targets an `intro` stands for, in the order the editor
// lists them.
export function introParts(sectionId) {
  return [{ kind: 'headline' }, { kind: 'subheadline' }, { kind: 'text', sectionId }];
}

// The text a single-field target points at in `landing`, or null when it's
// not there (the editor keeps a mirror in client/src/editor/landingAi.js).
export function landingSlice(landing, target) {
  const section = target.sectionId ? landing.sections.find((s) => s.id === target.sectionId) : null;
  switch (target.kind) {
    case 'headline':
    case 'subheadline':
      return landing[target.kind];
    case 'text':
      return section?.kind === 'text' ? section.body : null;
    case 'item':
      return section?.kind === 'items' ? (section.items[target.index]?.text ?? null) : null;
    case 'card':
      return section?.kind === 'resumes' ? (section.cards.find((c) => c.resumeId === target.resumeId)?.blurb ?? null) : null;
    case 'answer':
      return section?.kind === 'faq' ? (section.entries[target.index]?.answer ?? null) : null;
    case 'service':
      return section?.kind === 'services' ? (section.services[target.index]?.text ?? null) : null;
    default:
      return null;
  }
}

// The placeholder each URL in the target's own text stands behind: a Map
// of URL → `#L<n>`, numbered by first appearance, one per URL. Built from
// `landing` alone, so the prompt and the answer's merge agree on it.
export function linkPlaceholders(landing, target) {
  const placeholders = new Map();
  for (const part of target.kind === 'intro' ? introParts(target.sectionId) : [target]) {
    if (!INLINE_KINDS.includes(part.kind)) continue;
    mapLinks(
      landingSlice(landing, part) ?? '',
      ({ href }) => {
        if (!placeholders.has(href)) placeholders.set(href, `#L${placeholders.size + 1}`);
        return '';
      },
      linkScope(part.kind)
    );
  }
  return placeholders;
}

const maskLinks = (value, kind, placeholders) =>
  mapLinks(value, ({ label, href }) => `[${label}](${placeholders.get(href)})`, linkScope(kind));

// Text elsewhere on the page, its links as their labels.
const linkLabels = (value, kind) => mapLinks(value, ({ label }) => label, linkScope(kind));

// The model's `value` for a `kind` field with each placeholder turned back
// into its URL. A link to anything else is one the model made up.
function unmaskLinks(value, kind, placeholders) {
  const urls = new Map([...placeholders].map(([href, placeholder]) => [placeholder, href]));
  return mapLinks(
    value,
    ({ label, href }) => {
      if (!urls.has(href)) throw new AiError(502, 'The AI added a link that was not in the text. Try again.');
      return `[${label}](${urls.get(href)})`;
    },
    linkScope(kind)
  );
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function dates(start, end) {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

// What the AI may know about a resume, from its published snapshot
// (`{ header, blocks }`): its header's name and title, its summary (an
// executive summary's headline and overview too, and its highlights), and an
// outline of its jobs, skills and education, like brief.js's
// resumeOutline(). Only blocks shown on the web are read, the landing page
// being a web page; bullets are left out (they carry their own visibility,
// and an outline is enough to write a short intro from). Null when there's
// nothing to say.
export function landingProfile(snapshot) {
  if (!isPlainObject(snapshot)) return null;
  const header = isPlainObject(snapshot.header) ? snapshot.header : {};
  const profile = { name: text(header.name), title: text(header.title), summary: '', highlights: [], experience: [], skills: [], education: [] };
  const addSummary = (value) => {
    if (text(value)) profile.summary = [profile.summary, text(value)].filter(Boolean).join('\n\n');
  };
  for (const block of Array.isArray(snapshot.blocks) ? snapshot.blocks : []) {
    if (!isPlainObject(block) || block.visibleWeb === false) continue;
    const data = isPlainObject(block.data) ? block.data : {};
    if (block.type === 'summary') {
      addSummary(data.text);
    } else if (block.type === 'executive_summary') {
      addSummary(data.headline);
      addSummary(data.text);
      for (const h of Array.isArray(data.highlights) ? data.highlights : []) if (text(h)) profile.highlights.push(text(h));
    } else if (block.type === 'experience') {
      const entry = { jobTitle: text(data.jobTitle), company: text(data.company), dates: dates(text(data.startDate), text(data.endDate)) };
      if (entry.jobTitle || entry.company) profile.experience.push(entry);
    } else if (block.type === 'skills_group') {
      const entry = { category: text(data.category), items: text(data.items) };
      if (entry.items) profile.skills.push(entry);
    } else if (block.type === 'education') {
      const entry = { degree: text(data.degree), institution: text(data.institution) };
      if (entry.degree || entry.institution) profile.education.push(entry);
    }
  }
  const nonEmpty = Object.fromEntries(
    Object.entries(profile).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== ''))
  );
  return Object.keys(nonEmpty).length ? nonEmpty : null;
}

const PLACEHOLDER = '[the part being rewritten]';

// The rest of the page, as the model sees it: what a visitor reads, with
// the target's spot marked. No URLs, ids or photo. A hidden section isn't
// read, unless the target is in it. `resumes` is the landing context's
// (landingStore.js), for what an experience, education or skills section
// shows.
function pageContext(landing, target, resumes) {
  const spots = new Set((target.kind === 'intro' ? introParts(target.sectionId) : [target]).map(spotKey));
  const mark = (spot, value) => (spots.has(spotKey(spot)) ? PLACEHOLDER : value);
  return {
    headline: mark({ kind: 'headline' }, landing.headline),
    subheadline: mark({ kind: 'subheadline' }, landing.subheadline),
    availability: landing.availability,
    buttons: (landing.actions ?? []).map((action) => action.label).filter(Boolean),
    sections: landing.sections.filter((section) => !section.hidden || section.id === target.sectionId).map((section) => {
      const base = { kind: section.kind, title: section.title };
      switch (section.kind) {
        case 'text':
          return { ...base, body: mark({ kind: 'text', sectionId: section.id }, linkLabels(section.body, 'text')) };
        case 'items':
          return {
            ...base,
            items: section.items.map((item, index) => ({
              title: item.title,
              text: mark({ kind: 'item', sectionId: section.id, index }, linkLabels(item.text, 'item')),
              ...(item.meta ? { meta: item.meta } : {}),
            })),
          };
        case 'links':
          return { ...base, links: section.links.map((link) => link.label).filter(Boolean) };
        case 'resumes':
          return {
            ...base,
            cards: section.cards.map((card) => ({
              label: card.label,
              blurb: mark({ kind: 'card', sectionId: section.id, resumeId: card.resumeId }, card.blurb),
            })),
          };
        case 'quotes':
          return { ...base, quotes: section.quotes.filter((q) => q.text.trim()).map((q) => ({ text: q.text, name: q.name, role: q.role })) };
        case 'stats':
          return { ...base, stats: section.stats.filter((stat) => stat.value.trim()).map((stat) => ({ value: stat.value, label: stat.label })) };
        case 'faq':
          return {
            ...base,
            entries: section.entries.map((entry, index) => ({
              question: entry.question,
              answer: mark({ kind: 'answer', sectionId: section.id, index }, linkLabels(entry.answer, 'answer')),
            })),
          };
        case 'services':
          // A button's label, never its link.
          return {
            ...base,
            services: section.services.map((service, index) => ({
              title: service.title,
              text: mark({ kind: 'service', sectionId: section.id, index }, linkLabels(service.text, 'service')),
              ...(service.price ? { price: service.price } : {}),
              ...(service.action?.label ? { button: service.action.label } : {}),
            })),
          };
        case 'experience':
          return {
            ...base,
            roles: (resumes.get(section.resumeId)?.experience ?? []).slice(0, section.count).map((role) => ({
              jobTitle: role.jobTitle,
              company: role.company,
              location: role.location,
              ...(section.showDates ? { dates: dates(role.startDate, role.endDate) } : {}),
            })),
          };
        case 'education':
          return {
            ...base,
            entries: (resumes.get(section.resumeId)?.education ?? []).slice(0, section.count).map((entry) => ({
              degree: entry.degree,
              institution: entry.institution,
              location: entry.location,
              ...(section.showDates ? { dates: dates(entry.startDate, entry.endDate) } : {}),
            })),
          };
        case 'skills':
          return { ...base, groups: (resumes.get(section.resumeId)?.skills ?? []).map((group) => ({ category: group.category, items: group.items })) };
        case 'credentials':
          // The ones a visitor sees (none expired), without the number or
          // link, which give the model nothing to write from.
          return {
            ...base,
            credentials: section.credentials
              .filter((c) => c.name.trim() && !hasPassed(c.expires, utcToday()))
              .map((c) => ({ kind: c.kind, name: c.name, issuer: c.issuer })),
          };
        default:
          return base;
      }
    }),
  };
}

function spotKey(target) {
  return [target.kind, target.sectionId ?? '', target.index ?? '', target.resumeId ?? ''].join('|');
}

// What the model may change, by the names the output schema uses, its
// links behind their placeholders.
function editableFields(landing, target, placeholders) {
  if (target.kind === 'intro') {
    return {
      headline: landing.headline,
      subheadline: landing.subheadline,
      intro: maskLinks(landingSlice(landing, { kind: 'text', sectionId: target.sectionId }), 'text', placeholders),
    };
  }
  const value = landingSlice(landing, target);
  return { text: INLINE_KINDS.includes(target.kind) ? maskLinks(value, target.kind, placeholders) : value };
}

const str = { type: 'string' };
// Both providers' strict structured-output modes require every property to
// be listed in `required` and `additionalProperties: false` on every object.
function obj(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export function landingOutputSchema(target) {
  const rewrite = target.kind === 'intro' ? obj({ headline: str, subheadline: str, intro: str }) : obj({ text: str });
  return obj({ explanation: str, rewrite });
}

function fieldRule(target, limit, item) {
  switch (target.kind) {
    case 'headline':
      return `"text" is the page's headline, the first thing a visitor reads: usually the person's name or a short line about them. At most ${limit} characters.`;
    case 'subheadline':
      return `"text" is the line under the headline: usually what the person does, in a few words. At most ${limit} characters.`;
    case 'text':
      return `"text" is a section of prose on the page. Separate paragraphs with a blank line. At most ${limit} characters.`;
    case 'item':
      return `"text" is a line or two about one entry in a list on the page${item?.title ? ` (its title, which you don't change, is "${item.title}")` : ''}. At most ${limit} characters.`;
    case 'card':
      return `"text" is the short blurb on a card that links to one of the person's resumes. Say what that resume is for or who it suits. At most ${limit} characters.`;
    case 'service': {
      const facts = [item?.title && `its name is "${item.title}"`, item?.price && `its price is "${item.price}"`].filter(Boolean);
      return `"text" is a short description of one service the person offers, shown under its name on the page${facts.length ? ` (${facts.join(' and ')}, which you don't change)` : ''}. Say what a client gets from it; never state or change a price, a duration or a guarantee that isn't in the input. At most ${limit} characters.`;
    }
    case 'answer':
      return `"text" is the answer to a question visitors ask, shown under it on the page${item?.question ? ` (the question, which you don't change, is "${item.question}")` : ''}. Answer it directly, in a few sentences at most. At most ${limit} characters.`;
    default:
      return null;
  }
}

const PLAIN_RULE = 'Plain text only — no Markdown, no emoji, no links.';
const INLINE_SYNTAX =
  'you may mark a few words **bold** or *italic*. A link is written [label](#L1): you may reword its label, move it or drop it, but keep its #L target exactly as it is, and never add a link or a URL of your own. No other Markdown, no emoji.';

function formatRule(target) {
  if (target.kind === 'intro') return `"headline" and "subheadline" are plain text, with no Markdown, emoji or links. In "intro", ${INLINE_SYNTAX}`;
  return INLINE_KINDS.includes(target.kind) ? `Plain text, except that ${INLINE_SYNTAX}` : PLAIN_RULE;
}

const INTRO_RULE = `"headline" is the page's headline (usually the person's name, at most ${LANDING_LIMITS.headline} characters), "subheadline" the line under it (what they do, in a few words, at most ${LANDING_LIMITS.subheadline} characters), and "intro" a short introduction of two or three paragraphs separated by blank lines, at most ${LANDING_LIMITS.text} characters. Keep any of them that is already good as it is.`;

// `profile` is landingProfile() of the resume the target is about (the
// card's for a blurb, the default resume's otherwise), or null. `resumes`
// is the landing context's map of the resumes a visitor may open.
export function buildLandingPrompt(landing, target, instruction, profile, resumes = new Map()) {
  const rules = [
    "Only make the changes the instruction asks for, and keep the person's own voice. If the page has no text in their voice yet, write in the first person.",
    'Never invent facts: no employers, job titles, dates, technologies, credentials, projects, or numbers that are not in the input. If there is too little to go on, write less, and say so in "explanation".',
    formatRule(target),
    'In the context, "[the part being rewritten]" marks where the text you are writing sits. Use the rest of the page to stay consistent with it: match its tone, and do not repeat what it already says.',
    'In "explanation", say in one or two sentences what you changed.',
  ];
  if (target.kind === 'intro') rules.push(INTRO_RULE);
  else {
    const section = landing.sections.find((s) => s.id === target.sectionId);
    const lists = { item: section?.items, answer: section?.entries, service: section?.services };
    const item = lists[target.kind]?.[target.index] ?? null;
    rules.push(fieldRule(target, FIELD_LIMITS[target.kind], item));
  }
  if (profile) {
    rules.push(
      target.kind === 'card'
        ? "The resume profile is the resume this card links to: you may draw on it to say what that resume covers, but never on anything it does not say."
        : 'The resume profile is the person\'s own resume: you may draw on it to describe them, but never on anything it does not say.'
    );
  }

  const system = [
    "You write and rewrite text on a person's personal home page at their request, and return it as JSON matching the provided schema.",
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
  ].join('\n');

  const user = [
    ...(profile ? ['Resume profile (read-only):', JSON.stringify(profile, null, 2), ''] : []),
    'The rest of the page (read-only — do not change or repeat it):',
    JSON.stringify(pageContext(landing, target, resumes), null, 2),
    '',
    'Section to rewrite:',
    JSON.stringify(editableFields(landing, target, linkPlaceholders(landing, target)), null, 2),
    '',
    'Instruction:',
    instruction,
  ].join('\n');

  return { system, user };
}

function requireString(value, field) {
  if (typeof value !== 'string') throw new AiError(502, `AI response is missing "${field}"`);
  return value.trim();
}

// `length` is how the field's cap counts (inlineLength() for one that holds
// links and emphasis, as landingFields.js counts it).
function checkLength(value, limit, label, length = value.length) {
  if (length > limit) {
    throw new AiError(502, `The AI wrote more than the ${limit} characters the ${label} allows. Try again, or ask for something shorter.`);
  }
  return value;
}

const LABELS = { headline: 'headline', subheadline: 'subheadline', text: 'text section', item: 'item', card: 'card', answer: 'answer', service: 'service' };

// The proposals the model's `rewrite` makes against `landing`, one per field
// it changed, with their links' URLs back. A field it left alone (give or
// take whitespace) isn't one.
export function landingProposals(landing, target, rewrite) {
  if (!isPlainObject(rewrite)) throw new AiError(502, 'AI response is missing "rewrite"');
  const placeholders = linkPlaceholders(landing, target);
  const parts =
    target.kind === 'intro'
      ? [
          [{ kind: 'headline' }, rewrite.headline, 'headline'],
          [{ kind: 'subheadline' }, rewrite.subheadline, 'subheadline'],
          [{ kind: 'text', sectionId: target.sectionId }, rewrite.intro, 'intro'],
        ]
      : [[target, rewrite.text, 'text']];
  return parts.flatMap(([part, value, field]) => {
    const before = landingSlice(landing, part);
    const written = requireString(value, field);
    const inline = INLINE_KINDS.includes(part.kind);
    const unmasked = inline ? unmaskLinks(written, part.kind, placeholders) : written;
    const after = checkLength(unmasked, FIELD_LIMITS[part.kind], LABELS[part.kind], inline ? inlineLength(unmasked) : unmasked.length);
    return after === before.trim() ? [] : [{ target: part, before, after }];
  });
}

// Produces the proposals for one landing page rewrite. `landing` is a
// validated draft; `profile` is what the route may share of a resume (see
// above), or null; `resumes` is the landing context's map of the resumes a
// visitor may open (for an experience section's roles); `callModel` is
// injectable so tests stand in for the provider. Saves nothing.
export async function rewriteLanding({ landing, target, instruction, settings, profile = null, resumes = new Map(), callModel = callProvider }) {
  let scope;
  try {
    scope = normalizeLandingTarget(landing, target);
  } catch (err) {
    if (err instanceof InvalidLandingTargetError) throw new AiError(400, err.message);
    throw err;
  }
  const said = instruction || (scope.kind === 'intro' ? INTRO_INSTRUCTION : '');
  if (!said) throw new AiError(400, 'Tell the AI what to change.');
  const { system, user } = buildLandingPrompt(landing, scope, said, profile, resumes);
  const output = await callModel({
    provider: settings.provider,
    apiKey: settings.apiKeys[settings.provider],
    model: settings.models[settings.provider],
    system,
    user,
    schema: landingOutputSchema(scope),
    timeoutSeconds: settings.timeoutSeconds,
  });
  return {
    target: scope,
    proposals: landingProposals(landing, scope, output?.rewrite),
    explanation: typeof output?.explanation === 'string' ? output.explanation.trim() : '',
  };
}
