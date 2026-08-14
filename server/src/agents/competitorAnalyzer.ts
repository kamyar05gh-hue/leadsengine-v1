/**
 * Agent: competitor analyzer — reverse-engineers the content strategy of
 * pages that win AI citations alongside competitor brands.
 *
 * Pipeline:
 *   1. The citation supply chain (analyzeCitationSupplyChain) tells us which
 *      cited domains co-occur with competitor brands — i.e. the pages the
 *      engines lean on when they talk about our competitors. Own domains and
 *      domains with zero competitor co-occurrence are excluded.
 *   2. For each such domain we take the top 5 most-cited URLs from the
 *      stored audit records and scrape them with Playwright.
 *   3. Each page is analyzed for content structure (title, meta, headings,
 *      JSON-LD schema, word count), answer format (faq/table/list/prose) and
 *      GEO signals (statistics, FAQ section, comparison table), then stored
 *      in competitor_pages.
 *   4. identifyPatterns() aggregates the stored pages into prevalence
 *      statements ("Winning pages have FAQ schema (80%)") — the actionable
 *      output: what the pages that get cited have in common.
 *
 * HTML parsing is intentionally dependency-free (regex over the raw markup),
 * matching the convention in competitorWatcher.ts — no cheerio in the tree.
 */
import { chromium, type Browser } from 'playwright'
import type { CompetitorPage } from '../types.js'
import { allAuditRecords, insertCompetitorPage } from '../db/repo.js'
import { domainOf } from '../core/citations.js'
import { analyzeCitationSupplyChain } from './citationSupplyChain.js'

// ─── Public result types ────────────────────────────────────────────────────

/** What analyzeCompetitors returns to the caller (API route / workflow). */
export interface CompetitorAnalysisSummary {
  competitorsAnalyzed: number
  pagesScraped: number
  patterns: string[]
}

/** Structural breakdown of one scraped page (pre-persistence). */
export interface ContentStructure {
  title?: string
  metaDescription?: string
  /** H1–H3 texts in document order, capped (see MAX_HEADINGS). */
  headings: string[]
  /** JSON-stringified array of the page's JSON-LD blocks, if any. */
  schemaMarkup?: string
  wordCount: number
}

type AnswerFormat = NonNullable<CompetitorPage['answerFormat']>

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Per-domain cap on scraped pages (spec: top 5 cited pages). */
const TOP_PAGES_PER_DOMAIN = 5
/**
 * Cap on competitor domains analyzed per run. A broad audit can surface
 * 60-100 cited domains (observed: 2,421 citations → 248+ page scrapes and
 * a silently grinding 40+ minute stage); the analysis value concentrates in
 * the most-cited domains, so everything below this rank is skipped and the
 * skip is logged.
 */
const MAX_DOMAINS = Number(process.env.LE_COMPETITOR_MAX_DOMAINS ?? 15)
/** Binary/document URLs Playwright cannot render — always 'Download is starting'. */
const UNRENDERABLE_RX = /\.(pdf|docx?|xlsx?|pptx?|zip|rar)([?#]|$)/i
/** Navigation budget per page — a hung competitor site must not stall the run. */
const NAV_TIMEOUT_MS = 30_000
/** Give client-side rendering a moment to settle after DOMContentLoaded. */
const SETTLE_MS = 1_000
/** Headings kept per page — enough for structure analysis, bounded for storage. */
const MAX_HEADINGS = 40
/** A pattern is only reported when it holds for at least this share of pages. */
const PATTERN_MIN_PREVALENCE = 0.5
/** Word-count threshold for the "long-form content wins" pattern. */
const LONGFORM_WORDS = 1500

// ─── HTML helpers (pure, regex-based) ───────────────────────────────────────

/** Visible-ish text: scripts/styles/tags removed, whitespace collapsed. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

/** Raw JSON-LD payloads from <script type="application/ld+json"> blocks. */
function extractJsonLd(html: string): string[] {
  return [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean)
}

/** True when any JSON-LD block declares the given @type (e.g. 'FAQPage'). */
function hasSchemaType(jsonLd: string[], type: string): boolean {
  return jsonLd.some((block) => block.includes(`"${type}"`))
}

// ─── Analysis helpers (exported per spec) ───────────────────────────────────

/**
 * Extract the structural fingerprint of a page: title, meta description,
 * H1–H3 headings, JSON-LD schema markup and word count of the visible text.
 */
export function analyzeContentStructure(html: string): ContentStructure {
  const title =
    stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') || undefined

  // Meta description: attribute order varies, so try both directions.
  const metaDescription =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1]?.trim() ??
    undefined

  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS)

  const jsonLd = extractJsonLd(html)
  const words = visibleText(html).split(' ').filter(Boolean).length

  const structure: ContentStructure = { headings, wordCount: words }
  if (title) structure.title = title
  if (metaDescription) structure.metaDescription = metaDescription
  if (jsonLd.length > 0) structure.schemaMarkup = JSON.stringify(jsonLd)
  return structure
}

