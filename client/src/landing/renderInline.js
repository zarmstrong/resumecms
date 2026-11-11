import { createElement, Fragment } from 'react';
import { linkProps } from '../resume/safeUrl.js';
import { parseInline } from './inlineText.js';

// A text section's paragraph, an item's text, an FAQ answer or a service's
// text (issue #91) as React elements: <strong>, <em> and <a>, and
// everything else as text, so nothing in it can ever become markup. A
// link's href goes through linkProps() (safeHref()) like every href on the
// page, though the server only saves safe ones; one that isn't (a
// half-typed URL) shows its label unlinked.
export function renderInline(text) {
  return toElements(parseInline(text));
}

function toElements(tokens) {
  return tokens.map((token, i) => {
    switch (token.t) {
      case 'strong':
        return createElement('strong', { key: i }, ...toElements(token.children));
      case 'em':
        return createElement('em', { key: i }, ...toElements(token.children));
      case 'link': {
        const props = linkProps(token.href);
        const children = toElements(token.children);
        return props.href ? createElement('a', { key: i, className: 'l-inline-link', ...props }, ...children) : createElement(Fragment, { key: i }, ...children);
      }
      default:
        return token.text;
    }
  });
}
