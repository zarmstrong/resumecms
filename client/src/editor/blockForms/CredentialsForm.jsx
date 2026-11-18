import { CREDENTIAL_LABELS, credentialHref } from '../../resume/credentials.js';
import { hasPassed, utcToday } from '../../landing/dateText.js';

// One license, certification or membership (issue #206). Its dates are
// free text, shown as written; an expired one stays on the resume, so the
// form says so rather than the resume dropping it.
export function CredentialsForm({ data, onChange }) {
  const set = (field) => (e) => onChange({ ...data, [field]: e.target.value });
  // An unknown or missing kind is drawn as a certification (credentialKindLabel).
  const kind = Object.hasOwn(CREDENTIAL_LABELS, data.kind) ? data.kind : 'certification';

  return (
    <div className="ed-form">
      <label className="ed-field">
        <span>Kind</span>
        <select className="ed-input" value={kind} onChange={set('kind')}>
          {Object.entries(CREDENTIAL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="ed-field">
        <span>Name</span>
        <input className="ed-input" value={data.name || ''} onChange={set('name')} />
      </label>
      <label className="ed-field">
        <span>Issuer</span>
        <input className="ed-input" value={data.issuer || ''} onChange={set('issuer')} />
      </label>
      <label className="ed-field">
        <span>Number</span>
        <input className="ed-input" value={data.number || ''} onChange={set('number')} />
      </label>
      <div className="ed-field-row">
        <label className="ed-field ed-field-narrow">
          <span>Issued</span>
          <input className="ed-input" placeholder="e.g. Mar 2027" value={data.issued || ''} onChange={set('issued')} />
        </label>
        <label className="ed-field ed-field-narrow">
          <span>Expires</span>
          <input className="ed-input" placeholder="e.g. Mar 2027" value={data.expires || ''} onChange={set('expires')} />
        </label>
      </div>
      {hasPassed(data.expires, utcToday()) && (
        <div className="ed-field-hint">This expired on {data.expires}. It&apos;s still shown; update the date or hide this block.</div>
      )}
      <label className="ed-field">
        <span>Verify link (URL)</span>
        <input className="ed-input" value={data.url || ''} onChange={set('url')} />
        {data.url && !credentialHref(data.url) && <span className="ed-field-hint">Only an http or https address is linked.</span>}
      </label>
    </div>
  );
}
