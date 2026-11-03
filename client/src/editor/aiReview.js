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

// The tense a custom block's picker shows: the pick made in this panel, or
// else the tense setting's default, so changing the setting still moves an
// untouched picker, or else the first option. All come from the server
// (publicAiSettings): `options` is its `pickedTenses` (id → { label }). A
// pick or default that isn't among the options (settings reloaded since) is
// skipped, so the select never shows a blank value or sends a stale id.
export function pickerTense(picked, defaultTense, options) {
  options ??= {};
  const offered = (id) => typeof id === 'string' && Object.hasOwn(options, id);
  if (offered(picked)) return picked;
  if (offered(defaultTense)) return defaultTense;
  return Object.keys(options)[0];
}

// A note for a proposal written with a different tense than the picker now
// shows, or null. `options` is the settings' `pickedTenses` (id → { label }).
export function tenseChangeNote(usedTense, currentTense, options) {
  if (!usedTense || usedTense === currentTense) return null;
  const label = (id) => options?.[id]?.label || id;
  return `This rewrite used “${label(usedTense)}”. Try again to use “${label(currentTense)}”.`;
}

// Presets that only make sense for one block type, shown after AI_PRESETS.
// The experience one writes a description when there isn't one yet, and
// rewrites it otherwise.
export function presetsFor(type, data = {}) {
  if (type !== 'experience') return AI_PRESETS;
  const preset = data.description?.trim()
    ? {
        label: 'Rewrite description',
        instruction: 'Rewrite only the description so it reads clearly and confidently. Leave the tagline and bullets unchanged.',
      }
    : {
        label: 'Write description',
        instruction:
          'Write a short description of this role (two or three sentences) summarizing its scope and focus, based only on the details already here. Leave the tagline and bullets unchanged.',
      };
  return [...AI_PRESETS, preset];
}

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
      add('Description', before.description, after.description);
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

// How many of an experience block's bullets (sub-bullets included) are
// hidden from web or print. A sub-bullet of a hidden bullet is hidden with
// it, matching what the server marks as hidden for the AI (rewritableFields.js).
// Their text is sent to the AI along with the rest, so the panel says so
// before the user sends anything.
export function hiddenBulletCount(type, data = {}) {
  if (type !== 'experience') return 0;
  const count = (bullets, parentHidden) =>
    (Array.isArray(bullets) ? bullets : []).reduce((n, b) => {
      if (!b || typeof b !== 'object') return n + (parentHidden ? 1 : 0);
      const hidden = parentHidden || b.visibleWeb === false || b.visiblePrint === false;
      return n + (hidden ? 1 : 0) + count(b.children, hidden);
    }, 0);
  return count(data.bullets, false);
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
