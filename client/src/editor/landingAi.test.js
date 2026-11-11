import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorFor,
  highlightIds,
  introSectionId,
  landingSlice,
  locateRequest,
  locateTarget,
  placeProposals,
  previewLanding,
  requestSpot,
  rewriteCopy,
  setLandingSlice,
  targetKey,
} from './landingAi.js';

const item = (title, text) => ({ title, text, url: '' });

const landing = {
  headline: 'Jo',
  subheadline: 'Engineer',
  photo: 'custom',
  photoUrl: 'data:image/jpeg;base64,AAAA',
  sections: [
    { id: 'links', kind: 'links', title: '', links: [] },
    { id: 'intro', kind: 'text', title: '', body: 'Hello.' },
    { id: 'proj', kind: 'items', title: '', items: [item('A', 'one'), item('B', 'two'), item('C', '')] },
    { id: 'cards', kind: 'resumes', title: '', cards: [{ resumeId: 'r1', label: '', blurb: 'Main.' }] },
  ],
};

const itemProposal = (index, after = 'new') => {
  const target = { kind: 'item', sectionId: 'proj', index };
  return { id: `p${index}`, target, before: landingSlice(landing, target), after, anchor: anchorFor(landing, target) };
};

const withItems = (items) => ({
  ...landing,
  sections: landing.sections.map((s) => (s.id === 'proj' ? { ...s, items } : s)),
});

