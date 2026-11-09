import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeInline, inlineLength, inlineLinks, inlinePlainText, isPlainInline, mapLinks, parseInline, textParagraphs } from './inlineText.js';
import { ESCAPE_CASES, INLINE_CASES } from './inlineText.cases.js';

test('parses the shared cases', () => {
  for (const [input, expected] of INLINE_CASES) assert.deepEqual(parseInline(input), expected, JSON.stringify(input));
});

test('plain text and links read off the tokens', () => {
  const tokens = parseInline('At **[my blog](https://jo.example)**, *mostly* [mail](mailto:jo@example.com).');
  assert.equal(inlinePlainText(tokens), 'At my blog, mostly mail.');
  assert.deepEqual(inlineLinks(tokens), [
    { href: 'https://jo.example', label: 'my blog' },
    { href: 'mailto:jo@example.com', label: 'mail' },
  ]);
  assert.deepEqual(parseInline(null), []);
});

test('escaping makes text read exactly as written, and leaves plain text alone', () => {
  for (const input of ESCAPE_CASES) {
    const escaped = escapeInline(input);
    assert.ok(isPlainInline(input) ? escaped === input : escaped !== input, JSON.stringify(input));
    assert.deepEqual(parseInline(escaped), [{ t: 'text', text: input }], JSON.stringify(input));
    // The caps don't count escaping backslashes, so escaping never lengthens text.
    assert.equal(inlineLength(escaped), input.length, JSON.stringify(input));
    for (const paragraph of textParagraphs(escaped)) assert.equal(parseInline(paragraph).length, 1, JSON.stringify(paragraph));
  }
  // Escaped text holds escapes, so escaping it again would change it: what
  // keeps the migration from running twice is its flag, not this.
  assert.notEqual(escapeInline(escapeInline('**a**')), escapeInline('**a**'));
  assert.equal(escapeInline('a 5* hotel'), 'a 5* hotel');
  assert.equal(escapeInline('**Acme** \\o/'), '\\*\\*Acme\\*\\* \\\\o/');
});

test('a cap counts every character but an escaping backslash', () => {
  assert.equal(inlineLength(''), 0);
  assert.equal(inlineLength('**a** [b](https://x.example)'), 28);
  assert.equal(inlineLength('\\*a\\* \\[b\\] \\\\'), 9);
  // A backslash that escapes nothing counts like any character.
  assert.equal(inlineLength('C:\\Users \\'), 10);
});

test('links can be rewritten in place, found as the page finds them', () => {
  const body = '  [a](https://a.example) and [b](https://b.example)\n\n[c\n\nd](https://d.example) **[e](https://e.example)**';
  const swapped = mapLinks(body, ({ label, href }) => `[${label}](<${href}>)`, { paragraphs: true });
  assert.equal(swapped, '  [a](<https://a.example>) and [b](<https://b.example>)\n\n[c\n\nd](https://d.example) **[e](<https://e.example>)**');
  // As one paragraph, the label may hold a blank line.
  assert.equal(mapLinks('[c\n\nd](https://d.example)', ({ label }) => label), 'c\n\nd');
  assert.equal(mapLinks('no links', () => 'x'), 'no links');
});

test('paragraphs split like the client splits them', () => {
  assert.deepEqual(textParagraphs('One\nstill one\n\n  \nTwo\n'), ['One\nstill one', 'Two']);
  assert.deepEqual(textParagraphs(''), []);
});

test('a long run of markers parses quickly', () => {
  const started = Date.now();
  parseInline('*a '.repeat(1300));
  parseInline('[a]('.repeat(1000));
  parseInline('[['.repeat(2000) + ']](x)');
  assert.ok(Date.now() - started < 2000);
});
