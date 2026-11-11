import { carryItemKey } from './landingImages.js';

// AI rewrites on the landing page (issue #73): the editor's side of
// server/src/ai/landingRewrite.js. A request is for one spot (a target);
// what comes back is a list of proposals, each `{ target, before, after }`
// for one string field (an `intro` request gives up to three). Nothing is
// saved until a proposal is accepted, which writes `after` into the draft
// and saves it like any other edit.
//
// Sections and cards are addressed by id, so they can move freely. Items are
// a position, so a proposal for one carries an `anchor` (the item's title and
// text when it was made) and locateTarget() follows the item if it moves. An
// FAQ answer (issue #123) is a position too, followed the same way by its
// question, and so is a service's text (issue #122), by the service's title.

// A spot's key: what a request is tracked by, and what a panel finds its
// proposals by.
export function targetKey(target) {
  switch (target.kind) {
    case 'headline':
    case 'subheadline':
      return target.kind;
    case 'text':
    case 'intro':
      return `${target.kind}:${target.sectionId}`;
    case 'item':
      return `item:${target.sectionId}:${target.index}`;
    case 'card':
      return `card:${target.sectionId}:${target.resumeId}`;
    case 'answer':
      return `answer:${target.sectionId}:${target.index}`;
    case 'service':
      return `service:${target.sectionId}:${target.index}`;
    default:
      return '';
  }
}

// The spots an `intro` request writes, as the server's introParts().
export function introParts(sectionId) {
  return [{ kind: 'headline' }, { kind: 'subheadline' }, { kind: 'text', sectionId }];
}

// The text section an intro request writes: the first one visitors see, so
// a hidden one above it (a "Now" note kept for later) doesn't take the intro.
export function introSectionId(landing) {
  return landing.sections.find((s) => s.kind === 'text' && !s.hidden)?.id ?? null;
}

function sectionOf(landing, target, kind) {
  const section = landing.sections.find((s) => s.id === target.sectionId);
  return section?.kind === kind ? section : null;
}

// The targets that are a position in a list, rather than an id.
const POSITIONED = ['item', 'answer', 'service'];

// The list a positioned target's index is in, each entry as { title, text }
// (an FAQ entry's question and answer; a service already is one), so
// locateTarget() follows them all alike.
function positionedList(landing, target) {
  if (target.kind === 'answer') {
    return sectionOf(landing, target, 'faq')?.entries.map((entry) => ({ title: entry.question, text: entry.answer })) ?? null;
  }
  if (target.kind === 'service') return sectionOf(landing, target, 'services')?.services ?? null;
  return sectionOf(landing, target, 'items')?.items ?? null;
}

// The text at `target` in `landing`, or null when it isn't there. Mirrors
// landingSlice() in server/src/ai/landingRewrite.js.
export function landingSlice(landing, target) {
  switch (target.kind) {
    case 'headline':
    case 'subheadline':
      return landing[target.kind];
    case 'text':
      return sectionOf(landing, target, 'text')?.body ?? null;
    case 'item':
      return sectionOf(landing, target, 'items')?.items[target.index]?.text ?? null;
    case 'card':
      return sectionOf(landing, target, 'resumes')?.cards.find((c) => c.resumeId === target.resumeId)?.blurb ?? null;
    case 'answer':
      return sectionOf(landing, target, 'faq')?.entries[target.index]?.answer ?? null;
    case 'service':
      return sectionOf(landing, target, 'services')?.services[target.index]?.text ?? null;
    default:
      return null;
  }
}

// `landing` with `value` at `target` (which must be there).
export function setLandingSlice(landing, target, value) {
  if (target.kind === 'headline' || target.kind === 'subheadline') return { ...landing, [target.kind]: value };
  const sections = landing.sections.map((section) => {
    if (section.id !== target.sectionId) return section;
    switch (target.kind) {
      case 'text':
        return { ...section, body: value };
      case 'item':
        return { ...section, items: section.items.map((item, i) => (i === target.index ? carryItemKey(item, { ...item, text: value }) : item)) };
      case 'card':
        return { ...section, cards: section.cards.map((card) => (card.resumeId === target.resumeId ? { ...card, blurb: value } : card)) };
      case 'answer':
        return { ...section, entries: section.entries.map((entry, i) => (i === target.index ? { ...entry, answer: value } : entry)) };
      case 'service':
        return { ...section, services: section.services.map((service, i) => (i === target.index ? { ...service, text: value } : service)) };
      default:
        return section;
    }
  });
  return { ...landing, sections };
}

// What the proposal for `target` needs to find its item (or FAQ entry, or
// service) again.
export function anchorFor(landing, target) {
  if (!POSITIONED.includes(target.kind)) return null;
  const items = positionedList(landing, target);
  const item = items?.[target.index];
  return item ? { title: item.title, count: items.length } : null;
}

