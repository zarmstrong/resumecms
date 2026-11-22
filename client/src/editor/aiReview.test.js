import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PRESETS,
  BLOCK_TARGET,
  acceptAllPlan,
  applyProposal,
  bulletChange,
  changedFields,
  contextNote,
  describeTarget,
  hiddenBulletCount,
  isProposalStale,
  itemCountChanged,
  pickerTense,
  presetsFor,
  previewData,
  previewedProposals,
  proposalKey,
  landProposal,
  relocateRequest,
  relocateTarget,
  targetKey,
  targetSlice,
  tenseChangeNote,
  wordDiff,
} from './aiReview.js';

test('the tense picker shows the pick made in the panel, else the setting\'s default', () => {
  const options = { auto: { label: 'Any tense' }, past: { label: 'Past tense' }, present: { label: 'Present tense' } };
  assert.equal(pickerTense('present', 'past', options), 'present');
  assert.equal(pickerTense('auto', 'past', options), 'auto');
  assert.equal(pickerTense(null, 'past', options), 'past');
  // Settings without a default: the server's first option, not a guess.
  assert.equal(pickerTense(null, undefined, options), 'auto');
  assert.equal(pickerTense(null, undefined, undefined), undefined);
  assert.equal(pickerTense('past', 'past', null), undefined);
  // A pick or default no longer offered (settings reloaded) is skipped.
  const noPresent = { auto: options.auto, past: options.past };
  assert.equal(pickerTense('present', 'past', noPresent), 'past');
  assert.equal(pickerTense('present', 'gone', noPresent), 'auto');
  assert.equal(pickerTense('toString', undefined, options), 'auto');
});

test('a proposal written with another tense than the picker shows gets a note', () => {
  const options = { auto: { label: 'Any tense' }, past: { label: 'Past tense' }, present: { label: 'Present tense' } };
  assert.equal(tenseChangeNote('present', 'past', options), 'This rewrite used “Present tense”. Try again to use “Past tense”.');
  assert.equal(tenseChangeNote('past', 'past', options), null);
  assert.equal(tenseChangeNote(undefined, 'past', options), null);
  assert.equal(tenseChangeNote('present', 'future', options), 'This rewrite used “Present tense”. Try again to use “future”.');
});

const join = (runs, keep) => runs.filter((r) => keep.includes(r.type)).map((r) => r.text).join('');

test('wordDiff reproduces both sides exactly', () => {
  const before = 'Led a team of five engineers.';
  const after = 'Led a team of eight engineers to ship v2.';
  const runs = wordDiff(before, after);
  assert.equal(join(runs, ['same', 'del']), before);
  assert.equal(join(runs, ['same', 'add']), after);
  assert.ok(runs.some((r) => r.type === 'del' && r.text.includes('five')));
  assert.ok(runs.some((r) => r.type === 'add' && r.text.includes('eight')));
});

test('wordDiff groups a fully rewritten phrase instead of interleaving it', () => {
  const runs = wordDiff('A short description of what the company does.', 'Builds developer tooling for Example Corp.');
  assert.deepEqual(runs.map((r) => r.type), ['del', 'add']);
});

