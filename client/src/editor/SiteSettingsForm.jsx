import { normalizeSiteColors } from '../resume/siteColors.js';

const COLOR_FIELDS = [
  { key: 'accent', label: 'Accent', hint: 'Section rules and links' },
  { key: 'heading', label: 'Headings', hint: 'Name, section titles, job titles' },
  { key: 'text', label: 'Body text', hint: 'Paragraphs and bullet points' },
  { key: 'background', label: 'Background', hint: 'Resume page background' },
];

export function SiteSettingsForm({ site, onChange }) {
  const colors = normalizeSiteColors(site);

  function setColor(key, value) {
    onChange({ ...site, colors: { ...colors, [key]: value } });
  }

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Site title</span>
        <input
          className="ed-input"
          value={site.title || ''}
          onChange={(e) => onChange({ ...site, title: e.target.value })}
        />
      </label>

      <div className="ed-color-grid">
        {COLOR_FIELDS.map(({ key, label, hint }) => (
          <label className="ed-color-field" key={key}>
            <span className="ed-color-field-label">{label}</span>
            <span className="ed-color-field-hint">{hint}</span>
            <div className="ed-color-row">
              <input
                type="color"
                className="ed-color-swatch"
                value={colors[key]}
                onChange={(e) => setColor(key, e.target.value)}
                aria-label={`${label} color`}
              />
              <input
                className="ed-input"
                value={colors[key]}
                onChange={(e) => setColor(key, e.target.value)}
              />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
