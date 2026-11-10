// Reordering the landing page's sections in its editor (LandingForm). Unlike
// bullets (bulletDrag.js), sections have ids, so a drop is described as
// "before/after section X" and applied by id to the sections as they are when
// it lands: an edit made mid-drag (an accepted AI suggestion, a section
// removed) can't make it move whatever now sits at an index. The projection
// that draws the indicator is the same function that makes the saved order.

// The sections with `activeId` moved to just before or after `anchorId`, or
// null when either is gone or the order wouldn't change.
export function placeSection(sections, activeId, anchorId, edge) {
  if (activeId === anchorId) return null;
  const moving = sections.find((s) => s.id === activeId);
  const rest = sections.filter((s) => s.id !== activeId);
  const at = rest.findIndex((s) => s.id === anchorId);
  if (!moving || at < 0) return null;
  const index = edge === 'after' ? at + 1 : at;
  const next = [...rest.slice(0, index), moving, ...rest.slice(index)];
  return next.every((s, i) => s === sections[i]) ? null : { sections: next, index };
}

// "Position 2 of 5", for the indicator and the live region.
export function positionLabel(index, count) {
  return `Position ${index + 1} of ${count}`;
}

// What the pointer over `anchorId` would do, or null for nothing.
export function projectSectionDrop(sections, activeId, anchorId, edge) {
  const placed = placeSection(sections, activeId, anchorId, edge);
  return placed && { activeId, anchorId, edge, label: positionLabel(placed.index, sections.length) };
}

// The drop applied to `sections` as they are now (see above), with where the
// section ended up, or null when there's nothing to save.
export function applySectionDrop(sections, projection) {
  const placed = projection && placeSection(sections, projection.activeId, projection.anchorId, projection.edge);
  return placed ? { sections: placed.sections, label: positionLabel(placed.index, sections.length) } : null;
}

// Keyboard reordering: the section moved by `delta` places, and a label for
// the live region, or null when it's already at that end.
export function moveSectionBy(sections, id, delta) {
  const from = sections.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sections.length) return null;
  const placed = placeSection(sections, id, sections[to].id, delta > 0 ? 'after' : 'before');
  return placed && { sections: placed.sections, label: positionLabel(to, sections.length) };
}

// The collapsed ids worth keeping: those of sections still in the draft.
export function liveCollapsedIds(collapsed, sections) {
  return sections.filter((s) => collapsed.has(s.id)).map((s) => s.id);
}
