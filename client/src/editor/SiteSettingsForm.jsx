import { normalizeSiteColors } from '../resume/siteColors.js';

const COLOR_FIELDS = [
  { key: 'accent', label: 'Accent', hint: 'Section rules and links' },
  { key: 'heading', label: 'Headings', hint: 'Name, section titles, job titles' },
  { key: 'text', label: 'Body text', hint: 'Paragraphs and bullet points' },
  { key: 'background', label: 'Background', hint: 'Resume page background' },
];

// Optional per-element overrides — unset by default, so leaving these alone
// changes nothing. `preview` seeds a sensible starting color the first time
// a field is switched on.
const OPTIONAL_COLOR_FIELDS = [
  {
    key: 'skillsCategoryText',
    label: 'Skills category text',
    hint: 'Overrides the accent color for skill category labels',
    preview: (colors) => colors.accent,
  },
  {
    key: 'skillsCategoryPill',
    label: 'Skills category pill',
    hint: 'Badge background behind skill category labels',
    preview: () => '#e7f0ea',
  },
  {
    key: 'datesText',
    label: 'Employment dates text',
    hint: 'Overrides the default color for experience/education dates',
    preview: () => '#5b6472',
  },
  {
    key: 'datesPill',
    label: 'Employment dates pill',
    hint: 'Badge background behind employment/education dates',
    preview: () => '#eef0f3',
  },
];

function OptionalColorField({ label, hint, value, onChange, previewValue }) {
  const enabled = Boolean(value);
  return (
    <label className="ed-color-field">
      <span className="ed-color-field-label ed-color-field-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? previewValue : '')}
        />
        {label}
      </span>
      <span className="ed-color-field-hint">{hint}</span>
      {enabled && (
        <div className="ed-color-row">
          <input
            type="color"
            className="ed-color-swatch"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} color`}
          />
          <input className="ed-input" value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      )}
    </label>
  );
}

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

      <div className="ed-panel-label" style={{ padding: '6px 0 0' }}>
        Skills &amp; dates accents
      </div>
      <div className="ed-color-grid">
        {OPTIONAL_COLOR_FIELDS.map(({ key, label, hint, preview }) => (
          <OptionalColorField
            key={key}
            label={label}
            hint={hint}
            value={colors[key]}
            previewValue={preview(colors)}
            onChange={(value) => setColor(key, value)}
          />
        ))}
      </div>
    </div>
  );
}
