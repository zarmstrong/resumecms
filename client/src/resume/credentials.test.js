import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialHref, credentialKindLabel, credentialMeta } from './credentials.js';
import { hasPassed, utcToday } from '../landing/dateText.js';

test('credential meta preserves written dates and adds words only for readable dates', () => {
  assert.deepEqual(credentialMeta({ number: '123', issued: 'Mar 2024', expires: '2027' }), ['No. 123', 'Issued Mar 2024', 'Expires 2027']);
  assert.deepEqual(credentialMeta({ kind: 'membership', issued: '2024-03', expires: 'Until revoked' }), ['Since 2024-03', 'Until revoked']);
  assert.deepEqual(credentialMeta({ issued: 'On joining', expires: '2027-03-01' }), ['On joining', 'Expires 2027-03-01']);
  assert.deepEqual(credentialMeta({ number: '', issued: '', expires: '' }), []);
  assert.deepEqual(credentialMeta({}), []);
  assert.equal(credentialKindLabel('license'), 'License');
  assert.equal(credentialKindLabel('membership'), 'Membership');
  for (const kind of ['certification', 'unknown', undefined, 'toString']) assert.equal(credentialKindLabel(kind), 'Certification');
});

test('only absolute HTTP(S) verification URLs are linked', () => {
  for (const url of ['http://example.com/verify', 'https://example.com/verify?q=123']) assert.equal(credentialHref(url), url);
  // What the browser would go to, never the typed string resolved against the page.
  assert.equal(credentialHref('https:issuer.example/verify'), 'https://issuer.example/verify');
  assert.equal(credentialHref('HTTPS://Issuer.Example/Verify'), 'https://issuer.example/Verify');
  for (const url of ['tel:123', 'mailto:me@example.com', 'javascript:alert(1)', '/verify/123', '//example.com/verify', '', 'https://', 'not a URL', undefined]) assert.equal(credentialHref(url), null, String(url));
});

test('editor expiry check uses UTC and keeps a credential through its expiry period', () => {
  const today = utcToday(new Date('2026-01-01T00:30:00Z'));
  assert.equal(today, '2026-01-01');
  assert.equal(hasPassed('2025', today), true);
  assert.equal(hasPassed('Dec 2025', today), true);
  assert.equal(hasPassed('2026-01-01', today), false);
  assert.equal(hasPassed('2026', today), false);
  assert.equal(hasPassed('Until revoked', today), false);
});
