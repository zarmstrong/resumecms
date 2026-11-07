import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// How the PDF renderer tells /api/public/resume which resume it is
// rendering. /print fetches that endpoint like the public site does, and
// without a hint it would always get the default resume. The renderer
// (pdfRenderer.js) puts a cookie holding `<resume id>.<signature>` into the
// throwaway browser context it renders in; the public route serves that
// resume's published snapshot to a request carrying a valid one, whether or
// not the resume is public.
//
// A cookie rather than a request header: Puppeteer's extra headers go to
// every request the page makes, Google Fonts included, while a cookie for
// 127.0.0.1 never leaves the box. The key is random per process and never
// stored, so a signature is only good for this server's lifetime, and only
// the renderer, which runs in this same process, can mint one.
export const RENDER_COOKIE = 'resumecms_render';

// The same for a cover letter (issue #71): /print/letter fetches
// /api/public/letter, which serves the letter this cookie names, and
// nothing at all to a request without one. A cookie of its own, signed over
// a different input, so neither kind can stand in for the other.
export const RENDER_LETTER_COOKIE = 'resumecms_render_letter';

const COOKIE_NAMES = { resume: RENDER_COOKIE, letter: RENDER_LETTER_COOKIE };

// Set on the response to a request with a valid render cookie, naming the
// resume it served. The renderer checks it before keeping a PDF, so if the
// cookie ever stops reaching the server (a Puppeteer change in how cookies
// for 127.0.0.1 are stored, say), renders fail loudly instead of quietly
// filing the default resume's content under another resume's name.
export const RENDERED_RESUME_HEADER = 'X-ResumeCMS-Resume';
// And the cover letter /api/public/letter served.
export const RENDERED_LETTER_HEADER = 'X-ResumeCMS-Letter';

const key = randomBytes(32);

// `kind` is 'resume' or 'letter'.
function sign(id, kind) {
  return createHmac('sha256', key).update(`${kind}:${id}`).digest('base64url');
}

export function renderCookieValue(id, kind = 'resume') {
  return `${id}.${sign(id, kind)}`;
}

// The resume id (with kind 'letter', the cover letter id) a request's
// Cookie header vouches for, or null.
export function renderTarget(cookieHeader, kind = 'resume') {
  if (typeof cookieHeader !== 'string') return null;
  const prefix = `${COOKIE_NAMES[kind]}=`;
  const raw = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(id, kind));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}
