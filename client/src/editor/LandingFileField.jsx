import { useState } from 'react';
import { formatFileSize } from '../landing/documents.js';

const TYPES = ['application/pdf'];

// One of the landing page's file references (issue #128), a documents
// entry's: `value` is { fileId, name } or null, `onChange` gets null to
// remove it. `files` is the editor's context.files ({ id, src, size }, the
// stored ones), `limits` the server's LANDING_FILE_LIMITS, and
// `onUpload(file)` LandingEditorPage's upload for this entry, which puts
// the reference into the draft itself once the file is stored (into the
// draft as it is then: see landingImages.js), as LandingImageField's does.
// The server tells a PDF by its bytes and strips its metadata; here it's
// only checked enough to say what's wrong before sending it.
export function LandingFileField({ value, files, limits, onUpload, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stored = value ? files.find((file) => file.id === value.fileId) : null;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // so picking the same file again still uploads it
    if (!file) return;
    const problem = pdfFileProblem(file, limits);
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
    <div className="ed-field ed-landing-file">
      <div className="ed-photo-row">
        <span className="ed-landing-file-name">
          {stored ? (
            <>
              <a href={`${stored.src}/${encodeURIComponent(value.name)}`} target="_blank" rel="noopener noreferrer">
                {value.name}
              </a>{' '}
              <span className="ed-field-hint">PDF, {formatFileSize(stored.size)}</span>
            </>
          ) : (
            <span className="ed-field-hint">{value ? value.name : 'No PDF yet'}</span>
          )}
        </span>
        <div className="ed-photo-actions">
          <label className={`ed-btn ed-btn-ghost${busy ? ' ed-btn-inert' : ''}`}>
            {busy ? 'Uploading…' : value ? 'Replace PDF' : 'Upload PDF'}
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
        <span className="ed-field-hint ed-landing-card-status">This PDF is no longer stored, so nothing is shown. Upload it again.</span>
      )}
      {error && <div className="ed-field-error">{error}</div>}
    </div>
  );
}

// What's wrong with `file` before it's sent (not a PDF, or over the upload
// cap of `limits`), or '' when nothing is. A browser that doesn't know the
// type sends '', so the name stands in then.
export function pdfFileProblem(file, limits) {
  const isPdf = TYPES.includes(file.type) || (!file.type && /\.pdf$/i.test(file.name || ''));
  if (!isPdf) return 'Please choose a PDF file.';
  if (limits && file.size > limits.uploadBytes) return `That PDF is too large (at most ${Math.round(limits.uploadBytes / (1024 * 1024))} MB).`;
  return '';
}

// The types the file pickers accept.
export const FILE_TYPES = TYPES;
