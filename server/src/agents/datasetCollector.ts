/**
 * Dataset collector — "LeadEngine Data".
 *
 * Composes ONE head-to-toe, CSV-shaped record of a client's state at a
 * lifecycle event (audit / weekly / monthly / manual): industry niche +
 * location + avatar, the measurement setup, performance, market position,
 * everything we generated for them, week-over-week movement, what it cost,
 * and what worked / what did not.
 *
 * Two consumers:
 *   (a) the retro-framing protocol — a company's own timeline is the
 *       "before" the next retro frames against;
 *   (b) our own product improvement — which niches and tactics work, and
 *       where the SYSTEM (not the client) underperforms.
 *
 * HARD RULE: every value is READ from data that already exists in the
 * database. Nothing is estimated, modelled or invented here. When a source
 * is missing the column stays at its zero/null default — an empty cell is
 * information; a fabricated one is a lie the whole dataset then inherits.
 *
 * Append-only: one row per collection, never an update, so the timeline and
 * the movement between events are preserved.
 */
import { AUDIT, ENABLED_ENGINES, PACK_FOLDER } from '../config.js'
import { estimateUsd, round4 } from '../core/costs.js'
import { round1 } from '../core/scoring.js'
import {
  getAuditRecords,
  getCompany,
  getPromptLibrary,
  insertClientSnapshot,
  latestActionPlan,
  latestPromptLibrary,
  latestScore,
  latestTrackingSnapshot,
  listApiCostsForCompany,
  listContentGaps,
  listReports,
  listReverseReports,
  listTrackingSnapshots,
  relevantLearnings,
  sectorKeyOf,
  sentimentBreakdown,
} from '../db/repo.js'
import { analyzeCitationSupplyChain } from './citationSupplyChain.js'
import { promptOutcomes } from './retroAnalyzer.js'
import type {
  AuditRecord,
  ClientSnapshot,
  Company,
  DatasetColumn,
  Engine,
  NewClientSnapshot,
  PromptItem,
  SnapshotKind,
} from '../types.js'

// ─── canonical column list ──────────────────────────────────────────────────

/**
 * The canonical dataset columns, in canonical order. The frontend renders
 * from this and the CSV header is generated from it, so the column set can
 * never drift between storage, API, UI and export. Keys are typed as
 * `keyof ClientSnapshot`, so a renamed field is a compile error.
 */
