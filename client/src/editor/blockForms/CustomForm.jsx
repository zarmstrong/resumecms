import { CUSTOM_BODY_TYPES, defaultCustomItem } from '../blockDefaults.js';
import { targetKey } from '../aiReview.js';
import { useRowPanelOpen } from '../useRowPanelOpen.js';
import { patchCustomItem } from '../../resume/customItems.js';

const DEFAULT_TAG_COLOR = '#2f6f4e';

// Legacy items were saved as `{ heading, body }` with no bodyType.
function normalizeItem(item) {
  if (item.bodyType) return item;
  return { ...item, bodyType: 'text', text: item.body };
}

function TagColorField({ item, name, onChange }) {
  const enabled = Boolean(item.tagColor);
  return (
    <label className="ed-color-field">
      <span className="ed-color-field-label ed-color-field-toggle">
        <input
          type="checkbox"
          checked={enabled}
          aria-label={`${name} custom tag color`}
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
            aria-label={`${name} tag color`}
          />
          <input
            className="ed-input"
            value={item.tagColor}
            onChange={(e) => onChange({ tagColor: e.target.value })}
            aria-label={`${name} tag color, as #rrggbb`}
          />
        </div>
      )}
    </label>
  );
}

function ItemBodyFields({ item, name, onChange }) {
  switch (item.bodyType) {
    case 'list':
      return (
        <textarea
          className="ed-textarea"
          rows={3}
          value={item.items || ''}
          onChange={(e) => onChange({ items: e.target.value })}
          placeholder="One list item per line"
          aria-label={`${name} list, one entry per line`}
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
            aria-label={`${name} link text`}
          />
          <input
            className="ed-input ed-input-flex"
            value={item.url || ''}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://..."
            aria-label={`${name} link URL`}
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
            aria-label={`${name} tags, comma-separated`}
          />
          <TagColorField item={item} name={name} onChange={onChange} />
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
          aria-label={`${name} text`}
        />
      );
  }
}

// One item row. `aiPanel`/`aiEntry` are as in ExperienceForm's bullets: the
// item's rewrite panel opens below its fields when it gets a rewrite, and
// the ✨ button toggles it (useRowPanelOpen).
function CustomItem({ item, index, setItem, setItemType, removeItem, aiPanel, aiEntry }) {
  const [aiOpen, setAiOpen] = useRowPanelOpen(aiEntry);
  const aiShown = Boolean(aiPanel && aiOpen);
  // Each control names its item, since every item has the same ones.
  const name = `Item ${index + 1}`;
  return (
    <div className="ed-custom-item">
      <div className="ed-field-row">
        <input
          className="ed-input ed-input-flex"
          value={item.heading || ''}
          onChange={(e) => setItem(index, { heading: e.target.value })}
          placeholder="Optional item heading"
          aria-label={`${name} heading`}
        />
        <button type="button" className="ed-icon-btn" onClick={() => removeItem(index)} aria-label={`Remove item ${index + 1}`}>
          ✕
        </button>
        {aiPanel && (
          <button
            type="button"
            className={`ed-icon-btn${aiShown ? ' ed-icon-btn-active' : ''}`}
            onClick={() => setAiOpen((open) => !open)}
            aria-label={`Rewrite item ${index + 1} with AI`}
            aria-expanded={aiShown}
            title="Rewrite this item with AI"
          >
            ✨
          </button>
        )}
      </div>
      {/* Its own row, so the heading keeps the first row's full width. */}
      <div className="ed-field-row">
        <input
          className="ed-input ed-input-flex"
          value={item.date || ''}
          onChange={(e) => setItem(index, { date: e.target.value })}
          placeholder="Date"
          aria-label={`${name} date (optional)`}
          title="Optional, e.g. 2021: shown beside the heading"
        />
        <select
          className="ed-input ed-field-narrow"
          value={item.bodyType || 'text'}
          onChange={(e) => setItemType(index, e.target.value)}
          aria-label={`${name} body type`}
        >
          {CUSTOM_BODY_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <ItemBodyFields item={item} name={name} onChange={(patch) => setItem(index, patch)} />
      {aiShown &&
        aiPanel({ kind: 'item', index }, { open: true, onClose: () => setAiOpen(false), className: 'ed-ai-panel-inline' })}
    </div>
  );
}

// `aiPanel`/`aiEntries`: see ExperienceForm.
export function CustomForm({ data, onChange, aiPanel = null, aiEntries = null }) {
  const items = (data.items || []).map(normalizeItem);

  function setItem(i, patch) {
    const next = [...items];
    next[i] = patchCustomItem(next[i], patch);
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
          <CustomItem
            key={i}
            item={item}
            index={i}
            setItem={setItem}
            setItemType={setItemType}
            removeItem={removeItem}
            aiPanel={aiPanel}
            aiEntry={aiEntries?.[targetKey({ kind: 'item', index: i })]}
          />
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addItem}>
          + Add item
        </button>
      </div>
    </div>
  );
}
