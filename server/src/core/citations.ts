/**
 * Citation classification + brand citation/sentiment helpers.
 * Ported from leadengine/client_haubi.py (DIRECTORY_DOMAINS, EARNED_HINTS),
 * leadengine/run_audit.py score() domain classification, and
 * geo/parse.py (brand_cited, sentiment).
 */
import type { AuditRecord, CitationClass, Company, TopDomain } from '../types.js'

/** Swiss directory / listing domains (substring match against host). */
export const DIRECTORY_DOMAINS: string[] = [
  'local.ch', 'search.ch', 'doktor.ch', 'onedoc.ch', 'medicosearch',
  'comparis.ch', 'google.', 'bing.', 'yellow', 'tel.search',
  'kennstdueinen', 'wlw.de', 'wlw.ch', 'onlineinfo.ch', 'moneyhouse',
  'linkedin.', 'xing.', 'houzz',
  // agency/services marketplaces + rating directories (marketing niche)
  'sortlist', 'clutch.co', 'gryps', 'help.ch', 'localsearch',
  'firmenverzeichnis', 'trustpilot', 'provenexpert', 'kununu',
]

/** Earned media: press / trade publications (substring match against host). */
export const EARNED_HINTS: string[] = [
  '20min', 'nzz', 'bernerzeitung', 'bz', 'tagesanzeiger',
  'watson', 'blick', 'srf', 'handelszeitung', 'baublatt',
  'architektur', 'hochparterre',
]

export type Sentiment = 'positive' | 'neutral' | 'negative'

/** Positive signals for the sentence-window sentiment heuristic (geo/parse.py). */
const POSITIVE = [
  'empfehl', 'recommend', 'best', 'top', 'leading', 'excellent', 'hervorragend',
  'recommande', 'meilleur', 'trusted', 'renommiert', 'beliebt',
]
/** Negative signals for the sentence-window sentiment heuristic (geo/parse.py). */
const NEGATIVE = [
  'avoid', 'nicht empfehl', 'schlecht', 'poor', 'complaint', 'beschwerde',
  'closed', 'geschlossen', 'déconseill', 'warning',
]

/**
 * Host part of a URL, lowercased, leading "www." stripped.
 * Mirrors Python: `u.lower().split("/")[2] if "://" in u else u.lower()`,
 * i.e. URLs without a protocol are kept whole (path included).
 */
export function domainOf(url: string): string {
  const low = url.toLowerCase()
  const host = low.includes('://') ? (low.split('/')[2] ?? low) : low
  return host.replace(/^www\./, '')
}

/**
 * Classify every cited URL in ok records into own / directories / earned /
 * other, and rank the top 12 cited domains for the donut chart.
 */
export function classifyCitations(
  records: AuditRecord[],
  company: Company,
): { classes: Record<CitationClass, number>; topDomains: TopDomain[] } {
  const classes: Record<CitationClass, number> = { own: 0, directories: 0, earned: 0, other: 0 }
  const domainCounts = new Map<string, number>()

  for (const r of records) {
    if (!r.ok) continue
    for (const u of r.citedUrls) {
      const dom = domainOf(u)
      domainCounts.set(dom, (domainCounts.get(dom) ?? 0) + 1)
      if (company.domainHints.some((h) => dom.includes(h))) classes.own += 1
      else if (DIRECTORY_DOMAINS.some((d) => dom.includes(d))) classes.directories += 1
      else if (EARNED_HINTS.some((e) => dom.includes(e))) classes.earned += 1
      else classes.other += 1
    }
  }

  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([domain, citations]) => ({ domain, citations }))
  return { classes, topDomains }
}

/** True if any cited URL contains any domain hint (geo/parse.py brand_cited). */
export function brandCited(citedUrls: string[], domainHints: string[]): boolean {
  const low = citedUrls.map((u) => u.toLowerCase())
  return low.some((u) => domainHints.some((d) => u.includes(d)))
}

/**
 * Sentence-window sentiment heuristic around the first brand mention
 * (geo/parse.py sentiment): ±220 chars around the first alias hit, count
 * positive/negative signal words. Python returns "none" when no alias is
 * found; here that maps to 'neutral' — callers in this core only invoke it
 * for records where the client is mentioned anyway.
 */
export function sentiment(text: string, aliases: string[]): Sentiment {
  const low = text.toLowerCase()
  let hit = -1
  for (const a of aliases) {
    hit = low.indexOf(a.toLowerCase())
    if (hit >= 0) break
  }
  if (hit < 0) return 'neutral'
  const window = low.slice(Math.max(0, hit - 220), hit + 220)
  const pos = POSITIVE.filter((w) => window.includes(w)).length
  const neg = NEGATIVE.filter((w) => window.includes(w)).length
  if (neg > pos) return 'negative'
  if (pos > 0) return 'positive'
  return 'neutral'
}
