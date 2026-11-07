import { createHash } from 'node:crypto';
import * as z from 'zod';
import { httpError } from './httpError.js';

// Pure helpers for cover letters (issue #71): the title and `data` checks,
// the data a new letter starts with, and what identifies a rendered PDF.
// Kept apart from coverLetterStore.js so coverLetterFields.test.js covers
// them without a database.
//
// A letter's `data` (documented for MCP clients as COVER_LETTER_SCHEMA in
// mcp/blockSchemas.js; keep the keys in step, the test checks):
//   date            — shown as written; '' means the day it's exported
//   recipientName, recipientTitle, company
//   address         — the recipient's address, one line per line
//   salutation      — e.g. "Dear Ms. Smith,"
//   paragraphs      — the body, one string per paragraph
//   closing         — e.g. "Sincerely,"
//   signature       — the name it's signed with; '' means the header's name

export const MAX_TITLE_LENGTH = 100;

export const DEFAULT_TITLE = 'Cover letter';

export function validateTitle(title) {
  if (typeof title !== 'string' || !title.trim()) throw httpError(400, 'title is required');
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) throw httpError(400, `title is limited to ${MAX_TITLE_LENGTH} characters`);
  return trimmed;
}

// The title of a copy: "Acme SRE (copy)", cut so it still fits.
export function copyTitle(title) {
  const suffix = ' (copy)';
  return `${title.slice(0, MAX_TITLE_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

// Loose in the same way as blockData.js's: every key optional, unknown
// keys allowed. What it catches is a key of the wrong kind (paragraphs as
// a string, a number for the date), which would break the form or the
// rendered letter after it had been saved.
const str = z.string().nullish();
export const COVER_LETTER_DATA_VALIDATOR = z.looseObject({
  date: str,
  recipientName: str,
  recipientTitle: str,
  company: str,
  address: str,
  salutation: str,
  paragraphs: z.array(z.string()).nullish(),
  closing: str,
  signature: str,
});

// Throws a 400 naming the first offending key ("data.paragraphs.1:
// Invalid input: expected string, received number"); returns `data`.
export function assertCoverLetterData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw httpError(400, 'data must be an object');
  const result = COVER_LETTER_DATA_VALIDATOR.safeParse(data);
  if (result.success) return data;
  const issue = result.error.issues[0];
  const where = issue.path.length ? `data.${issue.path.join('.')}` : 'data';
  throw httpError(400, `${where}: ${issue.message}`);
}

// What a letter created from scratch starts with.
export function initialCoverLetterData() {
  return {
    date: '',
    recipientName: '',
    recipientTitle: '',
    company: '',
    address: '',
    salutation: 'Dear Hiring Manager,',
    paragraphs: [''],
    closing: 'Sincerely,',
    signature: '',
  };
}

// The date a letter whose `date` is blank shows when it's exported, as the
// PDF renderer's page is told it (routes/public.js's /letter). US style,
// whatever the server's locale; a letter that needs another style can say
// its date in words.
export function letterToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(now);
}

function hasOwnDate(data) {
  return typeof data?.date === 'string' && data.date.trim() !== '';
}

// Identifies everything a letter's PDF is rendered from: its data, its
// resume's header and site settings, and today's date when the letter
// shows the export date. A cached PDF with the same key is current.
export function letterPdfKey({ data, header, site, today }) {
  const content = JSON.stringify({ data, header: header ?? null, site: site ?? null, today: hasOwnDate(data) ? null : today });
  return createHash('sha256').update(content).digest('hex');
}
