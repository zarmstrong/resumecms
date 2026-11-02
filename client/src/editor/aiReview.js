// Pure helpers behind the AI rewrite review panel (AiRewritePanel.jsx).

// Mirrors REWRITABLE_TYPES in server/src/ai/rewritableFields.js.
export const AI_REWRITABLE_TYPES = new Set(['heading', 'summary', 'skills_group', 'experience', 'custom']);

export const AI_PRESETS = [
  { label: 'Tighten', instruction: 'Make this more concise without losing any substance.' },
  {
    label: 'Quantify impact',
    instruction:
      'Emphasize measurable impact. Where a number would help but none is given, add a bracketed placeholder like [X%] for me to fill in.',
  },
  { label: 'Stronger verbs', instruction: 'Start statements with strong, specific action verbs and use active voice.' },
  { label: 'Fix grammar', instruction: 'Fix grammar, spelling, and punctuation only. Change nothing else.' },
];

// Splits into words with their trailing whitespace attached, so joining the
// parts reproduces the original text exactly. Keeping spaces out of their
// own tokens stops them from anchoring matches, which would otherwise
// interleave a rewritten phrase into alternating struck/added words.
function tokenize(text) {
  return String(text || '').match(/\s+|\S+\s*/g) || [];
}

// Word-level diff via longest common subsequence. Returns runs of
// { type: 'same' | 'add' | 'del', text }, adjacent runs of one type merged.
export function wordDiff(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const runs = [];
  const push = (type, text) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.text += text;
    else runs.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', a[i++]);
    } else {
      push('add', b[j++]);
    }
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);
  return runs;
}

const CUSTOM_BODY_FIELD = { text: 'text', list: 'items', tags: 'items', link: 'label' };

function customBody(item) {
  if (!item.bodyType) return item.text ?? item.body ?? '';
  return item[CUSTOM_BODY_FIELD[item.bodyType] || 'text'] || '';
}

// The non-bullet text fields an AI rewrite can change, as
// { label, before, after } — only the ones that actually changed. Bullets
// are reviewed separately from the server's bulletReview.
export function changedFields(type, before = {}, after = {}) {
  const fields = [];
  const add = (label, b, a) => {
    if ((b || '') !== (a || '')) fields.push({ label, before: b || '', after: a || '' });
  };
  switch (type) {
    case 'heading':
      add('Heading', before.text, after.text);
      break;
    case 'summary':
      add('Summary', before.text, after.text);
      break;
    case 'skills_group':
      add('Category', before.category, after.category);
      add('Items', before.items, after.items);
      break;
    case 'experience':
      add('Tagline', before.tagline, after.tagline);
      break;
    case 'custom': {
      add('Section title', before.title, after.title);
      const items = before.items || [];
      items.forEach((item, i) => {
        const next = (after.items || [])[i] || {};
        add(`Item ${i + 1} heading`, item.heading, next.heading);
        add(`Item ${i + 1}`, customBody(item), customBody(next));
      });
      break;
    }
    default:
      break;
  }
  return fields;
}

// What happened to one bullet in the server's bulletReview, for its label.
export function bulletChange(item) {
  if (item.before === null) return 'added';
  return item.before === item.after ? 'unchanged' : 'reworded';
}

// True when the block changed after the proposal was generated — accepting
// would then silently overwrite those edits.
export function isProposalStale(proposal, currentData) {
  return JSON.stringify(proposal.baseData) !== JSON.stringify(currentData);
}
