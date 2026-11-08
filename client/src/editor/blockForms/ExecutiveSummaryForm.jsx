// Highlights are stored as an array of lines but edited as one textarea.
// Blank lines are kept while typing (so Enter starts a new highlight) and
// skipped when rendering.
export function ExecutiveSummaryForm({ data, onChange }) {
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Headline</span>
        <input
          className="ed-input"
          value={data.headline || ''}
          onChange={(e) => onChange({ ...data, headline: e.target.value })}
          placeholder="e.g. Engineering leader who scales platform teams"
        />
      </label>
      <label className="ed-field">
        <span>Overview</span>
        <textarea
          className="ed-textarea"
          rows={4}
          value={data.text || ''}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          placeholder="A short overview of your career and the value you bring."
        />
      </label>
      <label className="ed-field">
        <span>Key highlights</span>
        <textarea
          className="ed-textarea"
          rows={4}
          value={highlights.join('\n')}
          onChange={(e) => onChange({ ...data, highlights: e.target.value.split('\n') })}
          placeholder="One highlight per line, e.g. Grew the platform team from 6 to 40 engineers"
        />
      </label>
    </div>
  );
}
