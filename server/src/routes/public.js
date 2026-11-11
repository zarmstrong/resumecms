import { Router } from 'express';
import { store } from '../store.js';
import { NOINDEX, REVALIDATE, RENDER } from '../cacheHeaders.js';
import { RENDERED_LETTER_HEADER, renderTarget } from '../renderAccess.js';
import { httpError } from '../httpError.js';
import { handle } from './sendError.js';
import { HOST_HEADERS } from '../hostnames.js';
import { publicResumeHandlers } from './publicResume.js';
import { landingContactHandler } from './landingContact.js';

const router = Router();

// The resume itself, by host and by slug: see publicResume.js.
const { hostResume, slugResume } = publicResumeHandlers(store);
router.get('/resume', hostResume);

// What `/` shows on this host (issue #70): the published landing page when
// it's switched on and this host isn't one of a resume's domains (see the
// store's landingForHost), otherwise the same resume /api/public/resume
// would send. One request either way, so the page never shows the resume
// first and then swaps to the landing page. Only `/` asks for this, and
// it's never the PDF renderer's page (that one loads /print), so the
// render cookie doesn't come into it.
router.get('/home', handle((req, res) => {
  res.set('Cache-Control', REVALIDATE);
  res.vary(HOST_HEADERS);
  const landing = store.landingForHost(req.hostname);
  if (landing) {
    res.json({ kind: 'landing', landing });
    return;
  }
  res.json({ kind: 'resume', resume: store.forHost(req.hostname).getPublishedResume('web') });
}));

// A cover letter, for the PDF renderer's /print/letter page only (issue
// #71): the letter its render cookie names (see renderAccess.js), with its
// resume's header and look. Letters are never public, so a request without
// a valid cookie gets a 404, the same as an unknown path.
router.get('/letter', handle((req, res) => {
  res.set('Cache-Control', RENDER);
  const letterId = renderTarget(req.headers.cookie, 'letter');
  if (!letterId) throw httpError(404, 'Not found');
  const content = store.letterForRender(letterId);
  res.set(RENDERED_LETTER_HEADER, letterId);
  res.json(content);
}));

// A link preview's image (issue #87): a page's photo or share card, by the
// key its page's head tags name (shareImages.js). Only while a public page
// shows it, so one taken private or deleted is gone with it; the key
// changes with the image, so revalidating costs a 304 at most. Meant for
// previews, not image search.
router.get('/images/:key', handle((req, res) => {
  res.set('Cache-Control', REVALIDATE);
  res.set('X-Robots-Tag', NOINDEX);
  const image = store.shareImage(req.params.key);
  if (!image) throw httpError(404, 'Not found');
  res.type(image.contentType);
  if (image.body) {
    res.send(image.body);
    return;
  }
  res.sendFile(image.path, { cacheControl: false, dotfiles: 'allow' }, (err) => {
    // A newer card replaced this one between the lookup and the send.
    if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
  });
}));

// An image the landing page shows (issue #92), by its id (the hash of its
// bytes): only while the page is shown and its published snapshot shows
// this one (the store's publicLandingImage), so a draft-only upload isn't
// public and a removed one is gone at once. Hence revalidated, not
// immutable; the strong ETag makes that a 304.
router.get('/landing/images/:id', handle((req, res) => {
  res.set('Cache-Control', REVALIDATE);
  const image = store.publicLandingImage(req.params.id);
  if (!image) throw httpError(404, 'Not found');
  if (image.noindex) res.set('X-Robots-Tag', NOINDEX);
  res.set('ETag', `"${req.params.id}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(image.mime).send(image.bytes);
}));

// The landing page's "Save contact" vCard (issue #124): see landingContact.js.
router.get('/landing/contact.vcf', landingContactHandler(store));

router.get('/resumes/:slug', slugResume);

export default router;
