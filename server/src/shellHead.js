import { headTags, landingPage, resumePage } from './pageMeta.js';
import { photoKey } from './shareImages.js';

// Which public page a request for the HTML shell is (issue #87), and the
// head tags for it (pageMeta.js); clientStatic.js puts them into
// index.html. It asks the store exactly what the page's own fetch would:
//   /          — the landing page when landingForHost() shows it, else
//                forHost()'s resume (GET /api/public/home)
//   /resume    — forHost()'s resume (GET /api/public/resume); its
//                canonical URL is `/` wherever the page redirects there
//   /r/<slug>  — forPublicSlug(), unlisted: no JSON-LD (its X-Robots-Tag
//                is clientStatic.js's)
// and null for everything else (/editor, /print…), and for an unknown,
// private or unpublished slug or a resume never published, which keep
// index.html's own generic tags, so a private resume's name never appears
// in its shell. Null too if the store throws: the page still loads.
//
// Returns { head, noindex }: the tags, and whether the page asks search
// engines to leave it out (the landing page's seo.noindex).
export function createShellHead(store) {
  function imageUrls(page, origin) {
    const card = store.readyCardKey(page.card);
    const photo = photoKey(page.photoUrl);
    const url = (key) => (key ? `${origin}/api/public/images/${key}` : null);
    return { image: url(card ?? photo), largeImage: Boolean(card), photo: url(photo) };
  }

  function resumeHead(published, origin, canonicalPath, { withPerson }) {
    if (!published.header) return null;
    const page = resumePage(published);
    return { head: headTags(page, { url: origin + canonicalPath, withPerson, ...imageUrls(page, origin) }), noindex: false };
  }

  function headFor(req) {
    const origin = `${req.protocol}://${req.host}`;
    const pathname = req.path.replace(/\/+$/, '') || '/';
    if (pathname === '/' || pathname === '/resume') {
      const landing = store.landingForHost(req.hostname);
      if (landing && pathname === '/') {
        const page = landingPage(landing, store.getPublishedResume('web').header);
        const head = headTags(page, { url: `${origin}/`, withPerson: true, ...imageUrls(page, origin) });
        return { head, noindex: landing.seo?.noindex === true };
      }
      const published = store.forHost(req.hostname).getPublishedResume('web');
      return resumeHead(published, origin, landing ? '/resume' : '/', { withPerson: true });
    }
    const slug = /^\/r\/([^/]+)$/i.exec(pathname)?.[1];
    if (slug) {
      let resume;
      try {
        resume = store.forPublicSlug(decodeURIComponent(slug));
      } catch (err) {
        if (err?.status === 404 || err instanceof URIError) return null;
        throw err;
      }
      return resumeHead(resume.getPublishedResume('web'), origin, `/r/${slug.toLowerCase()}`, { withPerson: false });
    }
    return null;
  }

  return (req) => {
    try {
      return headFor(req);
    } catch (err) {
      console.error(`Could not build the page metadata for ${req.path}:`, err);
      return null;
    }
  };
}
