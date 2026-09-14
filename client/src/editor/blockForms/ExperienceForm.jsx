import { useState } from 'react';
import { MAX_BULLET_DEPTH, normalizeBullet } from '../../resume/bulletUtils.js';
import { VisibilityToggle } from '../VisibilityToggle.jsx';

function newBullet(text = '') {
  return { text, visibleWeb: true, visiblePrint: true, children: [] };
}

// `path` addresses a bullet by index at each nesting level, e.g. [1] is the
// second top-level bullet, [1, 0] is its first sub-bullet.
function updateAtPath(list, path, update) {
  const [idx, ...rest] = path;
  return list.map((b, i) => {
    if (i !== idx) return b;
    return rest.length === 0 ? update(b) : { ...b, children: updateAtPath(b.children, rest, update) };
  });
}

function removeAtPath(list, path) {
  const [idx, ...rest] = path;
  if (rest.length === 0) return list.filter((_, i) => i !== idx);
  return list.map((b, i) => (i === idx ? { ...b, children: removeAtPath(b.children, rest) } : b));
}

export function ExperienceForm({ data, onChange }) {
  const bullets = (data.bullets || []).map((b) => normalizeBullet(b));
  const [importText, setImportText] = useState(null); // null = import panel hidden

  function updateBullets(next) {
    onChange({ ...data, bullets: next });
  }
  function patchBullet(path, patch) {
    updateBullets(updateAtPath(bullets, path, (b) => ({ ...b, ...patch })));
  }
  function addBullet() {
    updateBullets([...bullets, newBullet()]);
  }
  function addSubBullet(path) {
    updateBullets(updateAtPath(bullets, path, (b) => ({ ...b, children: [...b.children, newBullet()] })));
  }
  function removeBullet(path) {
    updateBullets(removeAtPath(bullets, path));
  }
  const importLines = (importText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  function importBullets() {
    if (importLines.length === 0) return;
    updateBullets([...bullets, ...importLines.map((text) => newBullet(text))]);
    setImportText(null);
  }

  return (
    <div className="ed-form">
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Job title</span>
          <input
            className="ed-input"
            value={data.jobTitle || ''}
            onChange={(e) => onChange({ ...data, jobTitle: e.target.value })}
          />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>Start</span>
          <input
            className="ed-input"
            value={data.startDate || ''}
            onChange={(e) => onChange({ ...data, startDate: e.target.value })}
            placeholder="2022"
          />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>End</span>
          <input
            className="ed-input"
            value={data.endDate || ''}
            onChange={(e) => onChange({ ...data, endDate: e.target.value })}
            placeholder="Current"
          />
        </label>
      </div>

      <div className="ed-field-row">
        <label className="ed-field">
          <span>Company</span>
          <input
            className="ed-input"
            value={data.company || ''}
            onChange={(e) => onChange({ ...data, company: e.target.value })}
          />
        </label>
        <label className="ed-field">
          <span>Company URL</span>
          <input
            className="ed-input"
            value={data.companyUrl || ''}
            onChange={(e) => onChange({ ...data, companyUrl: e.target.value })}
            placeholder="https://…"
          />
        </label>
      </div>

      <label className="ed-field">
        <span>Location</span>
        <input
          className="ed-input"
          value={data.location || ''}
          onChange={(e) => onChange({ ...data, location: e.target.value })}
        />
      </label>

      <label className="ed-field">
        <span>Tagline (what the company does)</span>
        <input
          className="ed-input"
          value={data.tagline || ''}
          onChange={(e) => onChange({ ...data, tagline: e.target.value })}
        />
      </label>

      <label className="ed-field">
        <span>Description (optional)</span>
        <textarea
          className="ed-textarea"
          rows={3}
          value={data.description || ''}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
          placeholder="A short blurb about the role, shown above the bullet points"
        />
      </label>

      <div className="ed-field">
        <span>Bullet points</span>
        {bullets.map((b, i) => (
          <BulletEditor
            key={i}
            bullet={b}
            path={[i]}
            patchBullet={patchBullet}
            addSubBullet={addSubBullet}
            removeBullet={removeBullet}
          />
        ))}
        <div className="ed-bullet-actions">
          <button type="button" className="ed-btn ed-btn-ghost" onClick={addBullet}>
            + Add bullet
          </button>
          <button
            type="button"
            className="ed-btn ed-btn-ghost"
            onClick={() => setImportText(importText === null ? '' : null)}
          >
            {importText === null ? 'Import bullets' : 'Cancel import'}
          </button>
        </div>
        {importText !== null && (
          <div className="ed-bullet-import">
            <textarea
              className="ed-textarea"
              rows={6}
              placeholder="Paste bullet points here, one per line…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              autoFocus
            />
            <div className="ed-bullet-import-hint">
              Each line becomes its own bullet. Nested sub-bullets aren't supported here — add
              those individually below.
            </div>
            <button
              type="button"
              className="ed-btn ed-btn-primary"
              disabled={importLines.length === 0}
              onClick={importBullets}
            >
              Add {importLines.length || ''} bullet{importLines.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BulletEditor({ bullet, path, patchBullet, addSubBullet, removeBullet }) {
  const depth = path.length - 1;
  return (
    <div className="ed-bullet">
      <div className={`ed-bullet-row ed-bullet-depth-${depth}`}>
        <textarea
          className="ed-textarea"
          rows={2}
          value={bullet.text}
          onChange={(e) => patchBullet(path, { text: e.target.value })}
        />
        <div className="ed-visibility-toggles">
          <VisibilityToggle
            label="Web"
            active={bullet.visibleWeb}
            onClick={() => patchBullet(path, { visibleWeb: !bullet.visibleWeb })}
          />
          <VisibilityToggle
            label="Print/PDF"
            active={bullet.visiblePrint}
            onClick={() => patchBullet(path, { visiblePrint: !bullet.visiblePrint })}
          />
        </div>
        <button type="button" className="ed-icon-btn" onClick={() => removeBullet(path)} aria-label="Remove bullet">
          ✕
        </button>
      </div>
      <div className="ed-bullet-children">
        {bullet.children.map((child, i) => (
          <BulletEditor
            key={i}
            bullet={child}
            path={[...path, i]}
            patchBullet={patchBullet}
            addSubBullet={addSubBullet}
            removeBullet={removeBullet}
          />
        ))}
        {depth < MAX_BULLET_DEPTH && (
          <button type="button" className="ed-btn ed-btn-ghost ed-btn-sub" onClick={() => addSubBullet(path)}>
            + Add sub-bullet
          </button>
        )}
      </div>
    </div>
  );
}
