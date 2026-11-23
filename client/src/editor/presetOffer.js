import { presetSite } from '../resume/resumePresets.js';
import { SITE_SAVE_ATTEMPTS } from './siteSync.js';

// After a landing preset is applied (issue #219): the matching resume preset
// to offer for the default resume, if the landing preset names one
// (`resumePreset` in its template.json) that exists and there's a default
// resume. Returns { preset, resume } or null. Only an offer: the landing
// editor asks, and applies it to the resume's draft only on a yes.
export function resumePresetOffer(landingPreset, resumePresets, resumes) {
  const id = landingPreset?.resumePreset;
  if (!id) return null;
  const preset = resumePresets.find((p) => p.id === id);
  const resume = (resumes || []).find((r) => r.isDefault);
  return preset && resume ? { preset, resume } : null;
}

// The banner's question.
export function offerQuestion({ preset, resume }) {
  return `Use the "${preset.label}" preset on your resume "${resume.name}" too?`;
}

// What the banner says at each step of an offer: `status` is 'asking' (also
// when it has none), 'applying', 'applied' or 'failed' (with its `error`,
// and asked again, since nothing was applied).
export function offerMessage(offer) {
  const { preset, resume, status, error } = offer;
  if (status === 'applying') return `Applying the "${preset.label}" preset to "${resume.name}"…`;
  if (status === 'applied') {
    return `Applied the "${preset.label}" preset to the draft of "${resume.name}". Publish that resume to show it.`;
  }
  const question = `${offerQuestion(offer)} Only its draft changes; nothing is published.`;
  if (status === 'failed') {
    return `Couldn't apply the "${preset.label}" preset to "${resume.name}" (${error || 'unknown error'}). ${question}`;
  }
  return question;
}

// Accepting the offer: the resume's site settings as stored, through
// presetSite() (what the template picker's "Use this preset" does), saved
// with an ordinary PUT, so the store's touchDraft() runs and nothing is
// published. `target` is that resume's API (`resumeApi(id)`: getSite,
// putSite). `goOn()` is asked between each read and its write: once it says
// no (the page that asked is gone) nothing is written, so a write can't
// land on a draft another editor page has loaded since. The PUT carries the
// revision it was read at (issue #234), so a change saved elsewhere in
// between is a 409, not overwritten: then it reads again and applies the
// preset to that, up to `attempts` times. (presetSite() drops keys the
// preset doesn't set, which is why it's a fresh read and not a merge.)
// Resolves with whether it wrote.
export async function applyResumeOffer(offer, target, goOn = () => true, attempts = SITE_SAVE_ATTEMPTS) {
  for (let attempt = 1; ; attempt += 1) {
    const { site, revision } = await target.getSite();
    if (!goOn()) return false;
    try {
      await target.putSite(presetSite(site || {}, offer.preset), revision);
      return true;
    } catch (err) {
      if (err?.status !== 409 || attempt >= attempts) throw err;
    }
  }
}
