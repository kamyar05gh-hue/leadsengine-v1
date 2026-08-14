/**
 * Agent: evidence extractor — turn raw audit records into a verifiable
 * dataset behind the report's percentages.
 *
 * Pure data work: no external calls, everything comes from audit_records
 * via the repo. Prompts are clustered into five fixed topic buckets with
 * deterministic keyword heuristics (DE + EN, the only report languages);
 * per cluster we keep the exact prompts, verbatim answer excerpts (first
 * 300 chars), cited URLs grouped by domain, and mention/citation rates
 * derived with the same helpers the scorer uses (firstIdx / brandCited),
 * so the evidence always reconciles with the headline metrics.
 *
 * Two entry points by design:
 *  - extractEvidence(companyId)        → API layer (pulls from the DB)
 *  - buildEvidenceFromRecords(...)     → report renderer (records already
 *                                        scope-filtered in memory)
 */
import type {
  AuditRecord,
  Company,
  Engine,
  EvidenceBundle,
  EvidenceResponse,
  EvidenceSnippet,
  TopicCluster,
  TopicKey,
  TopDomain,
} from '../types.js'
import { allAuditRecords, getCompany } from '../db/repo.js'
import { firstIdx, round1 } from '../core/scoring.js'
import { brandCited, domainOf } from '../core/citations.js'

/** Answers are excerpted verbatim to this length — enough to verify a
 * mention claim, short enough to keep the payload/report readable. */
export const EXCERPT_LEN = 300

export const TOPIC_ORDER: TopicKey[] = ['pricing', 'comparison', 'local', 'service', 'general']

/**
 * Keyword signals per topic (lowercase substring match, DE + EN).
 * Order matters: classifyTopic returns the FIRST matching bucket, so the
 * most decision-relevant topics (pricing, comparison) win over the generic
 * local/service fallbacks.
 */
const PRICING_RX = /preis|kosten|cost|price|pricing|tarif|gebühr|budget|angebot|chf|franken|wie teuer/
const COMPARISON_RX = /vergleich|vergleichen|versus|\bvs\.?\b|beste|best|\btop\b|alternativ|besser|unterschied| welche/
const LOCAL_RX = /nähe|near|lokal|regional|umgebung|standort/

/**
 * Deterministic topic classifier. `local` also fires when the prompt names
 * the company's own city/region; `service` fires on any significant word
 * from the company's sector. Everything else lands in `general`.
 */
export function classifyTopic(prompt: string, company: Company): TopicKey {
  const p = prompt.toLowerCase()
  if (PRICING_RX.test(p)) return 'pricing'
  if (COMPARISON_RX.test(p)) return 'comparison'
  const locationTokens = company.location
    .toLowerCase()
    .split(/[^a-zäöüéèà]+/)
    .filter((t) => t.length >= 4)
  if (LOCAL_RX.test(p) || locationTokens.some((t) => p.includes(t))) return 'local'
  const sectorTokens = company.sector
    .toLowerCase()
    .split(/[^a-zäöüéèà]+/)
    .filter((t) => t.length >= 4)
  if (sectorTokens.some((t) => p.includes(t))) return 'service'
  return 'general'
}

