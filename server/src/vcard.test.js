import test from 'node:test';
import assert from 'node:assert/strict';
import { contactCard, contactCardFileName, escapeText, foldLine, landingContactCard } from './vcard.js';
import { CONTACT_CARD_PATH, resolveLanding, validateLanding } from './landingFields.js';

const lines = (card) => card.split('\r\n');
// A card's lines unfolded (RFC 2425: a CRLF followed by one space goes).
const unfolded = (card) => card.replace(/\r\n /g, '').split('\r\n');
const octets = (line) => Buffer.byteLength(line, 'utf8');

test('escapeText escapes a backslash, comma and semicolon, and every line break as \\n', () => {
  assert.equal(escapeText('a\\b'), 'a\\\\b');
  assert.equal(escapeText('Suite 4, Floor 2; rear'), 'Suite 4\\, Floor 2\\; rear');
  assert.equal(escapeText('one\ntwo\r\nthree\rfour'), 'one\\ntwo\\nthree\\nfour');
  // The backslash first, so an escape's own backslash isn't doubled.
  assert.equal(escapeText('\\,'), '\\\\\\,');
  // Other control characters mean nothing in a contact field.
  assert.equal(escapeText('a\tb\u0000c\u007f'), 'abc');
  assert.equal(escapeText('Tue–Sat · 9–6'), 'Tue–Sat · 9–6');
});

test('foldLine keeps every line within 75 octets, never splitting a character or an escape', () => {
  assert.equal(foldLine('NOTE:short'), 'NOTE:short');
  const exact = `NOTE:${'x'.repeat(70)}`;
  assert.equal(octets(exact), 75);
  assert.equal(foldLine(exact), exact);

  const long = `NOTE:${'abcdefghij'.repeat(30)}`;
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  assert.equal(octets(parts[0]), 75);
  for (const [i, part] of parts.entries()) {
    assert.ok(octets(part) <= 75, `line ${i} is ${octets(part)} octets`);
    if (i > 0) assert.equal(part[0], ' ');
  }
  assert.equal(folded.replace(/\r\n /g, ''), long);

  // Multi-byte characters (3 octets each) are never cut in two.
  const wide = `NOTE:${'–'.repeat(60)}`;
  const wideParts = foldLine(wide).split('\r\n');
  for (const part of wideParts) {
    assert.ok(octets(part) <= 75);
    assert.ok(!part.includes('�'));
  }
  assert.equal(foldLine(wide).replace(/\r\n /g, ''), wide);
  // Nor is an emoji (a surrogate pair, 4 octets).
  const emoji = `NOTE:${'😀'.repeat(40)}`;
  for (const part of foldLine(emoji).split('\r\n')) {
    assert.ok(octets(part) <= 75);
    assert.equal(Buffer.from(part, 'utf8').toString('utf8'), part);
  }

  // A backslash stays with what it escapes.
  const escaped = `NOTE:${'x'.repeat(69)}\\,y`;
  const [first, second] = foldLine(escaped).split('\r\n');
  assert.equal(first, `NOTE:${'x'.repeat(69)}`);
  assert.equal(second, ' \\,y');
});

