// The matching resume preset offered after a landing preset (issue #219).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyResumeOffer, offerMessage, offerQuestion, resumePresetOffer } from './presetOffer.js';

const presets = [
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'trades', label: 'Trades' },
];
const resumes = [
  { id: 'r1', name: 'Work', isDefault: false },
  { id: 'r2', name: 'Main', isDefault: true },
];

test('no offer without a resumePreset', () => {
  assert.equal(resumePresetOffer({ id: 'consulting' }, presets, resumes), null);
  assert.equal(resumePresetOffer(null, presets, resumes), null);
  assert.equal(resumePresetOffer(undefined, presets, resumes), null);
});

test('no offer for an unknown resume preset', () => {
  assert.equal(resumePresetOffer({ resumePreset: 'writing' }, presets, resumes), null);
});

test('no offer without a default resume', () => {
  const none = resumes.map((r) => ({ ...r, isDefault: false }));
  assert.equal(resumePresetOffer({ resumePreset: 'trades' }, presets, none), null);
  assert.equal(resumePresetOffer({ resumePreset: 'trades' }, presets, null), null);
  assert.equal(resumePresetOffer({ resumePreset: 'trades' }, presets, undefined), null);
});

test('the preset and the default resume, otherwise', () => {
  const offer = resumePresetOffer({ resumePreset: 'trades' }, presets, resumes);
  assert.deepEqual(offer, { preset: presets[1], resume: resumes[1] });
});

test('the question names the preset and the resume', () => {
  const offer = resumePresetOffer({ resumePreset: 'healthcare' }, presets, resumes);
  assert.equal(offerQuestion(offer), 'Use the "Healthcare" preset on your resume "Main" too?');
});

test('the banner says where the offer stands', () => {
  const offer = resumePresetOffer({ resumePreset: 'healthcare' }, presets, resumes);
  const asking = 'Use the "Healthcare" preset on your resume "Main" too? Only its draft changes; nothing is published.';
  assert.equal(offerMessage(offer), asking);
  assert.equal(offerMessage({ ...offer, status: 'asking' }), asking);
  assert.equal(offerMessage({ ...offer, status: 'applying' }), 'Applying the "Healthcare" preset to "Main"…');
  assert.equal(
    offerMessage({ ...offer, status: 'applied' }),
    'Applied the "Healthcare" preset to the draft of "Main". Publish that resume to show it.'
  );
  // Nothing was applied, so it's asked again.
  assert.equal(
    offerMessage({ ...offer, status: 'failed', error: 'Network down' }),
    `Couldn't apply the "Healthcare" preset to "Main" (Network down). ${asking}`
  );
  assert.match(offerMessage({ ...offer, status: 'failed' }), /\(unknown error\)/);
});

// A resume's API that records its calls and answers from `site`.
function fakeTarget(site, { failGet, failPut } = {}) {
  const calls = [];
  return {
    calls,
    getSite: async () => {
      calls.push(['get']);
      if (failGet) throw new Error('get failed');
      return { site };
    },
    putSite: async (next) => {
      calls.push(['put', next]);
      if (failPut) throw new Error('put failed');
      return { site: next };
    },
  };
}
const offerFor = (preset) => ({ preset, resume: resumes[1] });
const TRADES = { id: 'trades', label: 'Trades', header: 'banner', layout: 'rule-entries', colors: { accent: '#8a4b00' }, font: 'inter' };

test('accepting saves the preset over the stored appearance and keeps the rest', async () => {
  const stored = { title: 'Jo', description: 'Hi', pdfPageNumbers: true, template: 'classic', layout: 'flat', accent: '#111111', nameFont: 'lora', fontWeight: 600 };
  const target = fakeTarget(stored);
  assert.equal(await applyResumeOffer(offerFor(TRADES), target), true);
  assert.deepEqual(target.calls, [
    ['get'],
    ['put', { title: 'Jo', description: 'Hi', pdfPageNumbers: true, template: 'banner', layout: 'rule-entries', colors: { accent: '#8a4b00' }, font: 'inter' }],
  ]);
});

test('a resume with no site settings yet gets the preset alone', async () => {
  for (const stored of [null, undefined]) {
    const target = fakeTarget(stored);
    assert.equal(await applyResumeOffer(offerFor(TRADES), target), true);
    assert.deepEqual(target.calls[1], ['put', { template: 'banner', layout: 'rule-entries', colors: { accent: '#8a4b00' }, font: 'inter' }]);
  }
});

test('nothing is written once the page that asked is gone', async () => {
  const target = fakeTarget({ title: 'Jo' });
  assert.equal(await applyResumeOffer(offerFor(TRADES), target, () => false), false);
  assert.deepEqual(target.calls, [['get']]);
});

test('goOn is asked after the read, not before', async () => {
  const target = fakeTarget({ title: 'Jo' });
  const seen = [];
  await applyResumeOffer(offerFor(TRADES), target, () => {
    seen.push(target.calls.length);
    return true;
  });
  assert.deepEqual(seen, [1]);
});

test('a failed read writes nothing, and either failure rejects', async () => {
  const noRead = fakeTarget({}, { failGet: true });
  await assert.rejects(applyResumeOffer(offerFor(TRADES), noRead), /get failed/);
  assert.deepEqual(noRead.calls, [['get']]);
  await assert.rejects(applyResumeOffer(offerFor(TRADES), fakeTarget({}, { failPut: true })), /put failed/);
});
