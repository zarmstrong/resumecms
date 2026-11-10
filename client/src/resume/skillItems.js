// A skill group's `items` as the resume draws them as chips: split on
// commas, trimmed, blanks dropped. The landing page's skills section
// (issue #126) gets them already split by the server's splitSkillItems()
// (server/src/landingFields.js), which mirrors this; resolveLanding.test.js
// compares the two.
export function splitItems(items) {
  return (items || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
