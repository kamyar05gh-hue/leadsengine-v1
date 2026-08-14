/**
 * Agent: page builder — orchestrates the landing-page pipeline:
 *
 *   1. DECIDE the page type (pageTypeDecider) — the gap's recommendedFormat
 *      wins, then the dominant format among winning competitor pages, then
 *      'guide'. One page = one content type, enforced in prompt and renderer.
 *   2. CLONE the client's design (designCloner) — vision tokens from
 *      screenshots + site structure from the homepage HTML, cached per
 *      company so ten pages cost one screenshot run. Falls back to the FM
 *      shell, never a stub.
 *   3. WRITE the content (pageContentWriter) — Kimi outline (page chains
 *      are Kimi-only, no DeepSeek) → GPT (MODELS.laborPages) content →
 *      Kimi/Gemini fallback → deterministic fallbackContent.
 *      Grounded in gap/evidence, competitor analysis and the client's own
 *      website copy; zero invented facts.
 *   4. RENDER (pageShell) — format-locked body + AEO baseline blocks (answer
 *      capsule, key facts, FAQ, freshness line), client chrome, JSON-LD
 *      graph (Organization/LocalBusiness/Service + Article/FAQPage), and
 *      every page canonicalizes into the AI-crawl-pack FOLDER on the
 *      client's MAIN domain (https://<domain>/<PACK_FOLDER>/<file>.html)
 *      and links the MAIN website (nav + CTA + footer attribution).
 *
 * Besides the pages this module also builds the pack layer written by the
 * pages stage: sitemap.xml, graph.jsonld, the consolidated faq.html/faq.json,
 * llms.txt, robots.txt and DEPLOY.md (FTP guide, German).
 */
import {
  mainOrigin,
  packBaseUrl,
  packUrl,
  renderPage,
  renderIndex,
  type FaqItem,
  type PageContent,
} from './pageShell.js'
import { classifyTopic } from './evidenceExtractor.js'
import { identifyPatterns } from './competitorAnalyzer.js'
import { cloneClientDesign, type ClientDesign } from './designCloner.js'
import { decidePageType, type PageType } from './pageTypeDecider.js'
import { fallbackContent, writePageContent } from './pageContentWriter.js'
import { PACK_FOLDER } from '../config.js'
import { listCompetitorPages } from '../db/repo.js'
import type { CrawledPage, SiteCrawl } from './siteCrawler.js'
import type { Company, CompetitorPage, ContentGap, EvidenceBundle, PageSpec } from '../types.js'

export interface BuiltPage {
  filename: string
  html: string
  /** Page title (spec/hero) — feeds the site-wide graph, sitemap and llms.txt. */
  title?: string
  /** Meta description / teaser — feeds graph.jsonld WebPage nodes and llms.txt. */
  description?: string
  /** FAQ items rendered on this page — aggregated into the consolidated faq.html. */
  faq?: FaqItem[]
}

