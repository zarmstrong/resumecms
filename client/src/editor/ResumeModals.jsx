import { useState } from 'react';
import { api } from '../api.js';
import { parseHostnames, publicUrl, resumePatch } from './resumeLinks.js';

// The two dialogs behind the editor's resume switcher (issue #53). Like
// SettingsModal, they close only through their own buttons.

// "New resume…": a copy of the open resume's draft, or a resume with the
// default's header and look and no sections (what the server's
// createResume does without copyFrom). `onCreate(input)` makes it and
// switches to it; it's EditorPage's, which first saves any edit still
// waiting, so the copy has it.
export function NewResumeModal({ resume, defaultResume, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Switches to the new resume, which closes this; it returns without
      // one if a failed save made the user stop.
      await onCreate({ name, ...(copy ? { copyFrom: resume.id } : {}) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-modal-backdrop">
      <form className="ed-modal" role="dialog" aria-modal="true" aria-labelledby="ed-new-resume-title" onSubmit={handleCreate}>
        <div className="ed-modal-header">
          <h2 id="ed-new-resume-title">New resume</h2>
        </div>
        <div className="ed-modal-body">
          <div className="ed-form ed-modal-section">
            <div className="ed-field">
              <label htmlFor="ed-new-resume-name">Name</label>
              <input
                id="ed-new-resume-name"
                className="ed-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales"
                autoFocus
              />
              <span className="ed-field-hint">Only you see the name. Its link is made from it, and you can change both later.</span>
            </div>
            <label className="ed-field ed-checkbox-field">
              <input type="radio" name="ed-new-resume-start" checked={copy} onChange={() => setCopy(true)} />
              A copy of “{resume.name}”, with all its sections
            </label>
            <label className="ed-field ed-checkbox-field">
              <input type="radio" name="ed-new-resume-start" checked={!copy} onChange={() => setCopy(false)} />
              No sections yet, with the header and look of “{defaultResume.name}”
            </label>
            <span className="ed-field-hint">It starts private and unpublished, so nobody sees it until you say so.</span>
            {error && <div className="ed-login-error">{error}</div>}
          </div>
          <div className="ed-modal-actions">
            <button type="button" className="ed-btn ed-btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="ed-btn ed-btn-primary" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// "Resume settings…" for the open resume: name, link, who can see it,
// domains, making it the default, copying its link, deleting it. Saving
// sends only what changed (resumePatch). `onChanged()` reloads the list
// (this resume's new settings come back through the `resume` prop);
// `onDeleted()` is EditorPage's, which reloads and opens the default.
export function ResumeSettingsModal({ resume, defaultResume, onChanged, onDeleted, onClose }) {
  const [form, setForm] = useState(() => ({
    name: resume.name,
    slug: resume.slug,
    isPublic: resume.isPublic,
    hostnames: resume.hostnames.join('\n'),
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null); // null | 'ok' | 'failed'

  const patch = resumePatch(resume, form);
  const dirty = Object.keys(patch).length > 0;
  const hasDomains = parseHostnames(form.hostnames).length > 0;
  const url = publicUrl(resume, window.location);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // Every action here reports its error in the dialog rather than closing it.
  async function run(action) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    if (!dirty || window.confirm('Close without saving your changes to this resume?')) onClose();
  }

  const handleSave = (e) => {
    e.preventDefault();
    run(async () => {
      if (patch.slug && !window.confirm(`Change its link to /r/${patch.slug}? Links already shared with the old one will stop working.`)) {
        return;
      }
      await api.updateResume(resume.id, patch);
      // Saved either way: a failed reload only leaves the list behind until
      // the next one, and mustn't read as a failed save.
      await onChanged().catch(() => {});
      onClose();
    });
  };

  const handleMakeDefault = () =>
    run(async () => {
      if (!window.confirm(`Show “${resume.name}” on the main site instead of “${defaultResume.name}”?`)) return;
      await api.updateResume(resume.id, { isDefault: true });
      // Done either way; without a fresh list this dialog would still offer
      // it, so close it instead.
      await onChanged().catch(() => onClose());
    });

  const handleDelete = () =>
    run(async () => {
      if (!window.confirm(`Delete “${resume.name}”? Its sections, link, domains and PDF are removed for good.`)) return;
      await api.deleteResume(resume.id);
      await onDeleted();
    });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      // No clipboard (an http:// editor, a denied permission): the link is
      // on screen to copy by hand.
      setCopied('failed');
    }
  }

  return (
    <div className="ed-modal-backdrop">
      <form className="ed-modal" role="dialog" aria-modal="true" aria-labelledby="ed-resume-settings-title" onSubmit={handleSave}>
        <div className="ed-modal-header">
          <h2 id="ed-resume-settings-title">Resume settings</h2>
        </div>
        <div className="ed-modal-body">
          <section className="ed-modal-section ed-form">
            <div className="ed-field">
              <label htmlFor="ed-resume-name">Name</label>
              <input id="ed-resume-name" className="ed-input" value={form.name} onChange={set('name')} />
            </div>
            <div className="ed-field">
              <label htmlFor="ed-resume-slug">Link</label>
              <input id="ed-resume-slug" className="ed-input" value={form.slug} onChange={set('slug')} />
              <span className="ed-field-hint">
                {patch.slug ? 'Changing it breaks links already shared with the old one. ' : ''}
                /r/{form.slug.trim() || '…'}: lowercase letters, digits and single dashes.
              </span>
            </div>
            <label className="ed-field ed-checkbox-field">
              <input type="checkbox" checked={resume.isDefault || hasDomains || form.isPublic} onChange={set('isPublic')} disabled={resume.isDefault || hasDomains} />
              Public
            </label>
            <span className="ed-field-hint">
              {resume.isDefault
                ? 'The default resume is what the main site shows, so it is always public.'
                : hasDomains
                  ? 'A resume with domains is always public: anyone can visit a domain. Remove them to make it private.'
                  : 'Once published, anyone with its link can see a public resume. A private one is only in this editor and its PDF download.'}
            </span>
            <div className="ed-field">
              <label htmlFor="ed-resume-hostnames">Domains</label>
              <textarea id="ed-resume-hostnames" className="ed-textarea" rows={2} value={form.hostnames} onChange={set('hostnames')} placeholder="sales.example.com" />
              <span className="ed-field-hint">
                One per line. Visitors to one of them see this resume instead of the default, once it’s published. Point its DNS and your
                reverse proxy at this server first.
              </span>
            </div>
            {error && <div className="ed-login-error">{error}</div>}
            <div className="ed-modal-actions">
              <button type="button" className="ed-btn ed-btn-ghost" onClick={closeModal} disabled={busy}>
                Close
              </button>
              <button type="submit" className="ed-btn ed-btn-primary" disabled={busy || !dirty}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </section>

          <section className="ed-modal-section">
            <h3>Link</h3>
            {url ? (
              <div className="ed-resume-link">
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
                <button type="button" className="ed-btn ed-btn-ghost" onClick={handleCopy}>
                  {copied === 'ok' ? 'Copied' : 'Copy link'}
                </button>
              </div>
            ) : (
              <p className="ed-field-hint">
                {resume.isPublic || resume.isDefault ? 'Publish it to give it a link.' : 'Only you can see it while it’s private.'}
              </p>
            )}
            {copied === 'failed' && <p className="ed-field-hint">Couldn’t copy: select the link above instead.</p>}
          </section>

          {!resume.isDefault && (
            <section className="ed-modal-section">
              <h3>Default and delete</h3>
              <div className="ed-resume-actions">
                <button type="button" className="ed-btn ed-btn-ghost" onClick={handleMakeDefault} disabled={busy || !resume.publishedAt}>
                  Make this the default
                </button>
                <button type="button" className="ed-btn ed-btn-ghost ed-btn-danger" onClick={handleDelete} disabled={busy}>
                  Delete resume
                </button>
              </div>
              <p className="ed-field-hint">
                {resume.publishedAt
                  ? `The default is what the main site shows, now “${defaultResume.name}”.`
                  : 'Publish it before making it the default: the main site shows the published version.'}
              </p>
            </section>
          )}
        </div>
      </form>
    </div>
  );
}
