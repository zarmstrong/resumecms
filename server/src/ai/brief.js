import { httpError } from '../httpError.js';

// AI tailoring (issue #53): a brief says who a resume is for, and rewrites
// that carry one tailor the block to it (rewrite.js's tailoring rules). The
// same shape is saved on a resume as its `tailoring` setting, so the
// editor can show what a variant was tailored for and re-tailor it.
//
// { audience, posting, guidance }: the audience or role type ("security
// engineering roles") is required; the job posting (pasted, the employer's
// text) and the person's own extra guidance are optional, '' when absent.
// Each has its own cap, separate from rewrite.js's MAX_INSTRUCTION_LENGTH.
export const BRIEF_LIMITS = { audience: 200, posting: 12000, guidance: 2000 };

const BRIEF_FIELDS = Object.keys(BRIEF_LIMITS);

// The brief, trimmed and checked, or a 400 naming what's wrong. `label` is
// the field it came in as (`brief` on a rewrite, `tailoring` on a resume).
export function normalizeBrief(raw, label = 'brief') {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw httpError(400, `${label} must be an object like { "audience": "security engineering roles" }`);
  }
  const unknown = Object.keys(raw).find((key) => !BRIEF_FIELDS.includes(key));
  if (unknown) throw httpError(400, `Unknown ${label} field: ${unknown}`);
  const brief = {};
  for (const field of BRIEF_FIELDS) {
    const value = raw[field] ?? '';
    if (typeof value !== 'string') throw httpError(400, `${label}.${field} must be a string`);
    brief[field] = value.trim();
    if (brief[field].length > BRIEF_LIMITS[field]) {
      throw httpError(400, `${label}.${field} is limited to ${BRIEF_LIMITS[field]} characters`);
    }
  }
  if (!brief.audience) throw httpError(400, `${label}.audience is required: say who the resume is for`);
  return brief;
}

// Which rewrites get an outline of the rest of their resume
// (resumeOutline), and how much of it, or null for none. A summary gets
// one only when it's tailored: rewording its own text needs nothing else.
// An executive summary always does, since writing one means drawing on the
// whole resume, and its outline also has each job's accomplishments
// (tagline, description, bullets), which is what its highlights are made
// of.
export function outlineScope(type, hasBrief) {
  if (type === 'executive_summary') return { accomplishments: true };
  if (type === 'summary' && hasBrief) return { accomplishments: false };
  return null;
}

// What a summary rewrite (outlineScope) gets to see of the rest of the
// resume, so it can describe the person as a whole rather than only
// reword its own text: job titles and companies, skills, and education,
// plus with `accomplishments` each job's tagline, description and
// bullets. `blocks` is the draft in display order; `summary` is the
// summary or executive summary block being rewritten. A block or bullet
// that's hidden anywhere `summary` shows is left out, so nothing hidden
// reaches the summary's public text (a sub-bullet counts as hidden
// wherever its parent is). A summary hidden everywhere counts as shown
// everywhere: it's most likely a draft about to be unhidden, text and
// all. Null when there's nothing to show.
export function resumeOutline(blocks, summary, { accomplishments = false } = {}) {
  const hiddenEverywhere = !summary.visibleWeb && !summary.visiblePrint;
  const shows = { web: hiddenEverywhere || summary.visibleWeb, print: hiddenEverywhere || summary.visiblePrint };
  const shownWherever = (block) => (!shows.web || block.visibleWeb) && (!shows.print || block.visiblePrint);
  const outline = { experience: [], skills: [], education: [] };
  for (const block of blocks) {
    if (block.id === summary.id || !shownWherever(block)) continue;
    const data = block.data || {};
    if (block.type === 'experience') {
      const entry = { jobTitle: text(data.jobTitle), company: text(data.company), dates: dates(text(data.startDate), text(data.endDate)) };
      if (accomplishments) Object.assign(entry, jobAccomplishments(data, shownWherever));
      if (entry.jobTitle || entry.company) outline.experience.push(entry);
    } else if (block.type === 'skills_group') {
      const entry = { category: text(data.category), items: text(data.items) };
      if (entry.items) outline.skills.push(entry);
    } else if (block.type === 'education') {
      const entry = { degree: text(data.degree), institution: text(data.institution) };
      if (entry.degree || entry.institution) outline.education.push(entry);
    }
  }
  const nonEmpty = Object.fromEntries(Object.entries(outline).filter(([, list]) => list.length > 0));
  return Object.keys(nonEmpty).length ? nonEmpty : null;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// A job's tagline, description and shown bullets, each only when there is
// one. Bullets are flattened, a sub-bullet right after its parent. Rows
// saved before blockData.js's checks may hold anything, so a bullet that's
// neither a string nor an object is skipped rather than trusted.
function jobAccomplishments(data, shownWherever) {
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const flags = (b) => ({ visibleWeb: b.visibleWeb !== false, visiblePrint: b.visiblePrint !== false });
  const bullets = [];
  // Sub-bullets are only reached through a shown parent, and nest one level.
  const add = (list, depth) => {
    for (const b of Array.isArray(list) ? list : []) {
      if (typeof b === 'string') {
        if (b.trim()) bullets.push(b.trim());
      } else if (isObject(b) && shownWherever(flags(b))) {
        if (text(b.text)) bullets.push(text(b.text));
        if (depth === 0) add(b.children, 1);
      }
    }
  };
  add(data.bullets, 0);
  const out = {};
  if (text(data.tagline)) out.tagline = text(data.tagline);
  if (text(data.description)) out.description = text(data.description);
  if (bullets.length) out.bullets = bullets;
  return out;
}

function dates(start, end) {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}