/** slug like '/wissen/kosten' → 'wissen-kosten.html'; '/' → 'home.html'. */
export function slugToFilename(slug: string): string {
  const clean = slug.replace(/(^\/+|\/+$)/g, '').replace(/\//g, '-')
  return `${clean || 'home'}.html`
}

/** FAQ pages get FAQPage schema; every other format is an Article. */
function schemaForType(pageType: PageType): 'FAQPage' | 'Article' {
  return pageType === 'faq' ? 'FAQPage' : 'Article'
}

/**
 * Canonical URL of a generated page: the flat filename inside the AI-crawl
 * pack folder on the client's MAIN domain (…/<folder>/<file>.html). The pack
 * is uploaded via FTP as a folder — never a subdomain — so every page
 * inherits the main domain's authority.
 */
function canonicalFor(company: Company, slug: string): string {
  return packUrl(company, slugToFilename(slug))
}

/**
 * Build one page: decide type → clone design → write content → render.
 * Never fails to a stub (deterministic fallbackContent as last resort).
 */
export async function buildPage(
  company: Company,
  page: PageSpec,
  _brandProfile: string, // kept in signature; design now comes from designCloner
  allPages: PageSpec[],
  lang: 'de' | 'en' = company.language,
): Promise<BuiltPage> {
  const filename = slugToFilename(page.slug)
  const siblings = allPages
    .filter((p) => p.slug !== page.slug)
    .map((p) => ({ filename: slugToFilename(p.slug), title: p.title }))

  const design = await cloneClientDesign(company)
  const winningPages = winningPagesForGap({ prompt: page.targetQuery }, listCompetitorPages(company.id))
  // PageSpec has no recommendedFormat — the schemaType hint stands in for it.
  const pageType = decidePageType(
    { recommendedFormat: page.schemaType === 'FAQPage' ? 'faq' : null },
    winningPages,
  )

  const content =
    (await writePageContent(company, page, {
      pageType,
      winningPages,
      patterns: identifyPatterns(winningPages),
      evidenceText: '',
      structure: design.structure,
      masterStyle: design.masterPrompt,
      lang,
    })) ?? fallbackContent(company, page, pageType)

  const html = renderPage(company, content, {
    filename,
    siblings,
    schemaType: schemaForType(pageType),
    targetQuery: page.targetQuery,
    canonicalUrl: canonicalFor(company, page.slug),
    designTokens: design.tokens ?? undefined,
    rendered: design.rendered ?? undefined,
    structure: design.structure ?? undefined,
  })
  return {
    filename,
    html,
    title: page.title,
    description: content.metaDescription.slice(0, 155),
    faq: content.faq,
  }
}

/** Hub page — design-system index (cloned client design when available). */
export function buildIndex(
  company: Company,
  pages: BuiltPage[],
  specs: PageSpec[],
  design?: ClientDesign,
): BuiltPage {
  const entries = specs
    .map((s) => ({
      filename: slugToFilename(s.slug),
      title: s.title,
      teaser: s.answerCapsule.slice(0, 110) + (s.answerCapsule.length > 110 ? '…' : ''),
    }))
    .filter((e) => pages.some((p) => p.filename === e.filename))
  return {
    filename: 'index.html',
    html: renderIndex(company, entries, {
      rendered: design?.rendered ?? null,
      designTokens: design?.tokens ?? null,
      structure: design?.structure ?? null,
    }),
  }
}

// ─── AI-crawl-pack files (folder on the MAIN domain) ────────────────────────
// Everything below assumes deployment at https://<main-domain>/<PACK_FOLDER>/
// (see packUrl in pageShell). One page entry = one deployed pack file.

/** One pack page as the site-wide builders consume it. */
export interface PackPageEntry {
  filename: string
  title: string
  description: string
}

/** XML-escape a text/attribute value. */
const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ─── Crawled-site helpers (real main-site content → pack files) ─────────────

/** Display name of a crawled page: title first, H1 second, URL path last. */
function crawledPageName(p: CrawledPage): string {
  return p.title ?? p.h1 ?? p.url.replace(/^https?:\/\/[^/]+/, '') ?? p.url
}

/** One-line description of a crawled page: meta description or first text. */
function crawledPageDesc(p: CrawledPage, max = 155): string {
  const raw = p.metaDescription ?? p.text.replace(/\s+/g, ' ')
  const t = raw.trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** Markdown link label — square brackets stripped so links never break. */
const mdLabel = (s: string): string => s.replace(/[[\]]/g, '')

/** URL-path/title patterns that mark a crawled page as a services page. */
const SERVICE_PAGE_RE = /leistung|dienstleistung|angebot|kompetenz|l(?:oe|ö)sung|solution|offer|\/services?\b/i

/** Headings/names that are site chrome or legal, never a service name. */
const GENERIC_HEADING_RE =
  /^(kontakt|contact|über uns|ueber uns|about( us)?|team|faq|häufige fragen|impressum|datenschutz|privacy|cookie|agb|news|blog|aktuelles|referenzen|portfolio|projekte?|home|start(seite)?|jobs?|karriere|standorte?|anmeldung|registrierung|login|so funktioniert|warum|mehr erfahren|downloads?|sitemap)/i

/** URL slugs of pages that are never offerings (chrome/legal/funnel steps). */
const GENERIC_SLUG_RE =
  /^(kontakt|contact|ueber-?uns|about(-us)?|team|impressum|datenschutz|privacy|agb|terms|news|blog|aktuelles|referenzen|portfolio|projekte?|jobs?|karriere|standorte?|anmeldung|registrierung|login|downloads?|sitemap|suche|search|faq|404|shop|warenkorb|cart|checkout|danke|thank-?you)/i

/** A service found on the real site: its name + the live page it lives on. */
interface CrawledService {
  name: string
  url: string
}

/**
 * Services the client REALLY offers, read from the crawl:
 *
 *   1. Every non-generic TOP-LEVEL page is an offering candidate — sites name
 *      their offerings as pages ('/leads', '/brandawareness', '/kurse'). The
 *      service name is the page H1, or the first segment of the real title
 *      ('Leads | Future Media' → 'Leads').
 *   2. Pages matching the classic service keywords additionally contribute
 *      their h2/h3 headings ('Leistungen' listing pages).
 *
 * Chrome/legal pages and headings are filtered. Empty when the crawl found
 * nothing service-like — callers then fall back to the sector-label split.
 */
export function servicesFromCrawl(crawl: SiteCrawl): CrawledService[] {
  const out: CrawledService[] = []
  const seen = new Set<string>()
  const add = (name: string | null, url: string): void => {
    const t = (name ?? '').replace(/\s+/g, ' ').trim().replace(/[.:]+$/, '')
    if (t.length < 3 || t.length > 60) return
    if (GENERIC_HEADING_RE.test(t)) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name: t, url })
  }
  /** 'Leads | Future Media' / 'Kurse – Acme' → 'Leads' / 'Kurse'. */
  const titleName = (title: string | null): string | null => {
    const first = (title ?? '').split(/\s*[|·—–]\s*|\s+-\s+/)[0]?.trim()
    return first || null
  }
  const isUmbrella = (s: string): boolean =>
    /^(unsere\s+)?(leistungen|dienstleistungen|angebote?|services?)$/i.test(s.trim())

  for (const p of crawl.pages) {
    const path = p.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '')
    const topLevel = path !== '' && !path.includes('/')
    const keywordPage = SERVICE_PAGE_RE.test(p.url) || SERVICE_PAGE_RE.test(p.title ?? '')

    // Offering pages name a service themselves (H1 first, title segment second).
    if ((topLevel && !GENERIC_SLUG_RE.test(path)) || keywordPage) {
      const name = p.h1 && !isUmbrella(p.h1) ? p.h1 : titleName(p.title)
      if (name && !isUmbrella(name)) add(name, p.url)
    }
    // Classic 'Leistungen' pages list services as headings.
    if (keywordPage) for (const h of p.headings) add(h, p.url)
  }
  return out.slice(0, 10)
}

