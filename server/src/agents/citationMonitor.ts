/**
 * Citation monitor — aggregates every cited URL in audit_records by domain
 * and tracks, per domain, how often it appears alongside the company vs
 * alongside competitors, and in which prompt types.
 *
 * "Opportunity domains" cite competitors but never us — the outreach and
 * digital-PR target list. Pure DB analysis, no network calls.
 */
import {
  getAuditRecords,
  getCompany,
  latestPromptLibrary,
  listCitationSources,
  upsertCitationSource,
} from '../db/repo.js'
import { domainOf } from '../core/citations.js'
import { aliasPattern, clientPattern } from '../core/regex.js'
import type { AuditRecord, CitationSource, Company } from '../types.js'

/** Minimum competitor citations before a domain counts as an opportunity. */
const OPPORTUNITY_MIN_COMPETITOR_CITATIONS = 2

export interface CitationMonitorResult {
  sources: CitationSource[]
  opportunities: CitationSource[]
}

interface DomainBucket {
  companyCitations: number
  competitorCitations: number
  promptTypes: Set<string>
}

/** Prompt-type label for a record: scope/persona, e.g. "regional/avatar". */
function promptTypeOf(r: AuditRecord): string {
  return `${r.scope}/${r.persona}`
}

/** Aggregate cited domains across all stored audit records of a company. */
export function aggregateCitationDomains(
  records: AuditRecord[],
  company: Company,
): Map<string, DomainBucket> {
  const clientRx = clientPattern(company)
  const competitorRx = aliasPattern(company.competitors)
  const buckets = new Map<string, DomainBucket>()

  for (const r of records) {
    if (!r.ok) continue
    const mentionsCompany = clientRx.test(r.text ?? '')
    const mentionsCompetitor = company.competitors.length > 0 && competitorRx.test(r.text ?? '')
    for (const url of r.citedUrls) {
      const domain = domainOf(url)
      if (!domain) continue
      let bucket = buckets.get(domain)
      if (!bucket) {
        bucket = { companyCitations: 0, competitorCitations: 0, promptTypes: new Set() }
        buckets.set(domain, bucket)
      }
      // A source can back both sides — count each context independently.
      if (mentionsCompany) bucket.companyCitations += 1
      if (mentionsCompetitor) bucket.competitorCitations += 1
      bucket.promptTypes.add(promptTypeOf(r))
    }
  }
  return buckets
}

/** Opportunity = competitors get cited from this domain, we never do. */
export function isOpportunity(src: Pick<CitationSource, 'companyCitations' | 'competitorCitations'>): boolean {
  return (
    src.companyCitations === 0 &&
    src.competitorCitations >= OPPORTUNITY_MIN_COMPETITOR_CITATIONS
  )
}

/**
 * Rebuild the citation_sources table for a company from its latest audit
 * records and return the stored rows plus the opportunity subset.
 */
export async function monitorCitationSources(
  companyId: string,
): Promise<CitationMonitorResult | null> {
  const company = getCompany(companyId)
  if (!company) {
    console.warn(`[citation-monitor] ${companyId}: unknown company — skipped`)
    return null
  }
  const library = latestPromptLibrary(companyId)
  if (!library) {
    console.warn(`[citation-monitor] ${companyId}: no prompt library — skipped`)
    return null
  }

  const buckets = aggregateCitationDomains(getAuditRecords(companyId, library.id), company)
  const now = new Date().toISOString()
  for (const [domain, b] of buckets) {
    upsertCitationSource({
      companyId,
      domain,
      companyCitations: b.companyCitations,
      competitorCitations: b.competitorCitations,
      promptTypes: [...b.promptTypes].sort(),
      lastSeen: now,
    })
  }

  const sources = listCitationSources(companyId)
  const opportunities = sources.filter(isOpportunity)
  console.log(
    `[citation-monitor] ${companyId}: ${sources.length} domains, ${opportunities.length} opportunities`,
  )
  return { sources, opportunities }
}
