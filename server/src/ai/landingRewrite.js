import { LANDING_LIMITS } from '../landingFields.js';
import { AiError, callProvider } from './providers.js';

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
// Sections and cards are addressed by id, so moving them doesn't move a
// proposal onto something else; items have no ids, so theirs is a position.
//
// The page is shown to every visitor, so what the AI may draw on is too:
// the profile (landingProfile) is built from a resume's *published*
// snapshot, never its draft, and the route only passes one for a resume
// that's public and published. A resume's internal name and its tailoring
// brief are never part of it.

export const LANDING_TARGET_KINDS = ['headline', 'subheadline', 'text', 'item', 'card', 'intro'];

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
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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
    default:
      return null;
  }
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
// the target's spot marked. No URLs, ids or photo.
function pageContext(landing, target) {
  const spots = new Set((target.kind === 'intro' ? introParts(target.sectionId) : [target]).map(spotKey));
  const mark = (spot, value) => (spots.has(spotKey(spot)) ? PLACEHOLDER : value);
  return {
    headline: mark({ kind: 'headline' }, landing.headline),
    subheadline: mark({ kind: 'subheadline' }, landing.subheadline),
    sections: landing.sections.map((section) => {
      const base = { kind: section.kind, title: section.title };
      switch (section.kind) {
        case 'text':
          return { ...base, body: mark({ kind: 'text', sectionId: section.id }, section.body) };
        case 'items':
          return {
            ...base,
            items: section.items.map((item, index) => ({
              title: item.title,
              text: mark({ kind: 'item', sectionId: section.id, index }, item.text),
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
        default:
          return base;
      }
    }),
  };
}

function spotKey(target) {
  return [target.kind, target.sectionId ?? '', target.index ?? '', target.resumeId ?? ''].join('|');
}

// What the model may change, by the names the output schema uses.
function editableFields(landing, target) {
  if (target.kind === 'intro') {
    return {
      headline: landing.headline,
      subheadline: landing.subheadline,
      intro: landingSlice(landing, { kind: 'text', sectionId: target.sectionId }),
    };
  }
  return { text: landingSlice(landing, target) };
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
    default:
      return null;
  }
}

const INTRO_RULE = `"headline" is the page's headline (usually the person's name, at most ${LANDING_LIMITS.headline} characters), "subheadline" the line under it (what they do, in a few words, at most ${LANDING_LIMITS.subheadline} characters), and "intro" a short introduction of two or three paragraphs separated by blank lines, at most ${LANDING_LIMITS.text} characters. Keep any of them that is already good as it is.`;

// `profile` is landingProfile() of the resume the target is about (the
// card's for a blurb, the default resume's otherwise), or null.
export function buildLandingPrompt(landing, target, instruction, profile) {
  const rules = [
    "Only make the changes the instruction asks for, and keep the person's own voice. If the page has no text in their voice yet, write in the first person.",
    'Never invent facts: no employers, job titles, dates, technologies, credentials, projects, or numbers that are not in the input. If there is too little to go on, write less, and say so in "explanation".',
    'Plain text only — no Markdown, no emoji, no links.',
    'In the context, "[the part being rewritten]" marks where the text you are writing sits. Use the rest of the page to stay consistent with it: match its tone, and do not repeat what it already says.',
    'In "explanation", say in one or two sentences what you changed.',
  ];
  if (target.kind === 'intro') rules.push(INTRO_RULE);
  else {
    const item = target.kind === 'item' ? landing.sections.find((s) => s.id === target.sectionId)?.items[target.index] : null;
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
    JSON.stringify(pageContext(landing, target), null, 2),
    '',
    'Section to rewrite:',
    JSON.stringify(editableFields(landing, target), null, 2),
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

function checkLength(value, limit, label) {
  if (value.length > limit) {
    throw new AiError(502, `The AI wrote more than the ${limit} characters the ${label} allows. Try again, or ask for something shorter.`);
  }
  return value;
}

const LABELS = { headline: 'headline', subheadline: 'subheadline', text: 'text section', item: 'item', card: 'card' };

// The proposals the model's `rewrite` makes against `landing`, one per field
// it changed. A field it left alone (give or take whitespace) isn't one.
export function landingProposals(landing, target, rewrite) {
  if (!isPlainObject(rewrite)) throw new AiError(502, 'AI response is missing "rewrite"');
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
    const after = checkLength(requireString(value, field), FIELD_LIMITS[part.kind], LABELS[part.kind]);
    return after === before.trim() ? [] : [{ target: part, before, after }];
  });
}

// Produces the proposals for one landing page rewrite. `landing` is a
// validated draft; `profile` is what the route may share of a resume (see
// above), or null; `callModel` is injectable so tests stand in for the
// provider. Saves nothing.
export async function rewriteLanding({ landing, target, instruction, settings, profile = null, callModel = callProvider }) {
  let scope;
  try {
    scope = normalizeLandingTarget(landing, target);
  } catch (err) {
    if (err instanceof InvalidLandingTargetError) throw new AiError(400, err.message);
    throw err;
  }
  const said = instruction || (scope.kind === 'intro' ? INTRO_INSTRUCTION : '');
  if (!said) throw new AiError(400, 'Tell the AI what to change.');
  const { system, user } = buildLandingPrompt(landing, scope, said, profile);
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
