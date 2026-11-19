import { PUBLICATION_LABELS } from '../../resume/publications.js';
import { credentialHref } from '../../resume/credentials.js';
import { cleanDoi, isDoi } from '../../landing/publications.js';

// One published work or appearance (issue #214). Its title links to the
// link, or to the DOI's doi.org address when there's no link; its date is
// shown as written.
export function PublicationsForm({ data, onChange }) {
  const set = (field) => (e) => onChange({ ...data, [field]: e.target.value });
  // An unknown or missing kind is drawn as an article (publicationKindLabel).
  const kind = Object.hasOwn(PUBLICATION_LABELS, data.kind) ? data.kind : 'article';

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Kind</span>
        <select className="ed-input" value={kind} onChange={set('kind')}>
          {Object.entries(PUBLICATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="ed-field">
        <span>Title</span>
        <input className="ed-input" value={data.title || ''} onChange={set('title')} />
      </label>
      <label className="ed-field">
        <span>Outlet</span>
        <input className="ed-input" placeholder="e.g. a journal, publisher or event" value={data.outlet || ''} onChange={set('outlet')} />
      </label>
      <label className="ed-field">
        <span>Date</span>
        <input className="ed-input" placeholder="e.g. Mar 2024" value={data.date || ''} onChange={set('date')} />
        <span className="ed-field-hint">Shown as written. The Academic CV layout puts it in its date column.</span>
      </label>
      <label className="ed-field">
        <span>Link (URL)</span>
        <input className="ed-input" value={data.url || ''} onChange={set('url')} />
        {data.url && !credentialHref(data.url) && <span className="ed-field-hint">Only an http or https address is linked.</span>}
      </label>
      <label className="ed-field">
        <span>DOI</span>
        <input className="ed-input" value={data.doi || ''} onChange={(e) => onChange({ ...data, doi: cleanDoi(e.target.value) })} />
        {data.doi?.trim() && !isDoi(data.doi) && <span className="ed-field-hint">Not a DOI yet: one looks like 10.1234/abcd.</span>}
      </label>
      <label className="ed-field">
        <span>Note</span>
        <input className="ed-input" placeholder="e.g. with A. Author; invited; keynote" value={data.note || ''} onChange={set('note')} />
      </label>
    </div>
  );
}
