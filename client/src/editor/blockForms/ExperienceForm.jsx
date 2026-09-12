export function ExperienceForm({ data, onChange }) {
  const bullets = data.bullets || [];

  function setBullet(i, value) {
    const next = [...bullets];
    next[i] = value;
    onChange({ ...data, bullets: next });
  }
  function addBullet() {
    onChange({ ...data, bullets: [...bullets, ''] });
  }
  function removeBullet(i) {
    onChange({ ...data, bullets: bullets.filter((_, idx) => idx !== i) });
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

      <div className="ed-field">
        <span>Bullet points</span>
        {bullets.map((b, i) => (
          <div className="ed-bullet-row" key={i}>
            <textarea
              className="ed-textarea"
              rows={2}
              value={b}
              onChange={(e) => setBullet(i, e.target.value)}
            />
            <button type="button" className="ed-icon-btn" onClick={() => removeBullet(i)} aria-label="Remove bullet">
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addBullet}>
          + Add bullet
        </button>
      </div>
    </div>
  );
}