// Where `proposal`'s spot is in `landing` now, or null when it's gone (its
// section, card or item removed). An item is looked for in this order: still
// at its index, unchanged; moved, unchanged, to the one place it could be;
// edited in place (its title or its text still the same); moved and edited,
// to the one item with its title. An item with no title has only its text to
// go by, so an edited one is taken to be in place only while the list is as
// long as it was: otherwise its neighbour, slid into its place after it was
// removed, would look like it. An FAQ answer is followed the same way, its
// question standing for the title, and a service's text by its title.
export function locateTarget(landing, proposal) {
  const { target } = proposal;
  if (!POSITIONED.includes(target.kind)) return landingSlice(landing, target) === null ? null : target;
  const items = positionedList(landing, target);
  if (!items) return null;
  const title = proposal.anchor?.title ?? '';
  const at = (index) => ({ ...target, index });
  const here = items[target.index];
  const unique = (match) => {
    const found = items.flatMap((item, i) => (match(item) ? [i] : []));
    return found.length === 1 ? found[0] : null;
  };
  if (here && here.title === title && here.text === proposal.before) return target;
  const moved = unique((item) => item.title === title && item.text === proposal.before);
  if (moved !== null) return at(moved);
  const sameItem = title ? here?.title === title : items.length === proposal.anchor?.count && here?.title === '';
  if (here && (sameItem || here.text === proposal.before)) return target;
  const retitled = title ? unique((item) => item.title === title) : null;
  return retitled !== null ? at(retitled) : null;
}

// What a request remembers of its spot as it was sent, so locateRequest()
// can follow it the way locateTarget() follows a proposal.
export function requestSpot(landing, target) {
  return { target, before: landingSlice(landing, target), anchor: anchorFor(landing, target) };
}

// Where a request's spot (requestSpot()'s) is now, or null when it's gone:
// an item's follows its item, an answer's its FAQ entry, a service's its
// service; any other spot is
// an id, or the hero, and an intro's is its section.
export function locateRequest(landing, spot) {
  return POSITIONED.includes(spot.target.kind) ? locateTarget(landing, spot) : spot.target;
}

// Whether the spot has been edited since the proposal was made, so that
// accepting it would overwrite those edits. `located` is locateTarget()'s.
export function isStale(landing, proposal, located) {
  return landingSlice(landing, located) !== proposal.before;
}

// Each proposal with where it is now and whether it's stale; ones whose spot
// is gone are left out.
export function placeProposals(landing, proposals) {
  return proposals.flatMap((proposal) => {
    const located = locateTarget(landing, proposal);
    return located ? [{ proposal, located, key: targetKey(located), stale: isStale(landing, proposal, located) }] : [];
  });
}

// The draft as the preview shows it: every placed proposal that isn't stale
// written in. `placed` is placeProposals()'s.
export function previewLanding(landing, placed) {
  return placed.filter((p) => !p.stale).reduce((next, p) => setLandingSlice(next, p.located, p.proposal.after), landing);
}

// What the preview outlines, by LandingView's ids: 'hero' for the headline
// and subheadline, a section's id otherwise.
export function highlightIds(placed) {
  return new Set(placed.filter((p) => !p.stale).map((p) => p.located.sectionId ?? 'hero'));
}

// The draft as a rewrite request sends it: everything but the photo, which
// the AI never sees and which can be most of the request's size.
export function rewriteCopy(landing) {
  return { ...landing, photoUrl: '' };
}

// The quick instructions a panel offers for each kind of spot.
export function presetsFor(kind, current) {
  const empty = !String(current ?? '').trim();
  switch (kind) {
    case 'headline':
      return empty
        ? [{ label: 'Write one', instruction: 'Write a headline for my home page from my resume.' }]
        : [{ label: 'Punchier', instruction: 'Make this headline punchier.' }];
    case 'subheadline':
      return empty
        ? [{ label: 'Write one', instruction: 'Write a subheadline saying what I do, from my resume.' }]
        : [
            { label: 'Shorter', instruction: 'Make this shorter.' },
            { label: 'More specific', instruction: 'Make this more specific about what I do.' },
          ];
    case 'text':
      return empty
        ? [{ label: 'Write an intro', instruction: 'Write a short intro about me, drawing on my resume.' }]
        : [
            { label: 'Shorter', instruction: 'Make this shorter.' },
            { label: 'Friendlier', instruction: 'Make this warmer and more conversational.' },
            { label: 'Fix grammar', instruction: 'Fix grammar and spelling only.' },
          ];
    case 'item':
      return empty
        ? [{ label: 'Write a line', instruction: 'Write a line about this.' }]
        : [
            { label: 'Shorter', instruction: 'Make this shorter.' },
            { label: 'More specific', instruction: 'Make this more specific.' },
          ];
    case 'card':
      return empty
        ? [{ label: 'Write a blurb', instruction: 'Write a short blurb saying what this resume covers.' }]
        : [{ label: 'Shorter', instruction: 'Make this shorter.' }];
    case 'answer':
      return empty
        ? [{ label: 'Write an answer', instruction: 'Write a short answer to this question from my resume.' }]
        : [
            { label: 'Shorter', instruction: 'Make this shorter.' },
            { label: 'Clearer', instruction: 'Make this answer clearer and more direct.' },
            { label: 'Fix grammar', instruction: 'Fix grammar and spelling only.' },
          ];
    case 'service':
      return empty
        ? [{ label: 'Write a description', instruction: 'Write a short description of this service, saying what a client gets from it.' }]
        : [
            { label: 'Shorter', instruction: 'Make this shorter.' },
            { label: 'Clearer', instruction: 'Make it clearer what a client gets from this service.' },
            { label: 'Fix grammar', instruction: 'Fix grammar and spelling only.' },
          ];
    default:
      return [];
  }
}

export const TARGET_LABELS = {
  headline: 'the headline',
  subheadline: 'the subheadline',
  text: 'this text',
  item: 'this item',
  card: 'this card',
  intro: 'the headline and intro',
  answer: 'this answer',
  service: 'this service',
};
