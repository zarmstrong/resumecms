import {
  normalizeSiteColors,
  normalizePillPadding,
  normalizeResumeFont,
  normalizeNameFont,
  normalizeFontSize,
  FONT_OPTIONS,
} from '../resume/siteColors.js';
import { normalizeTemplate, TEMPLATE_OPTIONS } from '../resume/templates.js';

const PILL_PADDING_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'snug', label: 'Snug' },
  { value: 'cozy', label: 'Cozy' },
  { value: 'roomy', label: 'Roomy' },
  { value: 'spacious', label: 'Spacious' },
];

const FONT_SIZE_OPTIONS = [
  { value: 'smallest', label: 'Smallest' },
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'largest', label: 'Largest' },
];

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
    hint: 'Solid tag background behind skill category labels (text auto-picks white/dark for contrast)',
    preview: () => '#7a2e2e',
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
    hint: 'Solid tag background behind employment/education dates (text auto-picks white/dark for contrast)',
    preview: () => '#2c5f7c',
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

function NameFontField({ site, onChange }) {
  const siteFont = normalizeResumeFont(site);
  const override = normalizeNameFont(site);
  const matched = !override;

  return (
    <div className="ed-color-field">
      <span className="ed-color-field-label ed-color-field-toggle">
        <input
          type="checkbox"
          checked={matched}
          onChange={(e) => onChange({ ...site, nameFont: e.target.checked ? '' : siteFont })}
        />
        Match site font
      </span>
      <span className="ed-color-field-hint">Name and professional title</span>
      {!matched && (
        <select
          className="ed-input"
          value={override}
          onChange={(e) => onChange({ ...site, nameFont: e.target.value })}
        >
          {FONT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
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

      <label className="ed-field">
        <span>Template</span>
        <select
          className="ed-input"
          value={normalizeTemplate(site)}
          onChange={(e) => onChange({ ...site, template: e.target.value })}
        >
          {TEMPLATE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="ed-field-row">
        <label className="ed-field">
          <span>Font</span>
          <select
            className="ed-input"
            value={normalizeResumeFont(site)}
            onChange={(e) => onChange({ ...site, font: e.target.value })}
          >
            {FONT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="ed-field">
          <span>Font size</span>
          <select
            className="ed-input"
            value={normalizeFontSize(site)}
            onChange={(e) => onChange({ ...site, fontSize: e.target.value })}
          >
            {FONT_SIZE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <NameFontField site={site} onChange={onChange} />

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

      <label className="ed-field">
        <span>Pill padding</span>
        <select
          className="ed-input"
          value={normalizePillPadding(site)}
          onChange={(e) => onChange({ ...site, pillPadding: e.target.value })}
        >
          {PILL_PADDING_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
