import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialLanding, validateLanding } from '../../../server/src/landingFields.js';
import { applyPreset, contactFromLinks, offerPresetsOnOpen, presetSectionLabels, sectionHasWork } from './landingPresets.js';

// The presets as the registry loads them (it uses import.meta.glob, which
// node:test can't run).
const PRESET_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/landing-presets');
const PRESETS = fs
  .readdirSync(PRESET_DIR)
  .map((id) => JSON.parse(fs.readFileSync(path.join(PRESET_DIR, id, 'template.json'), 'utf8')));
const byId = (id) => PRESETS.find((p) => p.id === id);

const resumes = [
  { id: 'r-other', name: 'Other', isDefault: false },
  { id: 'r-main', name: 'Main', isDefault: true },
];
const refs = {
  knownResumeIds: new Set(resumes.map((r) => r.id)),
  previousResumeIds: new Set(),
  knownImageIds: new Set(),
  previousImageIds: new Set(),
  knownFileIds: new Set(),
  previousFileIds: new Set(),
};

// A first draft, as the server builds one from the default resume's header.
const firstDraft = () =>
  initialLanding('r-main', {
    name: 'Sam Rivera',
    title: 'Licensed electrician',
    email: 'sam@example.com',
    phone: '(555) 010-0199',
    links: [{ label: 'Instagram', url: 'https://instagram.com/sam' }],
  });

test('the five presets from issue #130 exist', () => {
  assert.deepEqual(PRESETS.map((p) => p.id).sort(), ['creative', 'education', 'healthcare', 'research', 'trades']);
});

test('every preset, applied to a first draft, is a draft the server accepts', () => {
  for (const preset of PRESETS) {
    const next = applyPreset(firstDraft(), preset, resumes, PRESETS);
    assert.doesNotThrow(() => validateLanding(next, refs), preset.id);
    assert.equal(next.template, preset.template);
    assert.deepEqual(next.style, preset.style);
    // Its own sections first, in its order.
    assert.deepEqual(
      next.sections.slice(0, preset.sections.length).map((s) => s.kind),
      preset.sections.map((s) => s.kind),
      preset.id,
    );
  }
});

test('applying a preset keeps the hero and never drops a section with something in it', () => {
  const draft = firstDraft();
  draft.availability = 'Booking for March';
  const next = applyPreset(draft, byId('trades'), resumes, PRESETS);
  assert.equal(next.headline, 'Sam Rivera');
  assert.equal(next.subheadline, 'Licensed electrician');
  assert.equal(next.availability, 'Booking for March');
  assert.deepEqual(next.actions, draft.actions);
  // Trades has no links or resume cards: the first draft's follow its own
  // sections, and its empty intro is dropped.
  const kinds = next.sections.map((s) => s.kind);
  assert.deepEqual(kinds, ['contact', 'services', 'credentials', 'gallery', 'quotes', 'links', 'resumes']);
  assert.ok(!next.sections.some((s) => s.id === 'intro'));
  const links = draft.sections.find((s) => s.kind === 'links');
  assert.equal(next.sections.find((s) => s.kind === 'links'), links);
});

test('a section of a kind the preset has is carried over in its place, its own title kept', () => {
  const draft = firstDraft();
  draft.sections[0] = { ...draft.sections[0], title: 'Hello', body: 'I teach chemistry.' };
  const next = applyPreset(draft, byId('education'), resumes, PRESETS);
  assert.equal(next.sections[0].id, 'intro');
  assert.equal(next.sections[0].title, 'Hello');
  assert.equal(next.sections[0].body, 'I teach chemistry.');

  // Untitled, it takes the preset's title.
  const untitled = firstDraft();
  untitled.sections[0] = { ...untitled.sections[0], body: 'I teach chemistry.' };
  assert.equal(applyPreset(untitled, byId('education'), resumes, PRESETS).sections[0].title, 'About me');
});

test('switching presets drops the empty sections the first one added', () => {
  const trades = applyPreset(firstDraft(), byId('trades'), resumes, PRESETS);
  const research = applyPreset(trades, byId('research'), resumes, PRESETS);
  const kinds = research.sections.map((s) => s.kind);
  assert.ok(!kinds.includes('services') && !kinds.includes('gallery'), kinds.join());
  // But a contact section the first preset filled in from the links stays.
  assert.ok(kinds.includes('contact'));
  assert.doesNotThrow(() => validateLanding(research, refs));
});

