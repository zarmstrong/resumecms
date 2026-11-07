import { useState } from 'react';
import { PhotoCropper } from './PhotoCropper.jsx';

// A photo picker: upload, crop to a square (PhotoCropper), replace or
// remove. `value` is the photo as a data URL ('' for none); `onChange`
// gets the new one. Used by the header form and the landing page form.
export function PhotoUpload({ label, value, onChange }) {
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
    onChange(photoUrl);
  }

  function removePhoto() {
    setPhotoError('');
    onChange('');
  }

  return (
    <div className="ed-field">
      <span>{label}</span>
      <div className="ed-photo-row">
        {value ? <img className="ed-photo-preview" src={value} alt="" /> : <div className="ed-photo-preview ed-photo-preview-empty" />}
        <div className="ed-photo-actions">
          <label className="ed-btn ed-btn-ghost">
            {value ? 'Replace photo' : 'Upload photo'}
            <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
          </label>
          {value && (
            <button type="button" className="ed-btn ed-btn-ghost" onClick={removePhoto}>
              Remove
            </button>
          )}
        </div>
      </div>
      {photoError && <div className="ed-field-error">{photoError}</div>}
      {cropImageUrl && <PhotoCropper imageUrl={cropImageUrl} onCancel={closeCropper} onConfirm={handleCropConfirm} />}
    </div>
  );
}
