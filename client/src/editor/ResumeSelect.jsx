import { LANDING_PAGE, resumeLabel } from './resumeLinks.js';

// The editor's switcher: every resume, then the landing page (issue #70).
// `value` is a resume id or LANDING_PAGE.
export function ResumeSelect({ resumes, value, onChange, disabled }) {
  return (
    <select
      className="ed-input ed-resume-select"
      aria-label="Resume"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <optgroup label="Resumes">
        {resumes.map((r) => (
          <option key={r.id} value={r.id}>
            {resumeLabel(r)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Site">
        <option value={LANDING_PAGE}>Landing page</option>
      </optgroup>
    </select>
  );
}
