/**
 * Citation verifier — fetches every URL an AI engine cited and checks the
 * page actually mentions the brand. AI answers routinely cite URLs that
 * 404, redirect, or never mention the client; this agent turns "cited" into
 * "verified" and persists the evidence in `verified_citations`.
 *
 * Structure:
 * - `verifyCitations`   — entry point: one shared headless Chromium, a
 *                         worker pool (max 5 pages), one DB row per URL.
 * - `fetchAndVerify`    — load one URL, detect a brand mention.
 * - `extractCitationContext` / `extractPageMetadata` — pure, regex-based
 *                         HTML extractors (no DOM needed, unit-testable).
 *
 * Failure policy: any single-URL failure (timeout, HTTP error, crash) is
 * logged and stored as an unverified row — it never aborts the batch.
 */
import { chromium, type Browser, type Page } from 'playwright'
import { getCompany, insertVerifiedCitation } from '../db/repo.js'

/** Per-page navigation budget — a hung page must not stall the batch. */
const PAGE_TIMEOUT_MS = 10_000
/** Max pages fetched at once; each worker reuses one Page for its URLs. */
const MAX_CONCURRENT = 5
/** Characters of surrounding text kept on each side of a brand mention. */
const CONTEXT_RADIUS = 100
/** Desktop UA — some sites serve empty shells to obvious bots. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Batch result returned by `verifyCitations`. */
export interface VerificationSummary {
  total: number
  verified: number
  failed: number
}

/** Page-level metadata extracted from the raw HTML. */
export interface PageMetadata {
  title?: string
  /** JSON-LD blocks serialized as a JSON string (ready for page_schema). */
  schemaMarkup?: string
  headings: string[]
}

/** Outcome of fetching and checking a single URL (pre-persistence). */
export interface CitationFetchResult {
  url: string
  mentionsBrand: boolean
  citationContext?: string
  metadata: PageMetadata
  /** Set when the page could not be loaded/checked (timeout, 4xx/5xx, …). */
  error?: string
}

// ─── pure HTML helpers ──────────────────────────────────────────────────────

/** Tags → text: drop markup/scripts/styles, collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First alias present in `text` (case-insensitive), longest match wins. */
function findBrandMention(text: string, aliases: string[]): string | undefined {
  const haystack = text.toLowerCase()
  return [...aliases]
    .filter((a) => a.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .find((alias) => haystack.includes(alias.toLowerCase()))
}

/**
 * Extract the text surrounding a brand mention: up to CONTEXT_RADIUS chars
 * before and after, with ellipses marking truncation. Returns undefined when
 * the mention is not found.
 */
export function extractCitationContext(
  html: string,
  brandMention: string,
): string | undefined {
  const text = htmlToText(html)
  const idx = text.toLowerCase().indexOf(brandMention.toLowerCase())
  if (idx === -1) return undefined
  const start = Math.max(0, idx - CONTEXT_RADIUS)
  const end = Math.min(text.length, idx + brandMention.length + CONTEXT_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

/**
 * Pull title, JSON-LD schema blocks and H1–H3 headings out of raw HTML.
 * Kept dependency-free (regex over the string) like the other extractors
 * in this codebase — no cheerio/DOM required.
 */
export function extractPageMetadata(html: string): PageMetadata {
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const title = rawTitle ? htmlToText(rawTitle) : undefined

  const jsonLdBlocks = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean)
  const schemaMarkup =
    jsonLdBlocks.length > 0 ? JSON.stringify(jsonLdBlocks) : undefined

  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => htmlToText(m[1] ?? ''))
    .filter(Boolean)
    .slice(0, 30)

  return { title, schemaMarkup, headings }
}

// ─── page fetching ──────────────────────────────────────────────────────────

/** Load one URL in an existing page and run the brand-mention check. */
async function verifyWithPage(
  page: Page,
  url: string,
  aliases: string[],
): Promise<CitationFetchResult> {
  try {
    // domcontentloaded is enough — we only need the HTML, not every asset.
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS,
    })
    if (!response) {
      return { url, mentionsBrand: false, metadata: { headings: [] }, error: 'no response' }
    }
    const status = response.status()
    if (status >= 400) {
      return {
        url,
        mentionsBrand: false,
        metadata: { headings: [] },
        error: `HTTP ${status}`,
      }
    }

    const html = await page.content()
    const metadata = extractPageMetadata(html)
    const mention = findBrandMention(htmlToText(html), aliases)
    return {
      url,
      mentionsBrand: mention !== undefined,
      citationContext: mention ? extractCitationContext(html, mention) : undefined,
      metadata,
    }
  } catch (err) {
    // Timeouts, DNS failures, TLS errors, crashes — all land here.
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { url, mentionsBrand: false, metadata: { headings: [] }, error: message }
  }
}

