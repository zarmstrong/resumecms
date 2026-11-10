import { useState } from 'react';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// One of the landing page's image references (issue #92): `value` is
// { imageId, alt } or null, `onChange` gets the new one (null to remove
// it). `images` is the editor's context.images ({ id, src, width, height },
// the stored ones), `limits` the server's LANDING_IMAGE_LIMITS, and
// `onUpload(file)` LandingEditorPage's upload for this field's target,
// which puts the reference into the draft itself once the image is stored
// (into the draft as it is then: see landingImages.js), so nothing here
// holds on to the draft across the wait. The server re-encodes the file (and
// drops its metadata); here it's only checked enough to say what's wrong
// before sending it.
export function LandingImageField({ label, hint, value, images, limits, onUpload, onChange, altHint }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stored = value ? images.find((image) => image.id === value.imageId) : null;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // so picking the same file again still uploads it
    if (!file) return;
    const problem = imageFileProblem(file, limits);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-field ed-landing-image">
      {label && <span>{label}</span>}
      {hint && <span className="ed-field-hint">{hint}</span>}
      <div className="ed-photo-row">
        {stored ? (
          <img className="ed-landing-image-preview" src={stored.src} alt="" width={stored.width} height={stored.height} />
        ) : (
          <div className="ed-landing-image-preview ed-photo-preview-empty" />
        )}
        <div className="ed-photo-actions">
          <label className={`ed-btn ed-btn-ghost${busy ? ' ed-btn-inert' : ''}`}>
            {busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
            <input type="file" accept={TYPES.join(',')} onChange={handleFile} disabled={busy} hidden />
          </label>
          {value && (
            <button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChange(null)} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>
      {value && !stored && (
        <span className="ed-field-hint ed-landing-card-status">This image is no longer stored, so nothing is shown. Upload it again.</span>
      )}
      {value && (
        <>
          <input
            className="ed-input"
            value={value.alt}
            maxLength={limits?.alt}
            onChange={(e) => onChange({ ...value, alt: e.target.value })}
            placeholder="Describe the image (required)"
            aria-label="Image description (alt text)"
          />
          {!value.alt.trim() && (
            <span className="ed-field-hint ed-landing-card-status">{altHint || 'Say what it shows, for visitors who use a screen reader.'}</span>
          )}
        </>
      )}
      {error && <div className="ed-field-error">{error}</div>}
    </div>
  );
}

// `obj` with `ref` under `key`, or without the key when there's none: a
// thumbnail, the hero's photoImage and seo.image are only stored when set.
export function withImageRef(obj, key, ref) {
  const { [key]: _removed, ...rest } = obj;
  return ref ? { ...rest, [key]: ref } : rest;
}

// What's wrong with `file` before it's sent (not a JPEG, PNG or WebP, or
// over the upload cap of `limits`), or '' when nothing is. Also checks each
// of the files a gallery's "Add images" takes at once (issue #120).
export function imageFileProblem(file, limits) {
  if (!TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP image.';
  if (limits && file.size > limits.uploadBytes) return `That image is too large (at most ${Math.round(limits.uploadBytes / (1024 * 1024))} MB).`;
  return '';
}

// The types the file pickers accept.
export const IMAGE_TYPES = TYPES;
