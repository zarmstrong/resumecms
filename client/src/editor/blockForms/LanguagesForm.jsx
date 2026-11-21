import { useId } from 'react';
import { LEVEL_SUGGESTIONS } from '../../resume/languages.js';

// A languages block (issue #217): the whole list in one block, each language
// with an optional level shown as written.
export function LanguagesForm({ data, onChange }) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const listId = useId();

  function setEntry(i, patch) {
    const next = entries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry));
    onChange({ ...data, entries: next });
  }
  function addEntry() {
    onChange({ ...data, entries: [...entries, { language: '', level: '' }] });
  }
  function removeEntry(i) {
    onChange({ ...data, entries: entries.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="ed-form">
      <datalist id={listId}>
        {LEVEL_SUGGESTIONS.map((level) => (
          <option key={level} value={level} />
        ))}
      </datalist>
      <div className="ed-field">
        <span>Languages</span>
        {entries.map((entry, i) => (
          <div className="ed-field-row" key={i}>
            <input
              className="ed-input ed-input-flex"
              aria-label={`Language ${i + 1}`}
              placeholder="e.g. Spanish"
              value={entry.language || ''}
              onChange={(e) => setEntry(i, { language: e.target.value })}
            />
            <input
              className="ed-input ed-field-narrow"
              aria-label={`Level ${i + 1}`}
              placeholder="e.g. Fluent"
              list={listId}
              value={entry.level || ''}
              onChange={(e) => setEntry(i, { level: e.target.value })}
            />
            <button
              type="button"
              className="ed-icon-btn"
              onClick={() => removeEntry(i)}
              aria-label={`Remove ${entry.language || 'language'}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addEntry}>
          + Add language
        </button>
      </div>
      <span className="ed-field-hint">A language left empty isn&apos;t shown. The level is shown as written.</span>
    </div>
  );
}
