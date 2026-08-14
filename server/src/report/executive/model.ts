/**
 * model.ts — assembles the view model for the Dark Executive Report (v7).
 *
 * v7 is a COUNT-FIRST model. Every displayed figure is derived from integer
 * counts measured on the scope-filtered records: `k` successes out of `n`
 * measured answers. Rates are computed downstream from those counts and are
 * always rendered next to them, so a "20%" is visibly "2 of 10 answers" and
 * never reads as an invented round number. Three statistical rules are baked
 * in here rather than in the templates:
 *
 *   1. Counts are the primary figure — `Count { k, n }` is what the model
 *      hands out; `ratePct()` derives the secondary percentage.
 *   2. Precision is disclosed — `wilson95()` gives the 95% score interval for
 *      the headline client metrics (pure TS, no dependency).
 *   3. Rates die below `MIN_DENOM` — with fewer than 5 measured answers a
 *      derived percentage carries no information, so `hasRate()` is false and
 *      the templates print the raw count plus "n/a".
 *
 * The second v7 change is DEPTH: the client and up to TOP_N competitors each
 * become a full `EntityProfile` combining measured counts with the stored
 * qualitative evidence that already exists per competitor but was unused —
 * the reverse-engineering teardown (whyTheyWin + tactics) and the scraped
 * competitor pages (format, word count, FAQ/table/statistics/schema signals),
 * plus the real prompts they were named in and one verbatim excerpt.
 *
 * No number is invented: missing data stays `null`/empty and renders as a
 * labelled "no data" line downstream.
 */
import type {
  AuditRecord,
  AuditScore,
  Company,
  CompetitorPage,
  Engine,
  ImpactModel,
  ReportEvidence,
  ReportLang,
  ReportSections,
  ReverseReport,
  Scope,
  SentimentReport,
  TopicKey,
} from '../../types.js'
import { brandCited, domainOf, DIRECTORY_DOMAINS, EARNED_HINTS } from '../../core/citations.js'
import { firstIdx } from '../../core/scoring.js'
import { isPlausibleCompanyName } from '../../core/competitors.js'
import { classifyTopic } from '../../agents/evidenceExtractor.js'

export const ENGINE_ORDER: Engine[] = ['chatgpt', 'gemini', 'perplexity', 'claude']
export const ENGINE_LABEL: Record<Engine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  claude: 'Claude',
}
/** Compact engine tags for mini bars. */
export const ENGINE_SHORT: Record<Engine, string> = {
  chatgpt: 'GPT',
  gemini: 'GEM',
  perplexity: 'PLX',
  claude: 'CLD',
}

/** How many competitors get their own full analysis page. */
export const TOP_N = 5

/** Series palette keys (fixed, in-family). Resolved to hex in html.ts. */
export type SeriesColor = 'sky' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5'
export const SERIES_COLORS: SeriesColor[] = ['sky', 'p1', 'p2', 'p3', 'p4', 'p5']

// ─── Statistical primitives ─────────────────────────────────────────────────

/** A measured fact: `k` of `n`. The denominator travels with the numerator. */
export interface Count {
  k: number
  n: number
}

export const count = (k: number, n: number): Count => ({ k, n })

/**
 * Below this denominator a derived percentage is noise: with n=4 the only
 * possible rates are 0/25/50/75/100%. Templates print the count and "n/a".
 */
export const MIN_DENOM = 5

/** True when the denominator supports quoting a percentage at all. */
export const hasRate = (c: Count): boolean => c.n >= MIN_DENOM

/** Percentage (1 decimal) or null when there is no denominator. */
export function ratePct(c: Count): number | null {
  if (c.n <= 0) return null
  return Math.round((1000 * c.k) / c.n) / 10
}

export interface Interval {
  lo: number
  hi: number
}

