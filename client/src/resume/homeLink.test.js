import test from 'node:test';
import assert from 'node:assert/strict';
import { homeLinkOf, sameHomeLink } from './homeLink.js';

const HOME = { href: '/', label: 'Home' };

test('the link is shown on the web only, when the server sends one', () => {
  assert.deepEqual(homeLinkOf({ home: HOME }, 'web'), HOME);
  assert.equal(homeLinkOf({ home: HOME }, 'print'), null);
  assert.equal(homeLinkOf({ home: HOME }, 'preview'), null);
  assert.equal(homeLinkOf({}, 'web'), null);
  assert.equal(homeLinkOf(null, 'web'), null);
});

test('only a same-site path is linked', () => {
  for (const href of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '', 5, null]) {
    assert.equal(homeLinkOf({ home: { href, label: 'Home' } }, 'web'), null, String(href));
  }
  assert.deepEqual(homeLinkOf({ home: { href: '/', label: '' } }, 'web'), HOME);
});

test('a refetch notices the link coming or going', () => {
  assert.equal(sameHomeLink(HOME, { ...HOME }), true);
  assert.equal(sameHomeLink(undefined, null), true);
  assert.equal(sameHomeLink(HOME, undefined), false);
  assert.equal(sameHomeLink(undefined, HOME), false);
});
