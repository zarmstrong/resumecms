import { PhotoUpload } from './PhotoUpload.jsx';
import { LinksEditor } from './LinksEditor.jsx';

// Where a card's resume stands for visitors: shown, or why not. `context`
// lists the resumes a card can link to now (public and published).
function cardStatus(resumeId, resumes, context) {
  if (context.resumes.some((r) => r.id === resumeId)) return null;
  const resume = resumes.find((r) => r.id === resumeId);
  if (!resume) return 'Deleted: not shown';
  if (!resume.isPublic) return 'Private: not shown until it is made public';
  return 'Not shown until it is published';
}

// The landing page's fields (issue #70). `landing` is the draft, `context`
// and `limits` come from GET /api/landing, `resumes` is the editor's list.
export function LandingForm({ landing, resumes, context, limits, onChange }) {
  const set = (patch) => onChange({ ...landing, ...patch });
  const cards = landing.resumes;
  const setCard = (i, patch) => set({ resumes: cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const moveCard = (i, delta) => {
    const next = [...cards];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    set({ resumes: next });
  };
  const addable = resumes.filter((r) => !cards.some((c) => c.resumeId === r.id));
  const titleOf = (resumeId) => context.resumes.find((r) => r.id === resumeId)?.title;

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Headline</span>
        <input
          className="ed-input"
          value={landing.headline}
          maxLength={limits?.headline}
          onChange={(e) => set({ headline: e.target.value })}
          placeholder="Your name"
        />
      </label>
      <label className="ed-field">
        <span>Subheadline</span>
        <input
          className="ed-input"
          value={landing.subheadline}
          maxLength={limits?.subheadline}
          onChange={(e) => set({ subheadline: e.target.value })}
          placeholder="e.g. Site reliability engineer"
        />
      </label>
      <label className="ed-field">
        <span>Intro</span>
        <textarea
          className="ed-input"
          rows={5}
          value={landing.intro}
          maxLength={limits?.intro}
          onChange={(e) => set({ intro: e.target.value })}
          placeholder="A few lines about yourself."
        />
        <span className="ed-field-hint">Plain text. Leave a blank line to start a new paragraph.</span>
      </label>

      <div className="ed-field">
        <span>Photo</span>
        <select className="ed-input" value={landing.photo} onChange={(e) => set({ photo: e.target.value })}>
          <option value="resume">The default resume's photo</option>
          <option value="custom">A different photo</option>
          <option value="none">No photo</option>
        </select>
        {landing.photo === 'resume' && !context.photoUrl && (
          <span className="ed-field-hint">The default resume's published header has no photo, so none is shown.</span>
        )}
      </div>
      {landing.photo === 'custom' && (
        <PhotoUpload label="Landing page photo" value={landing.photoUrl} onChange={(photoUrl) => set({ photoUrl })} />
      )}

      <LinksEditor links={landing.links} onChange={(links) => set({ links })} />

      <div className="ed-field">
        <span>Resumes</span>
        <span className="ed-field-hint">
          Cards linking to your resumes. Only public, published ones are shown; the default links to /resume.
        </span>
        {cards.map((card, i) => {
          const resume = resumes.find((r) => r.id === card.resumeId);
          const status = cardStatus(card.resumeId, resumes, context);
          return (
            <div className="ed-landing-card" key={card.resumeId}>
              <div className="ed-landing-card-head">
                <strong>{resume ? resume.name : 'Deleted resume'}</strong>
                <span className="ed-landing-card-actions">
                  <button type="button" className="ed-icon-btn" onClick={() => moveCard(i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ed-icon-btn"
                    onClick={() => moveCard(i, 1)}
                    disabled={i === cards.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ed-icon-btn"
                    onClick={() => set({ resumes: cards.filter((_, idx) => idx !== i) })}
                    aria-label="Remove card"
                  >
                    ✕
                  </button>
                </span>
              </div>
              {status && <span className="ed-field-hint ed-landing-card-status">{status}</span>}
              <input
                className="ed-input"
                value={card.label}
                maxLength={limits?.cardLabel}
                onChange={(e) => setCard(i, { label: e.target.value })}
                placeholder={titleOf(card.resumeId) || 'Card title, e.g. Engineering'}
                aria-label="Card title"
              />
              <textarea
                className="ed-input"
                rows={2}
                value={card.blurb}
                maxLength={limits?.blurb}
                onChange={(e) => setCard(i, { blurb: e.target.value })}
                placeholder="A line about this resume (optional)"
                aria-label="Card text"
              />
            </div>
          );
        })}
        {addable.length > 0 && (!limits || cards.length < limits.resumes) && (
          <select
            className="ed-input"
            value=""
            onChange={(e) => e.target.value && set({ resumes: [...cards, { resumeId: e.target.value, label: '', blurb: '' }] })}
            aria-label="Add a resume card"
          >
            <option value="">+ Add a resume…</option>
            {addable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <span className="ed-field-hint">
          A card without a title uses the resume's published header title, never its name here.
        </span>
      </div>
    </div>
  );
}
