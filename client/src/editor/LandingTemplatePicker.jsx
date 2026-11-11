import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LandingView } from '../landing/LandingView.jsx';
import { LANDING_TEMPLATES } from '../resume/templateRegistry.js';
import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, pageKey, thumbnailPage, thumbnailScale, withTemplate } from './templateThumbnails.js';

// The landing page's template, picked from a thumbnail of each (issue #130):
// every template in the registry, drawn with `draft` (the draft as the
// editor's preview shows it, AI suggestions included) and the preview's
// `context` by the real LandingView, so a thumbnail is always what the
// page would look like. `scheme` is the preview's light/dark choice.
//
// It's a native radio group, so the arrow keys, the tab stop and the
// focus ring are the browser's own; each radio's name is the template's
// label and its description the description, as text, and the chosen one
// shows its radio checked (and "Selected"), not just a colored border.
//
// The thumbnails are only pictures: `inert` and aria-hidden, so none of the
// page's links, buttons, galleries or players can be focused, clicked or
// opened in them (a media section stays a facade, and its player is never
// loaded). They're drawn only while `open` (the Look group is expanded)
// and each only while it's near the screen, and from a deferred copy of
// the draft, so typing elsewhere in the form doesn't wait on them, and an
// edit that doesn't change what they draw doesn't redraw them.
export function LandingTemplatePicker({ value, onChange, draft, context, scheme, open }) {
  const name = useId();
  const deferredDraft = useDeferredValue(draft);
  const deferredContext = useDeferredValue(context);
  const resolved = useMemo(
    () => (open && deferredDraft ? thumbnailPage(deferredDraft, deferredContext) : null),
    [open, deferredDraft, deferredContext],
  );
  const key = useMemo(() => pageKey(resolved), [resolved]);
  // The same object for as long as it draws the same, so the memoized
  // thumbnails skip the render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const page = useMemo(() => resolved, [key]);

  return (
    <fieldset className="ed-field ed-landing-templates">
      <legend>Template</legend>
      <div className="ed-landing-template-grid">
        {LANDING_TEMPLATES.map((t) => (
          <TemplateOption key={t.id} template={t} name={name} checked={t.id === value} onChange={onChange} page={page} scheme={scheme} />
        ))}
      </div>
    </fieldset>
  );
}

// One template: its picture, then its radio and name, then its
// description. The picture is outside the <label> (a label may hold no
// links or buttons, even inert ones), so a click on it, which lands on the
// card since nothing inert can be the target of one, picks the template
// here instead.
function TemplateOption({ template, name, checked, onChange, page, scheme }) {
  const radioRef = useRef(null);
  const descId = `${name}-${template.id}-desc`;
  return (
    <div
      className={`ed-landing-template${checked ? ' is-selected' : ''}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onChange(template.id);
        radioRef.current?.focus();
      }}
    >
      <Thumbnail page={page} templateId={template.id} scheme={scheme} />
      <label className="ed-landing-template-name">
        <input
          ref={radioRef}
          type="radio"
          name={name}
          value={template.id}
          checked={checked}
          onChange={() => onChange(template.id)}
          aria-describedby={template.description ? descId : undefined}
        />
        <span className="ed-landing-template-label">{template.label}</span>
        {checked && (
          <span className="ed-landing-template-current" aria-hidden="true">
            Selected
          </span>
        )}
      </label>
      {template.description && (
        <span id={descId} className="ed-landing-template-desc">
          {template.description}
        </span>
      )}
    </div>
  );
}

// One template's picture: the page at THUMBNAIL_WIDTH, scaled to the
// frame's width (measured, since the Look group's column is as narrow as
// a phone's screen or as wide as the editor's left pane). The frame keeps
// its size while nothing is drawn in it, so the list doesn't jump.
const Thumbnail = memo(function Thumbnail({ page, templateId, scheme }) {
  const frameRef = useRef(null);
  const [width, setWidth] = useState(0);
  const near = useNearScreen(frameRef);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    setWidth(frame.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(frame.clientWidth));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const scale = thumbnailScale(width);
  return (
    <div className="ed-landing-template-frame" ref={frameRef} inert aria-hidden="true">
      {page && near && scale > 0 && (
        <div className="ed-landing-template-page" style={{ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, transform: `scale(${scale})` }}>
          <LandingView landing={withTemplate(page, templateId)} scheme={scheme} />
        </div>
      )}
    </div>
  );
});

// Whether an element is on the screen or close to it (inside a scrolled or
// collapsed parent counts as off it); always true where it can't be told.
function useNearScreen(ref) {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '200px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}
