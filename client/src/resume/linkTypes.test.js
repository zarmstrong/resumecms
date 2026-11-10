import test from 'node:test';
import assert from 'node:assert/strict';
import { LINK_TYPES, LINK_TYPE_GROUPS, inferLinkType, linkGlyph, followLabelUrl } from './linkTypes.js';
import { LINK_TYPES as SERVER_LINK_TYPES } from '../../../server/src/landingFields.js';
import { HEADER_SCHEMA } from '../../../server/src/mcp/blockSchemas.js';

test('the server and the MCP header schema list the same link types, in order', () => {
  const values = LINK_TYPES.map((t) => t.value);
  assert.deepEqual(SERVER_LINK_TYPES, values);
  assert.deepEqual(HEADER_SCHEMA.properties.links.items.properties.type.enum, values);
  assert.equal(new Set(values).size, values.length);
});

test('every type has a one-letter badge, a group and http(s) placeholders', () => {
  for (const t of LINK_TYPES) {
    assert.match(t.glyph, /^[a-z]$/, t.value);
    assert.ok(t.label && t.group, t.value);
    if (t.value !== 'custom' && !t.urlFromLabel) assert.match(t.defaultUrl, /^https:\/\//, t.value);
  }
  // The dropdown lists every type once, in catalog order.
  assert.deepEqual(LINK_TYPE_GROUPS.flatMap((g) => g.types), LINK_TYPES);
  assert.equal(new Set(LINK_TYPE_GROUPS.map((g) => g.label)).size, LINK_TYPE_GROUPS.length);
});

test('a link without a type is recognized by its host or a subdomain of it (issue #129)', () => {
  for (const t of LINK_TYPES) {
    for (const host of t.hosts || []) {
      assert.equal(inferLinkType({ url: `https://${host}/jo` }), t.value, host);
      assert.equal(inferLinkType({ url: `HTTPS://WWW.${host.toUpperCase()}/jo` }), t.value, host);
      assert.equal(inferLinkType({ url: `${host}/jo` }), t.value, `${host} without a scheme`);
      // Lookalikes stay Custom.
      assert.equal(inferLinkType({ url: `https://${host}.example/jo` }), 'custom', `${host}.example`);
      assert.equal(inferLinkType({ url: `https://not${host}/jo` }), 'custom', `not${host}`);
      assert.equal(inferLinkType({ url: `https://example.com/${host}` }), 'custom', `${host} in a path`);
    }
  }
  assert.equal(inferLinkType({ url: 'https://jo.bandcamp.com' }), 'bandcamp');
  assert.equal(inferLinkType({ url: 'https://open.spotify.com/artist/1' }), 'spotify');
  assert.equal(inferLinkType({ url: 'https://instagram.com.example' }), 'custom');
  // x.com isn't any host ending in "x.com".
  assert.equal(inferLinkType({ url: 'https://box.com/jo' }), 'custom');
  // Only Google Scholar's and Business Profile's hosts, not all of Google.
  assert.equal(inferLinkType({ url: 'https://google.com/jo' }), 'custom');
  assert.equal(inferLinkType({ url: 'not a url' }), 'custom');
  assert.equal(inferLinkType({}), 'custom');
  // A stored type wins over the host.
  assert.equal(inferLinkType({ type: 'portfolio', url: 'https://behance.net/jo' }), 'portfolio');
});

test('email and phone links have their own badges, inferred from the URL too', () => {
  assert.equal(linkGlyph({ type: 'email' }), 'e');
  assert.equal(linkGlyph({ type: 'phone' }), 'p');
  // A Custom mailto link saved before the types existed gets the email badge.
  assert.equal(inferLinkType({ url: 'mailto:jo@example.com' }), 'email');
  assert.equal(inferLinkType({ url: ' TEL:+15555550100' }), 'phone');
  assert.equal(inferLinkType({ type: 'custom', url: 'mailto:jo@example.com' }), 'custom');
  assert.equal(inferLinkType({ url: 'https://github.com/jo' }), 'github');
});

test("each type's default URL is what its default label gives", () => {
  for (const type of LINK_TYPES.filter((t) => t.urlFromLabel)) {
    assert.equal(type.urlFromLabel(type.defaultLabel), type.defaultUrl, type.value);
  }
});

test('an email or phone URL follows its label until it is edited by hand', () => {
  assert.equal(followLabelUrl({ type: 'email', label: '', url: '' }, 'jo@example.com'), 'mailto:jo@example.com');
  assert.equal(followLabelUrl({ type: 'email', label: 'jo@example.co', url: 'mailto:jo@example.co' }, 'jo@example.com'), 'mailto:jo@example.com');
  assert.equal(followLabelUrl({ type: 'phone', label: '555', url: 'tel:555' }, '555 0100'), 'tel:5550100');
  // Cleared, or edited by hand.
  assert.equal(followLabelUrl({ type: 'phone', label: '555', url: 'tel:555' }, ''), '');
  assert.equal(followLabelUrl({ type: 'email', label: 'jo', url: 'mailto:other@example.com' }, 'jo@example.com'), 'mailto:other@example.com');
  // Other types never touch the URL.
  assert.equal(followLabelUrl({ type: 'github', label: '', url: '' }, 'github.com/jo'), undefined);
  assert.equal(followLabelUrl({ type: 'custom', label: '', url: '' }, 'jo@example.com'), undefined);
});
