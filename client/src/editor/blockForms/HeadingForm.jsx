import { HEADING_SIZE_OPTIONS } from '../../resume/blockStyle.js';
import { HEADING_COLUMN_OPTIONS } from '../../resume/blockColumns.js';
import { LAYOUT_TEMPLATES } from '../../resume/templateRegistry.js';

// Layouts that honor a heading's column placement declare `columns: true`
// in their template.json, so this hint stays accurate as layouts are added
// or relabeled.
const COLUMN_LAYOUT_LABELS = LAYOUT_TEMPLATES.filter((l) => l.columns).map((l) => l.label);

export function HeadingForm({ data, onChange }) {
  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Heading text</span>
        <input
          className="ed-input"
          value={data.text || ''}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
        />
      </label>
      <div className="ed-field-row">
        <label className="ed-field ed-field-narrow">
          <span>Heading size</span>
          <select
            className="ed-input"
            value={data.fontSize || ''}
            onChange={(e) => onChange({ ...data, fontSize: e.target.value })}
          >
            {HEADING_SIZE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          <span>Column placement</span>
          <select
            className="ed-input"
            value={data.column || 'auto'}
            onChange={(e) => onChange({ ...data, column: e.target.value })}
          >
            {HEADING_COLUMN_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="ed-field-hint">
        Column placement is only used by two-column layouts
        {COLUMN_LAYOUT_LABELS.length > 0 ? ` (${COLUMN_LAYOUT_LABELS.join(', ')})` : ''} — ignored otherwise.
      </span>
    </div>
  );
}
