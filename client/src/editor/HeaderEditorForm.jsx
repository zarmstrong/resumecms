export function HeaderEditorForm({ header, onChange }) {
  const links = header.links || [];

  function setLink(i, patch) {
    const next = [...links];
    next[i] = { ...next[i], ...patch };
    onChange({ ...header, links: next });
  }
  function addLink() {
    onChange({ ...header, links: [...links, { label: '', url: '' }] });
  }
  function removeLink(i) {
    onChange({ ...header, links: links.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Name</span>
        <input
          className="ed-input"
          value={header.name || ''}
          onChange={(e) => onChange({ ...header, name: e.target.value })}
        />
      </label>
      <label className="ed-field">
        <span>Professional title</span>
        <input
          className="ed-input"
          value={header.title || ''}
          onChange={(e) => onChange({ ...header, title: e.target.value })}
        />
      </label>
      <label className="ed-field">
        <span>Location</span>
        <input
          className="ed-input"
          value={header.location || ''}
          onChange={(e) => onChange({ ...header, location: e.target.value })}
        />
      </label>
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Email</span>
          <input
            className="ed-input"
            value={header.email || ''}
            onChange={(e) => onChange({ ...header, email: e.target.value })}
          />
        </label>
        <label className="ed-field">
          <span>Phone</span>
          <input
            className="ed-input"
            value={header.phone || ''}
            onChange={(e) => onChange({ ...header, phone: e.target.value })}
          />
        </label>
      </div>

      <div className="ed-field">
        <span>Links</span>
        {links.map((link, i) => (
          <div className="ed-field-row" key={i}>
            <input
              className="ed-input"
              value={link.label || ''}
              onChange={(e) => setLink(i, { label: e.target.value })}
              placeholder="Label, e.g. linkedin.com/in/you"
            />
            <input
              className="ed-input"
              value={link.url || ''}
              onChange={(e) => setLink(i, { url: e.target.value })}
              placeholder="https://…"
            />
            <button type="button" className="ed-icon-btn" onClick={() => removeLink(i)} aria-label="Remove link">
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addLink}>
          + Add link
        </button>
      </div>
    </div>
  );
}
