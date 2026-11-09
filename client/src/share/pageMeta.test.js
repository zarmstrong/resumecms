import test from 'node:test';
import assert from 'node:assert/strict';
import { DESCRIPTION_LENGTH, cardContent, clip, landingPageMeta, resumePageMeta } from './pageMeta.js';
import { resolveLanding } from '../landing/resolveLanding.js';
// What the HTML shell actually carries; this file mirrors it. Node
// builtins only, so it loads without the server's dependencies.
import * as server from '../../../server/src/pageMeta.js';
import { cardContent as serverCardContent } from '../../../server/src/shareImages.js';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';

const block = (type, data, extra = {}) => ({ id: type, type, parentId: null, visibleWeb: true, visiblePrint: true, data, ...extra });

test('a resume: its overrides, else name and title and the first summary shown on the web', () => {
  const header = { name: 'Jo Doe', title: 'Engineer', photoUrl: PHOTO };
  const blocks = [block('summary', { text: 'Hidden' }, { visibleWeb: false }), block('executive_summary', { headline: 'Leads', text: '' })];
  const meta = resumePageMeta(header, { colors: { accent: '#123456' } }, blocks);
  assert.equal(meta.title, 'Jo Doe – Engineer');
  assert.equal(meta.description, 'Leads');
  assert.equal(meta.card.name, 'Jo Doe');
  assert.equal(meta.card.photoUrl, PHOTO);
  assert.equal(resumePageMeta(header, { title: 'Hire Jo', description: 'Now' }, blocks).title, 'Hire Jo');
  assert.equal(resumePageMeta({}, {}, []).title, 'Resume');
  assert.equal(resumePageMeta({}, {}, []).card, null);
});

test('the landing page: seo, else headline and subheadline or the first text section', () => {
  const landing = {
    headline: 'Jo',
    subheadline: '',
    photo: 'none',
    photoUrl: '',
    sections: [{ id: 't', kind: 'text', title: '', body: 'Long. '.repeat(80) }],
    seo: { title: '', description: '', noindex: false },
  };
  const meta = landingPageMeta(resolveLanding(landing, { photoUrl: '', site: null, resumes: [] }));
  assert.equal(meta.title, 'Jo');
  assert.ok(meta.description.length <= DESCRIPTION_LENGTH);
  assert.deepEqual(resolveLanding({ ...landing, seo: undefined }, null).seo, { title: '', description: '', noindex: false });
  const seo = landingPageMeta(resolveLanding({ ...landing, seo: { title: 'T', description: 'D', noindex: true } }, null));
  assert.deepEqual([seo.title, seo.description], ['T', 'D']);
});

test('the same title, description and card as the server, for the same page', () => {
  const header = { name: '  Jo   Doe ', title: 'Staff Engineer, Platform', photoUrl: PHOTO, links: [] };
  const sites = [{}, { title: 'x'.repeat(90), description: 'word '.repeat(80), colors: { accent: '#123456' }, font: 'inter', layout: 'sidebar' }];
  const blockLists = [[], [block('summary', { text: `Builds ${'reliable '.repeat(40)}things.` })], [block('executive_summary', { headline: 'H', text: 'T' })]];
  for (const site of sites) {
    for (const blocks of blockLists) {
      const mine = resumePageMeta(header, site, blocks);
      const theirs = server.resumePage({ header, site, blocks });
      assert.deepEqual([mine.title, mine.description, mine.card], [theirs.title, theirs.description, theirs.card]);
    }
  }
  const landing = {
    headline: 'Hi, I am Jo',
    subheadline: 'Engineer in Lisbon',
    photoUrl: PHOTO,
    sections: [{ kind: 'text', title: '', body: 'About' }],
    seo: { title: '', description: '', noindex: false },
    site: { colors: { accent: '#654321' } },
  };
  const formatted = {
    ...landing,
    subheadline: '',
    sections: [
      { kind: 'text', title: '', body: '  ' },
      { kind: 'text', title: '', body: 'At **Acme**, writing at [my blog](https://jo.example).\n\nAnd *more*.' },
    ],
  };
  // A text section's links and emphasis (issue #91) read as plain text.
  assert.equal(landingPageMeta(formatted).description, 'At Acme, writing at my blog. And more.');
  for (const variant of [landing, { ...landing, subheadline: '' }, { ...landing, seo: { title: 'T', description: 'D' } }, formatted]) {
    const mine = landingPageMeta(variant);
    const theirs = server.landingPage(variant, null);
    assert.deepEqual([mine.title, mine.description, mine.card], [theirs.title, theirs.description, theirs.card]);
  }
  for (const value of ['', 'a b', 'one two three four five six', 'x'.repeat(50)]) assert.equal(clip(value, 12), server.clip(value, 12));
  const args = { name: 'Jo', title: 'T', photoUrl: 'data:image/svg+xml;base64,AA', site: { colors: null, font: 3 } };
  assert.deepEqual(cardContent(args), serverCardContent(args));
});
