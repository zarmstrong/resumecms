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

// What a summary rewrite with a brief gets to see of the rest of the
// resume, so it can describe the person as a whole rather than only
// reword its own text: job titles and companies, skills, and education.
// `blocks` is the draft in display order. A block that's hidden anywhere
// `summary` shows is left out, so nothing hidden reaches the summary's
// public text. A summary hidden everywhere counts as shown everywhere:
// it's most likely a draft about to be unhidden, text and all. Null when
// there's nothing to show.
export function resumeOutline(blocks, summary) {
  const hiddenEverywhere = !summary.visibleWeb && !summary.visiblePrint;
  const shows = { web: hiddenEverywhere || summary.visibleWeb, print: hiddenEverywhere || summary.visiblePrint };
  const shownWherever = (block) => (!shows.web || block.visibleWeb) && (!shows.print || block.visiblePrint);
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const outline = { experience: [], skills: [], education: [] };
  for (const block of blocks) {
    if (block.id === summary.id || !shownWherever(block)) continue;
    const data = block.data || {};
    if (block.type === 'experience') {
      const entry = { jobTitle: text(data.jobTitle), company: text(data.company), dates: dates(text(data.startDate), text(data.endDate)) };
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

function dates(start, end) {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}
