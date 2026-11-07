import { LINK_TYPES, DEFAULT_LINK_TYPE, linkTypeConfig, inferLinkType } from '../resume/linkTypes.js';

// A list of { type, label, url } links: pick a type (which prefills an
// empty label and URL), edit, add, remove. Used by the header form and the
// landing page form (whose links section has a heading of its own, so it
// passes `label={null}`).
export function LinksEditor({ links, onChange, label = 'Links' }) {
  function setLink(i, patch) {
    const next = [...links];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function addLink() {
    onChange([...links, { type: DEFAULT_LINK_TYPE, label: '', url: '' }]);
  }
  function removeLink(i) {
    onChange(links.filter((_, idx) => idx !== i));
  }
  function setLinkType(i, type) {
    const link = links[i];
    const cfg = linkTypeConfig(type);
    const patch = { type };
    if (!link.label) patch.label = cfg.defaultLabel;
    if (!link.url) patch.url = cfg.defaultUrl;
    setLink(i, patch);
  }

  return (
    <div className="ed-field">
      {label && <span>{label}</span>}
      {links.map((link, i) => (
        <div className="ed-link-item" key={i}>
          <select className="ed-input" value={link.type || inferLinkType(link)} onChange={(e) => setLinkType(i, e.target.value)}>
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="ed-field-row">
            <input
              className="ed-input ed-input-flex"
              value={link.label || ''}
              onChange={(e) => setLink(i, { label: e.target.value })}
              placeholder="Label, e.g. linkedin.com/in/you"
            />
            <input
              className="ed-input ed-input-flex"
              value={link.url || ''}
              onChange={(e) => setLink(i, { url: e.target.value })}
              placeholder="https://…"
            />
            <button type="button" className="ed-icon-btn" onClick={() => removeLink(i)} aria-label="Remove link">
              ✕
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="ed-btn ed-btn-ghost" onClick={addLink}>
        + Add link
      </button>
    </div>
  );
}
