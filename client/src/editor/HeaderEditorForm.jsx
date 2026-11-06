import { PhotoUpload } from './PhotoUpload.jsx';
import { LinksEditor } from './LinksEditor.jsx';

export function HeaderEditorForm({ header, onChange }) {
  return (
    <div className="ed-form">
      <PhotoUpload label="Headshot (optional)" value={header.photoUrl || ''} onChange={(photoUrl) => onChange({ ...header, photoUrl })} />
      <label className="ed-field">
        <span>Name</span>
        <input
          className="ed-input"
          value={header.name || ''}
          onChange={(e) => onChange({ ...header, name: e.target.value })}
        />
      </label>
      <label className="ed-field">
        <span>Professional title</span>
        <input
          className="ed-input"
          value={header.title || ''}
          onChange={(e) => onChange({ ...header, title: e.target.value })}
        />
      </label>
      <label className="ed-field">
        <span>Subtitle (optional)</span>
        <input
          className="ed-input"
          value={header.subtitle || ''}
          onChange={(e) => onChange({ ...header, subtitle: e.target.value })}
          placeholder="e.g. Infrastructure, SRE, DevOps & AI Automation"
        />
      </label>
      <label className="ed-field">
        <span>Location</span>
        <input
          className="ed-input"
          value={header.location || ''}
          onChange={(e) => onChange({ ...header, location: e.target.value })}
        />
      </label>
      <div className="ed-field-row">
        <label className="ed-field">
          <span>Email</span>
          <input
            className="ed-input"
            value={header.email || ''}
            onChange={(e) => onChange({ ...header, email: e.target.value })}
          />
        </label>
        <label className="ed-field">
          <span>Phone</span>
          <input
            className="ed-input"
            value={header.phone || ''}
            onChange={(e) => onChange({ ...header, phone: e.target.value })}
          />
        </label>
      </div>

      <LinksEditor links={header.links || []} onChange={(links) => onChange({ ...header, links })} />
    </div>
  );
}
