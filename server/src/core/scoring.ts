/**
 * Scoring core — turns raw audit records into the metrics contract.
 * Ported from leadengine/run_audit.py (score, _first_idx, _top_comp_sov,
 * _wavg, _overall_rank), leadengine/pdf_sales.py (tier_mention) and
 * leadengine/pdf_final.py (brand_engine_stats).
 *
 * All percentages are rounded to 1 decimal like Python's round(x, 1).
 */
import type {
  AuditRecord,
  AuditScore,
  Company,
  Competitor,
  Engine,
  EngineStats,
  OverallStats,
  ScopedScore,
} from '../types.js'
import { clientPattern } from './regex.js'
import { discoverCompetitors } from './competitors.js'
import { brandCited, classifyCitations, sentiment } from './citations.js'
import type { Sentiment } from './citations.js'

/**
 * Round like Python's round(): round-half-to-EVEN (banker's rounding),
 * not Math.round's half-up. Keeps TS output identical to the Python pipeline
 * on exact .5 boundaries.
 */
export function roundHalfEven(x: number, digits: number): number {
  const f = 10 ** digits
  const scaled = x * f
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let r: number
  if (diff > 0.5) r = floor + 1
  else if (diff < 0.5) r = floor
  else r = floor % 2 === 0 ? floor : floor + 1 // exact half → even neighbor
  return r / f
}

/** Python round(x, 1). */
export const round1 = (x: number): number => roundHalfEven(x, 1)
/** Python round(x). */
export const round0 = (x: number): number => roundHalfEven(x, 0)

/**
 * Index of the earliest occurrence of any name in text (case-insensitive
 * substring), or null if none appears. Ported from run_audit._first_idx.
 */
export function firstIdx(text: string, names: string[]): number | null {
  const low = text.toLowerCase()
  let best: number | null = null
  for (const n of names) {
    const i = low.indexOf(n.toLowerCase())
    if (i >= 0 && (best === null || i < best)) best = i
  }
  return best
}

/** run_audit._wavg: average a per-engine metric weighted by runs_ok. */
function wavg(
  perEngine: Partial<Record<Engine, EngineStats>>,
  key: 'mentionRate' | 'citationRate' | 'sov',
): number {
  let sum = 0
  let weight = 0
  for (const e of Object.values(perEngine)) {
    if (!e) continue
    sum += e[key] * e.runsOk
    weight += e.runsOk
  }
  return weight > 0 ? sum / weight : 0
}

