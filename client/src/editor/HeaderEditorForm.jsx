import { useState } from 'react';
import { LINK_TYPES, DEFAULT_LINK_TYPE, linkTypeConfig, inferLinkType } from '../resume/linkTypes.js';
import { PhotoCropper } from './PhotoCropper.jsx';

export function HeaderEditorForm({ header, onChange }) {
  const links = header.links || [];
  const [photoError, setPhotoError] = useState('');
  const [cropImageUrl, setCropImageUrl] = useState(null); // object URL of the file being cropped, or null

  function handlePhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file if they pick it again
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }
    setPhotoError('');
    setCropImageUrl(URL.createObjectURL(file));
  }

  function closeCropper() {
    URL.revokeObjectURL(cropImageUrl);
    setCropImageUrl(null);
  }

  function handleCropConfirm(photoUrl) {
    closeCropper();
    onChange({ ...header, photoUrl });
  }

  function removePhoto() {
    setPhotoError('');
    onChange({ ...header, photoUrl: '' });
  }

  function setLink(i, patch) {
    const next = [...links];
    next[i] = { ...next[i], ...patch };
    onChange({ ...header, links: next });
  }
  function addLink() {
    onChange({ ...header, links: [...links, { type: DEFAULT_LINK_TYPE, label: '', url: '' }] });
  }
  function removeLink(i) {
    onChange({ ...header, links: links.filter((_, idx) => idx !== i) });
  }
  function setLinkType(i, type) {
    const link = links[i];
    const cfg = linkTypeConfig(type);
    const patch = { type };
    if (!link.label) patch.label = cfg.defaultLabel;
    if (!link.url) patch.url = cfg.defaultUrl;
    setLink(i, patch);
  }

  return (
    <div className="ed-form">
      <div className="ed-field">
        <span>Headshot (optional)</span>
        <div className="ed-photo-row">
          {header.photoUrl ? (
            <img className="ed-photo-preview" src={header.photoUrl} alt="" />
          ) : (
            <div className="ed-photo-preview ed-photo-preview-empty" />
          )}
          <div className="ed-photo-actions">
            <label className="ed-btn ed-btn-ghost">
              {header.photoUrl ? 'Replace photo' : 'Upload photo'}
              <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
            </label>
            {header.photoUrl && (
              <button type="button" className="ed-btn ed-btn-ghost" onClick={removePhoto}>
                Remove
              </button>
            )}
          </div>
        </div>
        {photoError && <div className="ed-field-error">{photoError}</div>}
        {cropImageUrl && (
          <PhotoCropper imageUrl={cropImageUrl} onCancel={closeCropper} onConfirm={handleCropConfirm} />
        )}
      </div>
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

      <div className="ed-field">
        <span>Links</span>
        {links.map((link, i) => (
          <div className="ed-link-item" key={i}>
            <select
              className="ed-input"
              value={link.type || inferLinkType(link)}
              onChange={(e) => setLinkType(i, e.target.value)}
            >
              {LINK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="ed-field-row">
              <input
                className="ed-input ed-input-flex"
                value={link.label || ''}
                onChange={(e) => setLink(i, { label: e.target.value })}
                placeholder="Label, e.g. linkedin.com/in/you"
              />
              <input
                className="ed-input ed-input-flex"
                value={link.url || ''}
                onChange={(e) => setLink(i, { url: e.target.value })}
                placeholder="https://…"
              />
              <button type="button" className="ed-icon-btn" onClick={() => removeLink(i)} aria-label="Remove link">
                ✕
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={addLink}>
          + Add link
        </button>
      </div>
    </div>
  );
}
