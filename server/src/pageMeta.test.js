import test from 'node:test';
import assert from 'node:assert/strict';
import { DESCRIPTION_LENGTH, clip, escapeHtml, headTags, jsonForScript, landingPage, resumePage } from './pageMeta.js';
import { cardContent, cardKey, isImageKey, parsePhoto, photoKey } from './shareImages.js';
import { emptyLanding, resolveLanding } from './landingFields.js';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';

const published = (over = {}) => ({
  header: { name: 'Jo Doe', title: 'Engineer', photoUrl: PHOTO, links: [], ...over.header },
  site: { colors: { accent: '#123456' }, ...over.site },
  blocks: over.blocks ?? [],
});

const block = (type, data, extra = {}) => ({ id: type, type, parentId: null, data, ...extra });

test('clip collapses whitespace and cuts at a word with an ellipsis', () => {
  assert.equal(clip('  a \n b  ', 10), 'a b');
  assert.equal(clip('one two three four', 12), 'one two…');
  assert.ok(clip('word '.repeat(100), DESCRIPTION_LENGTH).length <= DESCRIPTION_LENGTH);
  // One long word is cut inside it rather than dropped.
  assert.equal(clip('x'.repeat(30), 10), `${'x'.repeat(9)}…`);
  assert.equal(clip(undefined, 10), '');
});

test('a resume: name and title, then the first summary shown on the web', () => {
  const page = resumePage(
    published({
      blocks: [
        block('heading', { text: 'About' }),
        // Hidden on the web: getPublishedResume('web') sends a placeholder.
        { id: 'h', type: 'summary', parentId: null, hidden: true, data: {} },
        block('summary', { text: 'Builds   things.' }),
        block('executive_summary', { text: 'Later' }),
      ],
    })
  );
  assert.equal(page.title, 'Jo Doe – Engineer');
  assert.equal(page.description, 'Builds things.');
  assert.equal(page.type, 'profile');
  assert.equal(page.person.name, 'Jo Doe');
});

test("a hidden summary's text is never the description, even if a placeholder kept it", () => {
  const page = resumePage(published({ blocks: [block('summary', { text: 'Secret' }, { hidden: true })] }));
  assert.equal(page.description, '');
});

test('an executive summary counts, its text before its headline', () => {
  assert.equal(resumePage(published({ blocks: [block('executive_summary', { headline: 'H', text: 'T' })] })).description, 'T');
  assert.equal(resumePage(published({ blocks: [block('executive_summary', { headline: 'H', text: '' })] })).description, 'H');
});

test("the site settings' title and description override, cut to their limits", () => {
  const page = resumePage(published({ site: { title: 'Jo — Staff Engineer', description: 'd'.repeat(500) } }));
  assert.equal(page.title, 'Jo — Staff Engineer');
  assert.ok(page.description.length <= 200);
  assert.equal(resumePage(published({ header: { name: '', title: '' } })).title, 'Resume');
  assert.equal(resumePage(published({ header: { title: '' } })).title, 'Jo Doe');
});

test('sameAs keeps only http(s) links, never mailto, tel or junk', () => {
  const page = resumePage(
    published({
      header: {
        links: [
          { url: 'https://github.com/jo' },
          { url: 'mailto:jo@example.com' },
          { url: 'tel:+15550100' },
          { url: 'javascript:alert(1)' },
          { url: 'not a url' },
          null,
          { url: 'http://jo.example' },
        ],
      },
    })
  );
  assert.deepEqual(page.person.sameAs, ['https://github.com/jo', 'http://jo.example']);
});

test('the landing page: seo first, then headline, subheadline and the first text section', () => {
  const landing = {
    headline: 'Hi, I am Jo',
    subheadline: '',
    photoUrl: PHOTO,
    sections: [
      { kind: 'links', title: '', links: [{ url: 'https://linkedin.com/in/jo' }, { url: 'mailto:jo@example.com' }] },
      { kind: 'text', title: '', body: `About me. ${'More. '.repeat(60)}` },
    ],
    seo: { title: '', description: '', noindex: false },
    site: null,
  };
  const page = landingPage(landing, { name: 'Jo Doe', title: 'Engineer' });
  assert.equal(page.title, 'Hi, I am Jo');
  assert.ok(page.description.startsWith('About me.'));
  assert.ok(page.description.length <= DESCRIPTION_LENGTH);
  assert.equal(page.type, 'website');
  // The person is the default resume's, the headline only a fallback.
  assert.deepEqual(page.person, { name: 'Jo Doe', jobTitle: 'Engineer', sameAs: ['https://linkedin.com/in/jo'] });
  assert.equal(landingPage(landing, null).person.name, 'Hi, I am Jo');

  const withSub = landingPage({ ...landing, subheadline: 'Engineer in Lisbon' }, null);
  assert.equal(withSub.description, 'Engineer in Lisbon');
  const withSeo = landingPage({ ...landing, seo: { title: 'Jo Doe', description: 'Hire me', noindex: false } }, null);
  assert.equal(withSeo.title, 'Jo Doe');
  assert.equal(withSeo.description, 'Hire me');
  // The card shows what the page does: headline and subheadline.
  assert.equal(withSub.card.name, 'Hi, I am Jo');
  assert.equal(withSub.card.title, 'Engineer in Lisbon');
});