/**
 * Wilson score interval (95%) for a binomial proportion, in percent — the
 * honest answer to "your percentages look invented": it shows how coarse a
 * rate measured on 30 answers really is (1/30 = 3.3%, 95% CI 0.6–17%).
 * Pure arithmetic, no dependency. Returns null without a denominator.
 */
export function wilson95(c: Count): Interval | null {
  if (c.n <= 0) return null
  const z = 1.959964
  const p = c.k / c.n
  const z2 = z * z
  const denom = 1 + z2 / c.n
  const centre = (p + z2 / (2 * c.n)) / denom
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / c.n + z2 / (4 * c.n * c.n))
  const lo = Math.max(0, centre - half)
  const hi = Math.min(1, centre + half)
  return { lo: Math.round(1000 * lo) / 10, hi: Math.round(1000 * hi) / 10 }
}

// ─── Input ──────────────────────────────────────────────────────────────────

export interface ExecInput {
  company: Company
  records: AuditRecord[]
  score: AuditScore
  impact: ImpactModel
  sections: ReportSections
  evidence: ReportEvidence
  sentiment?: SentimentReport
  competitorPages: CompetitorPage[]
  /** Stored reverse-engineering teardowns (one per analyzed competitor). */
  teardowns: ReverseReport[]
  /** name → regex source, from pdf.ts buildBrands(). */
  brands: Record<string, string>
  lang: ReportLang
  /** Report family: 'general' market overview | 'avatar' audience lens. */
  variant: string
  scope: Scope
  /** Optional roadmap fuel from the latest action plan (top page specs). */
  actionPages?: { title: string; targetQuery: string }[]
}

// ─── Entity profile ─────────────────────────────────────────────────────────

export interface EntityEngineRow {
  engine: Engine
  label: string
  /** Measured answers on this engine — the denominator of mention/citation. */
  runsOk: number
  mention: Count
  citation: Count
  /** Brand mentions of this entity / all brand mentions on this engine. */
  sov: Count
  /** Mean position among named brands, or null when never named. */
  rank: number | null
}

export interface EntityTotals {
  runsOk: number
  mention: Count
  citation: Count
  sov: Count
  rank: number | null
}

/** One prompt the entity was actually named in, with its hit count. */
export interface PromptHit {
  prompt: string
  /** Answers to this prompt naming the entity / answers measured. */
  hit: Count
  engines: Engine[]
}

/** One verbatim window around the entity's name in a measured answer. */
export interface Quote {
  engine: Engine
  prompt: string
  text: string
}

export interface TopicHit {
  topic: TopicKey
  hit: Count
}

/** A scraped competitor page reduced to its structural evidence. */
export interface PageEvidence {
  url: string
  title?: string
  format?: CompetitorPage['answerFormat']
  wordCount?: number
  hasFaq: boolean
  hasTable: boolean
  hasStats: boolean
  /** schema.org @type values found in the page's JSON-LD blocks. */
  schemaTypes: string[]
}

export interface EntityProfile {
  name: string
  color: SeriesColor
  isClient: boolean
  /** 0 for the client, 1..TOP_N for ranked competitors. */
  rankIdx: number
  rows: EntityEngineRow[]
  totals: EntityTotals
  /** Topic clusters ranked by measured mentions (strongest first). */
  topics: TopicHit[]
  /** Up to 3 real prompts the entity was named in, strongest first. */
  prompts: PromptHit[]
  quote: Quote | null
  /** Stored teardown (competitors only, when one was generated). */
  teardown: ReverseReport | null
  /** Scraped pages under this entity's domains (strongest evidence first). */
  pages: PageEvidence[]
}

// ─── Shared tables ──────────────────────────────────────────────────────────

export interface EngineRow {
  engine: Engine
  label: string
  runsOk: number
}

export interface TopicRow {
  topic: TopicKey
  runsOk: number
  prompts: number
  clientMention: Count
  clientCitation: Count
  /** Aligned with `competitors`: measured mentions of competitor i. */
  compMentions: Count[]
}

