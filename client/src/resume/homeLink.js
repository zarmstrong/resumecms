// The "← Home" link a public resume page shows above itself while the
// landing page holds `/` (issue #89). The server decides whether there is
// one (it's the only side that knows this host's mapping) and sends it as
// the resume's `home`; it never sends one in print mode or to the PDF
// renderer, and this checks the mode again so the PDF can't show it.
// Only a same-site path is linked, like the landing page's own links.
export function homeLinkOf(resume, mode) {
  const home = resume?.home;
  if (mode !== 'web' || !home || typeof home.href !== 'string' || !/^\/(?!\/)/.test(home.href)) return null;
  return { href: home.href, label: typeof home.label === 'string' && home.label ? home.label : 'Home' };
}

// Whether two responses show the same link, for a refetch to tell that the
// landing page was switched on or off since the page loaded.
export function sameHomeLink(a, b) {
  return (a?.href ?? null) === (b?.href ?? null) && (a?.label ?? null) === (b?.label ?? null);
}
