import { BLOCK_SPACING_OPTIONS } from '../resume/blockStyle.js';

// Shared "customize" section shown under every block type's own form —
// spacing and other layout tweaks that apply the same way regardless of
// block type, stored at `data.style` alongside the block's own fields.
export function BlockStyleForm({ data, onChange }) {
  const style = data.style || {};

  function patchStyle(patch) {
    onChange({ ...data, style: { ...style, ...patch } });
  }

  return (
    <div className="ed-form ed-block-style-form">
      <div className="ed-block-style-heading">Customize block</div>
      <div className="ed-field-row">
        <label className="ed-field ed-field-narrow">
          <span>Space above</span>
          <select
            className="ed-input"
            value={style.spaceAbove || ''}
            onChange={(e) => patchStyle({ spaceAbove: e.target.value })}
          >
            {BLOCK_SPACING_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field ed-field-narrow">
          <span>Space below</span>
          <select
            className="ed-input"
            value={style.spaceBelow || ''}
            onChange={(e) => patchStyle({ spaceBelow: e.target.value })}
          >
            {BLOCK_SPACING_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="ed-field ed-checkbox-field">
        <input
          type="checkbox"
          checked={!!style.highlight}
          onChange={(e) => patchStyle({ highlight: e.target.checked })}
        />
        <span>Highlight this block (tinted background box)</span>
      </label>
    </div>
  );
}
