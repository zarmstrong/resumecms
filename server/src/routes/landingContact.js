import { NOINDEX, REVALIDATE } from '../cacheHeaders.js';
import { HOST_HEADERS } from '../hostnames.js';
import { httpError } from '../httpError.js';
import { landingPage } from '../pageMeta.js';
import { contactCardFileName, landingContactCard } from '../vcard.js';
import { handle } from './sendError.js';

// GET /api/public/landing/contact.vcf (issue #124): the landing page's
// "Save contact" vCard, over any store (routes/public.js binds it to the
// real one), so a test can drive it over :memory:.
//
// Only while landingForHost() shows the landing page on this host, and
// its published snapshot shows a contact section with `vcard` on;
// otherwise a 404, the same as an unknown path. It's built from that
// resolved snapshot (vcard.js), never the draft, with the name and title
// the page's Person gets and the page's own URL. Which page that is
// depends on the host, so it varies on it; it's always revalidated, so a
// publish reaches the next download. Kept out of search results: it's
// for saving, and spelled out in a file it's easier to harvest.
export function landingContactHandler(store) {
  return handle((req, res) => {
    res.set('Cache-Control', REVALIDATE);
    res.vary(HOST_HEADERS);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Robots-Tag', NOINDEX);
    const landing = store.landingForHost(req.hostname);
    if (!landing) throw httpError(404, 'Not found');
    const person = landingPage(landing, store.getPublishedResume('web').header).person;
    const card = landingContactCard(landing, {
      name: person?.name ?? '',
      title: person?.jobTitle ?? '',
      url: `${req.protocol}://${req.host}/`,
    });
    if (!card) throw httpError(404, 'Not found');
    res.set('Content-Type', 'text/vcard; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${contactCardFileName(person?.name)}"`);
    res.send(card);
  });
}