test("the landing page's card is drawn in the colors and fonts the page is, never its dark palette", () => {
  const context = { photoUrl: '', site: { colors: { accent: '#123456' }, font: 'lora', layout: 'sidebar' }, resumes: new Map(), images: new Map() };
  const draft = { ...emptyLanding(), headline: 'Jo' };
  const resumeLook = landingPage(resolveLanding(draft, context), null).card;
  assert.deepEqual(resumeLook.site, { colors: { accent: '#123456' }, accent: '', font: 'lora', nameFont: '' });
  const style = { source: 'custom', colors: { accent: '#aa0000', heading: '', text: '', background: '#fafafa' }, font: 'inter', nameFont: '' };
  const own = landingPage(resolveLanding({ ...draft, style }, context), null).card;
  assert.deepEqual(own.site, {
    colors: { accent: '#aa0000', heading: '#14181c', text: '#14181c', background: '#fafafa' },
    accent: '',
    font: 'inter',
    nameFont: '',
  });
  assert.notEqual(cardKey(own), cardKey(resumeLook));
  // A dark palette or another template is the same card.
  const dark = landingPage(resolveLanding({ ...draft, style: { ...style, darkColors: { background: '#000000' } }, template: 'split' }, context), null).card;
  assert.equal(cardKey(dark), cardKey(own));
});

test('every value is escaped, in text, attributes and the JSON-LD', () => {
  const evil = '"></title><script>alert(1)</script>';
  const page = resumePage(published({ header: { name: evil, title: "O'Neil & co" }, site: { description: evil } }));
  const html = headTags(page, { url: 'https://jo.example/?a="b"', withPerson: true, image: 'https://jo.example/i', photo: 'https://jo.example/p' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /"><\/title>/);
  assert.match(html, /<title>&quot;&gt;&lt;\/title&gt;&lt;script&gt;/);
  assert.match(html, /O&#39;Neil &amp; co/);
  assert.match(html, /href="https:\/\/jo.example\/\?a=&quot;b&quot;"/);
  const json = html.match(/<script type="application\/ld\+json">(.*)<\/script>/)[1];
  assert.doesNotMatch(json, /</);
  assert.equal(JSON.parse(json).name, evil);
  assert.equal(jsonForScript(' '), '"\\u2028"');
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('the tags name the card as a large image, the photo as a small one, or no image', () => {
  const page = resumePage(published());
  const card = headTags(page, { url: 'https://x.test/', image: 'https://x.test/c', largeImage: true, photo: 'https://x.test/p', withPerson: true });
  assert.match(card, /property="og:image" content="https:\/\/x.test\/c"/);
  assert.match(card, /property="og:image:alt" content="Jo Doe"/);
  assert.match(card, /name="twitter:card" content="summary_large_image"/);
  assert.match(card, /<link rel="canonical" href="https:\/\/x.test\/" \/>/);
  assert.equal(JSON.parse(card.match(/ld\+json">(.*)<\/script>/)[1]).image, 'https://x.test/p');

  const photo = headTags(page, { url: 'https://x.test/', image: 'https://x.test/p', photo: 'https://x.test/p' });
  assert.match(photo, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(photo, /ld\+json/);

  const none = headTags(resumePage(published({ header: { photoUrl: '' } })), { url: 'https://x.test/' });
  assert.doesNotMatch(none, /og:image/);
  assert.doesNotMatch(none, /name="description"/);
});

test('photos and cards are keyed by what they show', () => {
  assert.equal(photoKey(''), null);
  assert.equal(photoKey('https://example.com/a.jpg'), null);
  assert.equal(photoKey('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.ok(isImageKey(photoKey(PHOTO)));
  assert.equal(parsePhoto(PHOTO).contentType, 'image/jpeg');
  assert.equal(isImageKey('../../etc/passwd'), false);

  const content = cardContent({ name: 'Jo', title: 'Engineer', photoUrl: 'nope', site: { colors: { accent: '#123456' }, layout: 'sidebar' } });
  assert.equal(content.photoUrl, '');
  assert.equal(cardContent({ name: ' ', title: 'x' }), null);
  assert.ok(isImageKey(cardKey(content)));
  // A layout change isn't a new card; a color is.
  assert.equal(cardKey(content), cardKey(cardContent({ name: 'Jo', title: 'Engineer', site: { colors: { accent: '#123456' } } })));
  assert.notEqual(cardKey(content), cardKey(cardContent({ name: 'Jo', title: 'Engineer', site: { colors: { accent: '#654321' } } })));
});
