import test from 'node:test';
import assert from 'node:assert/strict';
import { safeHref, linkProps, telHref, mailtoHref } from './safeUrl.js';
import { mailtoUrl } from '../../../server/src/landingFields.js';

globalThis.window ??= { location: { origin: 'https://resume.example' } };

test('safeHref keeps http, https, mailto and tel links and drops the rest', () => {
  for (const url of ['https://x.example', 'http://x.example', 'mailto:jo@example.com', 'tel:+15555550100', '/r/main']) {
    assert.equal(safeHref(url), url, url);
  }
  for (const url of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'sms:123', '', undefined]) {
    assert.equal(safeHref(url), undefined, String(url));
  }
});

test('linkProps opens web links in a new tab, but not email or phone links', () => {
  assert.deepEqual(linkProps('https://x.example'), { href: 'https://x.example', target: '_blank', rel: 'noopener noreferrer' });
  assert.deepEqual(linkProps('mailto:jo@example.com'), { href: 'mailto:jo@example.com' });
  assert.deepEqual(linkProps('TEL:555'), { href: 'TEL:555' });
  assert.equal(linkProps('javascript:alert(1)').href, undefined);
});

test('telHref dials the digits of a number as typed, with its extension', () => {
  assert.equal(telHref('+1 (555) 555-0100'), 'tel:+15555550100');
  assert.equal(telHref('555.555.0100'), 'tel:5555550100');
  assert.equal(telHref('+44 20 7946 0958 ext. 12'), 'tel:+442079460958;ext=12');
  assert.equal(telHref('555-0100 #7'), 'tel:5550100;ext=7');
  for (const phone of ['', '+', 'call me', undefined, 5]) assert.equal(telHref(phone), undefined, String(phone));
  // Rendered on every page load: a long run of spaces mustn't stall it.
  const start = Date.now();
  for (const phone of [`${' '.repeat(20000)}a`, `${'x '.repeat(10000)}a`, `#${' '.repeat(20000)}a`]) assert.equal(telHref(phone), undefined);
  assert.ok(Date.now() - start < 500);
});

test("mailtoHref links only a whole address, like the server's mailtoUrl() (issue #124)", () => {
  assert.equal(mailtoHref(' jo.doe+work@mail.example.co.uk '), 'mailto:jo.doe+work@mail.example.co.uk');
  const cases = ['jo@example.com', ' jo@example.com ', 'josé@exämple.de', '', 'jo', 'jo@', '@example.com', 'jo@example', 'jo@example.', 'jo@.com', 'jo@@example.com'];
  cases.push('jo@example.com?subject=hi', 'jo@example.com,eve@example.com', 'j%6f@example.com', 'jo @example.com', 'jo@exa\nmple.com', '<jo@example.com>', undefined, 5);
  for (const email of cases) assert.equal(mailtoHref(email) ?? '', mailtoUrl(email), JSON.stringify(email));
  for (const email of ['jo@', 'jo@example.com?subject=hi', undefined]) assert.equal(mailtoHref(email), undefined);
});
