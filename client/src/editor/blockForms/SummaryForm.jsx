export function SummaryForm({ data, onChange }) {
  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Summary</span>
        <textarea
          className="ed-textarea"
          rows={4}
          value={data.text || ''}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          placeholder="A brief summary of your professional background and goals."
        />
      </label>
    </div>
  );
}
