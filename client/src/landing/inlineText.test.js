import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inlineEdit, inlineLength, inlineLinks, inlinePlainText, parseInline } from './inlineText.js';
import { renderInline } from './renderInline.js';
import { textParagraphs } from './resolveLanding.js';
// The server's copy, which this one mirrors, and the cases both must pass.
// Node builtins only, so they load without the server's dependencies.
import * as server from '../../../server/src/inlineText.js';
import { ESCAPE_CASES, INLINE_CASES } from '../../../server/src/inlineText.cases.js';

test('parses the shared cases exactly as the server does', () => {
  for (const [input, expected] of INLINE_CASES) {
    assert.deepEqual(parseInline(input), expected, JSON.stringify(input));
    assert.deepEqual(server.parseInline(input), expected, JSON.stringify(input));
    assert.equal(inlinePlainText(parseInline(input)), server.inlinePlainText(expected));
    assert.deepEqual(inlineLinks(parseInline(input)), server.inlineLinks(expected));
  }
  for (const input of [...INLINE_CASES.map(([value]) => value), ...ESCAPE_CASES, 'One\n\n  two\n \n\nthree ']) {
    assert.deepEqual(textParagraphs(input), server.textParagraphs(input), JSON.stringify(input));
    assert.equal(inlineLength(input), server.inlineLength(input), JSON.stringify(input));
    const escaped = server.escapeInline(input);
    assert.equal(inlineLength(escaped), server.inlineLength(escaped), JSON.stringify(escaped));
  }
});

test('an edit that would take a field past its cap is refused, exactly', () => {
  // Item text at 999 counted characters, one of them an escaped marker.
  const previous = `${'x'.repeat(997)} \\*`;
  assert.equal(inlineLength(previous), 999);
  const at = previous.length - 1;
  // Typing between the backslash and its marker: one counted character becomes three.
  assert.equal(inlineEdit(previous, `${previous.slice(0, at)}a${previous.slice(at)}`, 1000), previous);
  // Typing one more at the end fits; a second doesn't.
  assert.equal(inlineEdit(previous, `${previous}y`, 1000), `${previous}y`);
  assert.equal(inlineEdit(`${previous}y`, `${previous}yz`, 1000), `${previous}y`);
  // A pasted block is all or nothing.
  assert.equal(inlineEdit('short', `short${'p'.repeat(996)}`, 1000), 'short');
  assert.equal(inlineEdit('short', `short${'p'.repeat(995)}`, 1000), `short${'p'.repeat(995)}`);
  // At the cap, a backslash then the marker it escapes both go in (raw length 1001 and 1002).
  const atCap = 'x'.repeat(999);
  assert.equal(inlineEdit(atCap, `${atCap}\\`, 1000), `${atCap}\\`);
  assert.equal(inlineEdit(`${atCap}\\`, `${atCap}\\*`, 1000), `${atCap}\\*`);
  // A field already over its cap can still be shortened, not lengthened.
  const over = 'x'.repeat(1005);
  assert.equal(inlineEdit(over, over.slice(1), 1000), over.slice(1));
  assert.equal(inlineEdit(over, `${over}x`, 1000), over);
  // No limits loaded yet: anything goes.
  assert.equal(inlineEdit('a', 'a'.repeat(5000), undefined), 'a'.repeat(5000));
});

// safeHref() resolves a URL against the page's origin.
globalThis.window ??= { location: { origin: 'https://jo.example' } };
const html = (text) => renderToStaticMarkup(createElement('p', null, renderInline(text)));

test('renders tokens as elements, and anything else as text, never as HTML', () => {
  assert.equal(
    html('At **Acme**, *mostly* [my blog](https://jo.example/blog) and [mail](mailto:jo@example.com).'),
    '<p>At <strong>Acme</strong>, <em>mostly</em> ' +
      '<a class="l-inline-link" href="https://jo.example/blog" target="_blank" rel="noopener noreferrer">my blog</a> and ' +
      '<a class="l-inline-link" href="mailto:jo@example.com">mail</a>.</p>'
  );
  assert.equal(
    html('<img src=x onerror=alert(1)> **<b>x</b>** [<i>y</i>](https://x.example)'),
    '<p>&lt;img src=x onerror=alert(1)&gt; <strong>&lt;b&gt;x&lt;/b&gt;</strong> ' +
      '<a class="l-inline-link" href="https://x.example" target="_blank" rel="noopener noreferrer">&lt;i&gt;y&lt;/i&gt;</a></p>'
  );
  // The server never saves one, but an unsafe or half-typed link shows its label unlinked.
  assert.equal(html('[click](javascript:alert(1)) [later](https://)'), '<p>click later</p>');
  assert.equal(html('[a](https://x.example/"onmouseover="alert(1))'), '<p><a class="l-inline-link" href="https://x.example/&quot;onmouseover=&quot;alert(1)" target="_blank" rel="noopener noreferrer">a</a></p>');
});
