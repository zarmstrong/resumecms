// The "Save contact" vCard a landing page's contact section offers (issue
// #124), served by routes/landingContact.js. Pure: it's built from the
// landing page as resolveLanding() shows its *published* snapshot, so it
// holds only what the page shows (a field the page leaves out never gets
// in), plus the name and title the page's JSON-LD Person gets
// (pageMeta.js's landingPage()) and the page's own URL. No photo.
//
// vCard 3.0 (RFC 2426), which phones import most reliably: CRLF line
// ends, text values escaped (`\`, `,`, `;` and newlines) and every line
// folded at 75 octets of UTF-8, never inside a character or an escape.

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

// A text value as RFC 2426 writes it: a backslash, comma and semicolon
// escaped, every line break (CRLF, CR or LF) as `\n`, and any other control
// character dropped (nothing a contact field means to hold).
export function escapeText(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/[\\,;]/g, (ch) => `\\${ch}`)
    .replace(/\n/g, '\\n');
}

// A phone number as TEL's value: a phone-number, not text, so RFC 2426's
// escaping doesn't apply and a reader would keep the backslash. The
// characters that would need it (`\ , ;`) and every control character
// become a space instead, so "555 0100, ext. 12" stays readable.
export function phoneValue(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f\\,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function utf8Octets(ch) {
  const code = ch.codePointAt(0);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

// One content line folded into lines of at most 75 octets each, a
// continuation starting with a space (which counts towards its 75). A
// break never falls inside a UTF-8 character or between a backslash and
// what it escapes, so a reader that unfolds sloppily still reads it right.
export function foldLine(line) {
  const lines = [];
  let current = '';
  let octets = 0;
  for (const unit of line.match(/\\[\s\S]|[\s\S]/gu) ?? []) {
    const size = [...unit].reduce((sum, ch) => sum + utf8Octets(ch), 0);
    if (octets + size > MAX_LINE_OCTETS) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += unit;
    octets += size;
  }
  lines.push(current);
  return lines.join(CRLF);
}

// N's family and given names from a full name: the last word, and the
// words before it (one word is a given name). A guess, but the card's FN
// is the name as written, which is what a phone shows.
function nameParts(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return { family: '', given: words[0] ?? '' };
  return { family: words.at(-1), given: words.slice(0, -1).join(' ') };
}

// The text of a vCard for `contact` (a resolved contact section:
// { email, phone, area, address, hours }, '' or [] for what isn't shown),
// for `person` ({ name, title }) at `url`, the page's absolute URL. An
// empty field adds no line. A card without a name is named by its email
// or phone, since FN is required.
export function contactCard(contact, { name = '', title = '', url = '' } = {}) {
  const c = isObject(contact) ? contact : {};
  const email = textOf(c.email);
  const phone = textOf(c.phone);
  const address = textOf(c.address);
  const area = textOf(c.area);
  const hours = (Array.isArray(c.hours) ? c.hours : [])
    .map((entry) => [textOf(entry?.days), textOf(entry?.time)].filter(Boolean).join(': '))
    .filter(Boolean);
  const fullName = textOf(name).replace(/\s+/g, ' ');
  const shownName = fullName || email || phone || 'Contact';
  const { family, given } = nameParts(fullName);
  const note = [area && `Service area: ${area}`, hours.length && `Hours:\n${hours.join('\n')}`].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeText(family)};${escapeText(given)};;;`,
    `FN:${escapeText(shownName)}`,
    textOf(title) && `TITLE:${escapeText(textOf(title))}`,
    email && `EMAIL;TYPE=INTERNET,WORK:${escapeText(email)}`,
    phone && `TEL;TYPE=WORK,VOICE:${phoneValue(phone)}`,
    // The address is free text, so all of it goes in the street part.
    address && `ADR;TYPE=WORK:;;${escapeText(address)};;;;`,
    note && `NOTE:${escapeText(note)}`,
    // A URI, not text, so nothing in it is escaped; one with a line break
    // in it isn't one.
    /^https?:\/\/[^\s]+$/.test(url) && `URL:${url}`,
    'END:VCARD',
  ].filter(Boolean);
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// The vCard for a landing page as resolveLanding() shows it, or null while
// it offers none: no contact section shown, or one with `vcard` off.
export function landingContactCard(landing, person) {
  const sections = Array.isArray(landing?.sections) ? landing.sections : [];
  const contact = sections.find((section) => section?.kind === 'contact' && section.vcardHref);
  return contact ? contactCard(contact, person) : null;
}

// The download's name, from the person's name: "Ada Lovelace" ->
// "Ada-Lovelace.vcf". Only ASCII letters and digits survive (it goes into
// a quoted Content-Disposition filename), "contact.vcf" when none do.
export function contactCardFileName(name) {
  const dashed = typeof name === 'string' ? name.replace(/[^a-z0-9]+/gi, ' ').trim().replace(/\s+/g, '-') : '';
  return `${dashed || 'contact'}.vcf`;
}
