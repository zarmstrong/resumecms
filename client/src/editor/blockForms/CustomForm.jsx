export function CustomForm({ data, onChange }) {
  const items = data.items || [];

  function setItem(i, patch) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange({ ...data, items: next });
  }
  function addItem() {
    onChange({ ...data, items: [...items, { heading: '', body: '' }] });
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
                className="ed-input"
                value={item.heading || ''}
                onChange={(e) => setItem(i, { heading: e.target.value })}
                placeholder="Optional item heading"
              />
              <button type="button" className="ed-icon-btn" onClick={() => removeItem(i)} aria-label="Remove item">
                ✕
              </button>
            </div>
            <textarea
              className="ed-textarea"
              rows={2}
              value={item.body || ''}
              onChange={(e) => setItem(i, { body: e.target.value })}
              placeholder="Item detail"
            />
          </div>
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addItem}>
          + Add item
        </button>
      </div>
    </div>
  );
}
