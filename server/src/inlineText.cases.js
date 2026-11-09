// What parseInline() makes of some text (issue #91), shared by the server's
// copy (inlineText.test.js) and the client's
// (client/src/landing/inlineText.test.js), so the two can't drift apart.
// Node builtins only, so the client's tests can import it.

const text = (value) => ({ t: 'text', text: value });
const strong = (...children) => ({ t: 'strong', children });
const em = (...children) => ({ t: 'em', children });
const link = (href, ...children) => ({ t: 'link', href, children });

export const INLINE_CASES = [
  ['', []],
  ['Just text.', [text('Just text.')]],
  ['currently at **Acme**', [text('currently at '), strong(text('Acme'))]],
  ['an *italic* word', [text('an '), em(text('italic')), text(' word')]],
  ['at [my blog](https://jo.example/blog).', [text('at '), link('https://jo.example/blog', text('my blog')), text('.')]],
  ['[mail](mailto:jo@example.com) or [call](tel:+15555550100)', [link('mailto:jo@example.com', text('mail')), text(' or '), link('tel:+15555550100', text('call'))]],

  // Nesting.
  ['**bold *and italic* text**', [strong(text('bold '), em(text('and italic')), text(' text'))]],
  ['*italic **and bold***', [em(text('italic '), strong(text('and bold')))]],
  ['***both***', [em(strong(text('both')))]],
  ['[**bold** label](https://x.example)', [link('https://x.example', strong(text('bold')), text(' label'))]],
  ['**[bold link](https://x.example)**', [strong(link('https://x.example', text('bold link')))]],
  ['[a [b](https://b.example) c](https://c.example)', [text('[a '), link('https://b.example', text('b')), text(' c](https://c.example)')]],
  ['[see [x]](https://x.example)', [link('https://x.example', text('see [x]'))]],
  // Emphasis doesn't cross a link's edge.
  ['*a [b* c](https://x.example)', [text('*a '), link('https://x.example', text('b* c'))]],

  // Unmatched markers stay literal.
  ['5 * 3 * 2', [text('5 * 3 * 2')]],
  ['a 5* hotel', [text('a 5* hotel')]],
  ['**not closed', [text('**not closed')]],
  ['not opened**', [text('not opened**')]],
  ['** spaced **', [text('** spaced **')]],
  ['****', [text('****')]],
  ['**a*', [text('*'), em(text('a'))]],
  ['*a**', [em(text('a')), text('*')]],
  ['2*3*4', [text('2'), em(text('3')), text('4')]],
  ['[no url]', [text('[no url]')]],
  ['[label] (https://x.example)', [text('[label] (https://x.example)')]],
  ['[label](https://x.example', [text('[label](https://x.example')]],
  ['[label]()', [text('[label]()')]],
  ['[ ](https://x.example)', [text('[ ](https://x.example)')]],
  ['[label](has space)', [text('[label](has space)')]],
  ['a ] b [ c', [text('a ] b [ c')]],

  // `](` inside a label, and parentheses in a URL.
  ['[a](https://a.example) b](https://b.example)', [link('https://a.example', text('a')), text(' b](https://b.example)')]],
  ['[a \\](b) c](https://x.example)', [link('https://x.example', text('a ](b) c'))]],
  ['[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) here', [link('https://en.wikipedia.org/wiki/Foo_(bar)', text('Foo')), text(' here')]],
  ['([Foo](https://x.example/a))', [text('('), link('https://x.example/a', text('Foo')), text(')')]],
  ['[Foo](https://x.example/(a)', [text('[Foo](https://x.example/(a)')]],
  // A URL is taken as written, markers and backslashes included.
  ['[x](https://x.example/*a*\\b)', [link('https://x.example/*a*\\b', text('x'))]],

  // Escapes.
  ['\\*not italic\\*', [text('*not italic*')]],
  ['\\**bold?**', [text('*'), em(text('bold?')), text('*')]],
  ['\\[not](https://x.example)', [text('[not](https://x.example)')]],
  ['[not\\](https://x.example)', [text('[not](https://x.example)')]],
  ['a \\\\*b*', [text('a \\'), em(text('b'))]],
  ['C:\\Users\\jo', [text('C:\\Users\\jo')]],
  ['trailing \\', [text('trailing \\')]],

  // Anything else is just text, HTML included.
  ['<b>hi</b> & <script>alert(1)</script>', [text('<b>hi</b> & <script>alert(1)</script>')]],
  ['# Heading\n- list\n![img](https://x.example/a.png)', [text('# Heading\n- list\n!'), link('https://x.example/a.png', text('img'))]],
  ['line one\n*line two*', [text('line one\n'), em(text('line two'))]],
];

// Text that must read exactly as written once escaped (escapeInline()).
export const ESCAPE_CASES = [
  'plain',
  'a 5* hotel',
  '**bold** and *italic*',
  '[link](https://x.example)',
  'already \\*escaped\\*',
  'C:\\Users\\*',
  '\\\\',
  '[a](b) **c** \\[d] *',
  'one *two\n\nthree* four',
];
