export function SkillsGroupForm({ data, onChange }) {
  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Category label</span>
        <input
          className="ed-input"
          value={data.category || ''}
          onChange={(e) => onChange({ ...data, category: e.target.value })}
          placeholder="e.g. Technologies"
        />
      </label>
      <label className="ed-field">
        <span>Items</span>
        <textarea
          className="ed-textarea"
          rows={2}
          value={data.items || ''}
          onChange={(e) => onChange({ ...data, items: e.target.value })}
          placeholder="Comma-separated list"
        />
      </label>
    </div>
  );
}