/**
 * Fetch a URL and check whether the page mentions any of the brand aliases.
 * Pass a shared `page` to reuse a browser instance; without one a throwaway
 * headless browser is launched (handy for one-off checks/tests).
 * Never throws — failures come back as `{ mentionsBrand: false, error }`.
 */
export async function fetchAndVerify(
  url: string,
  aliases: string[],
  page?: Page,
): Promise<CitationFetchResult> {
  if (page) return verifyWithPage(page, url, aliases)
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const ownPage = await browser.newPage({ userAgent: USER_AGENT })
    return await verifyWithPage(ownPage, url, aliases)
  } finally {
    await browser?.close()
  }
}

// ─── batch verification ─────────────────────────────────────────────────────

/**
 * Verify every cited URL of one audit record against the company's brand
 * (name + aliases). Each URL gets a row in `verified_citations` — verified
 * or not — so the report can distinguish "cited" from "actually cites us".
 *
 * One headless Chromium is shared across the batch; a worker pool of at
 * most MAX_CONCURRENT pages processes the URL list, each worker reusing a
 * single Page. Individual failures are logged and never abort the batch.
 */
export async function verifyCitations(
  companyId: string,
  auditRecordId: number,
  citedUrls: string[],
): Promise<VerificationSummary> {
  const company = getCompany(companyId)
  if (!company) {
    throw new Error(`[citation-verifier] unknown company: ${companyId}`)
  }
  // Brand identity = canonical name plus configured aliases, deduped.
  const aliases = [...new Set([company.name, ...company.aliases])]
  const urls = [...new Set(citedUrls)]
  if (urls.length === 0) return { total: 0, verified: 0, failed: 0 }

  let verified = 0
  let failed = 0
  let nextIndex = 0 // shared cursor — safe: workers interleave only at awaits

  const browser = await chromium.launch({ headless: true })
  try {
    const workerCount = Math.min(MAX_CONCURRENT, urls.length)
    const workers = Array.from({ length: workerCount }, async () => {
      const page = await browser.newPage({ userAgent: USER_AGENT })
      page.setDefaultTimeout(PAGE_TIMEOUT_MS)
      try {
        while (nextIndex < urls.length) {
          const url = urls[nextIndex++] as string
          const result = await fetchAndVerify(url, aliases, page)
          if (result.error) {
            console.warn(`[citation-verifier] ${url}: ${result.error}`)
          }
          insertVerifiedCitation({
            auditRecordId,
            url,
            actuallyCitesBrand: result.mentionsBrand,
            citationContext: result.citationContext,
            pageTitle: result.metadata.title,
            pageSchema: result.metadata.schemaMarkup,
            verifiedAt: new Date().toISOString(),
          })
          if (result.mentionsBrand) verified += 1
          else failed += 1
        }
      } finally {
        await page.close()
      }
    })
    await Promise.all(workers)
  } finally {
    await browser.close()
  }

  const summary = { total: urls.length, verified, failed }
  console.log(
    `[citation-verifier] audit #${auditRecordId}: ` +
      `${verified}/${summary.total} verified, ${failed} failed`,
  )
  return summary
}

// ─── batch verification (whole audit at once) ───────────────────────────────

/** One audit record's citation set, as the batch entry point consumes it. */
export interface RecordCitations {
  id: number
  citedUrls: string[]
}

export interface BatchVerifySummary {
  /** Distinct URLs actually fetched (after cross-record dedupe + cap). */
  urlsFetched: number
  /** Distinct URLs skipped by the cap. */
  urlsSkipped: number
  /** Rows written to verified_citations (one per record × URL pair). */
  rowsStored: number
  verified: number
  failed: number
}