test('targetKey tells every spot apart', () => {
  const keys = [
    { kind: 'headline' },
    { kind: 'subheadline' },
    { kind: 'text', sectionId: 'intro' },
    { kind: 'intro', sectionId: 'intro' },
    { kind: 'item', sectionId: 'proj', index: 0 },
    { kind: 'item', sectionId: 'proj', index: 1 },
    { kind: 'card', sectionId: 'cards', resumeId: 'r1' },
  ].map(targetKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('introSectionId is the first text section', () => {
  assert.equal(introSectionId(landing), 'intro');
  assert.equal(introSectionId({ ...landing, sections: [] }), null);
});

test('introSectionId skips a hidden text section', () => {
  const now = { id: 'now', kind: 'text', title: 'Now', body: 'Later.', hidden: true };
  assert.equal(introSectionId({ ...landing, sections: [now, ...landing.sections] }), 'intro');
  assert.equal(introSectionId({ ...landing, sections: [now] }), null);
});

test('setLandingSlice writes one field and nothing else', () => {
  const next = setLandingSlice(landing, { kind: 'card', sectionId: 'cards', resumeId: 'r1' }, 'Engineering.');
  assert.equal(landingSlice(next, { kind: 'card', sectionId: 'cards', resumeId: 'r1' }), 'Engineering.');
  assert.equal(next.sections[3].cards[0].label, '');
  assert.equal(next.sections[2], landing.sections[2]);
  assert.equal(setLandingSlice(landing, { kind: 'item', sectionId: 'proj', index: 1 }, 'x').sections[2].items[1].title, 'B');
  assert.equal(setLandingSlice(landing, { kind: 'headline' }, 'Hi').headline, 'Hi');
});

test('an item proposal follows its item when it moves', () => {
  const moved = withItems([item('B', 'two'), item('A', 'one'), item('C', '')]);
  assert.deepEqual(locateTarget(moved, itemProposal(0)), { kind: 'item', sectionId: 'proj', index: 1 });
  assert.deepEqual(locateTarget(moved, itemProposal(1)), { kind: 'item', sectionId: 'proj', index: 0 });
});

test('an item edited in place keeps its proposal there, stale', () => {
  const edited = withItems([item('A', 'one!'), item('B', 'two'), item('C', '')]);
  const [placed] = placeProposals(edited, [itemProposal(0)]);
  assert.equal(placed.located.index, 0);
  assert.equal(placed.stale, true);
});

test('an item moved and edited is found by its title', () => {
  const both = withItems([item('B', 'two'), item('C', ''), item('A', 'one, edited')]);
  assert.equal(locateTarget(both, itemProposal(0)).index, 2);
});

test('an untitled item is followed by its text, and by its place only while the list keeps its length', () => {
  const untitled = withItems([item('', 'foo'), item('', 'bar')]);
  const target = { kind: 'item', sectionId: 'proj', index: 0 };
  const proposal = { target, before: 'foo', after: 'new', anchor: anchorFor(untitled, target) };
  assert.equal(locateTarget(withItems([item('', 'bar')]), proposal), null);
  assert.equal(locateTarget(withItems([item('', 'foo!'), item('', 'bar')]), proposal).index, 0);
  assert.equal(locateTarget(withItems([item('', 'bar'), item('', 'foo')]), proposal).index, 1);
  assert.equal(locateRequest(withItems([item('', 'bar')]), requestSpot(untitled, target)), null);
});

test('a proposal whose spot is gone is not placed', () => {
  const removed = withItems([item('B', 'two'), item('C', '')]);
  assert.equal(locateTarget(removed, itemProposal(0)), null);
  const noSection = { ...landing, sections: landing.sections.filter((s) => s.id !== 'intro') };
  const text = { id: 't', target: { kind: 'text', sectionId: 'intro' }, before: 'Hello.', after: 'Hi.' };
  assert.deepEqual(placeProposals(noSection, [text]), []);
  const noCard = { ...landing, sections: landing.sections.map((s) => (s.id === 'cards' ? { ...s, cards: [] } : s)) };
  assert.equal(locateTarget(noCard, { target: { kind: 'card', sectionId: 'cards', resumeId: 'r1' }, before: 'Main.' }), null);
});

test('a request follows its item, and other spots stay put', () => {
  const spot = requestSpot(landing, { kind: 'item', sectionId: 'proj', index: 1 });
  const moved = withItems([item('B', 'two'), item('A', 'one'), item('C', '')]);
  assert.deepEqual(locateRequest(moved, spot), { kind: 'item', sectionId: 'proj', index: 0 });
  assert.equal(locateRequest(withItems([item('A', 'one')]), spot), null);
  const intro = { kind: 'intro', sectionId: 'intro' };
  assert.equal(locateRequest(moved, requestSpot(landing, intro)), intro);
});

test('the preview writes in every proposal that is not stale, and outlines where', () => {
  const proposals = [
    { id: 'h', target: { kind: 'headline' }, before: 'Jo', after: 'Jo Doe' },
    { id: 't', target: { kind: 'text', sectionId: 'intro' }, before: 'Hello (old).', after: 'Hi.' },
    itemProposal(2, 'A third thing.'),
  ];
  const placed = placeProposals(landing, proposals);
  assert.deepEqual(placed.map((p) => p.stale), [false, true, false]);
  const shown = previewLanding(landing, placed);
  assert.equal(shown.headline, 'Jo Doe');
  assert.equal(shown.sections[1].body, 'Hello.');
  assert.equal(shown.sections[2].items[2].text, 'A third thing.');
  assert.deepEqual([...highlightIds(placed)].sort(), ['hero', 'proj']);
});

test('an FAQ answer proposal is keyed by its place, and follows its question when entries move', () => {
  const entry = (question, answer) => ({ question, answer });
  const withFaq = (entries) => ({ ...landing, sections: [...landing.sections, { id: 'faq', kind: 'faq', title: '', entries }] });
  const page = withFaq([entry('Relocate?', 'Yes.'), entry('Start?', 'In May.'), entry('', 'Untitled.')]);
  const target = { kind: 'answer', sectionId: 'faq', index: 0 };
  assert.equal(targetKey(target), 'answer:faq:0');
  assert.notEqual(targetKey(target), targetKey({ kind: 'item', sectionId: 'faq', index: 0 }));
  assert.equal(landingSlice(page, target), 'Yes.');
  assert.equal(landingSlice(page, { ...target, index: 3 }), null);
  assert.equal(landingSlice(page, { kind: 'item', sectionId: 'faq', index: 0 }), null);

  // Accepting writes only that answer.
  const written = setLandingSlice(page, { ...target, index: 1 }, 'From June.');
  assert.deepEqual(written.sections[4].entries, [entry('Relocate?', 'Yes.'), entry('Start?', 'From June.'), entry('', 'Untitled.')]);
  assert.equal(written.sections[2], page.sections[2]);

  const proposal = { id: 'a', target, before: 'Yes.', after: 'Yes, within Europe.', anchor: anchorFor(page, target) };
  assert.deepEqual(proposal.anchor, { title: 'Relocate?', count: 3 });
  // Moved: followed. Moved and edited: found by its question, stale. Removed: gone.
  const moved = withFaq([entry('Start?', 'In May.'), entry('Relocate?', 'Yes.'), entry('', 'Untitled.')]);
  assert.deepEqual(locateTarget(moved, proposal), { ...target, index: 1 });
  const [placed] = placeProposals(withFaq([entry('Start?', 'In May.'), entry('Relocate?', 'Sure.')]), [proposal]);
  assert.deepEqual([placed.located.index, placed.stale, placed.key], [1, true, 'answer:faq:1']);
  assert.equal(locateTarget(withFaq([entry('Start?', 'In May.')]), proposal), null);
  // A request follows its entry the same way.
  assert.deepEqual(locateRequest(moved, requestSpot(page, target)), { ...target, index: 1 });

  // The preview writes it in and outlines its section.
  const shownPlaced = placeProposals(moved, [proposal]);
  assert.equal(previewLanding(moved, shownPlaced).sections[4].entries[1].answer, 'Yes, within Europe.');
  assert.deepEqual([...highlightIds(shownPlaced)], ['faq']);
});

test("a service's proposal is keyed by its place, writes only its text, and follows its title when services move", () => {
  const book = { type: 'link', label: 'Book', url: 'https://cal.example' };
  const service = (title, text) => ({ title, text, price: '$60', action: book });
  const withServices = (services) => ({ ...landing, sections: [...landing.sections, { id: 'sv', kind: 'services', title: '', services }] });
  const page = withServices([service('Tutoring', 'Weekly.'), service('Consult', 'Once.'), service('', 'Untitled.')]);
  const target = { kind: 'service', sectionId: 'sv', index: 0 };
  assert.equal(targetKey(target), 'service:sv:0');
  assert.notEqual(targetKey(target), targetKey({ kind: 'item', sectionId: 'sv', index: 0 }));
  assert.equal(landingSlice(page, target), 'Weekly.');
  assert.equal(landingSlice(page, { ...target, index: 3 }), null);
  assert.equal(landingSlice(page, { kind: 'item', sectionId: 'sv', index: 0 }), null);
  assert.equal(landingSlice(page, { ...target, sectionId: 'proj' }), null);

  // Accepting writes only that service's text: its title, price and button stay.
  const written = setLandingSlice(page, { ...target, index: 1 }, 'One hour.');
  assert.deepEqual(written.sections[4].services, [service('Tutoring', 'Weekly.'), service('Consult', 'One hour.'), service('', 'Untitled.')]);
  assert.equal(written.sections[2], page.sections[2]);

  const proposal = { id: 's', target, before: 'Weekly.', after: 'Every week.', anchor: anchorFor(page, target) };
  assert.deepEqual(proposal.anchor, { title: 'Tutoring', count: 3 });
  // Moved: followed. Moved and edited: found by its title, stale. Removed: gone.
  const moved = withServices([service('Consult', 'Once.'), service('Tutoring', 'Weekly.'), service('', 'Untitled.')]);
  assert.deepEqual(locateTarget(moved, proposal), { ...target, index: 1 });
  const [placed] = placeProposals(withServices([service('Consult', 'Once.'), service('Tutoring', 'Monthly.')]), [proposal]);
  assert.deepEqual([placed.located.index, placed.stale, placed.key], [1, true, 'service:sv:1']);
  assert.equal(locateTarget(withServices([service('Consult', 'Once.')]), proposal), null);
  // A request follows its service the same way.
  assert.deepEqual(locateRequest(moved, requestSpot(page, target)), { ...target, index: 1 });

  // The preview writes it in and outlines its section.
  const shownPlaced = placeProposals(moved, [proposal]);
  assert.equal(previewLanding(moved, shownPlaced).sections[4].services[1].text, 'Every week.');
  assert.deepEqual([...highlightIds(shownPlaced)], ['sv']);
});

test('rewriteCopy leaves the photo out and everything else in', () => {
  const copy = rewriteCopy(landing);
  assert.equal(copy.photoUrl, '');
  assert.equal(copy.photo, 'custom');
  assert.equal(copy.sections, landing.sections);
});