export const DATASET_COLUMNS: DatasetColumn[] = [
  // profile
  { key: 'id', label: 'Row', group: 'profile' },
  { key: 'company_id', label: 'Company', group: 'profile' },
  { key: 'snapshot_at', label: 'Snapshot at', group: 'profile' },
  { key: 'kind', label: 'Event', group: 'profile' },
  { key: 'job_id', label: 'Job', group: 'profile' },
  { key: 'library_version', label: 'Prompt library v', group: 'profile' },
  { key: 'sector', label: 'Sector', group: 'profile' },
  { key: 'sector_key', label: 'Sector key', group: 'profile' },
  { key: 'niche_services', label: 'Niche services', group: 'profile' },
  { key: 'locations', label: 'Locations', group: 'profile' },
  { key: 'primary_location', label: 'Primary location', group: 'profile' },
  { key: 'avatar', label: 'Avatar', group: 'profile' },
  { key: 'website', label: 'Website', group: 'profile' },
  { key: 'language', label: 'Language', group: 'profile' },
  // setup
  { key: 'prompts_total', label: 'Prompts', group: 'setup' },
  { key: 'prompts_general', label: 'Prompts (general)', group: 'setup' },
  { key: 'prompts_avatar', label: 'Prompts (avatar)', group: 'setup' },
  { key: 'prompts_multilingual', label: 'Prompts (FR/IT)', group: 'setup' },
  { key: 'engines', label: 'Engines', group: 'setup' },
  { key: 'runs_planned', label: 'Runs planned', group: 'setup' },
  { key: 'runs_ok', label: 'Runs ok', group: 'setup' },
  { key: 'runs_failed', label: 'Runs failed', group: 'setup' },
  // performance
  { key: 'mention_rate', label: 'Mention rate %', group: 'performance' },
  { key: 'citation_rate', label: 'Citation rate %', group: 'performance' },
  { key: 'sov', label: 'Share of voice %', group: 'performance' },
  { key: 'avg_rank', label: 'Avg rank', group: 'performance' },
  { key: 'top_competitor_sov', label: 'Top competitor SoV %', group: 'performance' },
  { key: 'sentiment_pos_pct', label: 'Positive sentiment %', group: 'performance' },
  { key: 'per_engine', label: 'Per engine (JSON)', group: 'performance' },
  // market
  { key: 'competitors', label: 'Competitors', group: 'market' },
  { key: 'top_competitor', label: 'Top competitor', group: 'market' },
  { key: 'citations_total', label: 'Citations total', group: 'market' },
  { key: 'citations_own', label: 'Citations own', group: 'market' },
  { key: 'citations_directory', label: 'Citations directory', group: 'market' },
  { key: 'citations_earned', label: 'Citations earned', group: 'market' },
  { key: 'citations_other', label: 'Citations other', group: 'market' },
  { key: 'top_cited_domains', label: 'Top cited domains', group: 'market' },
  { key: 'visibility_citation_gap', label: 'Visibility-citation gap pp', group: 'market' },
  // delivery
  { key: 'reports_generated', label: 'Reports', group: 'delivery' },
  { key: 'pages_generated', label: 'Pages', group: 'delivery' },
  { key: 'action_plan_pages', label: 'Action-plan pages', group: 'delivery' },
  { key: 'directory_listings', label: 'Directory listings', group: 'delivery' },
  { key: 'entity_tasks', label: 'Entity tasks', group: 'delivery' },
  { key: 'teardowns', label: 'Competitor teardowns', group: 'delivery' },
  { key: 'content_gaps', label: 'Content gaps', group: 'delivery' },
  { key: 'pack_folder', label: 'Pack folder', group: 'delivery' },
  // movement
  { key: 'mention_delta', label: 'Mention Δ pp', group: 'movement' },
  { key: 'citation_delta', label: 'Citation Δ pp', group: 'movement' },
  { key: 'sentiment_delta', label: 'Sentiment Δ pp', group: 'movement' },
  { key: 'new_competitors', label: 'New competitors', group: 'movement' },
  { key: 'lost_competitors', label: 'Lost competitors', group: 'movement' },
  { key: 'weeks_tracked', label: 'Weeks tracked', group: 'movement' },
  // efficiency
  { key: 'api_calls', label: 'API calls', group: 'efficiency' },
  { key: 'estimated_usd', label: 'Estimated USD', group: 'efficiency' },
  { key: 'usd_per_mention_point', label: 'USD / mention point', group: 'efficiency' },
  // learning
  { key: 'what_worked', label: 'What worked', group: 'learning' },
  { key: 'what_did_not', label: 'What did not', group: 'learning' },
  { key: 'lessons_count', label: 'Lessons', group: 'learning' },
]

// ─── helpers ────────────────────────────────────────────────────────────────

