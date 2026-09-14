import { CUSTOM_BODY_TYPES, defaultCustomItem } from '../blockDefaults.js';

const DEFAULT_TAG_COLOR = '#2f6f4e';

// Legacy items were saved as `{ heading, body }` with no bodyType.
function normalizeItem(item) {
  if (item.bodyType) return item;
  return { ...item, bodyType: 'text', text: item.body };
}

function TagColorField({ item, onChange }) {
  const enabled = Boolean(item.tagColor);
  return (
    <label className="ed-color-field">
      <span className="ed-color-field-label ed-color-field-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ tagColor: e.target.checked ? DEFAULT_TAG_COLOR : '' })}
        />
        Custom tag color
      </span>
      <span className="ed-color-field-hint">Overrides the accent color for just this group of tags</span>
      {enabled && (
        <div className="ed-color-row">
          <input
            type="color"
            className="ed-color-swatch"
            value={item.tagColor}
            onChange={(e) => onChange({ tagColor: e.target.value })}
            aria-label="Tag color"
          />
          <input className="ed-input" value={item.tagColor} onChange={(e) => onChange({ tagColor: e.target.value })} />
        </div>
      )}
    </label>
  );
}

function ItemBodyFields({ item, onChange }) {
  switch (item.bodyType) {
    case 'list':
      return (
        <textarea
          className="ed-textarea"
          rows={3}
          value={item.items || ''}
          onChange={(e) => onChange({ items: e.target.value })}
          placeholder="One list item per line"
        />
      );
    case 'link':
      return (
        <div className="ed-field-row">
          <input
            className="ed-input ed-input-flex"
            value={item.label || ''}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Link text, e.g. View certificate"
          />
          <input
            className="ed-input ed-input-flex"
            value={item.url || ''}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://..."
          />
        </div>
      );
    case 'tags':
      return (
        <div className="ed-tags-field">
          <input
            className="ed-input"
            value={item.items || ''}
            onChange={(e) => onChange({ items: e.target.value })}
            placeholder="Comma-separated, e.g. English (native), Spanish (fluent)"
          />
          <TagColorField item={item} onChange={onChange} />
        </div>
      );
    case 'text':
    default:
      return (
        <textarea
          className="ed-textarea"
          rows={2}
          value={item.text || ''}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Item detail"
        />
      );
  }
}

export function CustomForm({ data, onChange }) {
  const items = (data.items || []).map(normalizeItem);

  function setItem(i, patch) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange({ ...data, items: next });
  }
  function setItemType(i, bodyType) {
    setItem(i, { bodyType });
  }
  function addItem() {
    onChange({ ...data, items: [...items, defaultCustomItem()] });
  }
  function removeItem(i) {
    onChange({ ...data, items: items.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Section title</span>
        <input
          className="ed-input"
          value={data.title || ''}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
          placeholder="e.g. Certifications"
        />
      </label>

      <div className="ed-field">
        <span>Items</span>
        {items.map((item, i) => (
          <div className="ed-custom-item" key={i}>
            <div className="ed-field-row">
              <input
                className="ed-input ed-input-flex"
                value={item.heading || ''}
                onChange={(e) => setItem(i, { heading: e.target.value })}
                placeholder="Optional item heading"
              />
              <select
                className="ed-input ed-field-narrow"
                value={item.bodyType || 'text'}
                onChange={(e) => setItemType(i, e.target.value)}
              >
                {CUSTOM_BODY_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" className="ed-icon-btn" onClick={() => removeItem(i)} aria-label="Remove item">
                ✕
              </button>
            </div>
            <ItemBodyFields item={item} onChange={(patch) => setItem(i, patch)} />
          </div>
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addItem}>
          + Add item
        </button>
      </div>
    </div>
  );
}
