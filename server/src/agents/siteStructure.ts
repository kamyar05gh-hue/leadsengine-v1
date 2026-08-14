/**
 * SiteStructure — the structural skeleton of the client's live website,
 * extracted from the homepage HTML (designExtractor.fetchSiteStructure).
 * pageShell renders the client's own nav labels, CTA text and footer
 * columns around our optimized content, so a generated page matches the
 * main site's UI/UX and only the content differs.
 */

export interface SiteLink {
  label: string
  /** Absolute URL (resolved against the homepage). */
  href: string
}

export interface SiteStructure {
  /** Header/nav links, in document order. */
  navLinks: SiteLink[]
  /** Text of the header CTA button (e.g. "Kontakt", "Offerte anfordern"). */
  ctaText: string | null
  /** Logo alt text or brand link label. */
  logoText: string | null
  /** Footer link columns with their headings. */
  footerColumns: { heading: string; links: SiteLink[] }[]
  /** Homepage section rhythm — the h2 texts in document order. */
  sectionOrder: string[]
  /** Homepage meta description — verbatim client copy, used for grounding. */
  homeDescription: string | null
}
