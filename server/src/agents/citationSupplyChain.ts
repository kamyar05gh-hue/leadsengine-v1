/**
 * Agent: citation supply chain — who feeds the engines their answers.
 *
 * Every cited URL in audit_records is grouped by domain. For each domain we
 * report how often it was cited, which engines cited it, which topic
 * clusters it appears in, and which competitor brands co-occur with it —
 * i.e. the competitors mentioned in the same answers that cited the domain.
 *
 * "Cites a competitor" is a CO-OCCURRENCE proxy, not a page-content claim:
 * no external fetches happen in this layer, so we cannot know what a domain
 * literally says. A domain that keeps showing up alongside two or more
 * competitor brands is flagged as a "citation hub" — the places where the
 * competitive narrative is being supplied from, and the highest-leverage
 * targets for listings, PR, or content placement.
 *
 * Entry points mirror evidenceExtractor: analyzeCitationSupplyChain(id) for
 * the API, analyzeSupplyChainFromRecords(records, company) for the report.
 */
import type {
  AuditRecord,
  CitationSupplyChain,
  Company,
  Engine,
  SupplyChainDomain,
  TopicKey,
} from '../types.js'
import { allAuditRecords, getCompany } from '../db/repo.js'
import { domainOf } from '../core/citations.js'
import { discoverCompetitors } from '../core/competitors.js'
import { firstIdx } from '../core/scoring.js'
import { classifyTopic } from './evidenceExtractor.js'

/** A domain co-occurring with at least this many competitor brands is a hub. */
const HUB_MIN_COMPETITORS = 2

/**
 * Build the supply chain from an in-memory record set. Competitors are
 * discovered with the same bolded-name heuristic the scorer uses, so the
 * competitor column reconciles with the rest of the report.
 */
export function analyzeSupplyChainFromRecords(
  records: AuditRecord[],
  company: Company,
): CitationSupplyChain {
  const ok = records.filter((r) => r.ok && r.text)
  const competitors = discoverCompetitors(ok, company).map((c) => c.name)

  // domain → accumulator
  interface DomainAcc {
    citations: number
    competitors: Map<string, number>
    topics: Set<TopicKey>
    engines: Set<Engine>
  }
  const acc = new Map<string, DomainAcc>()

  let totalCitations = 0
  for (const r of ok) {
    if (r.citedUrls.length === 0) continue
    const topic = classifyTopic(r.prompt, company)
    const text = r.text ?? ''
    // competitors named anywhere in this answer, once per answer
    const named = new Set(
      competitors.filter((name) => firstIdx(text, [name]) !== null),
    )
    // count each domain once per record (a repeated URL on one domain is
    // one citation decision, not several)
    const domains = new Set(r.citedUrls.map(domainOf))
    for (const d of domains) {
      totalCitations += 1
      const entry = acc.get(d) ?? {
        citations: 0,
        competitors: new Map<string, number>(),
        topics: new Set<TopicKey>(),
        engines: new Set<Engine>(),
      }
      entry.citations += 1
      entry.topics.add(topic)
      entry.engines.add(r.engine)
      for (const name of named) {
        entry.competitors.set(name, (entry.competitors.get(name) ?? 0) + 1)
      }
      acc.set(d, entry)
    }
  }

  const ownHints = company.domainHints.map((h) => h.toLowerCase())
  const toDomain = ([domain, e]: [string, DomainAcc]): SupplyChainDomain => ({
    domain,
    citations: e.citations,
    isOwn: ownHints.some((h) => domain.includes(h)),
    // most-co-occurring competitors first
    competitors: [...e.competitors.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name),
    topics: [...e.topics].sort(),
    engines: [...e.engines].sort(),
  })

  const domains = [...acc.entries()]
    .map(toDomain)
    .sort((a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain))

  const hubs = domains.filter((d) => d.competitors.length >= HUB_MIN_COMPETITORS)

  return {
    companyId: company.id,
    generatedAt: new Date().toISOString(),
    totalCitations,
    domains,
    hubs,
  }
}

/** API entry point: load the company + all stored records, then analyze. */
export function analyzeCitationSupplyChain(companyId: string): CitationSupplyChain | null {
  const company = getCompany(companyId)
  if (!company) return null
  return analyzeSupplyChainFromRecords(allAuditRecords(companyId), company)
}
