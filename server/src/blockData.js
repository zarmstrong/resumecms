import * as z from 'zod';
import { httpError } from './httpError.js';

// Type checks for each block type's `data`, applied by the store on create
// and update (so both the REST routes and the MCP tools go through them).
// They're deliberately loose: every key is optional, unknown keys pass
// (the editor's forms, templates, and older data may carry more than
// mcp/blockSchemas.js documents), and documented enums are only required
// to be strings. What they do catch is a key of the wrong kind — `bullets`
// as a string, `items` as an object, a non-boolean `highlight` — which is
// what makes the editor's form or the renderer throw later, after the bad
// data has already been saved and possibly published. Keep the keys in
// step with mcp/blockSchemas.js (blockData.test.js checks that).

const str = z.string().nullish();
const bool = z.boolean().nullish();
const style = z.looseObject({ spaceAbove: str, spaceBelow: str, highlight: bool }).nullish();

// Bullets are objects, but plain strings are accepted and treated as { text }.
const subBullet = z.union([z.string(), z.looseObject({ text: str, visibleWeb: bool, visiblePrint: bool })]);
const bullet = z.union([
  z.string(),
  z.looseObject({ text: str, visibleWeb: bool, visiblePrint: bool, children: z.array(subBullet).nullish() }),
]);

export const BLOCK_DATA_VALIDATORS = {
  heading: z.looseObject({ text: str, fontSize: str, column: str, style }),
  summary: z.looseObject({ text: str, style }),
  skills_group: z.looseObject({ category: str, items: str, style }),
  experience: z.looseObject({
    jobTitle: str,
    company: str,
    companyUrl: str,
    location: str,
    startDate: str,
    endDate: str,
    tagline: str,
    description: str,
    bullets: z.array(bullet).nullish(),
    style,
  }),
  education: z.looseObject({ degree: str, institution: str, location: str, startDate: str, endDate: str, style }),
  custom: z.looseObject({
    title: str,
    items: z
      .array(
        z.looseObject({
          heading: str,
          bodyType: str,
          text: str,
          items: str,
          label: str,
          url: str,
          tagColor: str,
        })
      )
      .nullish(),
    style,
  }),
};

// Throws a 400 naming the first offending key (e.g. "data.bullets: Invalid
// input: expected array, received string"); returns `data` otherwise.
export function assertBlockData(type, data) {
  const validator = BLOCK_DATA_VALIDATORS[type];
  if (!validator) throw httpError(400, `unknown block type: ${type}`);
  const result = validator.safeParse(data);
  if (result.success) return data;
  const issue = mostSpecific(result.error.issues[0]);
  const where = issue.path.length ? `data.${issue.path.join('.')}` : 'data';
  throw httpError(400, `${where}: ${issue.message}`);
}

// A bullet is `string | object`, so a bad key inside a bullet object comes
// back as a union issue ("Invalid input" at the bullet) whose branch errors
// hold the real one; report the deepest branch issue (the object branch's
// "children: expected array" rather than the string branch's "expected
// string, received object"), with its path made absolute.
function mostSpecific(issue) {
  if (issue.code !== 'invalid_union') return issue;
  let best = issue;
  for (const branch of issue.errors) {
    for (const inner of branch) {
      const nested = mostSpecific({ ...inner, path: [...issue.path, ...inner.path] });
      if (nested.path.length > best.path.length) best = nested;
    }
  }
  if (best !== issue) return best;
  // No branch got further than the value itself (e.g. a number where a
  // string or object was expected): say what each branch wanted.
  const wanted = issue.errors.map((branch) => branch[0]?.message.replace(/^Invalid input: /, '')).filter(Boolean);
  return { ...issue, message: `Invalid input: ${wanted.join('; ')}` };
}