/**
 * Classify the page's dominant answer format — the shape an AI engine would
 * most likely lift into an answer:
 *   faq   — FAQPage schema, ≥3 question-style headings, or ≥3 <dt>/<dd> pairs
 *   table — at least one data table (≥2 rows)
 *   list  — list-heavy (≥5 <li> items across lists)
 *   prose — everything else (paragraph-driven)
 * Precedence is faq > table > list > prose: the most structured signal wins.
 */
export function detectAnswerFormat(html: string): AnswerFormat {
  const jsonLd = extractJsonLd(html)

  const questionHeadings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter((h) => h.endsWith('?')).length
  const definitionTerms = (html.match(/<dt[\s>]/gi) ?? []).length

  if (hasSchemaType(jsonLd, 'FAQPage') || questionHeadings >= 3 || definitionTerms >= 3) {
    return 'faq'
  }

  const hasDataTable = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].some(
    (m) => ((m[0] ?? '').match(/<tr[\s>]/gi) ?? []).length >= 2,
  )
  if (hasDataTable) return 'table'

  const listItems = (html.match(/<li[\s>]/gi) ?? []).length
  if (listItems >= 5) return 'list'

  return 'prose'
}

/**
 * Aggregate scraped pages into prevalence statements about what the winning
 * (i.e. AI-cited) competitor pages have in common. Only patterns holding for
 * ≥ PATTERN_MIN_PREVALENCE of pages are reported, strongest first. Returns an
 * empty array when too few pages were scraped to say anything meaningful.
 */
export function identifyPatterns(pages: CompetitorPage[]): string[] {
  if (pages.length === 0) return []
  const total = pages.length
  const pct = (n: number) => Math.round((n / total) * 100)

  // Each candidate: prevalence count + the statement template.
  const candidates: { count: number; statement: (p: number) => string }[] = [
    {
      count: pages.filter((p) => hasSchemaType(extractJsonLdFromMarkup(p.schemaMarkup), 'FAQPage')).length,
      statement: (p) => `Winning pages have FAQ schema (${p}%)`,
    },
    {
      count: pages.filter((p) => p.hasFaq).length,
      statement: (p) => `Winning pages include a FAQ section (${p}%)`,
    },
    {
      count: pages.filter((p) => (p.wordCount ?? 0) >= LONGFORM_WORDS).length,
      statement: (p) => `Winning pages have ${LONGFORM_WORDS}+ words (${p}%)`,
    },
    {
      count: pages.filter((p) => p.hasComparisonTable).length,
      statement: (p) => `Winning pages use comparison tables (${p}%)`,
    },
    {
      count: pages.filter((p) => p.hasStatistics).length,
      statement: (p) => `Winning pages cite statistics or prices (${p}%)`,
    },
    {
      count: pages.filter((p) => p.schemaMarkup !== undefined).length,
      statement: (p) => `Winning pages use JSON-LD schema markup (${p}%)`,
    },
  ]

  const patterns = candidates
    .filter((c) => c.count / total >= PATTERN_MIN_PREVALENCE)
    .sort((a, b) => b.count - a.count)
    .map((c) => c.statement(pct(c.count)))

  // Dominant answer format, if one shape clearly leads.
  const byFormat = new Map<AnswerFormat, number>()
  for (const p of pages) {
    if (p.answerFormat) byFormat.set(p.answerFormat, (byFormat.get(p.answerFormat) ?? 0) + 1)
  }
  const dominant = [...byFormat.entries()].sort((a, b) => b[1] - a[1])[0]
  if (dominant && dominant[1] / total >= PATTERN_MIN_PREVALENCE) {
    patterns.push(`Winning pages favour the '${dominant[0]}' answer format (${pct(dominant[1])}%)`)
  }

  return patterns
}