export interface SupplyRow {
  domain: string
  cls: 'own' | 'directory' | 'earned' | 'other'
  citations: number
  feeds: string[]
  isOwn: boolean
}

export interface SovSlice {
  label: string
  value: number
  color: SeriesColor | 'grey'
  isClient: boolean
}

/**
 * A prompt the client was never named in — the concrete loss, with the rivals
 * the engines named instead.
 */
export interface MissedPrompt {
  prompt: string
  /** Measured answers to this prompt (the client scored 0 of them). */
  runs: number
  rivals: { name: string; k: number }[]
}

/** One measured answer that linked to the client's own domain. */
export interface OwnCitation {
  url: string
  engine: Engine
  prompt: string
  /** From verified_citations: true/false when fetched, null when unverified. */
  verified: boolean | null
}

/** Client vs one competitor, in counts and percentage points. */
export interface GapLine {
  name: string
  color: SeriesColor
  client: Count
  other: Count
  /** other% − client%, or null when the base is too small to quote. */
  deltaPts: number | null
}

export interface ExecModel extends ExecInput {
  generatedAt: string
  client: EntityProfile
  /** Ranked competitor profiles (≤ TOP_N); empty in solo slices. */
  competitors: EntityProfile[]
  /** Competitor names, ranked — kept for chart legends and copy. */
  topComps: string[]
  topComp: string | null
  engineRows: EngineRow[]
  topicRows: TopicRow[]
  supplyRows: SupplyRow[]
  sovSlices: SovSlice[]
  gaps: GapLine[]
  /** Real URLs of the client that engines actually linked to (max 3). */
  ownCitations: OwnCitation[]
  /** Prompts the client lost outright, with the rivals named instead (max 3). */
  missedPrompts: MissedPrompt[]
  totalCitations: number
  totalRunsOk: number
  /** Smallest per-engine denominator — drives the small-sample footnote. */
  minRunsOk: number
  distinctPrompts: number
  runsPerPrompt: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyDomain(domain: string, isOwn: boolean): SupplyRow['cls'] {
  if (isOwn) return 'own'
  const d = domain.toLowerCase()
  if (DIRECTORY_DOMAINS.some((x) => d === x || d.endsWith('.' + x) || d.includes(x))) {
    return 'directory'
  }
  if (EARNED_HINTS.some((h) => d.includes(h))) return 'earned'
  return 'other'
}

/** Legal-form and filler tokens dropped when deriving a brand's domain key. */
const LEGAL_TOKEN_RX = /^(ag|gmbh|sa|sarl|sàrl|ltd|llc|inc|group|gruppe|holding|co|kg)$/i

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/[éèê]/g, 'e')
    .replace(/à/g, 'a')
    .replace(/ß/g, 'ss')

/**
 * A brand's domain key: the name folded to bare letters, legal form dropped.
 * "Webella Design" → "webelladesign", "Nordfabrik AG" → "nordfabrik".
 */
function brandKey(name: string): string {
  return fold(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !LEGAL_TOKEN_RX.test(t))
    .join('')
}

/**
 * The registrable label of a host: "help.sortlist.com" → "sortlist",
 * "webella.ch" → "webella". Public-suffix subtleties do not matter here —
 * the label is only used to decide whether a scraped page belongs to a brand.
 */
function domainLabel(domain: string): string {
  const parts = fold(domain).replace(/^www\./, '').split('.')
  const stripped = parts.length > 2 && parts[parts.length - 2] === 'co' ? parts.slice(0, -2) : parts.slice(0, -1)
  return (stripped[stripped.length - 1] ?? '').replace(/[^a-z0-9]/g, '')
}

/**
 * True when a scraped page's domain plausibly belongs to this brand. The test
 * is deliberately strict — a prefix relation between the registrable label
 * and the brand key, both at least 5 characters. Loose substring matching let
 * topic phrases ("Cost per Lead" ↔ leadup.ch, "Social Media Marketing in
 * Zürich" ↔ socialmediaagenturzuerich.ch) masquerade as evidenced brands.
 */
