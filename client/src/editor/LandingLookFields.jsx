import { useEffect, useState } from 'react';
import { DEFAULT_SITE_COLORS, FONT_OPTIONS, normalizeResumeFont } from '../resume/siteColors.js';
import { getLandingTemplate } from '../resume/templateRegistry.js';
import { DEFAULT_DARK_COLORS, LANDING_COLOR_KEYS, isHexColor, ownStyleFrom } from '../landing/landingStyle.js';
import { LandingTemplatePicker } from './LandingTemplatePicker.jsx';

const COLOR_FIELDS = {
  accent: { label: 'Accent', hint: 'Buttons, links and the subheadline' },
  heading: { label: 'Headings', hint: 'The headline and section headings' },
  text: { label: 'Body text', hint: 'Paragraphs and lists' },
  background: { label: 'Background', hint: 'The page' },
};

const EMPTY_STYLE = { source: 'resume', colors: { accent: '', heading: '', text: '', background: '' }, font: '', nameFont: '' };

// One color: the swatch, and the hex typed beside it, which is only kept
// once it's a whole #rrggbb (the server refuses anything else), so a
// half-typed one never fails the save. `defaultValue` is what '' is drawn
// as.
function ColorField({ label, hint, value, defaultValue, onChange }) {
  const shown = value || defaultValue;
  const [typed, setTyped] = useState(shown);
  useEffect(() => setTyped(shown), [shown]);
  return (
    <label className="ed-color-field">
      <span className="ed-color-field-label">{label}</span>
      <span className="ed-color-field-hint">{hint}</span>
      <div className="ed-color-row">
        <input
          type="color"
          className="ed-color-swatch"
          value={shown}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-label={`${label} color`}
        />
        <input
          className="ed-input"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (isHexColor(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setTyped(shown)}
          aria-label={`${label} color, as #rrggbb`}
        />
      </div>
    </label>
  );
}

function ColorFields({ colors, defaults, onChange, what }) {
  return (
    <div className="ed-color-grid">
      {LANDING_COLOR_KEYS.map((key) => (
        <ColorField
          key={key}
          label={what ? `${what} ${COLOR_FIELDS[key].label.toLowerCase()}` : COLOR_FIELDS[key].label}
          hint={COLOR_FIELDS[key].hint}
          value={colors?.[key] || ''}
          defaultValue={defaults[key]}
          onChange={(value) => onChange({ ...colors, [key]: value })}
        />
      ))}
    </div>
  );
}

// The landing page's look (issue #93), a collapsed group in its form: the
// template that arranges it, whose colors and fonts it's drawn in (the
// default resume's published ones, or its own), and an optional dark
// palette. `site` is the default resume's published site settings
// (GET /api/landing's context). `onApply` copies the page's own colors and
// fonts into that resume's draft (LandingEditorPage's handleApplyStyle),
// `applyState` says how that went. The template is picked from thumbnails
// of the page (LandingTemplatePicker, issue #130), drawn from `preview`
// ({ draft, context, scheme }: what the editor's preview draws) only while
// the group is open.
export function LandingLookFields({ landing, site, onChange, onApply, applyState, preview }) {
  const [open, setOpen] = useState(false);
  const style = { ...EMPTY_STYLE, ...landing.style };
  const template = getLandingTemplate(landing.template);
  const own = style.source === 'custom';
  const setStyle = (next) => onChange({ style: next });
  const summary = `${template?.label ?? 'Classic'} · ${own ? 'its own colors' : "the default resume's colors"}${style.darkColors ? ' · dark palette' : ''}`;

  return (
    <details className="ed-collapsible" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Look <span className="ed-collapsible-summary">{summary}</span>
      </summary>
      <div className="ed-collapsible-body">
        <LandingTemplatePicker
          value={template?.id ?? 'classic'}
          onChange={(id) => onChange({ template: id })}
          draft={preview?.draft ?? landing}
          context={preview?.context}
          scheme={preview?.scheme}
          open={open}
        />

        <label className="ed-field">
          <span>Colors and fonts</span>
          <select
            className="ed-input"
            value={style.source}
            onChange={(e) => setStyle(e.target.value === 'custom' ? ownStyleFrom(style, site) : { ...style, source: 'resume' })}
          >
            <option value="resume">The default resume's, as published</option>
            <option value="custom">This page's own</option>
          </select>
          <span className="ed-field-hint">
            {own
              ? 'Chosen here, for this page only. They start out as the default resume’s.'
              : 'The same as your default resume’s published site settings, so the two pages match.'}
          </span>
        </label>

        {own && (
          <>
            <div className="ed-field-row">
              <label className="ed-field">
                <span>Font</span>
                <select
                  className="ed-input"
                  value={normalizeResumeFont(style)}
                  onChange={(e) => setStyle({ ...style, font: e.target.value })}
                >
                  {FONT_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ed-field">
                <span>Headline and headings font</span>
                <select className="ed-input" value={style.nameFont} onChange={(e) => setStyle({ ...style, nameFont: e.target.value })}>
                  <option value="">Match the font</option>
                  {FONT_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ColorFields colors={style.colors} defaults={DEFAULT_SITE_COLORS} onChange={(colors) => setStyle({ ...style, colors })} />
            <div className="ed-field">
              <button type="button" className="ed-btn ed-btn-ghost ed-btn-sub" onClick={onApply} disabled={applyState?.status === 'applying'}>
                {applyState?.status === 'applying' ? 'Applying…' : 'Apply to the default resume…'}
              </button>
              <span className="ed-field-hint">
                {applyState?.status === 'applied'
                  ? applyState.message
                  : "Copies these colors and fonts into your default resume's site settings (not the dark palette). Its other settings stay as they are."}
              </span>
              {applyState?.status === 'error' && <span className="ed-field-hint ed-landing-card-status">{applyState.message}</span>}
            </div>
          </>
        )}

        <label className="ed-field ed-checkbox-field">
          <input
            type="checkbox"
            checked={Boolean(style.darkColors)}
            onChange={(e) => {
              const { darkColors: _dropped, ...rest } = style;
              setStyle(e.target.checked ? { ...rest, darkColors: { ...DEFAULT_DARK_COLORS } } : rest);
            }}
          />
          <span>Add a dark palette</span>
        </label>
        <span className="ed-field-hint">
          Shown instead to visitors whose phone or computer is set to dark mode, whichever colors the page uses otherwise (a
          resume has no dark palette to take one from). Switch the preview between light and dark above it.
        </span>
        {style.darkColors && (
          <ColorFields colors={style.darkColors} defaults={DEFAULT_DARK_COLORS} what="Dark" onChange={(darkColors) => setStyle({ ...style, darkColors })} />
        )}
      </div>
    </details>
  );
}
