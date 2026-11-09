import { LinkPreview } from './LinkPreview.jsx';

// The collapsed "Search & sharing" group (issue #87), in the landing
// page's form and a resume's site settings: a title and a description
// that replace what's derived from the page (`fallback`, the same
// meta with both left empty, shows as their placeholders), an optional
// noindex switch, and a preview of the link as it will look once
// published. `meta` is share/pageMeta.js's view of the draft as it is.
// `children` (the landing page's share image) go above the preview.
export function SearchSharingFields({ title, description, noindex, onChange, meta, fallback, limits, hint, children }) {
  return (
    <details className="ed-collapsible">
      <summary>
        Search &amp; sharing <span className="ed-collapsible-summary">{meta.title}</span>
      </summary>
      <div className="ed-collapsible-body">
        <span className="ed-field-hint">{hint}</span>
        <label className="ed-field">
          <span>Title</span>
          <input
            className="ed-input"
            value={title}
            maxLength={limits.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={fallback.title}
          />
        </label>
        <label className="ed-field">
          <span>Description</span>
          <textarea
            className="ed-input"
            rows={3}
            value={description}
            maxLength={limits.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={fallback.description || 'One or two sentences for search results and link previews.'}
          />
          <span className="ed-field-hint">Empty uses the text shown as its placeholder.</span>
        </label>
        {noindex !== undefined && (
          <label className="ed-field ed-checkbox-field">
            <input type="checkbox" checked={noindex} onChange={(e) => onChange({ noindex: e.target.checked })} />
            <span>Ask search engines not to list this page</span>
          </label>
        )}
        {children}
        <div className="ed-field">
          <span>Link preview</span>
          <LinkPreview meta={meta} />
          <span className="ed-field-hint">
            How LinkedIn, Slack and others show a link to it once published. LinkedIn keeps a preview for about a week; its Post
            Inspector fetches it again.
          </span>
        </div>
      </div>
    </details>
  );
}