/**
 * llms.txt following the llmstxt.org convention (H1, blockquote summary,
 * H2 sections with link lists). The MAIN website is the first content line —
 * an AI reading only this file must resolve the company's primary web
 * identity. When a site crawl is available, a "Hauptseiten" section lists the
 * REAL crawled pages (live URLs + one-line descriptions) before the pack
 * pages, and website.md (the markdown mirror of the main site) is referenced.
 */
export function buildLlmsTxt(
  company: Company,
  pages: PackPageEntry[],
  crawl?: SiteCrawl | null,
): string {
  const site = mainOrigin(company)
  const base = packBaseUrl(company)
  const host = site.replace(/^https?:\/\//, '')
  const mainPages =
    crawl && crawl.pages.length > 0
      ? [
          '## Hauptseiten',
          '',
          ...crawl.pages.map(
            (p) => `- [${mdLabel(crawledPageName(p))}](${p.url}): ${crawledPageDesc(p) || 'Seite der Hauptwebsite.'}`,
          ),
          '',
        ]
      : []
  const lines = [
    `# ${company.name}`,
    '',
    `> Hauptwebsite: ${site} — ${company.sector} in ${company.location}. Dieses Verzeichnis (${base}/) ist der KI-Wissensordner von ${company.name} auf der Hauptdomain.`,
    '',
    '## Hauptwebsite',
    '',
    `- [${host}](${site}): Offizielle Website von ${company.name} — Leistungen, Referenzen und Kontakt.`,
    '',
    ...mainPages,
    '## Seiten',
    '',
    `- [Übersicht](${base}/): Startseite dieses Verzeichnisses mit allen Themen.`,
    ...pages.map((p) => `- [${p.title}](${packUrl(company, p.filename)}): ${p.description}`),
    '',
    '## Ressourcen',
    '',
    ...(crawl && crawl.pages.length > 0
      ? [
          `- [Website-Spiegel](${base}/website.md): Der Inhalt der Hauptwebsite ${host} als Markdown — alle Hauptseiten mit kanonischen Live-Links.`,
        ]
      : []),
    `- [FAQ](${base}/faq.html): Alle häufigen Fragen zu ${company.name} — konsolidiert, mit FAQPage-Markup.`,
    `- [FAQ als JSON-LD](${base}/faq.json): Dasselbe FAQPage-Dokument als reines JSON-LD.`,
    `- [Wissensgraph](${base}/graph.jsonld): Site-weiter JSON-LD-@graph (Organization, LocalBusiness, Services, echte Hauptseiten und alle Seiten dieses Verzeichnisses).`,
    `- [Sitemap](${base}/sitemap.xml): Alle Seiten dieses Verzeichnisses.`,
    '',
  ]
  return lines.join('\n')
}

/** robots.txt — explicitly welcomes AI crawlers, points at the pack sitemap. */
export function buildRobotsTxt(company: Company): string {
  const bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Google-Extended', 'ClaudeBot', 'Bytespider']
  return [
    ...bots.map((b) => `User-agent: ${b}\nAllow: /`),
    '',
    `Sitemap: ${packBaseUrl(company)}/sitemap.xml`,
    '',
  ].join('\n')
}

/**
 * sitemap.xml of the pack — every HTML page with its absolute folder URL,
 * the index (folder root) first, lastmod = generation date.
 */
export function buildSitemapXml(company: Company, htmlFilenames: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const ordered = [
    'index.html',
    ...htmlFilenames.filter((f) => f !== 'index.html'),
  ].filter((f, i, a) => a.indexOf(f) === i)
  const urls = ordered
    .map(
      (f) =>
        `  <url>\n    <loc>${xmlEsc(packUrl(company, f))}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Distinct service labels parsed from the sector string ("A & B, C" → [A, B, C]). */
function servicesFromSector(sector: string): string[] {
  return [
    ...new Set(
      sector
        .split(/\s*(?:[,/|+•]|&| und )\s*/i)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3),
    ),
  ].slice(0, 8)
}

/** ASCII id fragment for a JSON-LD node ('Social Media Agentur' → 'social-media-agentur'). */
function idSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'service'
  )
}

/**
 * graph.jsonld — the standalone site-wide JSON-LD @graph of the pack
 * (served as application/ld+json). With a site crawl available it is a REAL
 * representation of the client's web presence:
 *
 *   - WebSite node for the main domain, hasPart → real pages + pack pages
 *   - one WebPage node per CRAWLED real page (live URL, real title, real
 *     meta/first-text description, detected language)
 *   - Organization/LocalBusiness enriched with the real homepage description
 *     and sameAs links (social profiles found in the crawl + domain hints)
 *   - Service nodes derived from the service headings/pages actually found
 *     in the crawl (sector-label split only as fallback), each pointing at
 *     the live page it was found on
 *   - PLUS one WebPage node per generated pack page, as before
 *
 * Everything is cross-referenced via @id; every node URL points at the live
 * main domain — an AI reading only this file must resolve the company's
 * primary web identity (the backlink requirement).
 */
export function buildSiteGraph(
  company: Company,
  pages: PackPageEntry[],
  crawl?: SiteCrawl | null,
): string {
  const site = mainOrigin(company)
  const today = new Date().toISOString().slice(0, 10)
  const lang = company.language === 'en' ? 'en' : 'de-CH'
  // Same @id convention as the per-page JSON-LD graphs (renderPage), so the
  // entities merge when an AI reads several pack files.
  const orgId = `${site}#organization`
  const bizId = `${site}#localbusiness`
  const webId = `${site}#website`
  const city = company.location.split(',')[0]?.trim() ?? company.location
  const areaServed = (company.locations.length > 0 ? company.locations : [city]).map((l) => ({
    '@type': 'City',
    name: l.split(',')[0]?.trim() ?? l,
  }))
  const ownHost = site.replace(/^https?:\/\//, '').replace(/^www\./, '')
  // Valid external profile URL: parseable, host has a TLD dot, not our host.
  // Filters TLD-less domain-hint variants ('future-media', 'futuremedia').
  const isExternalProfile = (u: string): boolean => {
    if (u === '') return false
    try {
      const host = new URL(u).hostname.replace(/^www\./, '')
      return host.includes('.') && host !== ownHost && !host.startsWith(ownHost)
    } catch {
      return false
    }
  }
  const sameAs = [
    ...new Set(
      [
        ...company.domainHints.map((h) =>
          /^https?:\/\//i.test(h.trim()) ? h.trim() : h.trim() ? `https://${h.trim()}` : '',
        ),
        // Real social-profile links found on the crawled site.
        ...(crawl?.socialLinks ?? []),
      ].filter(isExternalProfile),
    ),
  ]

  // Real description from the crawled homepage (meta or first text) — the
  // profile-derived label is only the fallback.
  const home = crawl?.pages.find((p) => p.url === `${crawl.origin}/`) ?? crawl?.pages[0]
  const realDescription = home ? crawledPageDesc(home, 300) : ''
  const description = realDescription || `${company.sector} in ${company.location}`

  const organization = {
    '@type': 'Organization',
    '@id': orgId,
    name: company.name,
    url: site,
    description,
    areaServed,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  }
  const localBusiness = {
    '@type': 'LocalBusiness',
    '@id': bizId,
    name: company.name,
    url: site,
    description,
    address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'CH' },
    areaServed,
    parentOrganization: { '@id': orgId },
  }

  // Services: from the real site content when the crawl found any, else the
  // sector-label split. Crawled services link the live page they were found on.
  const crawledServices = crawl ? servicesFromCrawl(crawl) : []
  const services =
    crawledServices.length > 0
      ? crawledServices.map((s) => ({
          '@type': 'Service',
          '@id': `${site}#service-${idSlug(s.name)}`,
          name: s.name,
          serviceType: s.name,
          url: s.url,
          provider: { '@id': bizId },
          areaServed,
        }))
      : servicesFromSector(company.sector).map((service) => ({
          '@type': 'Service',
          '@id': `${site}#service-${idSlug(service)}`,
          name: service,
          serviceType: service,
          url: site,
          provider: { '@id': bizId },
          areaServed,
        }))

  // One WebPage node per CRAWLED real page — live URL, real title, real
  // description, detected language.
  const realPages = (crawl?.pages ?? []).map((p) => ({
    '@type': 'WebPage',
    '@id': p.url,
    url: p.url,
    name: crawledPageName(p),
    description: crawledPageDesc(p) || description,
    inLanguage: p.lang === 'en' ? 'en' : p.lang ? `${p.lang}-CH` : lang,
    about: { '@id': orgId },
    isPartOf: { '@id': webId },
  }))

  // The pack's own generated pages, as before.
  const packPages = pages.map((p) => ({
    '@type': 'WebPage',
    '@id': packUrl(company, p.filename),
    url: packUrl(company, p.filename),
    name: p.title,
    description: p.description,
    inLanguage: lang,
    dateModified: today,
    about: { '@id': orgId },
    isPartOf: { '@id': webId },
  }))

  const webSite = {
    '@type': 'WebSite',
    '@id': webId,
    url: site,
    name: company.name,
    description,
    inLanguage: lang,
    publisher: { '@id': orgId },
    hasPart: [
      ...realPages.map((p) => ({ '@id': p['@id'] })),
      ...packPages.map((p) => ({ '@id': p['@id'] })),
    ],
  }

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [organization, localBusiness, ...services, ...realPages, ...packPages, webSite],
  }
  return JSON.stringify(graph, null, 2)
}

/**
 * website.md — the markdown mirror of the crawled MAIN site, written for
 * AI/llms consumption: H1 = company + main URL, a header block declaring
 * this the official content mirror with canonical links, then one `##`
 * section per crawled real page (live URL linked, h2→###/h3→#### headings
 * preserved, paragraphs as readable text).
 */
export function buildWebsiteMd(company: Company, crawl: SiteCrawl): string {
  const site = mainOrigin(company)
  const host = site.replace(/^https?:\/\//, '')
  const en = company.language === 'en'
  const date = crawl.crawledAt.slice(0, 10)
  const lines: string[] = [
    `# ${company.name} — ${site}`,
    '',
    en
      ? `> This document is the official content mirror of https://${host.replace(/^www\./, '')} — the website of ${company.name} (${company.sector}, ${company.location}) — prepared for AI systems and crawlers. Every section links its canonical live URL on the main domain; the live page is always the authoritative source. Crawled: ${date}.`
      : `> Dieses Dokument ist der offizielle Inhalts-Spiegel von https://${host.replace(/^www\./, '')} — der Website von ${company.name} (${company.sector}, ${company.location}) — aufbereitet für KI-Systeme und Crawler. Jeder Abschnitt verlinkt seine kanonische Live-URL auf der Hauptdomain; massgeblich ist immer die Live-Seite. Stand: ${date}.`,
    '',
    en ? `Canonical website: [${host}](${site})` : `Kanonische Website: [${host}](${site})`,
    '',
  ]

  for (const p of crawl.pages) {
    const name = crawledPageName(p)
    const urlLabel = p.url.replace(/^https?:\/\//, '')
    lines.push('---', '', `## ${name}`, '')
    lines.push(
      en
        ? `Canonical URL: [${urlLabel}](${p.url})`
        : `Kanonische URL: [${urlLabel}](${p.url})`,
    )
    lines.push('')
    if (p.metaDescription) {
      lines.push(`*${p.metaDescription}*`, '')
    }
    if (p.h1 && p.h1 !== name) {
      lines.push(`**${p.h1}**`, '')
    }
    for (const b of p.blocks) {
      if (b.tag === 'h2') lines.push(`### ${b.text}`, '')
      else if (b.tag === 'h3') lines.push(`#### ${b.text}`, '')
      else lines.push(b.text, '')
    }
  }
  return lines.join('\n')
}

/** Normalize a question for FAQ dedupe (case/punctuation/whitespace-insensitive). */
function faqKey(q: string): string {
  return q.toLowerCase().replace(/[^a-zäöüa-z0-9]+/gi, ' ').trim()
}

/** Merge FAQ lists, deduping by normalized question (first occurrence wins). */
export function dedupeFaq(...lists: FaqItem[][]): FaqItem[] {
  const seen = new Set<string>()
  const out: FaqItem[] = []
  for (const list of lists) {
    for (const item of list) {
      const key = faqKey(item.q)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/**
 * faq.html — ONE consolidated FAQ page for AI consumption: all Q&As as
 * static h2/h3+p blocks (nothing collapsed or JS-gated) PLUS the complete
 * FAQPage JSON-LD embedded — rendered through the same design shell as the
 * other pages, canonicalized into the pack folder on the main domain.
 */
export function buildFaqPage(company: Company, faq: FaqItem[], design?: ClientDesign): BuiltPage {
  const filename = 'faq.html'
  const city = company.location.split(',')[0]?.trim() ?? company.location
  const en = company.language === 'en'
  const heroLead = en
    ? `${company.name} is a ${company.sector} in ${company.location}. This page answers the most common questions about services, pricing, locations and how to get in touch — every answer is self-contained. Main website: ${company.website}`
    : `${company.name} ist ${company.sector} in ${company.location}. Diese Seite beantwortet die häufigsten Fragen zu Leistungen, Preisen, Standorten und Kontakt — jede Antwort ist eigenständig verständlich. Hauptwebsite: ${company.website}`
  const content: PageContent = {
    pageType: 'faq',
    heroTitle: en ? `Frequently asked questions about ${company.name}` : `Häufige Fragen zu ${company.name}`,
    heroLead,
    seoTitle: `FAQ ${company.name} ${city}`.slice(0, 60),
    stats: [],
    faq,
    sections: [],
    items: [],
    comparison: null,
    table: null,
    keyFacts: [],
    ctaTitle: en ? 'Any question left open?' : 'Ihre Frage ist nicht dabei?',
    ctaText: en
      ? `Ask us directly — you will find all contact options on ${company.website}.`
      : `Stellen Sie sie uns direkt — alle Kontaktmöglichkeiten finden Sie auf ${company.website}.`,
    metaDescription: (en
      ? `All frequently asked questions about ${company.name} — ${company.sector}, ${company.location}.`
      : `Alle häufigen Fragen zu ${company.name} — ${company.sector}, ${company.location}.`
    ).slice(0, 155),
  }
  const html = renderPage(company, content, {
    filename,
    siblings: [],
    schemaType: 'FAQPage',
    targetQuery: en ? `Frequently asked questions about ${company.name}` : `Häufige Fragen zu ${company.name}`,
    canonicalUrl: packUrl(company, filename),
    designTokens: design?.tokens ?? undefined,
    rendered: design?.rendered ?? undefined,
    structure: design?.structure ?? undefined,
  })
  return { filename, html, title: content.heroTitle, description: content.metaDescription, faq }
}

/**
 * faq.json — the bare FAQPage JSON-LD document alone (no HTML), for agents
 * that prefer fetching JSON. Same content as the markup embedded in faq.html.
 */
export function buildFaqJson(company: Company, faq: FaqItem[]): string {
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${packUrl(company, 'faq.html')}#faq`,
    url: packUrl(company, 'faq.html'),
    inLanguage: company.language === 'en' ? 'en' : 'de-CH',
    about: { '@id': `${mainOrigin(company)}#organization`, name: company.name, url: mainOrigin(company) },
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  return JSON.stringify(doc, null, 2)
}

/**
 * DEPLOY.md — short German FTP guide: upload the folder onto the MAIN domain
 * (never a subdomain), verify, submit the sitemap, and how to track AI-bot
 * crawls (server logs/CDN — client-side JS never sees bots).
 */
export function buildDeployMd(company: Company): string {
  const site = mainOrigin(company)
  const base = packBaseUrl(company)
  const host = site.replace(/^https?:\/\//, '')
  return `# Deployment: KI-Crawl-Paket für ${company.name}

Dieses Verzeichnis ist ein fertiges, FTP-taugliches Paket. Alle Canonical-, Sitemap- und
JSON-LD-URLs sind fest auf **${base}/** verankert.

## 1. Upload per FTP

1. Mit dem FTP-Zugang von ${host} verbinden (z. B. FileZilla).
2. Im Webroot der Hauptdomain den Ordner \`/${PACK_FOLDER}/\` anlegen.
3. Den **Inhalt** dieses Verzeichnisses (alle Dateien, ohne DEPLOY.md) nach \`/${PACK_FOLDER}/\` hochladen.
4. Prüfen: ${base}/ zeigt die Übersichtsseite.

**Wichtig — Hauptdomain, kein Subdomain:** Das Paket gehört als Ordner auf die Hauptdomain
(${base}/), nicht auf eine Subdomain wie ki.${host.replace(/^www\./, '')}. Eine Subdomain startet bei
Suchmaschinen und KI-Crawlern mit null Historie und null Autorität; ein Ordner erbt die über Jahre
aufgebaute Autorität der Hauptdomain — die Seiten werden dadurch deutlich schneller gefunden und zitiert.

## 2. Nach dem Upload prüfen

- Jede Seite aufrufen und kontrollieren, dass die Canonical-URL (\`<link rel="canonical">\`) auf ${base}/… zeigt und auflöst.
- ${base}/sitemap.xml, ${base}/graph.jsonld, ${base}/faq.json und ${base}/llms.txt müssen im Browser abrufbar sein.
- Sitemap in der Google Search Console einreichen: Property ${site} → Sitemaps → \`${PACK_FOLDER}/sitemap.xml\`.
- Falls auf der Hauptdomain bereits eine robots.txt existiert: die Zeile \`Sitemap: ${base}/sitemap.xml\` dort ergänzen (die robots.txt in diesem Paket wirkt nur, wenn keine eigene im Webroot liegt).
- **Hinweis zur Sitemap:** Die \`sitemap.xml\` in diesem Paket umfasst NUR die Seiten dieses Verzeichnisses (\`/${PACK_FOLDER}/\`). Die Hauptwebsite behält ihre eigene Sitemap — nichts ersetzen oder zusammenführen. Die echten Hauptseiten sind stattdessen in \`graph.jsonld\`, \`website.md\` und \`llms.txt\` dieses Pakets referenziert.

## 3. Bot-Crawls messen (KI-Traffic)

KI-Crawler (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended) führen **kein
JavaScript** aus — ein Tracking-Snippet im Browser sieht sie deshalb nie. Ehrliche Messung geht nur
über Server- oder CDN-Logs. Zwei empfohlene Wege:

1. **Cloudflare/CDN-Log-Analytics:** Läuft ${host} hinter Cloudflare (oder einem anderen CDN), die
   Log-/Analytics-Ansicht nach den User-Agents \`GPTBot\`, \`ClaudeBot\`, \`PerplexityBot\`,
   \`OAI-SearchBot\` und \`Google-Extended\` auf Pfade unter \`/${PACK_FOLDER}/\` filtern.
2. **Server-Logs an LeadEngine weiterleiten:** Ein kleines Skript (Cron/Log-Hook) postet jeden
   Bot-Treffer aus dem Access-Log an den LeadEngine-Server:

   \`\`\`
   POST http://<leadengine-host>:7002/api/track/bot
   Content-Type: application/json

   {"companyId": "${company.id}", "bot": "GPTBot", "path": "/${PACK_FOLDER}/faq.html"}
   \`\`\`

   Die Plattform schreibt diese Treffer in die Tabelle \`bot_visits\`; das Dashboard zeigt sie in der
   Ansicht «AI-Traffic».

Menschliche Besucher, die über ChatGPT/Perplexity-Links kommen, erfasst dagegen das bestehende
Tracking-Snippet (\`/track.js?company=${company.id}\`) — das sind Browser mit JavaScript.
`
}

// ─── Evidence-based generation ──────────────────────────────────────────────
//
// generateFromEvidence() builds a landing page for one content gap using the
// two evidence layers the platform already collects:
//
//   1. Citation supply chain — the competitor_pages table holds the pages AI
//      engines actually cite (scraped by competitorAnalyzer). We take the
//      pages relevant to the gap, read their winning answer format
//      (faq/table/list/prose), their GEO signals (statistics, FAQ, comparison
//      table) and the cross-page patterns, and feed them into the content
//      writer as the structural template for the decided page type.
//   2. Evidence bundle — the gap's topic cluster (classifyTopic) contributes
//      the verbatim engine answers and the domains the engines cite today,
//      so the copy targets the exact conversation the gap came from.
//
// Design comes from designCloner (screenshots → vision tokens, homepage HTML
// → site structure), cached per company. Every layer degrades gracefully —
// see the fallback notes on generateFromEvidence.

/** Answer format of a winning competitor page (mirrors CompetitorPage). */
type AnswerFormat = NonNullable<CompetitorPage['answerFormat']>

/** When formats tie, the most structured shape wins (same precedence as competitorAnalyzer). */
const FORMAT_PRECEDENCE: AnswerFormat[] = ['faq', 'table', 'list', 'prose']

/** Cap on competitor pages fed into one prompt — enough signal, bounded context. */
const MAX_WINNING_PAGES = 5
/** Cap on verbatim answer excerpts fed into one prompt. */
const MAX_EVIDENCE_EXCERPTS = 3

// ─── Winning competitor pages for a gap ─────────────────────────────────────

/** German stopwords excluded from gap↔page relevance matching. */
const GAP_STOPWORDS = new Set([
  'oder', 'und', 'für', 'mit', 'von', 'dem', 'den', 'der', 'die', 'das',
  'eine', 'einer', 'einem', 'einen', 'ist', 'sind', 'wie', 'was', 'welche',
  'welcher', 'welches', 'kann', 'soll', 'sollte', 'gibt', 'sein', 'haben',
  'wird', 'werden', 'sich', 'nicht', 'auch', 'nur', 'mehr', 'beim', 'zum',
  'zur', 'über', 'gegen', 'ohne', 'nach', 'vor', 'zwischen',
])

/** Lowercased word stems (≥4 chars, no stopwords) used for relevance scoring. */
function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zäöü0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GAP_STOPWORDS.has(w))
}

/**
 * Rank stored competitor pages by relevance to the gap: token overlap between
 * the gap prompt and each page's title/headings/URL. Pages with zero overlap
 * are dropped; when nothing overlaps at all, the most recent pages overall
 * are returned — their format/signals still describe what wins citations in
 * this market, which is better than no evidence.
 */
export function winningPagesForGap(gap: { prompt: string }, pages: CompetitorPage[]): CompetitorPage[] {
  const tokens = significantTokens(gap.prompt)
  const scored = pages
    .map((page) => {
      const haystack = `${page.title ?? ''} ${page.headings.join(' ')} ${page.url}`.toLowerCase()
      let score = 0
      for (const token of tokens) if (haystack.includes(token)) score += 1
      return { page, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  const ranked = scored.map((s) => s.page)
  return (ranked.length > 0 ? ranked : pages).slice(0, MAX_WINNING_PAGES)
}

/**
 * Dominant answer format across the winning pages. Ties break toward the
 * most structured format (faq > table > list > prose) — when in doubt we
 * imitate the shape engines can lift most easily.
 */
export function dominantAnswerFormat(pages: CompetitorPage[]): AnswerFormat {
  const counts = new Map<AnswerFormat, number>()
  for (const p of pages) {
    if (p.answerFormat) counts.set(p.answerFormat, (counts.get(p.answerFormat) ?? 0) + 1)
  }
  let best: AnswerFormat = 'prose'
  let bestCount = 0
  for (const format of FORMAT_PRECEDENCE) {
    const n = counts.get(format) ?? 0
    if (n > bestCount) {
      best = format
      bestCount = n
    }
  }
  return best
}

// ─── Evidence prompt assembly ───────────────────────────────────────────────

/** Same slug rules as intake.slugify, kept local so agents/ stays free of workflow deps. */
function slugifyGap(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'thema'
  )
}

/**
 * Map a content gap onto the PageSpec shape the classic builder consumes
 * (mirrors the mapping in api/routes.ts POST /api/landing-pages).
 */
function gapToSpec(gap: ContentGap): PageSpec {
  return {
    title: gap.prompt,
    slug: `/geo/${slugifyGap(gap.prompt.slice(0, 60))}`,
    targetQuery: gap.prompt,
    answerCapsule: gap.reason,
    schemaType: gap.recommendedFormat === 'faq' ? 'FAQPage' : 'Article',
    priority: 1,
    status: 'done',
  }
}

/**
 * The gap's topic evidence: which engines answer this topic today, how often
 * the client is mentioned/cited, which domains the engines lean on, and
 * verbatim answer excerpts — the conversation the new page must enter.
 * Returns an empty string when the evidence bundle has no cluster for the
 * gap's topic (callers then treat the evidence as missing).
 */
function evidenceBlock(company: Company, gap: ContentGap, evidence: EvidenceBundle): string {
  const topic = classifyTopic(gap.prompt, company)
  const cluster = evidence.topics.find((t) => t.topic === topic)
  if (!cluster) return ''

  const domains =
    cluster.citedDomains
      .slice(0, 5)
      .map((d) => `${d.domain} (${d.citations}×)`)
      .join(', ') || 'none'
  const excerpts = cluster.responses
    .slice(0, MAX_EVIDENCE_EXCERPTS)
    .map((r, i) => `${i + 1}. [${r.engine}] "${r.answerExcerpt}"`)
    .join('\n')

  return `CITATION EVIDENCE for this topic (${topic}, from ${cluster.runsOk} audited AI answers):
- Client mention rate today: ${Math.round(cluster.mentionRate * 100)}%, citation rate: ${Math.round(cluster.citationRate * 100)}% — this page exists to close that gap
- Domains the engines cite for this topic: ${domains}
- Verbatim answers the engines give today:
${excerpts || '(no excerpts)'}`
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Build a landing page for one content gap from citation supply-chain
 * evidence, rendered with the cloned client design.
 *
 * Fallback ladder (never throws, never ships a stub):
 *   - design extraction failure → standard pageShell stylesheet + chrome
 *   - LLM failure → deterministic fallbackContent for the decided page type
 *   - any unexpected error → buildPage() as-is
 * One failing page therefore never sinks the surrounding job.
 *
 * The page type follows decidePageType: the gap's recommendedFormat wins,
 * then the dominant competitor format, then 'guide'. Schema markup comes
 * free from renderPage: a JSON-LD graph with Organization(sameAs),
 * LocalBusiness(areaServed), Service, WebPage(dateModified) plus FAQPage
 * and/or Article, all anchored on the client's own domain.
 */
export async function generateFromEvidence(
  company: Company,
  gap: ContentGap,
  evidence: EvidenceBundle,
): Promise<BuiltPage> {
  const spec = gapToSpec(gap)
  const filename = slugToFilename(spec.slug)

  try {
    // Design is independent of the content path — resolve once (cached),
    // render with it in every branch below when available.
    const design = await cloneClientDesign(company)

    const allPages = listCompetitorPages(company.id)
    const winningPages = winningPagesForGap(gap, allPages)
    const evidenceText = evidenceBlock(company, gap, evidence)
    const pageType = decidePageType(gap, winningPages)

    if (winningPages.length === 0 || evidenceText === '') {
      console.warn(
        `[pageBuilder] ${company.id}: thin competitor/topic evidence for gap ${gap.id} — writer runs on the brief alone`,
      )
    }

    const content =
      (await writePageContent(company, spec, {
        pageType,
        winningPages,
        patterns: identifyPatterns(winningPages),
        evidenceText,
        structure: design.structure,
        masterStyle: design.masterPrompt,
      })) ?? fallbackContent(company, spec, pageType)

    const html = renderPage(company, content, {
      filename,
      siblings: [], // single gap page — no sibling nav
      schemaType: schemaForType(pageType),
      targetQuery: spec.targetQuery,
      canonicalUrl: canonicalFor(company, spec.slug),
      designTokens: design.tokens ?? undefined,
      rendered: design.rendered ?? undefined,
      structure: design.structure ?? undefined,
    })
    return {
      filename,
      html,
      title: spec.title,
      description: content.metaDescription.slice(0, 155),
      faq: content.faq,
    }
  } catch (err) {
    // Last-resort guard: an unexpected failure in the evidence path must not
    // fail the job — fall back to the classic builder, which never throws.
    console.warn(
      `[pageBuilder] generateFromEvidence failed for gap ${gap.id} — falling back to buildPage:`,
      err instanceof Error ? err.message : err,
    )
    return buildPage(company, spec, '', [spec])
  }
}