/** Verbatim excerpt: first EXCERPT_LEN chars, whitespace collapsed. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LEN ? `${flat.slice(0, EXCERPT_LEN)} …` : flat
}

/** Cited URLs grouped by domain, ranked by frequency. */
function groupDomains(records: AuditRecord[]): TopDomain[] {
  const counts = new Map<string, number>()
  for (const r of records) {
    for (const u of r.citedUrls) {
      const d = domainOf(u)
      counts.set(d, (counts.get(d) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([domain, citations]) => ({ domain, citations }))
}

/** Mention/citation rates over a set of ok records (same derivation as scoring). */
function rates(records: AuditRecord[], company: Company): {
  mentionRate: number
  citationRate: number
} {
  if (records.length === 0) return { mentionRate: 0, citationRate: 0 }
  const mentions = records.filter((r) => firstIdx(r.text ?? '', company.aliases) !== null).length
  const citations = records.filter((r) => brandCited(r.citedUrls, company.domainHints)).length
  return {
    mentionRate: round1((100 * mentions) / records.length),
    citationRate: round1((100 * citations) / records.length),
  }
}

/**
 * Build the full evidence bundle from an in-memory record set. Only ok
 * records carry evidence — failed runs have no answer text to verify.
 * `createdAt` is optional so the report renderer can pass its already
 * scope-filtered AuditRecord[] straight in.
 */
export function buildEvidenceFromRecords(
  records: (AuditRecord & { createdAt?: string })[],
  company: Company,
): EvidenceBundle {
  const ok = records.filter((r) => r.ok && r.text)

  // ── cluster every ok record into exactly one topic bucket ──────────────
  type Rec = (typeof records)[number]
  const byTopic = new Map<TopicKey, Rec[]>()
  for (const r of ok) {
    const topic = classifyTopic(r.prompt, company)
    const list = byTopic.get(topic) ?? []
    list.push(r)
    byTopic.set(topic, list)
  }

  const topics: TopicCluster[] = []
  for (const topic of TOPIC_ORDER) {
    const recs = byTopic.get(topic) ?? []
    if (recs.length === 0) continue
    const responses: EvidenceResponse[] = recs.map((r) => ({
      engine: r.engine,
      prompt: r.prompt,
      answerExcerpt: excerpt(r.text ?? ''),
      citedUrls: r.citedUrls,
      mentioned: firstIdx(r.text ?? '', company.aliases) !== null,
      cited: brandCited(r.citedUrls, company.domainHints),
      createdAt: r.createdAt ?? '',
    }))

    const perEngine: TopicCluster['perEngine'] = {}
    for (const eng of new Set(recs.map((r) => r.engine))) {
      const engRecs = recs.filter((r) => r.engine === eng)
      perEngine[eng] = { runsOk: engRecs.length, ...rates(engRecs, company) }
    }

    topics.push({
      topic,
      prompts: [...new Set(recs.map((r) => r.prompt))],
      responses,
      citedDomains: groupDomains(recs),
      runsOk: recs.length,
      ...rates(recs, company),
      perEngine,
    })
  }

  // ── Engine × Topic visibility matrix (mention rate per cell) ───────────
  const visibilityMatrix = Object.fromEntries(
    TOPIC_ORDER.map((t) => [t, {}]),
  ) as EvidenceBundle['visibilityMatrix']
  for (const cluster of topics) {
    for (const [eng, stats] of Object.entries(cluster.perEngine)) {
      visibilityMatrix[cluster.topic][eng as Engine] = stats.mentionRate
    }
  }

  // ── top-10 evidence snippets: client-cited first, then mentioned, then
  // citation-rich answers — the strongest exhibits surface first ──────────
  const allResponses = topics.flatMap((cluster) =>
    cluster.responses.map((r) => ({ ...r, topic: cluster.topic })),
  )
  const topSnippets: EvidenceSnippet[] = allResponses
    .sort(
      (a, b) =>
        Number(b.cited) - Number(a.cited) ||
        Number(b.mentioned) - Number(a.mentioned) ||
        b.citedUrls.length - a.citedUrls.length,
    )
    .slice(0, 10)
    .map((r) => ({
      engine: r.engine,
      topic: r.topic,
      prompt: r.prompt,
      answerExcerpt: r.answerExcerpt,
      citedUrls: r.citedUrls,
      mentioned: r.mentioned,
      cited: r.cited,
    }))

  return {
    companyId: company.id,
    generatedAt: new Date().toISOString(),
    runsOk: ok.length,
    topics,
    visibilityMatrix,
    topSnippets,
  }
}

/** API entry point: load the company + all stored records, then build. */
export function extractEvidence(companyId: string): EvidenceBundle | null {
  const company = getCompany(companyId)
  if (!company) return null
  return buildEvidenceFromRecords(allAuditRecords(companyId), company)
}