function domainBelongs(domain: string, key: string): boolean {
  const label = domainLabel(domain)
  if (label.length < 5 || key.length < 5) return false
  return label === key || label.startsWith(key) || key.startsWith(label)
}

/** schema.org @type values inside a stored JSON-LD blob. */
function schemaTypes(raw: string | undefined): string[] {
  if (!raw) return []
  const out = new Set<string>()
  for (const m of raw.matchAll(/"@type"\s*:\s*"([^"]{2,40})"/g)) {
    const t = m[1]
    if (t) out.add(t)
  }
  return [...out].slice(0, 4)
}

/** Structural strength of a scraped page — the exhibit-worthy ones first. */
function pageScore(p: CompetitorPage): number {
  return (
    (p.hasFaq ? 3 : 0) +
    (p.hasComparisonTable ? 3 : 0) +
    (p.hasStatistics ? 1 : 0) +
    (p.schemaMarkup ? 2 : 0) +
    Math.min(3, Math.floor((p.wordCount ?? 0) / 800))
  )
}

function toPageEvidence(p: CompetitorPage): PageEvidence {
  return {
    url: p.url,
    ...(p.title ? { title: p.title } : {}),
    ...(p.answerFormat ? { format: p.answerFormat } : {}),
    ...(p.wordCount ? { wordCount: p.wordCount } : {}),
    hasFaq: p.hasFaq,
    hasTable: p.hasComparisonTable,
    hasStats: p.hasStatistics,
    schemaTypes: schemaTypes(p.schemaMarkup),
  }
}

/**
 * Verbatim window around `idx` in an already whitespace-collapsed answer,
 * ≤ `max` chars. Markdown emphasis and link targets are removed because they
 * read as broken prose in print — the words themselves are never altered.
 */