/** run_audit._overall_rank: unweighted mean of per-engine avg ranks (truthy only). */
function overallRank(perEngine: Partial<Record<Engine, EngineStats>>): number | null {
  const vals = Object.values(perEngine)
    .map((e) => e?.avgRank)
    .filter((v): v is number => typeof v === 'number' && v > 0)
  return vals.length > 0 ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

/**
 * run_audit._top_comp_sov: highest per-competitor share of voice across all
 * ok runs. Denominator = client hits + all competitor hits.
 */
function topCompetitorSov(records: AuditRecord[], company: Company, compNames: string[]): number {
  const ok = records.filter((r) => r.ok)
  const clientHits = ok.filter((r) => firstIdx(r.text ?? '', company.aliases) !== null).length
  let compTotal = 0
  const perComp = new Map<string, number>()
  for (const cn of compNames) {
    const hits = ok.filter((r) => firstIdx(r.text ?? '', [cn]) !== null).length
    perComp.set(cn, hits)
    compTotal += hits
  }
  const total = clientHits + compTotal
  let best = 0
  for (const hits of perComp.values()) {
    if (total > 0) best = Math.max(best, (100 * hits) / total)
  }
  return round1(best)
}

/**
 * Full audit score: per-engine stats, weighted overall, citation classes,
 * top domains, and brand mention counts. Ported from run_audit.score().
 *
 * - mention/citation rates: % of the engine's ok runs
 * - sov: client brand hits / (client + competitor brand hits), per engine
 * - avgRank: 1 + competitors appearing before the client (mentioned runs only)
 * - sentimentPosPct: % of mentioned runs with positive window sentiment
 * - overall: runs-ok-weighted average across engines
 * - brandMentions: hits per competitor name + the client (under company.name)
 */
export function scoreRecords(
  records: AuditRecord[],
  company: Company,
  competitors: Competitor[],
): AuditScore {
  const compNames = competitors.map((c) => c.name)
  const perEngine: Partial<Record<Engine, EngineStats>> = {}

  for (const eng of new Set(records.map((r) => r.engine))) {
    const recs = records.filter((r) => r.engine === eng && r.ok)
    if (recs.length === 0) continue
    let mentions = 0
    let citations = 0
    let clientBrandHits = 0
    let compBrandHits = 0
    const ranks: number[] = []
    const sentiments: Sentiment[] = []

    for (const r of recs) {
      const text = r.text ?? ''
      const cIdx = firstIdx(text, company.aliases)
      const mentioned = cIdx !== null
      if (mentioned) mentions += 1
      if (brandCited(r.citedUrls, company.domainHints)) citations += 1
      if (mentioned && cIdx !== null) {
        clientBrandHits += 1
        const ahead = compNames.filter((cn) => {
          const i = firstIdx(text, [cn])
          return i !== null && i < cIdx
        }).length
        ranks.push(ahead + 1)
        sentiments.push(sentiment(text, company.aliases))
      }
      for (const cn of compNames) {
        if (firstIdx(text, [cn]) !== null) compBrandHits += 1
      }
    }

    const totalHits = clientBrandHits + compBrandHits
    perEngine[eng] = {
      runsOk: recs.length,
      mentionRate: round1((100 * mentions) / recs.length),
      citationRate: round1((100 * citations) / recs.length),
      sov: totalHits > 0 ? round1((100 * clientBrandHits) / totalHits) : 0,
      avgRank: ranks.length > 0 ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
      sentimentPosPct:
        sentiments.length > 0
          ? round1((100 * sentiments.filter((s) => s === 'positive').length) / sentiments.length)
          : null,
    }
  }

  const ok = records.filter((r) => r.ok)
  const overall: OverallStats = {
    runsOk: ok.length,
    mentionRate: round1(wavg(perEngine, 'mentionRate')),
    citationRate: round1(wavg(perEngine, 'citationRate')),
    sov: round1(wavg(perEngine, 'sov')),
    avgRank: overallRank(perEngine),
    topCompetitorSov: topCompetitorSov(records, company, compNames),
  }

  const { classes, topDomains } = classifyCitations(records, company)

  const brandMentions: Record<string, number> = {}
  for (const cn of compNames) {
    brandMentions[cn] = ok.filter((r) => firstIdx(r.text ?? '', [cn]) !== null).length
  }
  brandMentions[company.name] = ok.filter(
    (r) => firstIdx(r.text ?? '', company.aliases) !== null,
  ).length

  return {
    perEngine,
    overall,
    competitors,
    citationClasses: classes,
    topCitedDomains: topDomains,
    brandMentions,
  }
}

/**
 * Score regional and DACH scopes separately — competitors are discovered on
 * each scope's own records (a rival strong in DACH may be invisible
 * regionally) — plus a combined pass over all records.
 */
export function scoreScoped(records: AuditRecord[], company: Company): ScopedScore {
  const regional = records.filter((r) => r.scope === 'regional')
  const dach = records.filter((r) => r.scope === 'dach')
  return {
    regional: scoreRecords(regional, company, discoverCompetitors(regional, company)),
    dach: scoreRecords(dach, company, discoverCompetitors(dach, company)),
    combined: scoreRecords(records, company, discoverCompetitors(records, company)),
  }
}

/**
 * pdf_sales.tier_mention: % of ok records with records[i][key] === value
 * whose text matches the client pattern. Used for the geo ladder
 * (key='tier') and the persona split (key='persona').
 *
 * Deviation from the bare Python signature: the client regex is not global
 * here, so the company must be passed to build it.
 */
export function tierMention(
  records: AuditRecord[],
  key: 'tier' | 'persona',
  value: string,
  company: Company,
): number {
  const rx = clientPattern(company)
  const sel = records.filter((r) => r.ok && r[key] === value)
  if (sel.length === 0) return 0
  const hits = sel.filter((r) => rx.test(r.text ?? '')).length
  return round1((100 * hits) / sel.length)
}

/** Per-brand, per-engine visibility stats (pdf_final.brand_engine_stats). */
export interface BrandEngineStat {
  mention: number
  citation: number
  sov: number
  rank: number | null
}

/**
 * pdf_final.brand_engine_stats: for each brand (name → regex source) and
 * each engine present in the records:
 * - mention: % of the engine's ok runs where the brand regex matches
 * - sov: brand hits / (all brand hits + client hits) on that engine
 * - citation: % of runs where a cited URL matches the brand regex
 * - rank: 1 + number of other brands (or the client) matched BEFORE the
 *   brand's first match in the text
 *
 * Deviations from Python: (1) citation detection applied the brand regex to
 * the URL — Python used a separate BRAND_DOMS map plus page_mentions.json
 * (fetched page content); neither exists in this contract, so the regex is
 * the only signal. (2) The Python version hardcoded the ENGS list; here the
 * engines present in the records are used.
 */
export function brandEngineStats(
  records: AuditRecord[],
  brands: Record<string, string>,
  company: Company,
): Record<string, Partial<Record<Engine, BrandEngineStat>>> {
  const ok = records.filter((r) => r.ok)
  const engines = [...new Set(ok.map((r) => r.engine))]
  const clientRx = clientPattern(company)
  const entries = Object.entries(brands).map(([name, src]) => ({
    name,
    rx: new RegExp(src, 'i'),
  }))

  const runs = new Map<Engine, number>()
  const engTotals = new Map<Engine, number>()
  const rawMentions = new Map<string, Map<Engine, number>>()
  for (const e of engines) {
    runs.set(e, ok.filter((r) => r.engine === e).length || 1)
    engTotals.set(e, 0)
  }
  for (const { name } of entries) rawMentions.set(name, new Map())

  for (const r of ok) {
    const text = r.text ?? ''
    const hits = entries.filter(({ rx }) => rx.test(text))
    const clientHit = clientRx.test(text) ? 1 : 0
    engTotals.set(r.engine, (engTotals.get(r.engine) ?? 0) + hits.length + clientHit)
    for (const { name } of hits) {
      const m = rawMentions.get(name)
      if (m) m.set(r.engine, (m.get(r.engine) ?? 0) + 1)
    }
  }

  const out: Record<string, Partial<Record<Engine, BrandEngineStat>>> = {}
  for (const { name, rx } of entries) {
    const per: Partial<Record<Engine, BrandEngineStat>> = {}
    for (const e of engines) {
      const positions: number[] = []
      let cites = 0
      for (const r of ok) {
        if (r.engine !== e) continue
        const text = r.text ?? ''
        const m = rx.exec(text)
        if (m) {
          const before = text.slice(0, m.index)
          const ahead =
            entries.filter(({ rx: rx2 }) => rx2.test(before)).length +
            (clientRx.test(before) ? 1 : 0)
          positions.push(ahead + 1)
        }
        if (r.citedUrls.some((u) => rx.test(u.toLowerCase()))) cites += 1
      }
      const tot = (engTotals.get(e) ?? 0) || 1
      const runCount = runs.get(e) ?? 1
      const raw = rawMentions.get(name)?.get(e) ?? 0
      per[e] = {
        mention: round1((100 * raw) / runCount),
        sov: round1((100 * raw) / tot),
        citation: round1((100 * cites) / runCount),
        rank:
          positions.length > 0
            ? round1(positions.reduce((a, b) => a + b, 0) / positions.length)
            : null,
      }
    }
    out[name] = per
  }
  return out
}
