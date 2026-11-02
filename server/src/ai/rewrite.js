import { REWRITABLE_TYPES, RewriteShapeError, mergeRewrite, outputSchema, rewriteInput } from './rewritableFields.js';
import { AiError, callProvider } from './providers.js';

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
    ? 'You may add, remove, merge, split, or reorder bullets when that serves the instruction. Bullets nest at most one level (a bullet may have sub-bullets; sub-bullets have none).'
    : 'Return exactly the same number of bullets, with the same number of sub-bullets under each, in the same order. Reword them in place; do not add, remove, merge, or reorder them.';
}

export function buildPrompt(type, { editable, context }, instruction, { allowBulletRestructure = false } = {}) {
  const rules = [
    'Only make the changes the instruction asks for, and keep the person\'s own voice.',
    'Never invent facts: no employers, job titles, dates, technologies, credentials, or numbers that are not in the input. Where a metric would strengthen a statement but none is given, insert a bracketed placeholder such as [X%] or [N users] for the person to fill in.',
    'Plain text only — no Markdown, no emoji.',
    'Copy any field the instruction does not concern exactly as given.',
    'In "explanation", say in one or two sentences what you changed.',
  ];
  if (type === 'experience') {
    rules.push(
      '"description" is an optional short blurb about the role, shown above the bullets. If it is empty, leave it empty unless the instruction asks for one. When writing one, keep it to two or three sentences and draw only on the context, tagline, and bullets. If the tagline and bullets are too thin to say anything beyond the job title and company, leave it empty and say so in "explanation".'
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
// `settings` is the normalized `ai` setting (aiSettings.js); `callModel` is
// injectable so tests can stand in for the provider.
export async function rewriteBlock({ type, data, instruction, settings, callModel = callProvider }) {
  if (!REWRITABLE_TYPES.has(type)) throw new AiError(400, `${type} blocks can't be rewritten with AI`);
  const { allowBulletRestructure } = settings;
  const input = rewriteInput(type, data);
  const { system, user } = buildPrompt(type, input, instruction, { allowBulletRestructure });

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
