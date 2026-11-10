import { actionIcon } from './actionIcons.js';

// The icon as inline SVG in the text's color, or nothing for a name this
// build doesn't know. Decorative: the button's label says what it does.
export function ActionIcon({ name, className = 'l-action-icon' }) {
  const entry = actionIcon(name);
  if (!entry) return null;
  const [width, height, , , path] = entry.icon.icon;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {(Array.isArray(path) ? path : [path]).map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
