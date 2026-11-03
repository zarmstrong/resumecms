import { REWRITABLE_TYPES, RewriteShapeError, mergeRewrite, outputSchema, rewriteInput } from './rewritableFields.js';
import { AiError, callProvider } from './providers.js';
import { pickedTenseError, resolveTense } from './tense.js';

export const MAX_INSTRUCTION_LENGTH = 2000;

const TYPE_LABELS = {
  heading: 'Section heading',
  summary: 'Professional summary',
  skills_group: 'Skills row (a category label and a comma-separated list)',
  experience: 'Experience entry',
  custom: 'Custom section',
};

function bulletRule(allowBulletRestructure) {
  return allowBulletRestructure
    ? 'You may add, remove, merge, split, or reorder bullets when that serves the instruction. Bullets nest at most one level (a bullet may have sub-bullets; sub-bullets have none). Never merge or move content from a bullet marked "hidden": true into one that is not, since that bullet is shown publicly.'
    : 'Return exactly the same number of bullets, with the same number of sub-bullets under each, in the same order. Reword them in place; do not add, remove, merge, or reorder them.';
}

// The scope comes first so it reads as part of the rule, not an
// afterthought: it covers only text the instruction already changes, so it
// never overrides "only make the changes the instruction asks for" (fixing
// one typo doesn't retense the whole block), and an instruction that names a
// tense ("Put this in the past tense") wins over the setting. Which tense,
// if any, a request gets is tense.js's resolveTense. The past rule
// leaves statements of who the person is alone, so a past-tense rewrite
// doesn't say they stopped being an engineer. Present tense is spelled out
// because resume bullets drop an implied "I", and "present tense" alone lets
// a model switch between "Lead" and "Leads" from one rewrite to the next.
const UNCONCERNED = 'Leave text the instruction does not concern as it is, whatever its tense.';
export const TENSE_RULES = {
  past: `In text you write or rewrite for the instruction, use the past tense for verbs about the person's work and accomplishments ("Led a team of five", not "Lead a team of five" or "Leading a team of five"), unless the instruction asks for a different tense. Statements of who the person is or what they know ("Engineer with ten years of experience", "Fluent in Spanish") stay as they are. ${UNCONCERNED}`,
  present: `In text you write or rewrite for the instruction, use the present tense for verbs about the person's work and accomplishments, unless the instruction asks for a different tense. Bullets and other phrases without a subject drop the implied "I" ("Lead a team of five", not "Leads a team of five" or "Leading a team of five"); a full sentence keeps the original's subject ("She leads a team of five"). ${UNCONCERNED}`,
};

export function buildPrompt(
  type,
  { editable, context },
  instruction,
  { allowBulletRestructure = false, tense = null } = {}
) {
  const rules = [
    'Only make the changes the instruction asks for, and keep the person\'s own voice.',
    'Never invent facts: no employers, job titles, dates, technologies, credentials, or numbers that are not in the input. Where a metric would strengthen a statement but none is given, insert a bracketed placeholder such as [X%] or [N users] for the person to fill in.',
    'Plain text only — no Markdown, no emoji.',
    'Copy any field the instruction does not concern exactly as given.',
    'In "explanation", say in one or two sentences what you changed.',
  ];
  if (Object.hasOwn(TENSE_RULES, tense ?? '')) rules.push(TENSE_RULES[tense]);
  if (type === 'experience') {
    rules.push(
      '"description" is an optional short blurb about the role, shown above the bullets. If it is empty, leave it empty unless the instruction asks for one. When writing one, keep it to two or three sentences and draw only on the context, tagline, and bullets. If the tagline and bullets are too thin to say anything beyond the job title and company, leave it empty and say so in "explanation".'
    );
    rules.push(
      'Bullets marked "hidden": true are hidden from the web page, the PDF, or both, but the tagline and description always show on both. Never carry their content into the tagline or description. Rewrite those bullets themselves as usual.'
    );
    rules.push(bulletRule(allowBulletRestructure));
  }
  if (type === 'custom') {
    rules.push(
      'Return exactly the same number of items in the same order. Each item\'s "body" follows its type in itemBodyTypes: "list" is one entry per line, "tags" is a comma-separated list, "link" is the link\'s visible text, "text" is prose.'
    );
  }

  const system = [
    'You rewrite one section of a person\'s resume at their request, and return the rewritten section as JSON matching the provided schema.',
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
  ].join('\n');

  const user = [
    `Section type: ${TYPE_LABELS[type]}`,
    ...(context ? ['', 'Context (read-only — do not change or repeat it):', JSON.stringify(context, null, 2)] : []),
    '',
    'Section to rewrite:',
    JSON.stringify(editable, null, 2),
    '',
    'Instruction:',
    instruction,
  ].join('\n');

  return { system, user };
}

// Produces a proposal for one block. Nothing is saved here — the editor
// shows the proposal and, if accepted, saves it through the normal
// PUT /api/blocks/:id path (which calls touchDraft()).
//
// `settings` is the normalized `ai` setting (aiSettings.js); `tense` is the
// tense picked in the editor for a custom block (tense.js's PICKED_TENSES,
// or undefined for the setting's default), checked here as the one place a
// bad one becomes a 400; `callModel` is
// injectable so tests can stand in for the provider.
export async function rewriteBlock({ type, data, instruction, settings, tense: picked, callModel = callProvider }) {
  if (!REWRITABLE_TYPES.has(type)) throw new AiError(400, `${type} blocks can't be rewritten with AI`);
  const tenseError = pickedTenseError(picked, type);
  if (tenseError) throw new AiError(400, tenseError);
  const { allowBulletRestructure } = settings;
  const tense = resolveTense(settings.tense, type, data, picked);
  const input = rewriteInput(type, data);
  const { system, user } = buildPrompt(type, input, instruction, { allowBulletRestructure, tense });

  const output = await callModel({
    provider: settings.provider,
    apiKey: settings.apiKeys[settings.provider],
    model: settings.models[settings.provider],
    system,
    user,
    schema: outputSchema(type),
    timeoutSeconds: settings.timeoutSeconds,
  });

  try {
    const { data: proposedData, bulletReview } = mergeRewrite(type, data, output?.rewrite, { allowBulletRestructure });
    return {
      proposedData,
      bulletReview: bulletReview || null,
      explanation: typeof output?.explanation === 'string' ? output.explanation.trim() : '',
      allowBulletRestructure,
    };
  } catch (err) {
    if (err instanceof RewriteShapeError) throw new AiError(502, err.message);
    throw err;
  }
}
