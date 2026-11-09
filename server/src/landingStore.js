import { httpError } from './httpError.js';
import { createSettings, createResumeSettings } from './settings.js';
import { requestHostKey } from './hostnames.js';
import {
  HOME_LINK,
  experienceRoles,
  initialLanding,
  mergeLandingPatch,
  referencedResumeIds,
  resolveLanding,
  upgradeLanding,
  validateLanding,
} from './landingFields.js';
import { pdfPathFor, pdfVersionOf } from './pdfPaths.js';

// The landing page's storage and publishing (issue #70), composed into the
// resume store by createResumeStore() — the editor's routes and the MCP
// tools reach it through the store like everything else. It belongs to the
// install, not to one resume, so it lives in the global `settings` table:
//   landing_draft     — what the editor writes (absent until first saved)
//   landing_published — the snapshot the public site reads, plus publishedAt
// (both read through upgradeLanding(), so one saved before sections still
// reads as sections; the next save or publish stores the new shape)
//   landing_meta      — { lastEditedAt }, the landing page's own touchDraft()
//   landing_enabled   — whether `/` may show it at all; not drafted, it
//                       takes effect at once (and does nothing until a
//                       snapshot exists)
// Publishing it is separate from publishing a resume, so neither can push
// out the other's half-finished edits.
//
// `defaultResumeId` is the resume store's own (a function: the default can
// change between calls), `pdfDir` where its PDFs are (pdfPathFor()).
export function createLandingStore({ db, defaultResumeId, pdfDir }) {
  const { getSetting, setSetting } = createSettings(db);

  function touchLanding() {
    setSetting('landing_meta', { lastEditedAt: new Date().toISOString() });
  }

  function publishedResumeOf(resumeId) {
    return createResumeSettings(db, resumeId).getSetting('published_resume');
  }

  function knownResumeIds() {
    return new Set(db.prepare('SELECT id FROM resumes').all().map((row) => row.id));
  }

  function getLanding() {
    const stored = upgradeLanding(getSetting('landing_draft'));
    if (stored) return stored;
    const defaultId = defaultResumeId();
    return initialLanding(defaultId, publishedResumeOf(defaultId)?.header);
  }

  // Replaces the draft, or with `merge: true` shallow-merges into it (as the
  // MCP tool does; a list is replaced whole). Either way the result is
  // checked in full (landingFields.js): a card or action already in the
  // draft may name a resume deleted since, a new one must name one that exists.
  function setLanding(input, { merge = false } = {}) {
    const current = getLanding();
    const next = checkLanding(merge ? mergeLandingPatch(current, input) : input ?? {}, current);
    setSetting('landing_draft', next);
    touchLanding();
    return next;
  }

  function checkLanding(input, current) {
    return validateLanding(input, { knownResumeIds: knownResumeIds(), previousResumeIds: referencedResumeIds(current) });
  }

  // `input` checked as setLanding() would check it, without saving it: the
  // editor's copy of the draft, which an AI rewrite (routes/ai.js) works on
  // since it can be a debounce ahead of the stored one.
  function checkLandingDraft(input) {
    return checkLanding(input ?? {}, getLanding());
  }

  // Same rule as a resume's (see resumeStore.js's isDirty): publish clears
  // lastEditedAt, so any value present is an edit after it.
  function isDirty() {
    const meta = getSetting('landing_meta');
    const published = getSetting('landing_published');
    if (!meta?.lastEditedAt) return false;
    if (!published?.publishedAt) return true;
    return meta.lastEditedAt >= published.publishedAt;
  }

  function getLandingStatus() {
    return {
      enabled: getSetting('landing_enabled') === true,
      publishedAt: getSetting('landing_published')?.publishedAt ?? null,
      isDirty: isDirty(),
    };
  }

  // A draft that was never saved (the one built from the default resume's
  // header) can be published as it is.
  function publishLanding() {
    const publishedAt = new Date().toISOString();
    setSetting('landing_published', { ...getLanding(), publishedAt });
    setSetting('landing_meta', { lastEditedAt: null });
    return getLandingStatus();
  }

  function discardLandingDraft() {
    const published = upgradeLanding(getSetting('landing_published'));
    if (!published) throw httpError(409, 'The landing page has not been published yet');
    const { publishedAt, ...draft } = published;
    db.transaction(() => {
      setSetting('landing_draft', draft);
      setSetting('landing_meta', { lastEditedAt: null });
    })();
    return draft;
  }

  function setLandingEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw httpError(400, 'enabled must be a boolean');
    setSetting('landing_enabled', enabled);
    return getLandingStatus();
  }

  // A visitor's link to a resume's PDF, or '' while it has none. The
  // default's is the host's own (the landing page is only shown on hosts
  // whose resume is the default). It carries the file's version, as
  // client/src/resume/pdfUrl.js's pdfUrl() adds it, so each render is a
  // fresh URL.
  function pdfHref(row, isDefault) {
    const version = pdfVersionOf(pdfPathFor(pdfDir, row.id));
    if (!version) return '';
    const path = isDefault ? '/api/public/resume.pdf' : `/api/public/resumes/${encodeURIComponent(row.slug)}/resume.pdf`;
    return `${path}?v=${encodeURIComponent(version)}`;
  }

  // What the page's references point at right now, for resolveLanding():
  // the default resume's published photo and look, and every resume a
  // visitor may open (public and published) with its link, its PDF's and
  // the roles an experience section may show from it. The default lives at
  // /resume while the landing page holds `/`.
  function landingContext() {
    const defaultId = defaultResumeId();
    const defaultPublished = publishedResumeOf(defaultId);
    const rows = db
      .prepare(
        `SELECT r.id, r.slug, s.value FROM resumes r
           JOIN resume_settings s ON s.resume_id = r.id AND s.key = 'published_resume'
         WHERE r.is_public = 1`
      )
      .all();
    const resumes = new Map(
      rows.map((row) => [
        row.id,
        {
          href: row.id === defaultId ? '/resume' : `/r/${row.slug}`,
          title: JSON.parse(row.value)?.header?.title || '',
          pdfHref: pdfHref(row, row.id === defaultId),
          experience: experienceRoles(JSON.parse(row.value)?.blocks),
        },
      ])
    );
    return { photoUrl: defaultPublished?.header?.photoUrl || '', site: defaultPublished?.site ?? null, resumes };
  }

  // The same, as JSON for the editor, whose preview resolves the draft
  // against it as someone types (client/src/landing/resolveLanding.js
  // mirrors resolveLanding()). Also what an AI rewrite of the page reads an
  // experience section's roles from.
  function getLandingContext() {
    const { photoUrl, site, resumes } = landingContext();
    return { photoUrl, site, resumes: [...resumes].map(([id, target]) => ({ id, ...target })) };
  }

  // A resume's published snapshot, but only while a visitor may see it
  // (public and published), for an AI rewrite of the landing page to draw
  // on: what the page then says about it is no more than the resume itself
  // already shows. Null otherwise. Defaults to the default resume.
  function visibleResumeSnapshot(resumeId = defaultResumeId()) {
    const row = db.prepare('SELECT 1 FROM resumes WHERE id = ? AND is_public = 1').get(resumeId);
    return (row && publishedResumeOf(resumeId)) || null;
  }

  // The published landing page `hostname` shows at `/`, or null when it
  // shows a resume there: the feature is off, nothing is published, or the
  // host is one of a resume's domains. Any mapping counts, published or
  // not, so switching the landing page on never changes what a resume's
  // own domain shows.
  function landingForHost(hostname) {
    if (isResumeHost(hostname)) return null;
    return shownLanding();
  }

  function isResumeHost(hostname) {
    const key = requestHostKey(hostname);
    return Boolean(key && db.prepare('SELECT 1 FROM resume_hosts WHERE hostname = ?').get(key));
  }

  // The "← Home" link a resume page on `hostname` shows above itself
  // (issue #89), or null: only where landingForHost() would show the
  // landing page at `/`, and while its published snapshot keeps homeLink
  // on, saying that snapshot's homeLinkLabel, trimmed, or "Home" (a
  // draft's settings take effect on publish, like the rest of it). So a
  // resume's own domain never gets one. Cheaper than landingForHost(),
  // since nothing has to be resolved.
  function homeLinkForHost(hostname) {
    if (isResumeHost(hostname) || getSetting('landing_enabled') !== true) return null;
    const published = upgradeLanding(getSetting('landing_published'));
    if (!published?.homeLink) return null;
    return { href: HOME_LINK.href, label: published.homeLinkLabel.trim() || HOME_LINK.label };
  }

  // The same on whichever host shows it: the published page while it's
  // switched on, else null. For what the landing page's link preview
  // shows (shareStore.js), which doesn't depend on the host.
  function shownLanding() {
    if (getSetting('landing_enabled') !== true) return null;
    const published = upgradeLanding(getSetting('landing_published'));
    if (!published) return null;
    return { ...resolveLanding(published, landingContext()), publishedAt: published.publishedAt };
  }

  return {
    getLanding,
    setLanding,
    getLandingStatus,
    publishLanding,
    discardLandingDraft,
    setLandingEnabled,
    getLandingContext,
    checkLandingDraft,
    visibleResumeSnapshot,
    landingForHost,
    homeLinkForHost,
    shownLanding,
  };
}