test('a section the person titled themselves counts as written in, a preset title does not', () => {
  assert.equal(sectionHasWork({ id: 'a', kind: 'services', title: 'Services', services: [{ title: '', text: '', price: '' }] }, PRESETS), false);
  assert.equal(sectionHasWork({ id: 'a', kind: 'services', title: 'What I do', services: [] }, PRESETS), true);
  assert.equal(sectionHasWork({ id: 'a', kind: 'text', title: '', body: 'Hi' }, PRESETS), true);
  // An experience section reads a resume: nothing typed but its title,
  // so it holds something only when it's set up otherwise than a new one.
  const experience = { id: 'a', kind: 'experience', title: 'Experience', resumeId: 'r-main', count: 3, showDates: true };
  assert.equal(sectionHasWork(experience, PRESETS, resumes), false);
  assert.equal(sectionHasWork({ ...experience, resumeId: 'r-other' }, PRESETS, resumes), true);
  assert.equal(sectionHasWork({ ...experience, count: 1 }, PRESETS, resumes), true);
  assert.equal(sectionHasWork({ ...experience, showDates: false }, PRESETS, resumes), true);
  assert.equal(sectionHasWork({ id: 's', kind: 'skills', title: '', resumeId: 'r-main' }, PRESETS, resumes), false);
  assert.equal(sectionHasWork({ id: 's', kind: 'skills', title: '', resumeId: 'r-other' }, PRESETS, resumes), true);
  // Hidden, or in the side column: set by the person, so kept.
  assert.equal(sectionHasWork({ ...experience, hidden: true }, PRESETS, resumes), true);
  assert.equal(sectionHasWork({ id: 'g', kind: 'gallery', title: 'Recent work', images: [], column: 'side' }, PRESETS, resumes), true);
});

test('a resume-backed section set up by the person is kept with its settings, in place or after', () => {
  const draft = firstDraft();
  const mine = { id: 'exp', kind: 'experience', title: 'Experience', resumeId: 'r-other', count: 1, showDates: false, hidden: true, column: 'side' };
  draft.sections.push(mine);
  const healthcare = applyPreset(draft, byId('healthcare'), resumes, PRESETS);
  assert.equal(healthcare.sections.find((s) => s.kind === 'experience'), mine);
  // A preset without the kind keeps it after its own.
  const creative = applyPreset(draft, byId('creative'), resumes, PRESETS);
  assert.ok(creative.sections.includes(mine));
  assert.doesNotThrow(() => validateLanding(healthcare, refs));
});

test('a preset never takes the page past its section cap: its own new sections give way', () => {
  const texts = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, kind: 'text', title: '', body: `Para ${i}` }));
  for (const n of [15, 16, 19, 20]) {
    const draft = { ...firstDraft(), sections: texts(n) };
    const next = applyPreset(draft, byId('trades'), resumes, PRESETS, { sections: 20 });
    assert.ok(next.sections.length <= 20, `${n}: ${next.sections.length}`);
    // Nothing written is lost.
    assert.equal(next.sections.filter((s) => s.kind === 'text').length, n);
    assert.doesNotThrow(() => validateLanding(next, refs), String(n));
    // The preset's first sections are the ones kept.
    const added = next.sections.filter((s) => s.kind !== 'text').map((s) => s.kind);
    assert.deepEqual(added, ['contact', 'services', 'credentials', 'gallery', 'quotes'].slice(0, Math.max(0, 20 - n)));
  }
  // Education carries a text section in place, so it takes one slot fewer.
  const next = applyPreset({ ...firstDraft(), sections: texts(20) }, byId('education'), resumes, PRESETS, { sections: 20 });
  assert.equal(next.sections.length, 20);
  assert.equal(next.sections[0].id, 't0');
});

test('new sections start like "+ Add section" ones, an experience section on the default resume', () => {
  const next = applyPreset(firstDraft(), byId('healthcare'), resumes, PRESETS);
  const experience = next.sections.find((s) => s.kind === 'experience');
  assert.equal(experience.resumeId, 'r-main');
  assert.equal(experience.title, 'Experience');
  const ids = next.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a new contact section takes the first draft email and phone', () => {
  const next = applyPreset(firstDraft(), byId('trades'), resumes, PRESETS);
  const contact = next.sections.find((s) => s.kind === 'contact');
  assert.equal(contact.email, 'sam@example.com');
  assert.equal(contact.phone, '(555) 010-0199');
  assert.deepEqual(contactFromLinks({ sections: [] }), { email: '', phone: '' });
  assert.deepEqual(
    contactFromLinks({ sections: [{ kind: 'links', links: [{ label: '', url: 'mailto:a%40b.example?subject=x' }, { label: '', url: 'tel:+15550100' }] }] }),
    { email: '', phone: '+15550100' },
  );
});

