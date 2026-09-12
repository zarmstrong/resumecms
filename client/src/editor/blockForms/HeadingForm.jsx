export function HeadingForm({ data, onChange }) {
  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Heading text</span>
        <input
          className="ed-input"
          value={data.text || ''}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
        />
      </label>
    </div>
  );
}
