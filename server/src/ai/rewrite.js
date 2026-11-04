import {
  BLOCK_TARGET,
  InvalidTargetError,
  REWRITABLE_TYPES,
  RewriteShapeError,
  mergeRewrite,
  normalizeTarget,
  outputSchema,
  rewriteInput,
} from './rewritableFields.js';
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

// What the user line says is being rewritten, for anything narrower than
// the whole block.
function targetLabel(target) {
  switch (target.kind) {
    case 'description':
      return 'only the description';
    case 'bullet':
      return target.path.length === 1
        ? `only bullet ${target.path[0] + 1} (with its sub-bullets)`
        : `only sub-bullet ${target.path[1] + 1} of bullet ${target.path[0] + 1}`;
    case 'item':
      return `only item ${target.index + 1}`;
    default:
      return null;
  }
}

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

function subBulletRule(allowBulletRestructure) {
  return allowBulletRestructure
    ? 'You may add, remove, merge, or split this bullet\'s sub-bullets when that serves the instruction. Sub-bullets have no sub-bullets of their own.'
    : 'Return exactly the same number of sub-bullets under this bullet, in the same order. Reword them in place; do not add, remove, merge, or reorder them.';
}

const CONTEXT_PLACEHOLDER_RULE =
  'In the context, "[the part being rewritten]" marks where the section you are rewriting sits. Use the rest of the context to stay consistent with it: match its tone and tense, and do not repeat what it already says.';

function experienceRules(target, allowBulletRestructure) {
  switch (target.kind) {
    case 'description':
      return [
        '"description" is an optional short blurb about the role, shown above the bullets. If it is empty, write one only if the instruction asks for one. When writing one, keep it to two or three sentences and draw only on the context: the job details, tagline, and bullets. If they are too thin to say anything beyond the job title and company, leave it empty and say so in "explanation".',
        'Bullets marked "hidden": true in the context are hidden from the web page, the PDF, or both, but the description always shows on both. Never carry their content into the description.',
      ];
    case 'bullet':
      return [
        'You are rewriting one bullet of this entry. The tagline, description, and other bullets are context only.',
        CONTEXT_PLACEHOLDER_RULE,
        'Bullets marked "hidden": true are hidden from the web page, the PDF, or both. Never carry content from a hidden bullet in the context into the bullet you are rewriting unless that bullet is marked "hidden": true too.',
        ...(target.path.length === 1 ? [subBulletRule(allowBulletRestructure)] : []),
      ];
    default:
      return [
        'The "description" in the context is a separate blurb shown above the bullets. It is not part of this rewrite; use it only to stay consistent.',
        'Bullets marked "hidden": true are hidden from the web page, the PDF, or both, but the tagline always shows on both. Never carry their content into the tagline. Rewrite those bullets themselves as usual.',
        bulletRule(allowBulletRestructure),
      ];
  }
}

const CUSTOM_BODY_RULE =
  '"body" follows its item type: "list" is one entry per line, "tags" is a comma-separated list, "link" is the link\'s visible text, "text" is prose.';

function customRules(target) {
  if (target.kind === 'item') {
    return [
      'You are rewriting one item of this section. The section title and other items are context only.',
      CONTEXT_PLACEHOLDER_RULE,
      `The item's type is itemBodyType in the context. ${CUSTOM_BODY_RULE}`,
    ];
  }
  return [`Return exactly the same number of items in the same order. Each item's type is in itemBodyTypes. ${CUSTOM_BODY_RULE}`];
}

// `target` must already be normalized (normalizeTarget).
export function buildPrompt(
  type,
  { editable, context },
  instruction,
  { allowBulletRestructure = false, tense = null, target = BLOCK_TARGET } = {}
) {
  const rules = [
    'Only make the changes the instruction asks for, and keep the person\'s own voice.',
    'Never invent facts: no employers, job titles, dates, technologies, credentials, or numbers that are not in the input. Where a metric would strengthen a statement but none is given, insert a bracketed placeholder such as [X%] or [N users] for the person to fill in.',
    'Plain text only — no Markdown, no emoji.',
    'Copy any field the instruction does not concern exactly as given.',
    'In "explanation", say in one or two sentences what you changed.',
  ];
  if (Object.hasOwn(TENSE_RULES, tense ?? '')) rules.push(TENSE_RULES[tense]);
  if (type === 'experience') rules.push(...experienceRules(target, allowBulletRestructure));
  if (type === 'custom') rules.push(...customRules(target));

  const system = [
    'You rewrite one section of a person\'s resume at their request, and return the rewritten section as JSON matching the provided schema.',
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
  ].join('\n');

  const scope = targetLabel(target);
  const user = [
    `Section type: ${TYPE_LABELS[type]}`,
    ...(scope ? [`Rewriting: ${scope}`] : []),
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

// Produces a proposal for one block, or one part of it (`target`, see
// rewritableFields.js; omitted means the whole block). Nothing is saved
// here — the editor shows the proposal and, if accepted, saves it through
// the normal PUT /api/blocks/:id path (which calls touchDraft()).
//
// `settings` is the normalized `ai` setting (aiSettings.js); `tense` is the
// tense picked in the editor for a custom block (tense.js's PICKED_TENSES,
// or undefined for the setting's default), checked here as the one place a
// bad one becomes a 400; `callModel` is
// injectable so tests can stand in for the provider.
export async function rewriteBlock({ type, data, instruction, settings, tense: picked, target, callModel = callProvider }) {
  if (!REWRITABLE_TYPES.has(type)) throw new AiError(400, `${type} blocks can't be rewritten with AI`);
  const tenseError = pickedTenseError(picked, type);
  if (tenseError) throw new AiError(400, tenseError);
  let scope;
  try {
    scope = normalizeTarget(type, data, target);
  } catch (err) {
    if (err instanceof InvalidTargetError) throw new AiError(400, err.message);
    throw err;
  }
  const { allowBulletRestructure } = settings;
  const tense = resolveTense(settings.tense, type, data, picked);
  const input = rewriteInput(type, data, scope);
  const { system, user } = buildPrompt(type, input, instruction, { allowBulletRestructure, tense, target: scope });

  const output = await callModel({
    provider: settings.provider,
    apiKey: settings.apiKeys[settings.provider],
    model: settings.models[settings.provider],
    system,
    user,
    schema: outputSchema(type, scope),
    timeoutSeconds: settings.timeoutSeconds,
  });

  try {
    const { data: proposedData, bulletReview } = mergeRewrite(type, data, output?.rewrite, {
      allowBulletRestructure,
      target: scope,
    });
    return {
      target: scope,
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