test('a contact section never takes its details from a hidden links section', () => {
  const links = (hidden, list) => ({ id: `l${hidden}`, kind: 'links', title: '', ...(hidden ? { hidden: true } : {}), links: list });
  const secret = [{ type: 'email', label: 'secret', url: 'mailto:secret@example.com' }, { type: 'phone', label: '', url: 'tel:+15550000001' }];
  const open = [{ type: 'email', label: 'me', url: 'mailto:me@example.com' }];
  assert.deepEqual(contactFromLinks({ sections: [links(true, secret)] }), { email: '', phone: '' });
  assert.deepEqual(contactFromLinks({ sections: [links(true, secret), links(false, open)] }), { email: 'me@example.com', phone: '' });
  const next = applyPreset({ ...firstDraft(), sections: [links(true, secret)] }, byId('trades'), resumes, PRESETS);
  const contact = next.sections.find((s) => s.kind === 'contact');
  assert.equal(contact.email, '');
  assert.equal(contact.phone, '');
  // The hidden section itself is kept, still hidden.
  assert.equal(next.sections.find((s) => s.kind === 'links').hidden, true);
});

test("a contact section's phone is the number its link dials, its label only when that writes the same number", () => {
  const phoneOf = (label, url) => contactFromLinks({ sections: [{ kind: 'links', links: [{ type: 'phone', label, url }] }] }).phone;
  assert.equal(phoneOf('Call me', 'tel:+15550100199'), '+15550100199');
  assert.equal(phoneOf('(555) 010-0199', 'tel:+15550100199'), '(555) 010-0199');
  assert.equal(phoneOf('+1 555 010 0199', 'tel:+15550100199'), '+1 555 010 0199');
  assert.equal(phoneOf('0199', 'tel:+15550100199'), '+15550100199');
  assert.equal(phoneOf('555 010 0199 ext. 12', 'tel:+15550100199;ext=12'), '+15550100199;ext=12');
  assert.equal(phoneOf('(555) 010-0199'.padEnd(45, ' 1'), 'tel:+15550100199'), '+15550100199');
  // Too long, or not one line, for a contact field: left empty rather than failing the save.
  assert.equal(phoneOf('', `tel:+1${'5'.repeat(45)}`), '');
  assert.equal(phoneOf('', 'tel:+1555%0A0100'), '');
  const longEmail = `mailto:${'a'.repeat(250)}@example.com`;
  assert.equal(contactFromLinks({ sections: [{ kind: 'links', links: [{ label: '', url: longEmail }] }] }).email, '');
  // Whatever the links, the draft the preset makes is one the server takes.
  const draft = { ...firstDraft(), sections: [{ id: 'l', kind: 'links', title: '', links: [{ type: 'phone', label: 'x'.repeat(90), url: 'tel:+15550100199' }] }] };
  assert.doesNotThrow(() => validateLanding(applyPreset(draft, byId('trades'), resumes, PRESETS), refs));
});

test('a contact section already on the page is the one kept, never a second', () => {
  const draft = applyPreset(firstDraft(), byId('creative'), resumes, PRESETS);
  draft.sections.push({ id: 'c', kind: 'contact', title: 'Reach me', email: 'me@example.com', phone: '', area: '', address: '', hours: [], vcard: true });
  const next = applyPreset(draft, byId('healthcare'), resumes, PRESETS);
  const contacts = next.sections.filter((s) => s.kind === 'contact');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, 'c');
  assert.doesNotThrow(() => validateLanding(next, refs));
});

test('the style is a copy, so editing the page never edits the preset', () => {
  const preset = byId('creative');
  const next = applyPreset(firstDraft(), preset, resumes, PRESETS);
  next.style.colors.accent = '#000000';
  assert.notEqual(preset.style.colors.accent, '#000000');
});

test('the presets are offered on open only before a first save and a first publish', () => {
  assert.equal(offerPresetsOnOpen({ hasDraft: false, publishedAt: null }), true);
  assert.equal(offerPresetsOnOpen({ hasDraft: true, publishedAt: null }), false);
  assert.equal(offerPresetsOnOpen({ hasDraft: false, publishedAt: '2026-01-01T00:00:00.000Z' }), false);
  // A server from before the flag says nothing about it: don't offer.
  assert.equal(offerPresetsOnOpen({ publishedAt: null }), false);
  assert.equal(offerPresetsOnOpen(null), false);
});

test('the picker lists a preset by its section titles', () => {
  assert.deepEqual(presetSectionLabels(byId('creative')), ['Selected work', 'Watch or listen', 'Kind words', 'Find me elsewhere']);
});