/** schemaMarkup is stored as a JSON-stringified string[] — unwrap defensively. */
function extractJsonLdFromMarkup(schemaMarkup: string | undefined): string[] {
  if (!schemaMarkup) return []
  try {
    const parsed: unknown = JSON.parse(schemaMarkup)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

// ─── GEO signal detectors ───────────────────────────────────────────────────

/**
 * Bot-challenge / interstitial pages (Cloudflare "Just a moment...", similar
 * anti-bot walls) — the scrape succeeds but returns no real content, so
 * without this guard they get stored as if they were genuine competitor
 * analysis (observed: gryps.ch, word_count 53, headings empty).
 */
const CHALLENGE_RX =
  /just a moment|checking your browser|enable javascript and cookies|attention required.*cloudflare|ddos protection by cloudflare|verify you are human/i

function looksLikeChallengePage(html: string, structure: ContentStructure): boolean {
  if (CHALLENGE_RX.test(html)) return true
  // genuine pages this short with no headings are vanishingly rare
  return structure.wordCount < 80 && structure.headings.length === 0
}

/** Statistics: percentages, CHF/EUR/USD amounts, or larger figures in text. */
const STATISTICS_RX =
  /\d+(?:[.,]\d+)?\s?%|(?:CHF|EUR|USD|€|\$|Fr\.?)\s?\d[\d'.,]*|\d[\d'.,]{2,}\d/

function detectStatistics(html: string): boolean {
  return STATISTICS_RX.test(visibleText(html))
}

/**
 * FAQ section: FAQPage schema, a heading that names a FAQ block
 * (de/en/fr hints), or repeated question-answer structures.
 */
function detectFaq(html: string): boolean {
  const jsonLd = extractJsonLd(html)
  if (hasSchemaType(jsonLd, 'FAQPage')) return true

  const headingTexts = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((m) =>
    stripTags(m[1] ?? '').toLowerCase(),
  )
  if (
    headingTexts.some((h) =>
      /\bfaq\b|häufige fragen|fragen und antworten|questions fréquentes/.test(h),
    )
  ) {
    return true
  }

  const questionHeadings = headingTexts.filter((h) => h.endsWith('?')).length
  const definitionTerms = (html.match(/<dt[\s>]/gi) ?? []).length
  return questionHeadings >= 3 || definitionTerms >= 3
}

/**
 * Comparison table: a table with ≥2 header cells (option columns) or one
 * whose text carries comparison language (vs / Vergleich / comparaison).
 */
function detectComparisonTable(html: string): boolean {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].some((m) => {
    const table = m[0] ?? ''
    const headerCells = (table.match(/<th[\s>]/gi) ?? []).length
    if (headerCells >= 2) return true
    return /\bvs\.?\b|vergleich|compar(?:ison|aison)|gegenüberstellung/i.test(stripTags(table))
  })
}

// ─── Scraping ───────────────────────────────────────────────────────────────

/**
 * Scrape a single page and return its rendered HTML. Pass a shared `browser`
 * to reuse one Chromium instance across many pages (analyzeCompetitors does);
 * without one, a throwaway instance is launched for this call. Throws on
 * navigation failure — callers decide whether to skip or abort.
 */
export async function scrapeCompetitorPage(url: string, browser?: Browser): Promise<string> {
  const target = url.includes('://') ? url : `https://${url}`
  let ownBrowser: Browser | null = null
  try {
    const activeBrowser = browser ?? (ownBrowser = await chromium.launch({ headless: true }))
    const page = await activeBrowser.newPage()
    try {
      // domcontentloaded (not networkidle): content sites often keep
      // analytics/ads connections open forever, which would burn the timeout.
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      await page.waitForTimeout(SETTLE_MS)
      return await page.content()
    } finally {
      await page.close().catch(() => undefined)
    }
  } finally {
    await ownBrowser?.close().catch(() => undefined)
  }
}

// ─── Page selection ─────────────────────────────────────────────────────────

/**
 * Top cited URLs per domain, ranked by how often audit records cited them.
 * Each URL counts once per record — a repeated URL in one answer is one
 * citation decision, not several (same convention as citationSupplyChain).
 */
export function topCitedUrlsByDomain(
  companyId: string,
  domains: string[],
): Map<string, string[]> {
  const wanted = new Set(domains)
  const counts = new Map<string, Map<string, number>>() // domain → url → citations

  for (const record of allAuditRecords(companyId)) {
    if (!record.ok) continue
    const seenInRecord = new Set<string>()
    for (const url of record.citedUrls) {
      // PDFs/Office docs can't be rendered by the scraper (navigation aborts
      // with 'Download is starting') — exclude them from ranking so they
      // don't occupy a domain's five slots with guaranteed failures.
      if (UNRENDERABLE_RX.test(url)) continue
      const domain = domainOf(url)
      if (!wanted.has(domain) || seenInRecord.has(url)) continue
      seenInRecord.add(url)
      const perDomain = counts.get(domain) ?? new Map<string, number>()
      perDomain.set(url, (perDomain.get(url) ?? 0) + 1)
      counts.set(domain, perDomain)
    }
  }

  const result = new Map<string, string[]>()
  for (const domain of domains) {
    const ranked = [...(counts.get(domain) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([url]) => url)
      .slice(0, TOP_PAGES_PER_DOMAIN)
    if (ranked.length > 0) result.set(domain, ranked)
  }
  return result
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Reverse-engineer competitor content strategies for a company:
 * find cited domains that co-occur with competitor brands, scrape their top
 * pages, analyze structure + GEO signals, persist to competitor_pages, and
 * distill the cross-page patterns. Returns null for unknown companies or
 * when no citation data exists yet; per-page scrape failures are logged and
 * skipped so one broken site never sinks the whole run.
 */
export async function analyzeCompetitors(
  companyId: string,
  onProgress: (scraped: number, total: number) => void = () => {},
): Promise<CompetitorAnalysisSummary | null> {
  const supplyChain = analyzeCitationSupplyChain(companyId)
  if (!supplyChain) {
    console.warn(`[competitor-analyzer] ${companyId}: unknown company — skipped`)
    return null
  }

  // "Citations where competitors are mentioned": the supply chain flags
  // every domain co-occurring with ≥1 competitor brand in the same answers.
  const allCompetitorDomains = supplyChain.domains
    .filter((d) => !d.isOwn && d.competitors.length > 0)
    .map((d) => d.domain)
  // Supply-chain domains are ranked by citation volume; everything below
  // MAX_DOMAINS adds scrape minutes, not insight (see the constant's note).
  const competitorDomains = allCompetitorDomains.slice(0, MAX_DOMAINS)
  if (allCompetitorDomains.length > competitorDomains.length) {
    console.log(
      `[competitor-analyzer] ${companyId}: ${allCompetitorDomains.length} competitor-cited domains — analyzing top ${competitorDomains.length}`,
    )
  }

  if (competitorDomains.length === 0) {
    console.log(`[competitor-analyzer] ${companyId}: no competitor-cited domains — nothing to do`)
    return { competitorsAnalyzed: 0, pagesScraped: 0, patterns: [] }
  }

  const urlsByDomain = topCitedUrlsByDomain(companyId, competitorDomains)
  const totalUrls = [...urlsByDomain.values()].reduce((a, u) => a + u.length, 0)
  const scrapedPages: CompetitorPage[] = []
  let pagesScraped = 0
  let attempted = 0
  let domainsAnalyzed = 0

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })

    for (const domain of competitorDomains) {
      const urls = urlsByDomain.get(domain)
      if (!urls || urls.length === 0) continue
      let domainScraped = 0

      for (const url of urls) {
        attempted += 1
        onProgress(attempted, totalUrls)
        try {
          const html = await scrapeCompetitorPage(url, browser)
          const structure = analyzeContentStructure(html)
          if (looksLikeChallengePage(html, structure)) {
            console.warn(`[competitor-analyzer] ${companyId}: skipped bot-challenge page ${url}`)
            continue
          }
          const page: Omit<CompetitorPage, 'id'> = {
            companyId,
            competitorDomain: domain,
            url,
            headings: structure.headings,
            wordCount: structure.wordCount,
            answerFormat: detectAnswerFormat(html),
            hasStatistics: detectStatistics(html),
            hasFaq: detectFaq(html),
            hasComparisonTable: detectComparisonTable(html),
            scrapedAt: new Date().toISOString(),
          }
          if (structure.title) page.title = structure.title
          if (structure.metaDescription) page.metaDescription = structure.metaDescription
          if (structure.schemaMarkup) page.schemaMarkup = structure.schemaMarkup

          const id = insertCompetitorPage(page)
          scrapedPages.push({ id, ...page })
          pagesScraped += 1
          domainScraped += 1
        } catch (err) {
          console.warn(
            `[competitor-analyzer] ${companyId}: scrape failed for ${url} —`,
            err instanceof Error ? err.message : err,
          )
        }
      }

      if (domainScraped > 0) domainsAnalyzed += 1
    }
  } finally {
    await browser?.close().catch(() => undefined)
  }

  const patterns = identifyPatterns(scrapedPages)
  console.log(
    `[competitor-analyzer] ${companyId}: ${domainsAnalyzed}/${competitorDomains.length} domains, ` +
      `${pagesScraped} pages scraped, ${patterns.length} patterns`,
  )
  return { competitorsAnalyzed: domainsAnalyzed, pagesScraped, patterns }
}