test('contactCard writes vCard 3.0 with CRLF line ends, and leaves out every empty field', () => {
  const card = contactCard(
    {
      email: 'jo@example.com',
      phone: '+1 (512) 555-0100',
      area: 'Travis, Williamson; and Hays counties',
      address: '100 Congress Ave\nAustin, TX 78701',
      hours: [{ days: 'Tue–Sat', time: '9–6' }, { days: '', time: 'Evenings by appointment' }, { days: ' ', time: '' }],
    },
    { name: 'Jo Ann Doe', title: 'Plumber, licensed', url: 'https://jo.example/' }
  );
  assert.ok(card.endsWith('END:VCARD\r\n'));
  assert.ok(!/[^\r]\n/.test(card), 'every line ends in CRLF');
  assert.deepEqual(unfolded(card), [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Doe;Jo Ann;;;',
    'FN:Jo Ann Doe',
    'TITLE:Plumber\\, licensed',
    'EMAIL;TYPE=INTERNET,WORK:jo@example.com',
    'TEL;TYPE=WORK,VOICE:+1 (512) 555-0100',
    'ADR;TYPE=WORK:;;100 Congress Ave\\nAustin\\, TX 78701;;;;',
    'NOTE:Service area: Travis\\, Williamson\\; and Hays counties\\nHours:\\nTue–Sat: 9–6\\nEvenings by appointment',
    'URL:https://jo.example/',
    'END:VCARD',
    '',
  ]);
  for (const line of lines(card)) assert.ok(octets(line) <= 75, line);

  // Only what's there: no title, email, address or note lines for empty fields.
  assert.deepEqual(unfolded(contactCard({ phone: '555 0100', email: '', area: ' ', address: '', hours: [] }, { name: 'Jo', title: '', url: '' })), [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:;Jo;;;',
    'FN:Jo',
    'TEL;TYPE=WORK,VOICE:555 0100',
    'END:VCARD',
    '',
  ]);
  // FN is required: without a name, the email (or the phone) names the card.
  assert.ok(unfolded(contactCard({ email: 'jo@example.com' })).includes('FN:jo@example.com'));
  assert.ok(unfolded(contactCard({ phone: '555 0100' })).includes('FN:555 0100'));
  assert.ok(unfolded(contactCard({ area: 'Austin' })).includes('FN:Contact'));
  // A URL that isn't one is left out rather than escaped.
  assert.ok(!contactCard({ area: 'x' }, { url: 'https://a.example/\r\nNOTE:x' }).includes('URL:'));
  assert.ok(!contactCard({ area: 'x' }, { url: 'javascript:alert(1)' }).includes('URL:'));
});

test('a field never adds a property of its own: its line breaks and separators are escaped', () => {
  const card = contactCard({ address: 'Main St\r\nEND:VCARD\nBEGIN:VCARD', email: '' }, { name: 'Jo;Doe', title: 'A\nTEL:1' });
  const props = unfolded(card).map((line) => line.split(/[:;]/)[0]);
  assert.deepEqual(props, ['BEGIN', 'VERSION', 'N', 'FN', 'TITLE', 'ADR', 'END', '']);
  assert.ok(unfolded(card).includes('FN:Jo\\;Doe'));
});

test('a long note is folded, and unfolds to what was escaped', () => {
  const area = 'Serving Travis, Williamson, Hays, Bastrop, Caldwell and Burnet counties and the whole Hill Country';
  const card = contactCard({ area }, { name: 'Jo' });
  const note = lines(card).findIndex((line) => line.startsWith('NOTE:'));
  assert.ok(lines(card)[note + 1].startsWith(' '));
  assert.ok(unfolded(card).includes(`NOTE:${escapeText(`Service area: ${area}`)}`));
  for (const line of lines(card)) assert.ok(octets(line) <= 75, line);
});

test('landingContactCard reads the shown contact section, and only while its button is on', () => {
  const resolved = (fields) =>
    resolveLanding(validateLanding({ sections: [{ id: 'k', kind: 'contact', ...fields }] }, { knownResumeIds: new Set() }), { resumes: new Map() });
  const person = { name: 'Jo', title: 'Plumber', url: 'https://jo.example/' };
  const card = landingContactCard(resolved({ email: 'jo@example.com', phone: 'not a number' }), person);
  assert.ok(card.includes('EMAIL;TYPE=INTERNET,WORK:jo@example.com'));
  // The page doesn't show the phone, so neither does the card.
  assert.ok(!card.includes('TEL'));
  assert.equal(resolved({ email: 'jo@example.com' }).sections[0].vcardHref, CONTACT_CARD_PATH);
  assert.equal(landingContactCard(resolved({ email: 'jo@example.com', vcard: false }), person), null);
  assert.equal(landingContactCard(resolved({ email: 'jo@example.com', hidden: true }), person), null);
  assert.equal(landingContactCard(resolved({ email: 'jo@' }), person), null, 'nothing shown, no card');
  assert.equal(landingContactCard({ sections: [] }, person), null);
  assert.equal(landingContactCard(null, person), null);
});

test('contactCardFileName keeps ASCII letters and digits only', () => {
  assert.equal(contactCardFileName('Ada Lovelace'), 'Ada-Lovelace.vcf');
  assert.equal(contactCardFileName('José "J" Núñez'), 'Jos-J-N-ez.vcf');
  assert.equal(contactCardFileName('李'), 'contact.vcf');
  assert.equal(contactCardFileName(undefined), 'contact.vcf');
});