test('wordDiff merges adjacent runs and handles empty sides', () => {
  assert.deepEqual(wordDiff('', 'new text'), [{ type: 'add', text: 'new text' }]);
  assert.deepEqual(wordDiff('old text', ''), [{ type: 'del', text: 'old text' }]);
  assert.deepEqual(wordDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
});

test('changedFields lists only fields that changed', () => {
  const fields = changedFields('skills_group', { category: 'Tools', items: 'a, b' }, { category: 'Tools', items: 'A, B' });
  assert.deepEqual(fields, [{ label: 'Items', before: 'a, b', after: 'A, B' }]);
});

test('changedFields reads each custom item from its body-type field', () => {
  const before = { title: 'T', items: [{ heading: 'h', bodyType: 'link', label: 'View', url: 'u' }] };
  const after = { title: 'T', items: [{ heading: 'h', bodyType: 'link', label: 'See it', url: 'u' }] };
  assert.deepEqual(changedFields('custom', before, after), [{ label: 'Item 1', before: 'View', after: 'See it' }]);
});

test('changedFields includes an experience description written from nothing', () => {
  const fields = changedFields('experience', { tagline: 't' }, { tagline: 't', description: 'New blurb.' });
  assert.deepEqual(fields, [{ label: 'Description', before: '', after: 'New blurb.' }]);
});

test('presetsFor offers to write or rewrite an experience description, only on the description', () => {
  const description = { kind: 'description' };
  const labels = (presets) => presets.map((p) => p.label);
  assert.deepEqual(labels(presetsFor('experience', {}, description)), ['Write description']);
  assert.deepEqual(labels(presetsFor('experience', { description: '  ' }, description)), ['Write description']);
  const rewrite = presetsFor('experience', { description: 'Led things.' }, description);
  assert.equal(rewrite[rewrite.length - 1].label, 'Rewrite description');
  assert.equal(rewrite.length, AI_PRESETS.length + 1);
  assert.equal(presetsFor('experience', {}), AI_PRESETS);
  assert.equal(presetsFor('experience', {}, { kind: 'bullet', path: [0] }), AI_PRESETS);
  assert.equal(presetsFor('summary', { text: 'x' }), AI_PRESETS);
});

test('an executive summary diffs its headline, overview and highlights, ignoring blank highlights', () => {
  const before = { headline: 'Leader', text: 'Builds teams.', highlights: ['Grew team', ''] };
  assert.deepEqual(changedFields('executive_summary', before, { ...before, highlights: ['Grew team'] }), []);
  assert.deepEqual(changedFields('executive_summary', before, { headline: 'Platform leader', text: 'Builds teams.', highlights: ['Grew team', 'Cut spend'] }), [
    { label: 'Headline', before: 'Leader', after: 'Platform leader' },
    { label: 'Key highlights', before: 'Grew team', after: 'Grew team\nCut spend' },
  ]);
});

test('an executive summary leads with drafting from the resume, and says the outline is sent', () => {
  const presets = presetsFor('executive_summary', {});
  assert.deepEqual(presets.slice(0, 2).map((p) => p.label), ['Draft from my resume', 'Pick highlights']);
  assert.deepEqual(presets.slice(2), AI_PRESETS);
  assert.match(contextNote('executive_summary'), /outline of the rest of this resume/);
  assert.equal(contextNote('summary'), null);
});

const exp = {
  tagline: 't',
  description: 'Old blurb',
  bullets: [
    'Legacy bullet',
    { text: 'Second', visibleWeb: true, visiblePrint: false, children: [{ text: 'Child', visibleWeb: true, visiblePrint: true, children: [] }] },
  ],
};

test('targetKey and proposalKey match the server and tell targets apart', () => {
  assert.equal(targetKey(undefined), 'block');
  assert.equal(targetKey({ kind: 'description' }), 'description');
  assert.equal(targetKey({ kind: 'bullet', path: [1, 0] }), 'bullet:1.0');
  assert.equal(targetKey({ kind: 'item', index: 2 }), 'item:2');
  assert.equal(proposalKey('b1', { kind: 'bullet', path: [1] }), 'b1:bullet:1');
  assert.notEqual(proposalKey('b1', { kind: 'bullet', path: [1] }), proposalKey('b1', { kind: 'bullet', path: [1, 0] }));
});

test('describeTarget names the part being rewritten', () => {
  assert.equal(describeTarget(BLOCK_TARGET), null);
  assert.equal(describeTarget({ kind: 'description' }), 'description');
  assert.equal(describeTarget({ kind: 'bullet', path: [1] }), 'bullet 2');
  assert.equal(describeTarget({ kind: 'bullet', path: [1, 0] }), 'sub-bullet 2.1');
  assert.equal(describeTarget({ kind: 'item', index: 0 }), 'item 1');
});

test('targetSlice returns the part a target owns', () => {
  const { description, ...rest } = exp;
  assert.deepEqual(targetSlice('experience', exp), rest);
  const summary = { text: 'x' };
  assert.equal(targetSlice('summary', summary), summary);
  assert.equal(targetSlice('experience', exp, { kind: 'description' }), 'Old blurb');
  assert.equal(targetSlice('experience', {}, { kind: 'description' }), '');
  assert.equal(targetSlice('experience', exp, { kind: 'bullet', path: [0] }).text, 'Legacy bullet');
  assert.equal(targetSlice('experience', exp, { kind: 'bullet', path: [1, 0] }).text, 'Child');
  assert.equal(targetSlice('experience', exp, { kind: 'bullet', path: [5] }), null);
  assert.deepEqual(targetSlice('custom', { items: [{ heading: 'h' }] }, { kind: 'item', index: 0 }), { heading: 'h' });
});

test('applyProposal writes only the description', () => {
  const proposal = { target: { kind: 'description' }, proposedData: { ...exp, tagline: 'other', description: 'New blurb' } };
  const current = { ...exp, tagline: 'edited since' };
  assert.deepEqual(applyProposal('experience', current, proposal), { ...current, description: 'New blurb' });
  const none = { target: { kind: 'description' }, proposedData: { bullets: [] } };
  assert.equal(applyProposal('experience', current, none), current);
});

test('accepting a whole-block experience rewrite keeps the current description', () => {
  const proposal = { target: BLOCK_TARGET, proposedData: { ...exp, tagline: 'New tagline' } };
  // A description edited (or rewritten and accepted) since the proposal survives.
  const edited = applyProposal('experience', { ...exp, description: 'Newer blurb' }, proposal);
  assert.equal(edited.description, 'Newer blurb');
  assert.equal(edited.tagline, 'New tagline');
  // One written since a proposal made when there was none survives too.
  const fromNothing = { target: BLOCK_TARGET, proposedData: { tagline: 'New tagline', bullets: [] } };
  assert.equal(applyProposal('experience', { tagline: 't', description: 'Written since', bullets: [] }, fromNothing).description, 'Written since');
  // And a block that still has none doesn't gain one.
  const { description, ...noDescription } = exp;
  assert.ok(!('description' in applyProposal('experience', noDescription, proposal)));
});

test('a whole-block experience rewrite leaves the labelled details and their flags as they are now', () => {
  const details = { hoursPerWeek: '40', grade: 'GS-0343-11', salary: '$1', supervisor: 'Jane Doe', contactSupervisor: 'yes' };
  const base = { ...exp, ...details };
  const proposal = { target: BLOCK_TARGET, baseData: base, proposedData: { ...base, tagline: 'New tagline' } };

  // Hidden from the web, a salary changed and a supervisor removed since the request.
  const { supervisor, ...withoutSupervisor } = base;
  const current = { ...withoutSupervisor, salary: '$2', detailsVisibleWeb: false };
  const accepted = applyProposal('experience', current, proposal);
  assert.equal(accepted.tagline, 'New tagline');
  assert.equal(accepted.detailsVisibleWeb, false, 'the line stays hidden from the web');
  assert.equal(accepted.salary, '$2');
  assert.ok(!('supervisor' in accepted), 'a detail removed since is not brought back');
  assert.equal(accepted.hoursPerWeek, '40');
  assert.ok(!('detailsVisiblePrint' in accepted));
  assert.deepEqual(previewData('experience', current, [proposal]), accepted, 'the preview shows what Accept saves');

  // Shown again since a request made while it was hidden.
  const hiddenBase = { ...base, detailsVisibleWeb: false, detailsVisiblePrint: false };
  const fromHidden = { target: BLOCK_TARGET, baseData: hiddenBase, proposedData: { ...hiddenBase, tagline: 'New tagline' } };
  const shownAgain = applyProposal('experience', { ...base, detailsVisibleWeb: true }, fromHidden);
  assert.equal(shownAgain.detailsVisibleWeb, true);
  assert.ok(!('detailsVisiblePrint' in shownAgain));

  // Details filled in since a request made before there were any.
  const plain = { target: BLOCK_TARGET, baseData: exp, proposedData: { ...exp, tagline: 'New tagline' } };
  assert.equal(applyProposal('experience', { ...exp, supervisor: 'Jane Doe' }, plain).supervisor, 'Jane Doe');

  // None of it is the proposal's, so none of it makes the proposal out of
  // date, shows in its review, or keeps it out of Accept all.
  assert.equal(isProposalStale('experience', proposal, current), false);
  assert.equal(isProposalStale('experience', proposal, { ...current, tagline: 'edited since' }), true);
  for (const key of [...Object.keys(details), 'detailsVisibleWeb', 'detailsVisiblePrint']) {
    assert.ok(!(key in targetSlice('experience', { ...base, detailsVisibleWeb: false, detailsVisiblePrint: true })), key);
  }
  const plan = acceptAllPlan([{ id: 'b1', type: 'experience', data: current }], [{ ...proposal, blockId: 'b1' }]);
  assert.deepEqual(plan.changes, [{ blockId: 'b1', data: accepted }]);
  assert.deepEqual(plan.skipped, []);

  // Another type's block rewrite still replaces its whole data.
  const summary = { target: BLOCK_TARGET, proposedData: { text: 'New', salary: 'kept as proposed' } };
  assert.equal(applyProposal('summary', { text: 'Old' }, summary), summary.proposedData);
});

test('applyProposal writes only the targeted bullet, keeping the others as stored', () => {
  const proposedData = {
    ...exp,
    description: 'ignored',
    bullets: ['Legacy reworded', { ...exp.bullets[1], text: 'Second reworded', children: [{ ...exp.bullets[1].children[0], text: 'Child reworded' }] }],
  };
  const top = applyProposal('experience', exp, { target: { kind: 'bullet', path: [0] }, proposedData });
  assert.equal(top.description, 'Old blurb');
  assert.deepEqual(top.bullets[0], { text: 'Legacy reworded', visibleWeb: true, visiblePrint: true, children: [] });
  assert.equal(top.bullets[1], exp.bullets[1]);

  const sub = applyProposal('experience', exp, { target: { kind: 'bullet', path: [1, 0] }, proposedData });
  assert.equal(sub.bullets[0], 'Legacy bullet');
  assert.equal(sub.bullets[1].text, 'Second');
  assert.equal(sub.bullets[1].visiblePrint, false);
  assert.equal(sub.bullets[1].children[0].text, 'Child reworded');

  const gone = { ...exp, bullets: ['Only one'] };
  assert.equal(applyProposal('experience', gone, { target: { kind: 'bullet', path: [1, 0] }, proposedData }), gone);
});

test('applyProposal writes only the targeted custom item', () => {
  const data = { title: 'T', items: [{ heading: 'a', text: 'x' }, { heading: 'b', text: 'y' }] };
  const proposedData = { title: 'ignored', items: [{ heading: 'a', text: 'x' }, { heading: 'B', text: 'Y' }] };
  const merged = applyProposal('custom', data, { target: { kind: 'item', index: 1 }, proposedData });
  assert.deepEqual(merged, { title: 'T', items: [data.items[0], { heading: 'B', text: 'Y' }] });
  assert.equal(applyProposal('custom', { items: [] }, { target: { kind: 'item', index: 1 }, proposedData }).items.length, 0);
});

// Issue #214: an item's date is never the AI's, so a proposal neither
// sets nor undoes one, and a date edited meanwhile doesn't make it stale.
test("a custom proposal keeps every item's current date and doesn't go stale over one", () => {
  const base = {
    title: 'Publications',
    items: [
      { heading: 'Paper', bodyType: 'text', text: 'x', date: '2021' },
      { heading: 'Talk', bodyType: 'text', text: 'y' },
    ],
  };
  const proposedData = {
    title: 'Selected publications',
    items: [
      { heading: 'Paper', bodyType: 'text', text: 'X', date: '1999' },
      { heading: 'Talk', bodyType: 'text', text: 'Y', date: 'made up' },
    ],
  };
  // Edited since: the paper's date changed and the talk got one.
  const current = { ...base, items: [{ ...base.items[0], date: '2022' }, { ...base.items[1], date: '2020' }] };

  const block = { target: BLOCK_TARGET, baseData: base, proposedData };
  assert.equal(isProposalStale('custom', block, current), false);
  assert.deepEqual(applyProposal('custom', current, block), {
    title: 'Selected publications',
    items: [
      { heading: 'Paper', bodyType: 'text', text: 'X', date: '2022' },
      { heading: 'Talk', bodyType: 'text', text: 'Y', date: '2020' },
    ],
  });
  const undated = applyProposal('custom', base, block);
  assert.deepEqual(undated.items.map((item) => item.date), ['2021', undefined]);
  assert.equal(Object.hasOwn(undated.items[1], 'date'), false);
  assert.deepEqual(previewData('custom', current, [block]).items.map((item) => item.date), ['2022', '2020']);

  for (const index of [0, 1]) {
    const item = { target: { kind: 'item', index }, baseData: base, proposedData };
    assert.equal(isProposalStale('custom', item, current), false, `item ${index}`);
    assert.deepEqual(applyProposal('custom', current, item).items.map((it) => it.date), ['2022', '2020']);
    assert.deepEqual(applyProposal('custom', base, item).items.map((it) => it.date), ['2021', undefined]);
    assert.equal(Object.hasOwn(applyProposal('custom', base, item).items[1], 'date'), false);
  }
  assert.equal(applyProposal('custom', current, { target: { kind: 'item', index: 0 }, baseData: base, proposedData }).items[0].text, 'X');

  // The text still decides staleness, and the date doesn't move an item
  // proposal onto another item.
  const reworded = { ...current, items: [{ ...current.items[0], text: 'edited' }, current.items[1]] };
  assert.equal(isProposalStale('custom', block, reworded), true);
  assert.deepEqual(relocateTarget('custom', { target: { kind: 'item', index: 1 }, baseData: base }, current), { kind: 'item', index: 1 });
});

// Dates go by position only while the positions still mean the same items:
// once the block's items changed, a stale proposal keeps the dates it was
// made against rather than putting another item's date on each.
test('a stale custom block proposal keeps its own dates, never a moved item\'s', () => {
  const item = (heading, date) => ({ heading, bodyType: 'text', text: heading.toLowerCase(), ...(date ? { date } : {}) });
  const base = { title: 'Pubs', items: [item('A', '2021'), item('B', '2019'), item('C', '2015')] };
  const proposedData = { title: 'Pubs', items: [item("A'", '2021'), item("B'", '2019'), item("C'", '2015')] };
  const proposal = { target: BLOCK_TARGET, baseData: base, proposedData };
  const datesOf = (data) => data.items.map((it) => it.date);

  // A removed and an undated D added: same count, different items.
  const swapped = { ...base, items: [base.items[1], base.items[2], item('D')] };
  assert.equal(isProposalStale('custom', proposal, swapped), true);
  assert.deepEqual(datesOf(applyProposal('custom', swapped, proposal)), ['2021', '2019', '2015']);
  assert.deepEqual(datesOf(previewData('custom', swapped, [proposal])), ['2021', '2019', '2015']);

  // Reordered (say over MCP): same items, same count.
  const reordered = { ...base, items: [base.items[2], base.items[0], base.items[1]] };
  assert.equal(isProposalStale('custom', proposal, reordered), true);
  assert.equal(applyProposal('custom', reordered, proposal), proposedData);

  // A date-only edit still keeps the new date.
  const redated = { ...base, items: [base.items[0], { ...base.items[1], date: '2020' }, base.items[2]] };
  assert.equal(isProposalStale('custom', proposal, redated), false);
  assert.deepEqual(datesOf(applyProposal('custom', redated, proposal)), ['2021', '2020', '2015']);
});

// The lists a date is for repeat themselves: the same award, the same
// heading and text, in several years. Relocation tells them apart by date.
test('an item proposal follows its own dated entry among entries that differ only by date', () => {
  const dl = (date, text = 'College of Eng.') => ({ heading: "Dean's List", bodyType: 'text', text, date });
  const base = { title: 'Awards', items: [dl('2019'), dl('2020'), dl('2021')] };

  // Rewrite the 2019 entry, then delete it: the proposal goes with it,
  // rather than staying, not stale, over the 2020 entry.
  const first = { target: { kind: 'item', index: 0 }, baseData: base, proposedData: { ...base, items: [dl('2019', 'R19'), dl('2020'), dl('2021')] } };
  const withoutFirst = { ...base, items: [base.items[1], base.items[2]] };
  assert.equal(relocateTarget('custom', first, withoutFirst), null);

  // Rewrite the 2021 entry, then delete 2020: it follows its entry to 1.
  const last = { target: { kind: 'item', index: 2 }, baseData: base, proposedData: { ...base, items: [dl('2019'), dl('2020'), dl('2021', 'R21')] } };
  const withoutMiddle = { ...base, items: [base.items[0], base.items[2]] };
  const moved = relocateTarget('custom', last, withoutMiddle);
  assert.deepEqual(moved, { kind: 'item', index: 1 });
  assert.equal(isProposalStale('custom', { ...last, target: moved, origin: last.target }, withoutMiddle), false);
  assert.deepEqual(applyProposal('custom', withoutMiddle, { ...last, target: moved, origin: last.target }).items, [dl('2019'), dl('2021', 'R21')]);

  // A block rewrite maps dates by position while it isn't stale, which with
  // entries like these means every item but its date is as it was made
  // for: each current entry gets the rewrite of an identical one and keeps
  // its own date, so the 2019 entry deleted and a 2022 one added stay so.
  const block = { target: BLOCK_TARGET, baseData: base, proposedData: { ...base, items: [dl('2019', 'R'), dl('2020', 'R'), dl('2021', 'R')] } };
  const shifted = { ...base, items: [base.items[1], base.items[2], dl('2022')] };
  assert.equal(isProposalStale('custom', block, shifted), false);
  assert.deepEqual(applyProposal('custom', shifted, block).items, [dl('2020', 'R'), dl('2021', 'R'), dl('2022', 'R')]);

  // A date edited alone leaves the proposal where it is, and not stale.
  const middle = { target: { kind: 'item', index: 1 }, baseData: base, proposedData: { ...base, items: [dl('2019'), dl('2020', 'R20'), dl('2021')] } };
  const redated = { ...base, items: [base.items[0], dl('2018'), base.items[2]] };
  assert.equal(relocateTarget('custom', middle, redated), middle.target);
  assert.equal(isProposalStale('custom', middle, redated), false);
  assert.deepEqual(applyProposal('custom', redated, middle).items[1], dl('2018', 'R20'));
});

// A date edit that makes two items identical (or a cleared date) moves
// nothing: each proposal stays on its own index, typed one keystroke at a
// time as the editor's anchor advances.
test('a date edit that makes two items twins leaves each proposal on its own item', () => {
  const award = (date) => ({ heading: 'Best paper', bodyType: 'text', text: 'Conf X', ...(date ? { date } : {}) });
  const follow = (proposal, steps) => {
    let p = proposal;
    for (const data of steps) {
      const target = relocateTarget('custom', p, data);
      if (target === null) return null;
      p = { ...p, target, origin: p.origin || p.target, anchorData: data };
    }
    return p;
  };
  const cases = [
    // Retyping item 0's date: 2020 → 202 → 2021.
    [[award('2020'), award('2021')], [[award('202'), award('2021')], [award('2021'), award('2021')]]],
    // Clearing it: 2020 → 202 → … → none.
    [[award('2020'), award()], [[award('202'), award()], [award('20'), award()], [award('2'), award()], [award(), award()]]],
  ];
  for (const [items, stepItems] of cases) {
    const base = { title: 'Awards', items };
    const steps = stepItems.map((step) => ({ ...base, items: step }));
    for (const index of [0, 1]) {
      const proposedData = { ...base, items: items.map((it, i) => (i === index ? { ...it, text: `R${index}` } : it)) };
      const placed = follow({ target: { kind: 'item', index }, baseData: base, proposedData }, steps);
      const last = steps[steps.length - 1];
      assert.deepEqual(placed?.target, { kind: 'item', index }, `item ${index}`);
      assert.equal(isProposalStale('custom', placed, last), false);
      assert.deepEqual(
        applyProposal('custom', last, placed).items.map((it) => it.text),
        [0, 1].map((i) => (i === index ? `R${index}` : 'Conf X'))
      );
    }
  }
});

// Entries that differ only by date, reordered: with dates ignored nothing
// moved, but no date edit leaves the same dated items in another order.
test('an item proposal follows its entry when entries that differ only by date are reordered', () => {
  const award = (date, text = 'Conf X') => ({ heading: 'Best paper', bodyType: 'text', text, date });
  const base = { title: 'Awards', items: [award('2020'), award('2021')] };
  const swapped = { ...base, items: [award('2021'), award('2020')] };
  for (const index of [0, 1]) {
    const year = base.items[index].date;
    const proposedData = { ...base, items: base.items.map((it, i) => (i === index ? award(it.date, `R${year}`) : it)) };
    const proposal = { target: { kind: 'item', index }, baseData: base, proposedData };
    const target = relocateTarget('custom', proposal, swapped);
    assert.deepEqual(target, { kind: 'item', index: 1 - index }, `the ${year} award`);
    const placed = { ...proposal, target, origin: proposal.target, anchorData: swapped };
    assert.equal(isProposalStale('custom', placed, swapped), false);
    assert.deepEqual(
      applyProposal('custom', swapped, placed).items,
      swapped.items.map((it) => (it.date === year ? award(year, `R${year}`) : it))
    );
    assert.deepEqual(previewData('custom', swapped, [placed]).items.find((it) => it.date === year), award(year, `R${year}`));
  }

  // Three of them, the first dragged to the end; one of another kind stays.
  const other = { heading: 'Fellow', bodyType: 'text', text: 'Society Y', date: '2020' };
  const three = { title: 'Awards', items: [award('2019'), award('2020'), award('2021'), other] };
  const dragged = { ...three, items: [award('2020'), award('2021'), award('2019'), other] };
  const at = (index) => relocateTarget('custom', { target: { kind: 'item', index }, baseData: three, proposedData: three }, dragged);
  assert.deepEqual([0, 1, 2].map(at), [{ kind: 'item', index: 2 }, { kind: 'item', index: 0 }, { kind: 'item', index: 1 }]);
  const fellow = { target: { kind: 'item', index: 3 }, baseData: three, proposedData: three };
  assert.equal(relocateTarget('custom', fellow, dragged), fellow.target);

  // Exact copies swapped are the same data: nothing to follow.
  const copies = { title: 'Awards', items: [award('2020'), award('2020')] };
  const copy = { target: { kind: 'item', index: 0 }, baseData: copies, proposedData: copies };
  assert.equal(relocateTarget('custom', copy, { ...copies, items: [award('2020'), award('2020')] }), copy.target);

  // Exact copies with another entry moved past them: a copy that moved
  // can't be told from one that didn't, so their proposals go. While the
  // copies keep their positions, they stay.
  const withOther = { title: 'Awards', items: [award('2020'), award('2020'), other] };
  const past = { ...withOther, items: [other, award('2020'), award('2020')] };
  for (const index of [0, 1]) {
    assert.equal(relocateTarget('custom', { target: { kind: 'item', index }, baseData: withOther, proposedData: withOther }, past), null);
  }
  const around = { title: 'Awards', items: [other, award('2020'), award('2021'), award('2020')] };
  const aroundMoved = { ...around, items: [award('2021'), award('2020'), other, award('2020')] };
  const kept = { target: { kind: 'item', index: 3 }, baseData: around, proposedData: around };
  assert.equal(relocateTarget('custom', kept, aroundMoved), kept.target);

  // Several moved in one update (two swaps): each is found by what it
  // reads, not by the gap it sat in.
  const four = { title: 'Awards', items: [award('2020'), award('2021'), award('2022'), award('2023')] };
  const shuffled = { ...four, items: [award('2021'), award('2020'), award('2023'), award('2022')] };
  const in4 = (index) => relocateTarget('custom', { target: { kind: 'item', index }, baseData: four, proposedData: four }, shuffled);
  assert.deepEqual([0, 1, 2, 3].map((i) => in4(i).index), [1, 0, 3, 2]);
  // The same for entries with nothing alike, reversed.
  const plain = (heading) => ({ heading, bodyType: 'text', text: heading.toLowerCase() });
  const abc = { title: 'T', items: [plain('A'), plain('B'), plain('C'), plain('D')] };
  const reversed = { ...abc, items: [...abc.items].reverse() };
  const inAbc = (index) => relocateTarget('custom', { target: { kind: 'item', index }, baseData: abc, proposedData: abc }, reversed);
  assert.deepEqual([0, 1, 2, 3].map((i) => inAbc(i).index), [3, 2, 1, 0]);
});

// Two entries a date edit made exact copies, then one removed: the data
// is the same whichever went, so the proposal can't be kept on a survivor.
test('an item proposal goes when one of several exact copies of its entry is removed', () => {
  const award = (date, text = 'Conf X') => ({ heading: 'Best paper', bodyType: 'text', text, date });
  const other = { heading: 'Fellow', bodyType: 'text', text: 'Society Y' };
  const base = { title: 'Awards', items: [award('2020'), award('2021'), other] };
  const twins = { ...base, items: [award('2021'), award('2021'), other] };
  const one = { ...base, items: [award('2021'), other] };
  for (const index of [0, 1]) {
    const proposal = { target: { kind: 'item', index }, baseData: base, proposedData: base };
    assert.equal(relocateTarget('custom', proposal, twins), proposal.target);
    assert.equal(relocateTarget('custom', { ...proposal, anchorData: twins }, one), null, `item ${index}`);
    // A request still loading goes the same way.
    const request = { asked: proposal.target, baseData: base, target: proposal.target, anchorData: twins };
    assert.equal(relocateRequest('custom', request, one), null);
  }
  // The other entry's proposal follows it, and removing it instead leaves
  // the copies' proposals where they are.
  const onOther = { target: { kind: 'item', index: 2 }, baseData: base, proposedData: base, anchorData: twins };
  assert.deepEqual(relocateTarget('custom', onOther, one), { kind: 'item', index: 1 });
  const first = { target: { kind: 'item', index: 0 }, baseData: base, proposedData: base, anchorData: twins };
  assert.equal(relocateTarget('custom', first, { ...base, items: [award('2021'), award('2021')] }), first.target);
  // Editing one copy in place isn't a removal: its proposal stays on it.
  const edited = { ...base, items: [award('2021', 'Conf X, with a prize'), award('2021'), other] };
  assert.equal(relocateTarget('custom', first, edited), first.target);
});

// An entry edited and then deleted: the proposal compares against what it
// was made for, not the edited copy, so it can't stay over another year's
// entry that reads the same.
test('an item proposal goes with its entry when the entry is edited and then deleted', () => {
  const award = (date, text = 'Conf X') => ({ heading: 'Best paper', bodyType: 'text', text, date });
  const base = { title: 'Awards', items: [award('2020'), award('2021')] };
  const proposal = { target: { kind: 'item', index: 0 }, baseData: base, proposedData: { ...base, items: [award('2020', 'R2020'), award('2021')] } };
  const edited = { ...base, items: [award('2020', 'Conf X, with a prize'), award('2021')] };
  assert.equal(relocateTarget('custom', proposal, edited), proposal.target);
  assert.equal(isProposalStale('custom', proposal, edited), true);
  const deleted = { ...base, items: [award('2021')] };
  assert.equal(relocateTarget('custom', { ...proposal, anchorData: edited }, deleted), null);

  // It goes with a removed entry whatever takes its place, rather than
  // wait there, stale, for that one to be edited into reading like it.
  const other = { ...base, items: [award('2020'), { heading: 'Fellow', bodyType: 'text', text: 'Society Y' }] };
  const editedOther = { ...other, items: [award('2020', 'edited'), other.items[1]] };
  const onOther = { ...proposal, baseData: other, anchorData: editedOther };
  assert.equal(relocateTarget('custom', onOther, { ...other, items: [other.items[1]] }), null);
  assert.equal(relocateTarget('custom', { ...proposal, baseData: other }, { ...other, items: [other.items[1]] }), null);

  // An edit that makes the entry above read exactly like the proposal's
  // own moves nothing: the proposal doesn't jump onto the edited one.
  const three = { title: 'T', items: [award('2021', 'x'), award('2021', 'y'), award('2021', 'x')] };
  const middle = { target: { kind: 'item', index: 1 }, baseData: three, proposedData: three };
  const alike = { ...three, items: [award('2021', 'y'), award('2021', 'y'), award('2021', 'x')] };
  assert.equal(relocateTarget('custom', middle, alike), middle.target);
});

// A rewrite still loading is followed one change at a time, like a ready
// proposal: placed in one step when it lands, an entry deleted and another
// year's added would read as two date edits.
test('a loading item request follows its entry, and is forgotten with it', () => {
  const award = (date, text = 'Conf X') => ({ heading: 'Best paper', bodyType: 'text', text, ...(date ? { date } : {}) });
  const base = { title: 'Awards', items: [award('2020'), award('2021')] };
  const start = (index) => ({ asked: { kind: 'item', index }, baseData: base, target: { kind: 'item', index }, anchorData: base });
  // The request as EditorPage keeps it across `steps`, or null once dropped.
  const follow = (request, steps) => {
    for (const data of steps) {
      const target = relocateRequest('custom', request, data);
      if (target === null) return null;
      request = { ...request, target, anchorData: data };
    }
    return request;
  };
  const without2020 = { ...base, items: [award('2021')] };
  const with2022 = { ...base, items: [award('2021'), award('2022')] };

  // The 2020 award deleted, a 2022 one added: its request is gone, not
  // waiting to land on the 2021 award.
  assert.equal(follow(start(0), [without2020, with2022]), null);
  // The same one step at a time would stay, and not be stale.
  const late = { target: { kind: 'item', index: 0 }, baseData: base, proposedData: { ...base, items: [award('2020', 'R2020'), award('2021')] } };
  assert.equal(relocateTarget('custom', late, with2022), late.target);
  assert.equal(isProposalStale('custom', late, with2022), false);

  // The 2021 award's request follows it to index 0 and lands there.
  const moved = follow(start(1), [without2020, with2022]);
  assert.deepEqual(moved.target, { kind: 'item', index: 0 });
  const proposedData = { ...base, items: [award('2020'), award('2021', 'R2021')] };
  const landed = landProposal({ blockId: 'b', target: { kind: 'item', index: 1 }, baseData: base, proposedData }, moved);
  assert.deepEqual(landed.target, { kind: 'item', index: 0 });
  assert.deepEqual(landed.origin, { kind: 'item', index: 1 });
  assert.equal(landed.anchorData, with2022);
  assert.equal(relocateTarget('custom', landed, with2022), landed.target);
  assert.equal(isProposalStale('custom', landed, with2022), false);
  assert.deepEqual(applyProposal('custom', with2022, landed).items, [award('2021', 'R2021'), award('2022')]);

  // Edited and then deleted while loading: gone too, compared with what
  // was sent rather than the edited copy.
  const edited = { ...base, items: [award('2020', 'Conf X, with a prize'), award('2021')] };
  assert.equal(follow(start(0), [edited, without2020]), null);

  // A date typed on its own entry meanwhile leaves it where it is.
  const redated = follow(start(0), [{ ...base, items: [award('202'), award('2021')] }, { ...base, items: [award('2021'), award('2021')] }]);
  assert.deepEqual(redated.target, { kind: 'item', index: 0 });
  const unmoved = landProposal({ blockId: 'b', target: { kind: 'item', index: 0 }, baseData: base, proposedData: base }, redated);
  assert.equal(unmoved.origin, undefined);
  assert.equal(unmoved.anchorData, redated.anchorData);

  // Other targets aren't positions: their proposal lands as it came.
  const block = { blockId: 'b', target: BLOCK_TARGET, baseData: base, proposedData: base };
  assert.equal(landProposal(block, { asked: BLOCK_TARGET, target: BLOCK_TARGET }), block);

  // A bullet's request follows its bullet the same way.
  const bullets = { bullets: [{ text: 'one' }, { text: 'two' }] };
  const bullet = { asked: { kind: 'bullet', path: [1] }, baseData: bullets, target: { kind: 'bullet', path: [1] }, anchorData: bullets };
  assert.deepEqual(relocateRequest('experience', bullet, { bullets: [{ text: 'two' }] }), { kind: 'bullet', path: [0] });
});

// A block proposal goes by position, and has no anchor to follow a reorder
// with. Where the date is all that tells entries apart and it words them
// differently, dates that aren't the ones it was made against make it
// stale, so each entry can't silently get another year's rewrite.
test('a custom block proposal goes stale when entries that differ only by date may have traded places', () => {
  const award = (date, text = 'Conf X') => ({ heading: 'Best paper', bodyType: 'text', text, ...(date ? { date } : {}) });
  const talk = { heading: 'Keynote', bodyType: 'text', text: 'Conf Z', date: '2018' };
  const base = { title: 'Awards', items: [award('2020'), award('2021'), talk] };
  const proposedData = { title: 'Awards', items: [award('2020', 'R2020'), award('2021', 'R2021'), { ...talk, text: 'RZ' }] };
  const proposal = { blockId: 'b', target: BLOCK_TARGET, baseData: base, proposedData };
  const blockOf = (data) => [{ id: 'b', type: 'custom', data }];

  assert.equal(isProposalStale('custom', proposal, base), false);

  // Swapped: accepting would put the 2020 rewrite on the 2021 award.
  const swapped = { ...base, items: [award('2021'), award('2020'), talk] };
  assert.equal(isProposalStale('custom', proposal, swapped), true);
  assert.equal(applyProposal('custom', swapped, proposal), proposedData);
  assert.deepEqual(acceptAllPlan(blockOf(swapped), [proposal]), { changes: [], accepted: [], skipped: [proposal] });

  // Swapped and then redated, or one deleted and another year added: the
  // dates can't say which entry is which any more.
  for (const items of [
    [award('2021'), award('2019'), talk],
    [award('2021'), award('2022'), talk],
    [award('2020'), award(), talk],
  ]) {
    assert.equal(isProposalStale('custom', proposal, { ...base, items }), true, JSON.stringify(items.map((it) => it.date)));
  }

  // A date edited on an entry nothing else looks like is only a date edit.
  const redated = { ...base, items: [award('2020'), award('2021'), { ...talk, date: '2019' }] };
  assert.equal(isProposalStale('custom', proposal, redated), false);
  assert.deepEqual(applyProposal('custom', redated, proposal).items, [award('2020', 'R2020'), award('2021', 'R2021'), { ...talk, text: 'RZ', date: '2019' }]);
  assert.equal(acceptAllPlan(blockOf(redated), [proposal]).accepted.length, 1);

  // Entries it words alike can't be mixed up, wherever they went.
  const alike = { ...proposal, proposedData: { ...proposedData, items: [award('2020', 'R'), award('2021', 'R'), { ...talk, text: 'RZ' }] } };
  assert.equal(isProposalStale('custom', alike, swapped), false);
  assert.deepEqual(applyProposal('custom', swapped, alike).items, [award('2021', 'R'), award('2020', 'R'), { ...talk, text: 'RZ' }]);

  // A legacy pair counts as it's stored after the form normalized it.
  const legacy = (date) => ({ heading: 'Best paper', body: 'Conf X', date });
  const legacyProposal = {
    target: BLOCK_TARGET,
    baseData: { title: 'Awards', items: [legacy('2020'), legacy('2021')] },
    proposedData: { title: 'Awards', items: [award('2020', 'R2020'), award('2021', 'R2021')] },
  };
  const normalized = (date) => ({ ...legacy(date), bodyType: 'text', text: 'Conf X' });
  assert.equal(isProposalStale('custom', legacyProposal, { title: 'Awards', items: [normalized('2020'), normalized('2021')] }), false);
  assert.equal(isProposalStale('custom', legacyProposal, { title: 'Awards', items: [normalized('2021'), normalized('2020')] }), true);
});

// An item removed and another added that reads the same but for its date
// is, in the data, a date edit. EditorPage notes the count changing.
test('a custom block proposal is stale for good once its item count has differed', () => {
  const award = (date, text = 'Conf X') => ({ heading: 'Best paper', bodyType: 'text', text, ...(date ? { date } : {}) });
  const base = { title: 'Awards', items: [award('2020')] };
  const proposal = { blockId: 'b', target: BLOCK_TARGET, baseData: base, proposedData: { title: 'Awards', items: [award('2020', 'R2020')] } };
  const empty = { ...base, items: [] };
  const retyped = { ...base, items: [award('2021')] };

  assert.equal(itemCountChanged('custom', BLOCK_TARGET, base, base), false);
  assert.equal(itemCountChanged('custom', BLOCK_TARGET, base, retyped), false);
  assert.equal(itemCountChanged('custom', undefined, base, empty), true);
  assert.equal(itemCountChanged('custom', BLOCK_TARGET, base, { ...base, items: [award('2020'), award()] }), true);
  // Only a custom block's whole-block rewrite goes by item position.
  assert.equal(itemCountChanged('custom', { kind: 'item', index: 0 }, base, empty), false);
  assert.equal(itemCountChanged('skills_group', BLOCK_TARGET, base, empty), false);

  // Unnoted, the retyped entry reads as a date edit; noted, it's stale,
  // the proposal keeps its own dates, and Accept all leaves it open.
  assert.equal(isProposalStale('custom', proposal, retyped), false);
  const noted = { ...proposal, itemsChanged: true };
  assert.equal(isProposalStale('custom', noted, retyped), true);
  assert.equal(isProposalStale('custom', noted, base), true);
  assert.equal(applyProposal('custom', retyped, noted), noted.proposedData);
  assert.deepEqual(acceptAllPlan([{ id: 'b', type: 'custom', data: retyped }], [noted]).skipped, [noted]);

  // A request that saw the count differ while it loaded lands noted.
  const landed = landProposal(proposal, { asked: BLOCK_TARGET, baseData: base, itemsChanged: true });
  assert.equal(landed.itemsChanged, true);
  assert.equal(isProposalStale('custom', landed, retyped), true);
  assert.equal(landProposal(proposal, { asked: BLOCK_TARGET, baseData: base }), proposal);
  assert.equal(landProposal(proposal, { asked: undefined, baseData: base }), proposal);
});

// The form writes every legacy { heading, body } item back with a bodyType
// and text on any edit to its block, a date's included.
test('a date edit on a block of legacy custom items makes none of its proposals stale', () => {
  const base = { title: 'Talks', items: [{ heading: 'Conf', body: 'Spoke.' }, { heading: 'Meetup', body: 'Demoed.' }] };
  const proposedData = {
    title: 'Talks',
    items: [
      { heading: 'Conf', bodyType: 'text', text: 'Spoke well.' },
      { heading: 'Meetup', bodyType: 'text', text: 'Demoed it.' },
    ],
  };
  // As CustomForm leaves it after a date typed on the second item.
  const current = {
    title: 'Talks',
    items: [
      { heading: 'Conf', body: 'Spoke.', bodyType: 'text', text: 'Spoke.' },
      { heading: 'Meetup', body: 'Demoed.', bodyType: 'text', text: 'Demoed.', date: '2024' },
    ],
  };
  const block = { target: BLOCK_TARGET, baseData: base, proposedData };
  assert.equal(isProposalStale('custom', block, current), false);
  assert.deepEqual(applyProposal('custom', current, block).items.map((it) => it.date), [undefined, '2024']);
  for (const index of [0, 1]) {
    const proposal = { target: { kind: 'item', index }, baseData: base, proposedData };
    assert.equal(isProposalStale('custom', proposal, current), false, `item ${index}`);
    assert.deepEqual(relocateTarget('custom', proposal, current), { kind: 'item', index });
  }
  // Its text edited is still an edit.
  const edited = { ...current, items: [{ ...current.items[0], text: 'Spoke twice.' }, current.items[1]] };
  assert.equal(isProposalStale('custom', { target: { kind: 'item', index: 0 }, baseData: base, proposedData }, edited), true);
  assert.equal(isProposalStale('custom', block, edited), true);
});

test('applyProposal for the whole block returns the proposed data', () => {
  const proposal = { target: BLOCK_TARGET, proposedData: { text: 'new' } };
  assert.deepEqual(applyProposal('summary', { text: 'old' }, proposal), { text: 'new' });
});

test('previewData lays narrow proposals over a whole-block one, whatever order they came in', () => {
  const description = { target: { kind: 'description' }, baseData: exp, proposedData: { ...exp, description: 'New blurb' } };
  const block = { target: BLOCK_TARGET, proposedData: { ...exp, tagline: 'New tagline' } };
  const bullet = { target: { kind: 'bullet', path: [0] }, baseData: exp, proposedData: { ...exp, bullets: ['Legacy reworded', exp.bullets[1]] } };
  const data = previewData('experience', exp, [description, bullet, block]);
  assert.equal(data.tagline, 'New tagline');
  assert.equal(data.description, 'New blurb');
  assert.equal(data.bullets[0].text, 'Legacy reworded');
  assert.equal(previewData('experience', exp, []), exp);
});

test('Accept all saves what the preview shows, except a whole-block rewrite the block was edited since', () => {
  const summaryData = { text: 'Engineer.' };
  const blocks = [
    { id: 'e', type: 'experience', data: exp },
    { id: 's', type: 'summary', data: summaryData },
    { id: 'k', type: 'skills_group', data: { category: 'Cloud', items: 'AWS, edited' } },
    { id: 'none', type: 'summary', data: { text: 'Untouched.' } },
  ];
  const expBlock = { blockId: 'e', target: BLOCK_TARGET, baseData: exp, proposedData: { ...exp, tagline: 'New tagline' } };
  const expDescription = { blockId: 'e', target: { kind: 'description' }, baseData: exp, proposedData: { ...exp, description: 'New blurb' } };
  const summary = { blockId: 's', target: BLOCK_TARGET, baseData: summaryData, proposedData: { text: 'SRE.' } };
  // made before the skills row was edited: the preview shows it, Accept all leaves it
  const staleSkills = { blockId: 'k', target: BLOCK_TARGET, baseData: { category: 'Cloud', items: 'AWS' }, proposedData: { category: 'Cloud', items: 'AWS, GCP' } };

  const plan = acceptAllPlan(blocks, [summary, expDescription, staleSkills, expBlock]);
  assert.deepEqual(plan.changes.map((c) => c.blockId), ['e', 's']);
  const expData = plan.changes[0].data;
  assert.equal(expData.tagline, 'New tagline');
  assert.equal(expData.description, 'New blurb', 'both of the entry\'s rewrites, composed');
  assert.deepEqual(expData, previewData('experience', exp, [expBlock, expDescription]), 'exactly what the preview shows');
  assert.deepEqual(plan.changes[1].data, { text: 'SRE.' });
  assert.deepEqual(plan.skipped, [staleSkills]);
  assert.equal(plan.accepted.length, 3);
  assert.ok(previewedProposals('skills_group', blocks[2].data, [staleSkills]).includes(staleSkills), 'though the preview shows it');

  assert.deepEqual(acceptAllPlan(blocks, []), { changes: [], accepted: [], skipped: [] });
});

test('isProposalStale only looks at the part the proposal is for', () => {
  const bullet = { target: { kind: 'bullet', path: [1] }, baseData: exp };
  assert.equal(isProposalStale('experience', bullet, { ...exp, description: 'edited' }), false);
  assert.equal(isProposalStale('experience', bullet, { ...exp, bullets: [exp.bullets[1], exp.bullets[0]] }), true);
  const description = { target: { kind: 'description' }, baseData: exp };
  assert.equal(isProposalStale('experience', description, { ...exp, bullets: [] }), false);
  assert.equal(isProposalStale('experience', description, { ...exp, description: 'edited' }), true);
  // Accepting a whole-block experience rewrite keeps the current
  // description, so editing it since doesn't make the rewrite stale.
  const block = { target: BLOCK_TARGET, baseData: exp };
  assert.equal(isProposalStale('experience', block, { ...exp, description: 'edited' }), false);
  assert.equal(isProposalStale('experience', block, { ...exp, tagline: 'edited' }), true);
});

const b = (text, children = []) => ({ text, visibleWeb: true, visiblePrint: true, children });

test('relocateTarget follows a bullet that moved, and keeps one edited in place', () => {
  const base = { bullets: [b('One'), b('Two', [b('Two-a')]), b('Three')] };
  const proposal = { target: { kind: 'bullet', path: [2] }, baseData: base };
  // Unchanged: same target object back.
  assert.equal(relocateTarget('experience', proposal, base), proposal.target);
  // Bullet 1 deleted: "Three" is now at [1].
  assert.deepEqual(relocateTarget('experience', proposal, { bullets: [b('Two', [b('Two-a')]), b('Three')] }), { kind: 'bullet', path: [1] });
  // Dragged to the top.
  assert.deepEqual(relocateTarget('experience', proposal, { bullets: [b('Three'), b('One'), b('Two', [b('Two-a')])] }), { kind: 'bullet', path: [0] });
  // Edited in place: stays, and is stale.
  const edited = { bullets: [b('One'), b('Two', [b('Two-a')]), b('Three!')] };
  assert.equal(relocateTarget('experience', proposal, edited), proposal.target);
  assert.equal(isProposalStale('experience', proposal, edited), true);
  // Deleted, and its position is gone: null.
  assert.equal(relocateTarget('experience', proposal, { bullets: [b('One'), b('Two')] }), null);
  // A new (empty) bullet added above it: follows.
  assert.deepEqual(
    relocateTarget('experience', proposal, { bullets: [b(''), b('One'), b('Two', [b('Two-a')]), b('Three')] }),
    { kind: 'bullet', path: [3] }
  );
  // A new bullet added above it while it was being edited elsewhere: the
  // edit to another bullet doesn't stop it following.
  assert.deepEqual(
    relocateTarget('experience', proposal, { bullets: [b('One!'), b('New'), b('Two', [b('Two-a')]), b('Three')] }),
    { kind: 'bullet', path: [3] }
  );
});

test('relocateTarget keeps a bullet edited in place, even when an identical bullet is elsewhere', () => {
  const base = { bullets: [b('Managed team'), b('Shipped app'), b('Managed team')] };
  const proposal = { target: { kind: 'bullet', path: [0] }, baseData: base };
  const edited = { bullets: [b('Managed a team of five'), b('Shipped app'), b('Managed team')] };
  // Not moved to [2]: [0] now holds text that was never in the block.
  assert.equal(relocateTarget('experience', proposal, edited), proposal.target);
  assert.equal(isProposalStale('experience', proposal, edited), true);
  // Edited, then a bullet added (below, or above it): EditorPage advances
  // the anchor after each change, and it never jumps to the twin.
  const anchored = { ...proposal, anchorData: edited };
  assert.equal(
    relocateTarget('experience', anchored, { bullets: [...edited.bullets, b('New')] }),
    anchored.target
  );
  assert.deepEqual(
    relocateTarget('experience', anchored, { bullets: [b('New'), ...edited.bullets] }),
    { kind: 'bullet', path: [1] }
  );
  // Deleted above after the edit: follows up.
  assert.deepEqual(
    relocateTarget('experience', { ...proposal, target: { kind: 'bullet', path: [1] }, anchorData: { bullets: [b('New'), ...edited.bullets] } }, edited),
    { kind: 'bullet', path: [0] }
  );
  // A real move still relocates: [0] now holds another original bullet.
  const dragged = { bullets: [b('Shipped app'), b('Managed team'), b('Other')] };
  const single = { target: { kind: 'bullet', path: [0] }, baseData: { bullets: [b('Managed team'), b('Shipped app'), b('Other')] } };
  assert.deepEqual(relocateTarget('experience', single, dragged), { kind: 'bullet', path: [1] });
});

test('previewedProposals leaves out any narrow proposal whose part was edited, and says why by omission only', () => {
  const base = { description: 'Old', bullets: [b('One')] };
  const description = { target: { kind: 'description' }, baseData: base, proposedData: { ...base, description: 'New' } };
  const block = { target: BLOCK_TARGET, baseData: base, proposedData: { ...base, tagline: 'T' } };
  const edited = { ...base, description: 'Typed since' };
  assert.deepEqual(previewedProposals('experience', base, [description, block]), [block, description]);
  // Edited description: its proposal drops out; the whole-block one stays.
  assert.deepEqual(previewedProposals('experience', edited, [description, block]), [block]);
  assert.equal(previewData('experience', edited, [description]).description, 'Typed since');
});

test('relocateTarget only matches a sub-bullet to sub-bullets', () => {
  const base = { bullets: [b('Parent', [b('Child')]), b('Other')] };
  const proposal = { target: { kind: 'bullet', path: [0, 0] }, baseData: base };
  // A top-level "Child" with no children has the same normalized shape, but isn't a match.
  assert.equal(relocateTarget('experience', proposal, { bullets: [b('Child'), b('Other')] }), null);
  assert.deepEqual(relocateTarget('experience', proposal, { bullets: [b('Other'), b('Parent', [b('Child')])] }), { kind: 'bullet', path: [1, 0] });
});

test('relocateTarget follows a moved custom item and leaves other targets alone', () => {
  const base = { items: [{ heading: 'a' }, { heading: 'b' }] };
  const proposal = { target: { kind: 'item', index: 1 }, baseData: base };
  assert.deepEqual(relocateTarget('custom', proposal, { items: [{ heading: 'b' }] }), { kind: 'item', index: 0 });
  const description = { target: { kind: 'description' }, baseData: exp };
  assert.equal(relocateTarget('experience', description, {}), description.target);
});

test('a relocated proposal applies, diffs, and checks staleness from its original position', () => {
  const base = { bullets: [b('One'), b('Two')] };
  const proposedData = { bullets: [b('One'), b('Two, rewritten')] };
  const moved = { target: { kind: 'bullet', path: [0] }, origin: { kind: 'bullet', path: [1] }, baseData: base, proposedData };
  const current = { bullets: [b('Two'), b('One')] };
  assert.equal(isProposalStale('experience', moved, current), false);
  assert.deepEqual(applyProposal('experience', current, moved).bullets.map((x) => x.text), ['Two, rewritten', 'One']);
});

test('previewData leaves out a bullet proposal whose spot now holds a different bullet', () => {
  const base = { bullets: [b('One'), b('Two')] };
  const proposal = { target: { kind: 'bullet', path: [1] }, baseData: base, proposedData: { bullets: [b('One'), b('Two, rewritten')] } };
  assert.equal(previewData('experience', base, [proposal]).bullets[1].text, 'Two, rewritten');
  const replaced = { bullets: [b('One'), b('Something else')] };
  assert.equal(previewData('experience', replaced, [proposal]), replaced);
});

test('previewData shows a bullet rewrite over a reword-only block rewrite, but not over a restructuring one', () => {
  const base = { tagline: 't', bullets: [b('One'), b('Two')] };
  const bullet = { target: { kind: 'bullet', path: [1] }, baseData: base, proposedData: { ...base, bullets: [b('One'), b('Two, rewritten')] } };
  const reword = { target: BLOCK_TARGET, allowBulletRestructure: false, proposedData: { tagline: 'T', bullets: [b('One!'), b('Two!')] } };
  const shown = previewData('experience', base, [reword, bullet]);
  assert.deepEqual(shown.bullets.map((x) => x.text), ['One!', 'Two, rewritten']);
  assert.equal(shown.tagline, 'T');
  const restructure = { ...reword, allowBulletRestructure: true, proposedData: { tagline: 'T', bullets: [b('Two!'), b('One!')] } };
  assert.deepEqual(previewData('experience', base, [bullet, restructure]).bullets.map((x) => x.text), ['Two!', 'One!']);
});

test('previewData leaves out a sub-bullet rewrite while its parent bullet has a restructuring rewrite open', () => {
  const base = { bullets: [b('Parent', [b('A'), b('B')])] };
  const parent = {
    target: { kind: 'bullet', path: [0] },
    allowBulletRestructure: true,
    baseData: base,
    proposedData: { bullets: [b('Parent!', [b('A and B merged')])] },
  };
  const child = { target: { kind: 'bullet', path: [0, 1] }, baseData: base, proposedData: { bullets: [b('Parent', [b('A'), b('B!')])] } };
  assert.deepEqual(previewData('experience', base, [parent, child]).bullets[0].children.map((x) => x.text), ['A and B merged']);
  // Reword-only, positions hold, so both show.
  const reword = { ...parent, allowBulletRestructure: false, proposedData: { bullets: [b('Parent!', [b('A!'), b('B')])] } };
  assert.deepEqual(previewData('experience', base, [reword, child]).bullets[0].children.map((x) => x.text), ['A!', 'B!']);
});

test('the helpers tolerate a block whose data is null', () => {
  assert.equal(targetSlice('experience', null, { kind: 'description' }), '');
  assert.equal(targetSlice('experience', null, { kind: 'bullet', path: [0] }), null);
  const proposal = { target: { kind: 'description' }, baseData: null, proposedData: { description: 'New' } };
  assert.equal(isProposalStale('experience', proposal, null), false);
  assert.deepEqual(applyProposal('experience', null, proposal), { description: 'New' });
  assert.equal(relocateTarget('experience', { target: { kind: 'bullet', path: [0] }, baseData: null }, null), null);
});

test('changedFields is scoped to the target', () => {
  const after = { ...exp, tagline: 'changed', description: 'New blurb' };
  assert.deepEqual(changedFields('experience', exp, after, { kind: 'description' }), [{ label: 'Description', before: 'Old blurb', after: 'New blurb' }]);
  assert.deepEqual(changedFields('experience', exp, after, { kind: 'bullet', path: [0] }), []);
  const before = { title: 'T', items: [{ heading: 'a', bodyType: 'tags', items: 'x, y' }] };
  const next = { title: 'U', items: [{ heading: 'a', bodyType: 'tags', items: 'X, Y' }] };
  assert.deepEqual(changedFields('custom', before, next, { kind: 'item', index: 0 }), [{ label: 'Item', before: 'x, y', after: 'X, Y' }]);
});

test('bulletChange labels added, reworded, and unchanged bullets', () => {
  assert.equal(bulletChange({ before: null, after: 'x' }), 'added');
  assert.equal(bulletChange({ before: 'x', after: 'y' }), 'reworded');
  assert.equal(bulletChange({ before: 'x', after: 'x' }), 'unchanged');
});

test('isProposalStale detects edits made after the proposal', () => {
  const proposal = { baseData: { text: 'a' } };
  assert.equal(isProposalStale('summary', proposal, { text: 'a' }), false);
  assert.equal(isProposalStale('summary', proposal, { text: 'ab' }), true);
});

test('hiddenBulletCount counts bullets hidden from web or print, sub-bullets included', () => {
  const data = {
    bullets: [
      'legacy string bullet',
      { text: 'a', visibleWeb: true, visiblePrint: false, children: [{ text: 'b', visibleWeb: false, visiblePrint: true }] },
      { text: 'c', visibleWeb: true, visiblePrint: true, children: [{ text: 'd', visibleWeb: true, visiblePrint: true }] },
    ],
  };
  assert.equal(hiddenBulletCount('experience', data), 2);
  assert.equal(hiddenBulletCount('experience', {}), 0);
  assert.equal(hiddenBulletCount('summary', data), 0);
});

test('hiddenBulletCount counts a hidden bullet\'s sub-bullets as hidden too', () => {
  const data = {
    bullets: [{ text: 'a', visibleWeb: false, visiblePrint: true, children: [{ text: 'b' }, { text: 'c', visibleWeb: true, visiblePrint: true }] }],
  };
  assert.equal(hiddenBulletCount('experience', data), 3);
});