/**
 * Cap on distinct URLs fetched per audit. Beyond this the verification value
 * flattens (the long tail is one-off citations) while the wall-clock keeps
 * growing — an uncapped run fetched 2,421 URLs sequentially for 90 minutes.
 */
const MAX_BATCH_URLS = Number(process.env.LE_VERIFY_MAX_URLS ?? 500)

/**
 * Verify every record's citations in ONE pass: a single shared Chromium for
 * the whole audit (the per-record entry point above launches a browser per
 * call — fine for one record, ruinous for 200), URLs deduplicated ACROSS
 * records (an answer set citing sortlist.ch fifty times costs one fetch, not
 * fifty), and a global cap prioritizing the client's own domains first, then
 * the most-cited URLs — exactly the ones the report reasons about.
 *
 * Rows are still written per (record, URL) pair from the shared verdict, so
 * the stored shape is identical to per-record verification. URLs beyond the
 * cap get NO row: absent-from-map renders as "pending" downstream, never as
 * a false "not verified".
 */
export async function verifyCitationsBatch(
  companyId: string,
  records: RecordCitations[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<BatchVerifySummary> {
  const company = getCompany(companyId)
  if (!company) {
    throw new Error(`[citation-verifier] unknown company: ${companyId}`)
  }
  const aliases = [...new Set([company.name, ...company.aliases])]

  // Rank distinct URLs: own-domain first, then by citation frequency.
  const freq = new Map<string, number>()
  for (const r of records) {
    for (const url of new Set(r.citedUrls)) freq.set(url, (freq.get(url) ?? 0) + 1)
  }
  const isOwn = (url: string): boolean =>
    company.domainHints.some((h) => url.toLowerCase().includes(h.toLowerCase()))
  const ranked = [...freq.keys()].sort(
    (a, b) => Number(isOwn(b)) - Number(isOwn(a)) || (freq.get(b) ?? 0) - (freq.get(a) ?? 0),
  )
  const toFetch = ranked.slice(0, MAX_BATCH_URLS)
  const skipped = ranked.length - toFetch.length
  if (skipped > 0) {
    console.log(
      `[citation-verifier] ${companyId}: ${ranked.length} distinct URLs — verifying top ${toFetch.length} (own domains + most-cited)`,
    )
  }

  const verdicts = new Map<string, CitationFetchResult>()
  if (toFetch.length > 0) {
    let nextIndex = 0
    let done = 0
    const browser = await chromium.launch({ headless: true })
    try {
      const workers = Array.from({ length: Math.min(MAX_CONCURRENT, toFetch.length) }, async () => {
        const page = await browser.newPage({ userAgent: USER_AGENT })
        page.setDefaultTimeout(PAGE_TIMEOUT_MS)
        try {
          while (nextIndex < toFetch.length) {
            const url = toFetch[nextIndex++] as string
            const result = await fetchAndVerify(url, aliases, page)
            if (result.error) console.warn(`[citation-verifier] ${url}: ${result.error}`)
            verdicts.set(url, result)
            done += 1
            onProgress(done, toFetch.length)
          }
        } finally {
          await page.close()
        }
      })
      await Promise.all(workers)
    } finally {
      await browser.close()
    }
  }

  // Persist per (record, URL) from the shared verdicts.
  const summary: BatchVerifySummary = {
    urlsFetched: toFetch.length,
    urlsSkipped: skipped,
    rowsStored: 0,
    verified: 0,
    failed: 0,
  }
  const now = new Date().toISOString()
  for (const r of records) {
    for (const url of new Set(r.citedUrls)) {
      const v = verdicts.get(url)
      if (!v) continue // beyond the cap — stays "pending", never a false negative
      insertVerifiedCitation({
        auditRecordId: r.id,
        url,
        actuallyCitesBrand: v.mentionsBrand,
        citationContext: v.citationContext,
        pageTitle: v.metadata.title,
        pageSchema: v.metadata.schemaMarkup,
        verifiedAt: now,
      })
      summary.rowsStored += 1
      if (v.mentionsBrand) summary.verified += 1
      else summary.failed += 1
    }
  }
  console.log(
    `[citation-verifier] ${companyId}: batch — ${summary.urlsFetched} URLs fetched, ` +
      `${summary.rowsStored} rows, ${summary.verified} verified`,
  )
  return summary
}