const list = (values: readonly string[]): string =>
  [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(', ')

/**
 * Services in the sector label. Sector strings are written as
 * "Social Media Marketing / SEO / Webdesign" (or comma/&-separated), so the
 * niche list is a plain split — no classification, no invention.
 */
export function splitNiche(sector: string): string[] {
  return sector
    .split(/[/,;&]|\bund\b|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

/**
 * Language marker counts for a prompt. PromptItem carries NO language field
 * (promptgen's fr/it layer drops `lang` when it maps into PromptItem), so
 * the multilingual count can only be recovered from the prompt text itself.
 * Deliberately conservative: at least two distinct markers of one language
 * must hit before a prompt counts as non-German.
 */
const FR_MARKERS =
  /\b(quel|quels|quelle|quelles|combien|co[uû]te|co[uû]t|prix|meilleur|meilleure|meilleurs|entreprise|entreprises|agence|comment|pour|dans|avec|est-ce|suisse romande|entre|entreprise)\b/gi
const IT_MARKERS =
  /\b(quanto|costa|costi|prezzo|prezzi|migliore|migliori|azienda|aziende|agenzia|come|nella|nel|per|con|quale|quali|ticino|svizzera)\b/gi

export function detectPromptLang(text: string): 'fr' | 'it' | 'de' {
  const fr = new Set((text.match(FR_MARKERS) ?? []).map((m) => m.toLowerCase())).size
  const it = new Set((text.match(IT_MARKERS) ?? []).map((m) => m.toLowerCase())).size
  if (fr < 2 && it < 2) return 'de'
  return fr >= it ? 'fr' : 'it'
}

/** Prompt-library composition: totals per persona plus the FR/IT layer. */
function libraryComposition(items: PromptItem[]): {
  total: number
  general: number
  avatar: number
  multilingual: number
  tiers: Record<string, number>
} {
  const tiers: Record<string, number> = {}
  let general = 0
  let avatar = 0
  let multilingual = 0
  for (const item of items) {
    if (item.persona === 'avatar') avatar++
    else general++
    tiers[item.tier] = (tiers[item.tier] ?? 0) + 1
    // Stored `lang` is authoritative (set by promptgen since the field was
    // added); text detection is the fallback for pre-existing libraries.
    const lang = item.lang ?? detectPromptLang(item.text)
    if (lang !== 'de') multilingual++
  }
  return { total: items.length, general, avatar, multilingual, tiers }
}

/**
 * Calls the audit was planned to make: for every requested engine, its prompt
 * quota (enginePlan) — or the whole library when it has none — times the
 * configured runs per prompt. Mirrors the queue the audit stage builds.
 */
function plannedRuns(company: Company, promptsTotal: number, engines: Engine[]): number {
  if (promptsTotal === 0 || engines.length === 0) return 0
  return engines.reduce((sum, engine) => {
    const quota = company.enginePlan?.[engine]
    return sum + Math.min(quota ?? promptsTotal, promptsTotal) * AUDIT.runsPerPrompt
  }, 0)
}

/** ok/failed run counts, overall and per engine. */
function runTally(records: AuditRecord[]): {
  ok: number
  failed: number
  byEngine: Record<string, { ok: number; failed: number }>
} {
  const byEngine: Record<string, { ok: number; failed: number }> = {}
  let ok = 0
  let failed = 0
  for (const r of records) {
    const e = (byEngine[r.engine] ??= { ok: 0, failed: 0 })
    if (r.ok) {
      ok++
      e.ok++
    } else {
      failed++
      e.failed++
    }
  }
  return { ok, failed, byEngine }
}

// ─── collector ──────────────────────────────────────────────────────────────

/**
 * Compose and persist one dataset row for a company.
 *
 * Returns null when the company does not exist. Otherwise it always returns
 * a row: a company with no score yet still gets its profile + setup +
 * delivery columns, and the performance columns stay at 0 — an early-stage
 * client is data too.
 */
export function collectClientSnapshot(
  companyId: string,
  kind: SnapshotKind,
  jobId?: string,
): ClientSnapshot | null {
  const company = getCompany(companyId)
  if (!company) return null

  const now = new Date().toISOString()
  const sectorKey = sectorKeyOf(company.sector)

  // ─── setup + the measured record set ─────────────────────────────────────
  // Anchored on the library the latest SCORE was computed from, so the setup,
  // run-tally and performance columns all describe the SAME measurement (the
  // weekly tracker writes extra library versions that must not be mistaken
  // for the audited one). Falls back to the latest library before scoring.
  const score = latestScore(companyId)
  const scoredLibrary = score ? getPromptLibrary(score.libraryId) : null
  const library = scoredLibrary ?? latestPromptLibrary(companyId)
  const composition = libraryComposition(library?.items ?? [])

  const measuredLibraryId = library?.id ?? null
  const records = measuredLibraryId ? getAuditRecords(companyId, measuredLibraryId) : []
  const runs = runTally(records)

  const engines: Engine[] =
    company.engines && company.engines.length > 0
      ? company.engines
      : ((Object.keys(runs.byEngine) as Engine[]).length > 0
          ? (Object.keys(runs.byEngine) as Engine[])
          : [...ENABLED_ENGINES])

  // ─── performance: combined scope (the headline the reports quote) ────────
  const combined = score?.payload.combined ?? null
  const overall = combined?.overall ?? null
  const sentiment = sentimentBreakdown(companyId)
  const sentimentPosPct =
    sentiment.total > 0 ? round1((sentiment.positive / sentiment.total) * 100) : null

  const mentionRate = overall?.mentionRate ?? 0
  const citationRate = overall?.citationRate ?? 0

  // ─── market ──────────────────────────────────────────────────────────────
  const competitors = combined ? [...combined.competitors].sort((a, b) => b.rawHits - a.rawHits) : []
  const classes = combined?.citationClasses ?? { own: 0, directories: 0, earned: 0, other: 0 }
  // Total = the sum of its own breakdown, so the market columns reconcile.
  // (The supply chain counts a domain once per answer rather than once per
  // URL, so its total is a different measure — it lives in the payload.)
  const citationsTotal = classes.own + classes.directories + classes.earned + classes.other
  const supplyChain = analyzeCitationSupplyChain(companyId)

  // ─── delivery ────────────────────────────────────────────────────────────
  const reports = listReports(companyId)
  const plan = latestActionPlan(companyId)
  const teardowns = listReverseReports(companyId)
  const gaps = listContentGaps(companyId)

  // ─── movement ────────────────────────────────────────────────────────────
  const tracking = latestTrackingSnapshot(companyId)
  const weeksTracked = listTrackingSnapshots(companyId).length

  // ─── efficiency ──────────────────────────────────────────────────────────
  const costRows = listApiCostsForCompany(companyId)
  const estimatedUsd = round4(estimateUsd(costRows))

  // ─── learning ────────────────────────────────────────────────────────────
  // Sector + global lessons already distilled by the retro analyzer, plus the
  // measured count of prompts this run that earned nothing at all.
  const worked = relevantLearnings(company.sector, ['prompt_pattern', 'action'], 8)
  const pitfalls = relevantLearnings(company.sector, ['pitfall'], 8)
  const outcomes = promptOutcomes(records, company)
  const dryPrompts = outcomes.filter((o) => o.mentions === 0 && o.citations === 0).length
  const whatDidNot = [
    ...pitfalls.map((l) => l.lesson),
    ...(outcomes.length > 0
      ? [`${dryPrompts}/${outcomes.length} prompts earned zero mentions and zero citations`]
      : []),
  ]

  const snapshot: NewClientSnapshot = {
    company_id: company.id,
    snapshot_at: now,
    kind,
    job_id: jobId ?? null,
    library_version: library?.version ?? null,

    // profile
    sector: company.sector,
    sector_key: sectorKey,
    niche_services: list(splitNiche(company.sector)),
    locations: list(company.locations),
    primary_location: company.location,
    avatar: company.buyerPersona,
    website: company.website,
    language: company.language,

    // setup
    prompts_total: composition.total,
    prompts_general: composition.general,
    prompts_avatar: composition.avatar,
    prompts_multilingual: composition.multilingual,
    engines: list(engines),
    runs_planned: plannedRuns(company, composition.total, engines) || runs.ok + runs.failed,
    runs_ok: runs.ok,
    runs_failed: runs.failed,

    // performance
    mention_rate: mentionRate,
    citation_rate: citationRate,
    sov: overall?.sov ?? 0,
    avg_rank: overall?.avgRank ?? null,
    top_competitor_sov: overall?.topCompetitorSov ?? 0,
    sentiment_pos_pct: sentimentPosPct,
    per_engine: JSON.stringify(combined?.perEngine ?? {}),

    // market
    competitors: list(competitors.map((c) => c.name)),
    top_competitor: competitors[0]?.name ?? '',
    citations_total: citationsTotal,
    citations_own: classes.own,
    citations_directory: classes.directories,
    citations_earned: classes.earned,
    citations_other: classes.other,
    top_cited_domains: list((combined?.topCitedDomains ?? []).slice(0, 10).map((d) => d.domain)),
    visibility_citation_gap: round1(mentionRate - citationRate),

    // delivery
    reports_generated: reports.filter((r) => r.kind !== 'page').length,
    pages_generated: reports.filter((r) => r.kind === 'page').length,
    action_plan_pages: plan?.pages.length ?? 0,
    directory_listings: plan?.directoryListings.length ?? 0,
    entity_tasks: plan?.entityTasks.length ?? 0,
    teardowns: teardowns.length,
    content_gaps: gaps.length,
    pack_folder: PACK_FOLDER,

    // movement
    mention_delta: tracking?.changes.mentionRateChange ?? null,
    citation_delta: tracking?.changes.citationRateChange ?? null,
    sentiment_delta: tracking?.changes.sentimentChange ?? null,
    new_competitors: list(tracking?.changes.newCompetitors ?? []),
    lost_competitors: list(tracking?.changes.lostCompetitors ?? []),
    weeks_tracked: weeksTracked,

    // efficiency
    api_calls: costRows.length,
    estimated_usd: estimatedUsd,
    usd_per_mention_point: round4(estimatedUsd / Math.max(mentionRate, 0.1)),

    // learning
    what_worked: worked.map((l) => l.lesson).join(' | '),
    what_did_not: whatDidNot.join(' | '),
    lessons_count: worked.length + pitfalls.length,
  }

  // The payload keeps the structured detail the flat columns had to flatten,
  // so a column added later can be backfilled from stored rows alone.
  const payload = {
    ...snapshot,
    detail: {
      measuredLibraryId,
      scoreCreatedAt: score?.createdAt ?? null,
      // domain-per-answer citation count (differs from the per-URL classes)
      supplyChainCitations: supplyChain?.totalCitations ?? 0,
      promptTiers: composition.tiers,
      runsByEngine: runs.byEngine,
      perEngine: combined?.perEngine ?? {},
      competitors: competitors.map((c) => ({ name: c.name, rawHits: c.rawHits })),
      topCitedDomains: combined?.topCitedDomains ?? [],
      citationHubs: (supplyChain?.hubs ?? []).slice(0, 10),
      reportsByKind: reports.reduce<Record<string, number>>((acc, r) => {
        acc[r.kind] = (acc[r.kind] ?? 0) + 1
        return acc
      }, {}),
      sentiment,
      trackingChanges: tracking?.changes ?? null,
      lessonsWorked: worked.map((l) => ({ kind: l.kind, lesson: l.lesson, weight: l.weight })),
      lessonsPitfalls: pitfalls.map((l) => ({ kind: l.kind, lesson: l.lesson, weight: l.weight })),
      dryPrompts,
      promptsEvaluated: outcomes.length,
      enginePlan: company.enginePlan ?? null,
    },
  }

  return insertClientSnapshot(snapshot, payload)
}

// ─── CSV export ─────────────────────────────────────────────────────────────

/** RFC4180 field: always quoted, embedded quotes doubled. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * RFC4180 CSV of the dataset: CRLF line breaks, every field quoted, header
 * row = the canonical DATASET_COLUMNS keys (machine-readable identifiers, so
 * a downstream parser keys on exactly the same strings the API returns).
 */
export function toCsv(rows: ClientSnapshot[]): string {
  const header = DATASET_COLUMNS.map((c) => csvField(c.key)).join(',')
  const body = rows.map((row) =>
    DATASET_COLUMNS.map((c) => csvField(row[c.key])).join(','),
  )
  return [header, ...body].join('\r\n') + '\r\n'
}
