import { HEADING_SIZE_OPTIONS } from '../../resume/blockStyle.js';

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
    </div>
  );
}
