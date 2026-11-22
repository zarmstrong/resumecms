// A custom item's optional date (issue #214): free text such as "2021" or
// "Mar 2024", shown as written beside the item's heading (in the academic
// layout, in its date column). Never parsed, and never rewritten by the AI
// (see editor/aiReview.js).

// The date to draw, or '' for none (a blank one draws nothing).
export function customItemDate(item) {
  return typeof item?.date === 'string' ? item.date.trim() : '';
}

// `item` with `patch` applied, the date stored only while it's set, so
// clearing it leaves the item as it was before it had one.
export function patchCustomItem(item, patch) {
  const { date, ...rest } = { ...item, ...patch };
  return date ? { ...rest, date } : rest;
}
