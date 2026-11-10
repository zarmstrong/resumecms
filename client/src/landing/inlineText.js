// The landing page's inline syntax (issue #91): `[label](url)`, `**bold**`
// and `*italic*` in a text section's body (one paragraph at a time, as
// textParagraphs() splits it), an item's text and an FAQ answer (each as a
// whole). A copy of the shared part
// of server/src/inlineText.js, which documents the rules; the two are kept
// in step by the cases in server/src/inlineText.cases.js, which
// inlineText.test.js runs through both. Rendered by renderInline.js, as
// React elements, never as HTML.

const ESCAPABLE = '\\*[]';
const SPACE = /\s/;

// Where a link's `(url)` that starts at `open` ends: the index of its `)`,
// or -1 when there's none (a space, the end of the text, or nothing in it).
function urlClose(text, open) {
  if (text[open] !== '(') return -1;
  let depth = 0;
  for (let k = open + 1; k < text.length; k++) {
    const c = text[k];
    if (SPACE.test(c)) return -1;
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) return k > open + 1 ? k : -1;
      depth--;
    }
  }
  return -1;
}

// Every link in `text`, in order: { start, end, labelStart, labelEnd, href }
// (offsets into `text`; `end` is past the closing parenthesis). A `]`
// closes the nearest `[` still open, so brackets nest inside a label; once
// a link is found, the `[`s still open before it can't start one around it.
export function linkSpans(text) {
  const spans = [];
  const open = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      i++;
    } else if (c === '[') {
      open.push(i);
    } else if (c === ']' && open.length) {
      const start = open.pop();
      if (!/\S/.test(text.slice(start + 1, i))) continue;
      const close = urlClose(text, i + 1);
      if (close === -1) continue;
      spans.push({ start, end: close + 1, labelStart: start + 1, labelEnd: i, href: text.slice(i + 2, close) });
      open.length = 0;
      i = close;
    }
  }
  return spans;
}

// Text nodes, links and runs of `*` between `from` and `to`, then emphasis
// matched over them. A run can open emphasis if a non-space follows it in
// the region, and close it if a non-space comes before it.
function parseRegion(text, from, to, spans) {
  const nodes = [];
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ t: 'text', text: buffer });
    buffer = '';
  };
  let s = 0;
  for (let i = from; i < to; ) {
    const span = spans[s];
    if (span && span.start === i) {
      flush();
      nodes.push({ t: 'link', href: span.href, children: parseRegion(text, span.labelStart, span.labelEnd, []) });
      i = span.end;
      s++;
      continue;
    }
    const c = text[i];
    if (c === '\\' && i + 1 < to && ESCAPABLE.includes(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
    } else if (c === '*') {
      let j = i;
      while (j < to && text[j] === '*') j++;
      flush();
      nodes.push({ t: 'delim', count: j - i, open: j < to && !SPACE.test(text[j]), close: i > from && !SPACE.test(text[i - 1]) });
      i = j;
    } else {
      buffer += c;
      i++;
    }
  }
  flush();
  return emphasis(nodes);
}

// Each run that can close pairs with the nearest run before it that can
// open: two markers from each for bold when both have two, else one for
// italic, until one of them runs out. Runs left between the two become
// literal, as does whatever is left of any run at the end.
function emphasis(nodes) {
  const openers = [];
  for (let i = 0; i < nodes.length; i++) {
    const run = nodes[i];
    if (run.t !== 'delim') continue;
    if (run.close) {
      while (run.count > 0 && openers.length) {
        const k = openers.length - 1;
        const opener = openers[k];
        const use = opener.count >= 2 && run.count >= 2 ? 2 : 1;
        const a = nodes.indexOf(opener);
        const inner = nodes.splice(a + 1, i - a - 1);
        nodes.splice(a + 1, 0, { t: use === 2 ? 'strong' : 'em', children: finish(inner) });
        i = a + 2;
        opener.count -= use;
        run.count -= use;
        openers.length = opener.count > 0 ? k + 1 : k;
      }
    }
    if (run.count > 0 && run.open) openers.push(run);
  }
  return finish(nodes);
}

// Leftover runs as literal text, and neighbouring text nodes joined.
function finish(nodes) {
  const out = [];
  for (const node of nodes) {
    const token = node.t === 'delim' ? (node.count > 0 ? { t: 'text', text: '*'.repeat(node.count) } : null) : node;
    if (!token) continue;
    const last = out[out.length - 1];
    if (token.t === 'text' && last?.t === 'text') out[out.length - 1] = { t: 'text', text: last.text + token.text };
    else out.push(token);
  }
  return out;
}

export function parseInline(text) {
  const source = typeof text === 'string' ? text : '';
  return parseRegion(source, 0, source.length, linkSpans(source));
}

// How long `text` counts as against its cap: every character as written,
// markers and URLs included, except a backslash that escapes the next one.
// So escaping a marker never makes text longer, and text the one-off
// migration escaped (escapeInline()) counts exactly what it did before.
// The editor refuses an edit past it (inlineEdit(), client side).
export function inlineLength(text) {
  let length = 0;
  for (let i = 0; i < text.length; i++, length++) {
    if (text[i] === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) i++;
  }
  return length;
}

// What the tokens read as without their formatting: a link is its label.
export function inlinePlainText(tokens) {
  return tokens.map((token) => (token.t === 'text' ? token.text : inlinePlainText(token.children))).join('');
}

// Every link in the tokens, nested ones included: [{ href, label }].
export function inlineLinks(tokens) {
  return tokens.flatMap((token) => {
    if (token.t === 'link') return [{ href: token.href, label: inlinePlainText(token.children) }];
    return token.t === 'text' ? [] : inlineLinks(token.children);
  });
}

// ---- Client only -----------------------------------------------------------

// What a field whose cap counts inlineLength() holds after an edit from
// `previous` to `next` (typed, pasted or deleted): `next` while it's within
// `limit`, else `previous`, so the field never goes past its cap. A
// maxLength can't be exact here: typing between a `\` and the `*` it
// escapes turns one counted character into three, and typing the `*` after
// a `\` adds one to the text but none to the count. An edit that doesn't
// make an over-cap field longer still goes through, so it can be shortened.
// No cap (`limit` undefined, before the form's limits load) allows anything.
export function inlineEdit(previous, next, limit) {
  if (limit === undefined || limit === null) return next;
  const length = inlineLength(next);
  return length <= limit || length <= inlineLength(typeof previous === 'string' ? previous : '') ? next : previous;
}
