// Pure helpers for cover letters (issue #71): what a letter shows, worked
// out once for both its view (CoverLetterView.jsx) and its plain text.
// `data` is the letter's data as the server stores it (see
// server/src/coverLetterFields.js), `header` its resume's header.

// The day a letter without a date of its own shows, in the same style the
// server tells the PDF renderer's page (coverLetterFields.js's
// letterToday): US style, whatever the browser's locale.
export function letterToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(now);
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// What the letter shows, blanks dropped: { date, recipient (lines),
// salutation, paragraphs, closing, signature }. A blank date is `today`,
// a blank signature the header's name.
export function letterParts(data, header, today) {
  const d = data || {};
  const address = text(d.address)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    date: text(d.date) || today,
    recipient: [text(d.recipientName), text(d.recipientTitle), text(d.company), ...address].filter(Boolean),
    salutation: text(d.salutation),
    paragraphs: (Array.isArray(d.paragraphs) ? d.paragraphs : []).map(text).filter(Boolean),
    closing: text(d.closing),
    signature: text(d.signature) || text(header?.name),
  };
}

// The letter as plain text for an application form's text box: from the
// salutation to the signature, a blank line between paragraphs. The date
// and the recipient's address are left out; a text box sits inside the
// application they'd only repeat.
export function letterText(data, header, today) {
  const parts = letterParts(data, header, today);
  const signOff = [parts.closing, parts.signature].filter(Boolean).join('\n');
  return [parts.salutation, ...parts.paragraphs, signOff].filter(Boolean).join('\n\n');
}

// A paragraph moved from `from` to `to`, or null when `paragraphs` is no
// longer the list the drag started with (`snapshot`): an edit that landed
// mid-drag cancels the drop rather than moving whatever sits there now.
export function moveParagraph(paragraphs, from, to, snapshot = paragraphs) {
  if (JSON.stringify(paragraphs) !== JSON.stringify(snapshot)) return null;
  if (from === to || from < 0 || to < 0 || from >= paragraphs.length || to >= paragraphs.length) return null;
  const next = [...paragraphs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
