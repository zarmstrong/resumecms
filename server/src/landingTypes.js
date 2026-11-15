// @ts-check
// The landing page's stored draft (and published snapshot) as JSDoc types,
// for `npm run typecheck` (issue #177). Types only: nothing here runs.
// validateLanding() in landingFields.js is what holds a draft to this shape,
// one field at a time; SECTION_FIELDS there is typed by SectionKind, so a
// kind added to one and not the other fails the check. See "Landing page"
// in CLAUDE.md for what each field means.

/**
 * @typedef {'text' | 'items' | 'links' | 'resumes' | 'quotes' | 'experience' | 'image' | 'divider' | 'stats'
 *   | 'faq' | 'education' | 'skills' | 'credentials' | 'gallery' | 'media' | 'services' | 'publications'
 *   | 'contact' | 'documents'} SectionKind
 */

/**
 * An uploaded image (landingImageStore.js) or document (landingFileStore.js)
 * as the draft names it.
 * @typedef {{ imageId: string, alt: string }} ImageRef
 * @typedef {{ fileId: string, name: string }} FileRef
 */

/**
 * A hero button (issue #88), or a service's (always a `link`).
 * @typedef {{ type: 'link', label: string, url: string, icon?: string }} LinkAction
 * @typedef {LinkAction | { type: 'resume', label: string, resumeId: string, open: 'page' | 'pdf', icon?: string }} LandingAction
 */

/**
 * What every section has. `hidden` and `column` are stored only when set.
 * @typedef {{ id: string, title: string, hidden?: true, column?: 'side' }} SectionBase
 */

/**
 * @typedef {{ title: string, text: string, url: string, meta?: string, image?: ImageRef }} LandingItem
 * @typedef {{ type: string, label: string, url: string }} LandingLink
 * @typedef {{ resumeId: string, label: string, blurb: string, showPdf: boolean }} ResumeCard
 * @typedef {{ text: string, name: string, role: string, url: string }} Quote
 * @typedef {{ value: string, label: string }} Stat
 * @typedef {{ question: string, answer: string }} FaqEntry
 * @typedef {{ kind: 'license' | 'certification' | 'membership', name: string, issuer: string, number: string, issued: string, expires: string, url: string }} Credential
 * @typedef {{ image: ImageRef | null, caption: string }} GalleryEntry
 * @typedef {{ title: string, text: string, price: string, action?: LinkAction }} Service
 * @typedef {{ kind: 'article' | 'paper' | 'book' | 'chapter' | 'talk' | 'podcast' | 'press', title: string, outlet: string, date: string, url: string, doi: string, note: string }} Publication
 * @typedef {{ days: string, time: string }} Hours
 * @typedef {{ file: FileRef | null, label: string, description: string }} LandingDocument
 */

/**
 * One section, by kind (SECTION_FIELDS in landingFields.js).
 * @typedef {SectionBase & (
 *   | { kind: 'text', body: string }
 *   | { kind: 'items', items: LandingItem[] }
 *   | { kind: 'links', links: LandingLink[] }
 *   | { kind: 'resumes', cards: ResumeCard[] }
 *   | { kind: 'quotes', quotes: Quote[] }
 *   | { kind: 'experience' | 'education', resumeId: string, count: number, showDates: boolean }
 *   | { kind: 'skills', resumeId: string }
 *   | { kind: 'image', image: ImageRef | null, caption: string }
 *   | { kind: 'divider' }
 *   | { kind: 'stats', stats: Stat[] }
 *   | { kind: 'faq', entries: FaqEntry[] }
 *   | { kind: 'credentials', credentials: Credential[] }
 *   | { kind: 'gallery', images: GalleryEntry[] }
 *   | { kind: 'media', url: string, caption: string, poster?: ImageRef, transcript: string }
 *   | { kind: 'services', services: Service[] }
 *   | { kind: 'publications', order: 'manual' | 'newest', group: boolean, entries: Publication[] }
 *   | { kind: 'contact', email: string, phone: string, area: string, address: string, hours: Hours[], vcard: boolean }
 *   | { kind: 'documents', documents: LandingDocument[] }
 * )} LandingSection
 */

/**
 * The page's look (landingStyle.js): four colors and two fonts, each '' for
 * the site settings' default.
 * @typedef {{ accent: string, heading: string, text: string, background: string }} LandingColors
 * @typedef {{ source: 'resume' | 'custom', colors: LandingColors, font: string, nameFont: string, darkColors?: LandingColors }} LandingStyle
 */

/**
 * A whole draft, as validateLanding() returns it and `landing_draft`
 * stores it. A published snapshot adds `publishedAt`.
 * @typedef {{
 *   headline: string,
 *   subheadline: string,
 *   availability: string,
 *   actions: LandingAction[],
 *   photo: 'resume' | 'custom' | 'upload' | 'none',
 *   photoUrl: string,
 *   photoImage?: ImageRef,
 *   coverImage?: ImageRef,
 *   sections: LandingSection[],
 *   seo: { title: string, description: string, noindex: boolean, image?: ImageRef },
 *   homeLink: boolean,
 *   homeLinkLabel: string,
 *   template: string,
 *   style: LandingStyle,
 * }} LandingDraft
 */

export {};
