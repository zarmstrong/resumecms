import { LINK_TYPE_GROUPS, DEFAULT_LINK_TYPE, linkTypeConfig, inferLinkType, followLabelUrl } from '../resume/linkTypes.js';

// A list of { type, label, url } links: pick a type (which prefills an
// empty label and URL), edit, add, remove. An email or phone link's URL is
// built from its label as it's typed, until the URL is edited by hand. Used by the header form and the
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
  function setLabel(i, label) {
    const url = followLabelUrl(links[i], label);
    setLink(i, url === undefined ? { label } : { label, url });
  }
  function setLinkType(i, type) {
    const link = links[i];
    const cfg = linkTypeConfig(type);
    const patch = { type };
    if (!link.label) patch.label = cfg.defaultLabel;
    if (!link.url) patch.url = link.label && cfg.urlFromLabel ? cfg.urlFromLabel(link.label) : cfg.defaultUrl;
    setLink(i, patch);
  }

  return (
    <div className="ed-field">
      {label && <span>{label}</span>}
      {links.map((link, i) => {
        const type = inferLinkType(link);
        const placeholders = PLACEHOLDERS[type] || placeholdersFor(type);
        return (
          <div className="ed-link-item" key={i}>
            <select className="ed-input" value={link.type || type} onChange={(e) => setLinkType(i, e.target.value)}>
              {LINK_TYPE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.types.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="ed-field-row">
              <input
                className="ed-input ed-input-flex"
                value={link.label || ''}
                onChange={(e) => setLabel(i, e.target.value)}
                placeholder={placeholders.label}
              />
              <input
                className="ed-input ed-input-flex"
                value={link.url || ''}
                onChange={(e) => setLink(i, { url: e.target.value })}
                placeholder={placeholders.url}
              />
              <button type="button" className="ed-icon-btn" onClick={() => removeLink(i)} aria-label="Remove link">
                ✕
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" className="ed-btn ed-btn-ghost" onClick={addLink}>
        + Add link
      </button>
    </div>
  );
}

const PLACEHOLDERS = {
  email: { label: 'Email address, e.g. you@example.com', url: 'mailto:…' },
  phone: { label: 'Phone number, e.g. +1 555 555 0100', url: 'tel:…' },
};

// Any other type suggests a label like its own default (Custom has none).
function placeholdersFor(type) {
  const example = linkTypeConfig(type).defaultLabel;
  return { label: example ? `Label, e.g. ${example}` : 'Label', url: 'https://…' };
}
