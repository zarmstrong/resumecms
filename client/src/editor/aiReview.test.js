import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PRESETS,
  BLOCK_TARGET,
  acceptAllPlan,
  applyProposal,
  bulletChange,
  changedFields,
  describeTarget,
  hiddenBulletCount,
  isProposalStale,
  pickerTense,
  presetsFor,
  previewData,
  previewedProposals,
  proposalKey,
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