function window(flat: string, idx: number, max = 160): string {
  const start = Math.max(0, idx - Math.floor(max / 3))
  const end = Math.min(flat.length, start + max)
  const cut = flat
    .slice(start, end)
    .replace(/\((https?:[^)]*)\)/g, '')
    .replace(/[*_`#[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `${start > 0 ? '… ' : ''}${cut}${end < flat.length ? ' …' : ''}`
}

/** One brand's detection rules against an answer and its cited URLs. */
interface Probe {
  name: string
  /** Index of the brand's first occurrence in the answer, or null. */
  at: (text: string) => number | null
  cited: (urls: string[]) => boolean
}

function clientProbe(company: Company): Probe {
  return {
    name: company.name,
    at: (t) => firstIdx(t, company.aliases),
    cited: (urls) => brandCited(urls, company.domainHints),
  }
}

function competitorProbe(name: string, rxSource: string | undefined): Probe {
  const rx = rxSource ? new RegExp(rxSource, 'i') : null
  const key = brandKey(name)
  return {
    name,
    at: (t) => {
      if (rx) {
        const m = rx.exec(t)
        return m ? m.index : null
      }
      return firstIdx(t, [name])
    },
    // A citation for a competitor means an engine linked to THEIR domain —
    // decided on the host, not on a substring of the whole URL.
    cited: (urls) => urls.some((u) => domainBelongs(domainOf(u), key)),
  }
}

// ─── Entity measurement ─────────────────────────────────────────────────────

/**
 * Measure one brand against the record slice: per-engine and pooled counts.
 * `sovDen` carries the per-engine total of ALL brand mentions (client plus
 * every discovered competitor), so an SoV always reads as one integer over
 * another and cannot be inflated by a partial brand set.
 */
function measure(
  ok: AuditRecord[],
  engines: Engine[],
  probe: Probe,
  probes: Probe[],
  sovDen: Map<Engine, number>,
): { rows: EntityEngineRow[]; totals: EntityTotals } {
  const rows: EntityEngineRow[] = []
  for (const e of engines) {
    const recs = ok.filter((r) => r.engine === e)
    if (recs.length === 0) continue
    let mentions = 0
    let citations = 0
    const ranks: number[] = []
    for (const r of recs) {
      const text = r.text ?? ''
      const at = probe.at(text)
      if (at !== null) {
        mentions += 1
        const ahead = probes.filter((p) => {
          if (p.name === probe.name) return false
          const i = p.at(text)
          return i !== null && i < at
        }).length
        ranks.push(ahead + 1)
      }
      if (probe.cited(r.citedUrls)) citations += 1
    }
    rows.push({
      engine: e,
      label: ENGINE_LABEL[e],
      runsOk: recs.length,
      mention: count(mentions, recs.length),
      citation: count(citations, recs.length),
      sov: count(mentions, sovDen.get(e) ?? 0),
      rank: ranks.length > 0 ? Math.round((10 * ranks.reduce((a, b) => a + b, 0)) / ranks.length) / 10 : null,
    })
  }
  const sum = (pick: (r: EntityEngineRow) => Count): Count =>
    rows.reduce((acc, r) => count(acc.k + pick(r).k, acc.n + pick(r).n), count(0, 0))
  const ranked = rows.filter((r) => r.rank !== null)
  return {
    rows,
    totals: {
      runsOk: rows.reduce((a, r) => a + r.runsOk, 0),
      mention: sum((r) => r.mention),
      citation: sum((r) => r.citation),
      sov: sum((r) => r.sov),
      rank:
        ranked.length > 0
          ? Math.round((10 * ranked.reduce((a, r) => a + (r.rank ?? 0), 0)) / ranked.length) / 10
          : null,
    },
  }
}

/** The prompts a brand was actually named in, strongest first. */
function promptHits(ok: AuditRecord[], probe: Probe, max = 3): PromptHit[] {
  const byPrompt = new Map<string, { hit: number; runs: number; engines: Set<Engine> }>()
  for (const r of ok) {
    const entry = byPrompt.get(r.prompt) ?? { hit: 0, runs: 0, engines: new Set<Engine>() }
    entry.runs += 1
    if (probe.at(r.text ?? '') !== null) {
      entry.hit += 1
      entry.engines.add(r.engine)
    }
    byPrompt.set(r.prompt, entry)
  }
  return [...byPrompt.entries()]
    .filter(([, v]) => v.hit > 0)
    .sort((a, b) => b[1].hit - a[1].hit || b[1].hit / b[1].runs - a[1].hit / a[1].runs)
    .slice(0, max)
    .map(([prompt, v]) => ({ prompt, hit: count(v.hit, v.runs), engines: [...v.engines].sort() }))
}

/** One verbatim excerpt where the brand is named — never paraphrased. */
function firstQuote(ok: AuditRecord[], probe: Probe): Quote | null {
  for (const r of ok) {
    const flat = (r.text ?? '').replace(/\s+/g, ' ').trim()
    const at = probe.at(flat)
    if (at === null) continue
    return { engine: r.engine, prompt: r.prompt, text: window(flat, at) }
  }
  return null
}

/** Topic clusters ranked by measured mentions of the brand. */
function topicHits(ok: AuditRecord[], company: Company, probe: Probe): TopicHit[] {
  const byTopic = new Map<TopicKey, { k: number; n: number }>()
  for (const r of ok) {
    const t = classifyTopic(r.prompt, company)
    const entry = byTopic.get(t) ?? { k: 0, n: 0 }
    entry.n += 1
    if (probe.at(r.text ?? '') !== null) entry.k += 1
    byTopic.set(t, entry)
  }
  return [...byTopic.entries()]
    .map(([topic, v]) => ({ topic, hit: count(v.k, v.n) }))
    .sort((a, b) => b.hit.k - a.hit.k || b.hit.k / b.hit.n - a.hit.k / a.hit.n)
}

// ─── Competitor selection ───────────────────────────────────────────────────

/**
 * Which competitors earn their own analysis page.
 *
 * Discovery alone is not enough: on some slices it surfaces topic phrases
 * ("Stundensätze", "Cost per Lead (CPL)") that pass the name heuristics but
 * are not firms. A competitor is therefore "report-grade" only when stored
 * EVIDENCE backs it — a reverse-engineering teardown, scraped pages under its
 * own domain, or an explicitly configured competitor — on top of the name
 * gate. The slice must additionally contain at least one DISCOVERED
 * report-grade competitor; without that anchor the slice is treated as having
 * no competitive data at all (the avatar lens behaves this way) and the deck
 * degrades to a client-focused document instead of printing empty pages.
 */
function selectCompetitors(
  score: AuditScore,
  company: Company,
  teardowns: ReverseReport[],
  pages: CompetitorPage[],
  ok: AuditRecord[],
  brands: Record<string, string>,
): { name: string; teardown: ReverseReport | null; mentions: number }[] {
  const configured = new Set(company.competitors.map((c) => c.toLowerCase()))
  const byTeardown = new Map(teardowns.map((t) => [t.competitor.toLowerCase(), t]))
  const pageDomains = [...new Set(pages.map((p) => p.competitorDomain))]

  const evidenceFor = (name: string): ReverseReport | null => byTeardown.get(name.toLowerCase()) ?? null
  const backed = (name: string): boolean => {
    if (configured.has(name.toLowerCase())) return true
    if (evidenceFor(name)) return true
    const key = brandKey(name)
    return key.length >= 5 && pageDomains.some((d) => domainBelongs(d, key))
  }

  const mentionsOf = (name: string): number => {
    const probe = competitorProbe(name, brands[name])
    return ok.filter((r) => probe.at(r.text ?? '') !== null).length
  }

  // Anchor: discovered names that pass BOTH the name gate and the evidence gate.
  const discovered = [...score.competitors]
    .sort((a, b) => b.rawHits - a.rawHits)
    .filter((c) => isPlausibleCompanyName(c.name) && backed(c.name))
  if (discovered.length === 0) return []

  const picked = new Map<string, { name: string; teardown: ReverseReport | null; mentions: number }>()
  for (const c of discovered) {
    picked.set(c.name.toLowerCase(), {
      name: c.name,
      teardown: evidenceFor(c.name),
      mentions: mentionsOf(c.name),
    })
  }
  // Top up to TOP_N with evidence-backed brands that the slice measured but
  // discovery missed (a teardown competitor named in plain, unbolded prose).
  for (const t of teardowns) {
    if (picked.size >= TOP_N) break
    if (picked.has(t.competitor.toLowerCase())) continue
    // Teardowns outlive the discovery logic that created them: rows written
    // before a filter fix (procedure names like "Facelift", "Nachsorge")
    // would otherwise be promoted straight back into the deck. Re-validate
    // every stored name against the CURRENT quality gate.
    if (!isPlausibleCompanyName(t.competitor)) continue
    const m = mentionsOf(t.competitor)
    if (m === 0) continue
    picked.set(t.competitor.toLowerCase(), { name: t.competitor, teardown: t, mentions: m })
  }
  return [...picked.values()]
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, TOP_N)
}

// ─── Build ──────────────────────────────────────────────────────────────────

export function buildModel(input: ExecInput): ExecModel {
  const { records, score, evidence, brands, company, competitorPages, teardowns } = input
  const ok = records.filter((r) => r.ok)
  const engines = ENGINE_ORDER.filter((e) => ok.some((r) => r.engine === e))

  const chosen = selectCompetitors(score, company, teardowns, competitorPages, ok, brands)
  const topComps = chosen.map((c) => c.name)

  // Probe set for SoV: the client plus EVERY discovered competitor, so the
  // share denominator is the full measured brand field, not just the top N.
  const client = clientProbe(company)
  const allCompNames = [...new Set([...score.competitors.map((c) => c.name), ...topComps])]
  const allProbes: Probe[] = [client, ...allCompNames.map((n) => competitorProbe(n, brands[n]))]
  const sovDen = new Map<Engine, number>()
  for (const e of engines) {
    let total = 0
    for (const r of ok.filter((x) => x.engine === e)) {
      const text = r.text ?? ''
      total += allProbes.filter((p) => p.at(text) !== null).length
    }
    sovDen.set(e, total)
  }

  const pagesFor = (name: string): PageEvidence[] => {
    const key = brandKey(name)
    if (key.length < 5) return []
    const seen = new Set<string>()
    return competitorPages
      .filter((p) => domainBelongs(p.competitorDomain, key))
      .filter((p) => {
        const url = p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
        if (seen.has(url)) return false
        seen.add(url)
        return true
      })
      .sort((a, b) => pageScore(b) - pageScore(a) || (b.wordCount ?? 0) - (a.wordCount ?? 0))
      .slice(0, 3)
      .map(toPageEvidence)
  }

  const profile = (
    name: string,
    probe: Probe,
    color: SeriesColor,
    isClient: boolean,
    rankIdx: number,
    teardown: ReverseReport | null,
  ): EntityProfile => {
    const { rows, totals } = measure(ok, engines, probe, allProbes, sovDen)
    return {
      name,
      color,
      isClient,
      rankIdx,
      rows,
      totals,
      topics: topicHits(ok, company, probe),
      prompts: promptHits(ok, probe),
      quote: firstQuote(ok, probe),
      teardown,
      pages: isClient ? [] : pagesFor(name),
    }
  }

  const clientProfile = profile(company.name, client, 'sky', true, 0, null)
  const competitors = chosen.map((c, i) =>
    profile(
      c.name,
      competitorProbe(c.name, brands[c.name]),
      SERIES_COLORS[i + 1] ?? 'p5',
      false,
      i + 1,
      c.teardown,
    ),
  )

  const engineRows: EngineRow[] = engines.map((e) => ({
    engine: e,
    label: ENGINE_LABEL[e],
    runsOk: ok.filter((r) => r.engine === e).length,
  }))

  // Topic clusters: client counts from the evidence bundle's prompt sets,
  // competitor counts measured on the same record slice.
  const compProbes = competitors.map((c) => competitorProbe(c.name, brands[c.name]))
  const topicRows: TopicRow[] = evidence.bundle.topics
    .filter((t) => t.runsOk > 0)
    .map((t) => {
      const promptSet = new Set(t.prompts)
      const sel = ok.filter((r) => promptSet.has(r.prompt))
      const hits = (p: Probe): Count =>
        count(sel.filter((r) => p.at(r.text ?? '') !== null).length, sel.length)
      return {
        topic: t.topic,
        runsOk: t.runsOk,
        prompts: t.prompts.length,
        clientMention: hits(client),
        clientCitation: count(sel.filter((r) => client.cited(r.citedUrls)).length, sel.length),
        compMentions: compProbes.map(hits),
      }
    })

  // Feeds column: only brands from the discovered competitor set.
  const knownComps = new Set(score.competitors.map((c) => c.name))
  const supplyRows: SupplyRow[] = evidence.supplyChain.domains.slice(0, 7).map((d) => ({
    domain: d.domain,
    cls: classifyDomain(d.domain, d.isOwn),
    citations: d.citations,
    feeds: d.competitors.filter((n) => knownComps.has(n)).slice(0, 2),
    isOwn: d.isOwn,
  }))

  // SoV slices over ALL brands: client sky, ranked competitors, rest grey.
  const mentionsOfName = (name: string): number => {
    const p = competitorProbe(name, brands[name])
    return ok.filter((r) => p.at(r.text ?? '') !== null).length
  }
  const topSet = new Set(topComps)
  let others = 0
  for (const name of allCompNames) {
    if (!topSet.has(name)) others += mentionsOfName(name)
  }
  const sovSlices: SovSlice[] = [
    {
      label: clientProfile.name,
      value: clientProfile.totals.mention.k,
      color: 'sky' as const,
      isClient: true,
    },
    ...competitors.map((c) => ({
      label: c.name,
      value: c.totals.mention.k,
      color: c.color,
      isClient: false,
    })),
    { label: '__others__', value: others, color: 'grey' as const, isClient: false },
  ].filter((sl) => sl.value > 0)

  // Gap to each ranked competitor, in counts AND percentage points.
  const clientRate = ratePct(clientProfile.totals.mention)
  const gaps: GapLine[] = competitors.map((c) => {
    const other = ratePct(c.totals.mention)
    const quotable =
      hasRate(clientProfile.totals.mention) && hasRate(c.totals.mention) && clientRate !== null && other !== null
    return {
      name: c.name,
      color: c.color,
      client: clientProfile.totals.mention,
      other: c.totals.mention,
      deltaPts: quotable ? Math.round(10 * (other - clientRate)) / 10 : null,
    }
  })

  // Lost prompts: questions where the client was never named, ranked by how
  // loudly the ranked rivals answered them instead. Real prompts, real counts.
  const missedAcc = new Map<string, { runs: number; client: number; rivals: Map<string, number> }>()
  for (const r of ok) {
    const entry = missedAcc.get(r.prompt) ?? { runs: 0, client: 0, rivals: new Map<string, number>() }
    entry.runs += 1
    const text = r.text ?? ''
    if (client.at(text) !== null) entry.client += 1
    competitors.forEach((c, i) => {
      const p = compProbes[i]
      if (p && p.at(text) !== null) entry.rivals.set(c.name, (entry.rivals.get(c.name) ?? 0) + 1)
    })
    missedAcc.set(r.prompt, entry)
  }
  const missedPrompts: MissedPrompt[] = [...missedAcc.entries()]
    .filter(([, v]) => v.client === 0)
    .map(([prompt, v]) => ({
      prompt,
      runs: v.runs,
      rivals: [...v.rivals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([name, k]) => ({ name, k })),
    }))
    .sort(
      (a, b) =>
        b.rivals.reduce((x, y) => x + y.k, 0) - a.rivals.reduce((x, y) => x + y.k, 0) ||
        b.runs - a.runs,
    )
    .slice(0, 3)

  // Own citations: the real URLs engines linked to, with their verification
  // status where the citation verifier already fetched the page.
  const hints = company.domainHints.map((h) => h.toLowerCase())
  const seenUrl = new Set<string>()
  const ownCitations: OwnCitation[] = []
  for (const r of ok) {
    for (const u of r.citedUrls) {
      const low = u.toLowerCase()
      if (!hints.some((h) => low.includes(h)) || seenUrl.has(low)) continue
      seenUrl.add(low)
      ownCitations.push({
        url: u,
        engine: r.engine,
        prompt: r.prompt,
        verified: input.evidence.verification?.[u] ?? null,
      })
    }
  }

  const distinctPrompts = new Set(records.map((r) => r.prompt)).size
  const runsPerPrompt = records.reduce((mx, r) => Math.max(mx, r.run + 1), 1)
  const minRunsOk = engineRows.length > 0 ? Math.min(...engineRows.map((r) => r.runsOk)) : 0

  return {
    ...input,
    generatedAt: new Date().toISOString().slice(0, 10),
    client: clientProfile,
    competitors,
    topComps,
    topComp: topComps[0] ?? null,
    engineRows,
    topicRows,
    supplyRows,
    sovSlices,
    gaps,
    ownCitations: ownCitations.slice(0, 3),
    missedPrompts,
    totalCitations: evidence.supplyChain.totalCitations,
    totalRunsOk: ok.length,
    minRunsOk,
    distinctPrompts,
    runsPerPrompt,
  }
}
