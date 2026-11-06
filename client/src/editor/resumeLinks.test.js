import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHostnames, pickResume, publicUrl, resumeLabel, resumePatch } from './resumeLinks.js';

const resume = (fields) => ({
  id: 'r',
  slug: 'sales',
  name: 'Sales',
  isDefault: false,
  isPublic: false,
  hostnames: [],
  publishedAt: null,
  ...fields,
});

const main = resume({ id: 'main', slug: 'main', name: 'Main', isDefault: true, isPublic: true, publishedAt: '2026-01-01' });
const prod = { protocol: 'https:', port: '', origin: 'https://me.example' };
const dev = { protocol: 'http:', port: '5173', origin: 'http://localhost:5173' };

test('?resume= opens that resume if it exists, the default otherwise', () => {
  const sales = resume({ id: 'sales' });
  const list = [main, sales];
  assert.equal(pickResume(list, 'sales'), sales);
  assert.equal(pickResume(list, 'deleted'), main);
  assert.equal(pickResume(list, null), main);
  assert.equal(pickResume([], null), null);
});

test('only a published resume has a public URL: the main site, its domain, or its /r/ link', () => {
  assert.equal(publicUrl(main, prod), 'https://me.example/');
  assert.equal(publicUrl({ ...main, publishedAt: null }, prod), null, 'a default that was never published');
  assert.equal(publicUrl(resume({ isPublic: true }), prod), null, 'public but not published');
  assert.equal(publicUrl(resume({ publishedAt: 'x' }), prod), null, 'published but private');
  assert.equal(publicUrl(resume({ isPublic: true, publishedAt: 'x' }), prod), 'https://me.example/r/sales');
  const withDomain = resume({ isPublic: true, publishedAt: 'x', hostnames: ['sales.example.com', 'z.example.com'] });
  assert.equal(publicUrl(withDomain, prod), 'https://sales.example.com/', 'its first domain is preferred');
  assert.equal(publicUrl(withDomain, dev), 'http://sales.example.com:5173/', "the editor's scheme and port carry over");
  // While the landing page holds `/`, the default lives at /resume.
  assert.equal(publicUrl(main, prod, { landingShown: true }), 'https://me.example/resume');
  assert.equal(publicUrl(withDomain, prod, { landingShown: true }), 'https://sales.example.com/');
});

test("the switcher's label says who can see a resume", () => {
  assert.equal(resumeLabel(main), 'Main (default)');
  assert.equal(resumeLabel(resume({})), 'Sales (private)');
  assert.equal(resumeLabel(resume({ isPublic: true })), 'Sales (public, not published yet)');
  assert.equal(resumeLabel(resume({ isPublic: true, publishedAt: 'x' })), 'Sales (public)');
});

test('domains are split on lines, commas or spaces', () => {
  assert.deepEqual(parseHostnames('a.example.com\n b.example.com,c.example.com  d.example.com\n\n'), [
    'a.example.com',
    'b.example.com',
    'c.example.com',
    'd.example.com',
  ]);
  assert.deepEqual(parseHostnames('  \n'), []);
});

test('the settings form sends only what changed', () => {
  const r = resume({ hostnames: ['sales.example.com'], isPublic: true });
  const form = { name: 'Sales', slug: 'sales', isPublic: true, hostnames: 'sales.example.com' };
  assert.deepEqual(resumePatch(r, form), {});
  assert.deepEqual(resumePatch(r, { ...form, name: '  Sales EMEA ' }), { name: 'Sales EMEA' });
  assert.deepEqual(resumePatch(r, { ...form, slug: 'sales-emea' }), { slug: 'sales-emea' });
  assert.deepEqual(resumePatch(r, { ...form, hostnames: 'sales.example.com\nb.example.com' }), {
    hostnames: ['sales.example.com', 'b.example.com'],
  });
  // removing the domains and unticking Public in one go makes it private
  assert.deepEqual(resumePatch(r, { ...form, hostnames: '', isPublic: false }), { hostnames: [], isPublic: false });
});

test('a resume with domains is public whatever the checkbox says', () => {
  const r = resume({});
  const form = { name: 'Sales', slug: 'sales', isPublic: false, hostnames: '' };
  assert.deepEqual(resumePatch(r, { ...form, hostnames: 'sales.example.com' }), { hostnames: ['sales.example.com'], isPublic: true });
  assert.deepEqual(resumePatch(r, { ...form, isPublic: true }), { isPublic: true });
});

test("the default's Public checkbox never counts, even unticked from before it was made the default", () => {
  const form = { name: 'Main', slug: 'main', isPublic: false, hostnames: '' };
  assert.deepEqual(resumePatch(main, form), {});
  assert.deepEqual(resumePatch(main, { ...form, name: 'Main CV' }), { name: 'Main CV' });
});
