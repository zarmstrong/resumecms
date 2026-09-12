export function EducationForm({ data, onChange }) {
  return (
    <div className="ed-form">
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Degree</span>
          <input
            className="ed-input"
            value={data.degree || ''}
            onChange={(e) => onChange({ ...data, degree: e.target.value })}
          />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>Start</span>
          <input
            className="ed-input"
            value={data.startDate || ''}
            onChange={(e) => onChange({ ...data, startDate: e.target.value })}
          />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>End</span>
          <input
            className="ed-input"
            value={data.endDate || ''}
            onChange={(e) => onChange({ ...data, endDate: e.target.value })}
          />
        </label>
      </div>
      <label className="ed-field">
        <span>Institution</span>
        <input
          className="ed-input"
          value={data.institution || ''}
          onChange={(e) => onChange({ ...data, institution: e.target.value })}
        />
      </label>
      <label className="ed-field">
        <span>Location</span>
        <input
          className="ed-input"
          value={data.location || ''}
          onChange={(e) => onChange({ ...data, location: e.target.value })}
        />
      </label>
    </div>
  );
}
