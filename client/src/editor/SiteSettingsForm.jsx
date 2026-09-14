import { useState } from 'react';
import {
  normalizeSiteColors,
  normalizePillPadding,
  normalizeResumeFont,
  normalizeNameFont,
  normalizeFontSize,
  normalizeLineSpacing,
  normalizeFontWeight,
  normalizeBulletStyle,
  FONT_OPTIONS,
} from '../resume/siteColors.js';
import { normalizeTemplate, normalizeLayout, getHeaderTemplate, getLayoutTemplate } from '../resume/templateRegistry.js';
import { TemplatePickerModal } from './TemplatePickerModal.jsx';

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

const LINE_SPACING_OPTIONS = [
  { value: 'tight', label: 'Tight' },
  { value: 'snug', label: 'Snug' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'loose', label: 'Loose' },
];

const FONT_WEIGHT_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'medium', label: 'Medium' },
];

const BULLET_STYLE_OPTIONS = [
  { value: 'disc', label: 'Disc (•)' },
  { value: 'circle', label: 'Circle (◦)' },
  { value: 'square', label: 'Square (▪)' },
  { value: 'dash', label: 'Dash (–)' },
  { value: 'arrow', label: 'Arrow (→)' },
  { value: 'none', label: 'None' },
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
  {
    key: 'sidebarBackground',
    label: 'Sidebar background',
    hint: 'Only used by the Sidebar body layout — overrides its automatic accent-tinted background',
    preview: () => '#eef2ea',
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

export function SiteSettingsForm({ header, site, blocks, onChange }) {
  const colors = normalizeSiteColors(site);
  const [pickerOpen, setPickerOpen] = useState(false);

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
        <div className="ed-template-summary">
          <span className="ed-template-summary-text">
            {getHeaderTemplate(normalizeTemplate(site)).label} header + {getLayoutTemplate(normalizeLayout(site)).label} layout
          </span>
          <button type="button" className="ed-btn ed-btn-ghost ed-btn-sub" onClick={() => setPickerOpen(true)}>
            Change template…
          </button>
        </div>
      </label>

      {pickerOpen && (
        <TemplatePickerModal
          header={header}
          site={site}
          blocks={blocks}
          onChange={onChange}
          onClose={() => setPickerOpen(false)}
        />
      )}

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

        <label className="ed-field">
          <span>Font weight</span>
          <select
            className="ed-input"
            value={normalizeFontWeight(site)}
            onChange={(e) => onChange({ ...site, fontWeight: e.target.value })}
          >
            {FONT_WEIGHT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="ed-field">
          <span>Line spacing</span>
          <select
            className="ed-input"
            value={normalizeLineSpacing(site)}
            onChange={(e) => onChange({ ...site, lineSpacing: e.target.value })}
          >
            {LINE_SPACING_OPTIONS.map(({ value, label }) => (
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
        Optional accent overrides
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

      <div className="ed-field-row">
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

        <label className="ed-field">
          <span>Bullet style</span>
          <select
            className="ed-input"
            value={normalizeBulletStyle(site)}
            onChange={(e) => onChange({ ...site, bulletStyle: e.target.value })}
          >
            {BULLET_STYLE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
