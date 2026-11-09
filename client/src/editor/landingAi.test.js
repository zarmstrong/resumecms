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

test('rewriteCopy leaves the photo out and everything else in', () => {
  const copy = rewriteCopy(landing);
  assert.equal(copy.photoUrl, '');
  assert.equal(copy.photo, 'custom');
  assert.equal(copy.sections, landing.sections);
});
