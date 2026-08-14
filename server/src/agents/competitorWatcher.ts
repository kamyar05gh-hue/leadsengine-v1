/**
 * Competitor watcher — snapshots competitor websites over time and diffs
 * consecutive snapshots for title/meta/heading/pricing changes.
 *
 * Scraping is intentionally NOT wired up yet (spec: structure only):
 * `fetchCompetitorHtml` returns null, so `watchCompetitors` currently
 * diffs whatever snapshots exist in competitor_snapshots. The pure pieces
 * (`extractSnapshot`, `diffSnapshots`) are fully implemented and unit-
 * testable — enabling scraping is a one-line change in `fetchCompetitorHtml`.
 */
import {
  getCompany,
  insertCompetitorSnapshot,
  latestPromptLibrary,
  getAuditRecords,
  latestCompetitorSnapshots,
} from '../db/repo.js'
import { discoverCompetitors } from '../core/competitors.js'
import type { Company, CompetitorChange, CompetitorSnapshot } from '../types.js'

/** What one scrape of a competitor's homepage yields (pre-persistence). */
export interface SiteSnapshot {
  competitorDomain: string
  title: string
  metaDescription: string
  headings: string[]
  pricing: string[]
}

/** Price-looking lines: CHF/EUR/USD amounts, "ab 99.-", "Preis:" sections. */
const PRICE_RX =
  /(?:CHF|EUR|USD|€|\$|Fr\.?)\s?\d[\d'.,]*|\d[\d'.,]*\s?(?:CHF|EUR|€|\$|\.-|Fr\.)/i

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Pure extractor: HTML → SiteSnapshot. Kept dependency-free (regex over the
 * raw HTML) so it runs without a DOM; swap for cheerio when scraping lands.
 */
export function extractSnapshot(domain: string, html: string): SiteSnapshot {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const metaDescription =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1]?.trim() ??
    ''
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter(Boolean)
    .slice(0, 30)
  const pricing = [...new Set(
    stripTags(html)
      .split(/(?<=[.!?])\s+|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.length < 200 && PRICE_RX.test(s)),
  )].slice(0, 20)
  return { competitorDomain: domain, title, metaDescription, headings, pricing }
}

/**
 * Fetch a competitor homepage. STUB: returns null — no network calls until
 * scraping is approved/enabled. Signature is final.
 */
export async function fetchCompetitorHtml(domain: string): Promise<string | null> {
  // TODO(scraping): fetch(`https://${domain}`) with timeout + UA header,
  // then feed the body through extractSnapshot(). Disabled per spec.
  void domain
  return null
}

/**
 * Domains to watch: verified competitor domains are not known yet, so we
 * derive best-guess .ch domains from configured + discovered competitor names.
 */
export function competitorDomains(company: Company, discoveredNames: string[]): string[] {
  const names = [...new Set([...company.competitors, ...discoveredNames])]
  return names.map((name) => {
    const slug = name
      .toLowerCase()
      .replace(/\b(ag|gmbh|sa|sàrl|ltd|inc|gruppe|group)\b/g, '')
      .replace(/[^a-z0-9]+/g, '')
    return `${slug}.ch` // TODO: replace guess with verified domain lookup
  })
}

/** Diff two consecutive snapshots of the same domain. */
export function diffSnapshots(
  prev: SiteSnapshot,
  next: SiteSnapshot,
): CompetitorChange[] {
  const changes: CompetitorChange[] = []
  const domain = next.competitorDomain
  if (prev.title !== next.title) {
    changes.push({ competitorDomain: domain, kind: 'title', detail: `"${prev.title}" → "${next.title}"` })
  }
  if (prev.metaDescription !== next.metaDescription) {
    changes.push({ competitorDomain: domain, kind: 'meta', detail: 'meta description changed' })
  }
  const addedH = next.headings.filter((h) => !prev.headings.includes(h))
  const removedH = prev.headings.filter((h) => !next.headings.includes(h))
  if (addedH.length || removedH.length) {
    changes.push({
      competitorDomain: domain,
      kind: 'headings',
      detail: `+${addedH.length}/-${removedH.length} headings` +
        (addedH.length ? ` (new: ${addedH.slice(0, 3).join('; ')})` : ''),
    })
  }
  const addedP = next.pricing.filter((p) => !prev.pricing.includes(p))
  const removedP = prev.pricing.filter((p) => !next.pricing.includes(p))
  if (addedP.length || removedP.length) {
    changes.push({
      competitorDomain: domain,
      kind: 'pricing',
      detail: `pricing lines changed: +${addedP.length}/-${removedP.length}` +
        (addedP.length ? ` (new: ${addedP.slice(0, 3).join('; ')})` : ''),
    })
  }
  return changes
}

/**
 * One watch cycle for a company: scrape each top competitor (stubbed),
 * persist snapshots, and diff against the previous snapshot per domain.
 * Returns the changes detected across all competitors.
 */
export async function watchCompetitors(companyId: string): Promise<CompetitorChange[] | null> {
  const company = getCompany(companyId)
  if (!company) {
    console.warn(`[competitor-watcher] ${companyId}: unknown company — skipped`)
    return null
  }

  const library = latestPromptLibrary(companyId)
  const discovered = library
    ? discoverCompetitors(getAuditRecords(companyId, library.id), company, 7).map((c) => c.name)
    : []
  const domains = competitorDomains(company, discovered)
  if (domains.length === 0) {
    console.log(`[competitor-watcher] ${companyId}: no competitors known — skipped`)
    return []
  }

  const prevByDomain = new Map(
    latestCompetitorSnapshots(companyId).map((s) => [s.competitorDomain, s]),
  )
  const changes: CompetitorChange[] = []
  let scraped = 0

  for (const domain of domains) {
    const html = await fetchCompetitorHtml(domain)
    if (html === null) continue // scraping disabled — nothing to persist yet
    const next = extractSnapshot(domain, html)
    const prev = prevByDomain.get(domain)
    if (prev) changes.push(...diffSnapshots(prev, next))
    insertCompetitorSnapshot({
      companyId,
      ...next,
      scrapedAt: new Date().toISOString(),
    })
    scraped += 1
  }

  console.log(
    `[competitor-watcher] ${companyId}: ${scraped}/${domains.length} scraped, ${changes.length} changes` +
      (scraped === 0 ? ' (scraping disabled)' : ''),
  )
  return changes
}
