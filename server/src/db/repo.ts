/**
 * Persistence helpers — one function per table, so stages/agents/API never
 * write SQL inline. JSON columns are (de)serialized at this boundary.
 */
import { connect } from './client.js'
import type {
  ActionPlan,
  ActionPlanInput,
  ApiCostEntry,
  AuditRecord,
  AuditScore,
  BotVisit,
  BotVisitSummary,
  CitationSource,
  ClientSnapshot,
  Company,
  CompetitorPage,
  CompetitorSnapshot,
  ContentGap,
  FreshnessCheck,
  NewClientSnapshot,
  PromptItem,
  PromptLibrary,
  ReferralEvent,
  ReportFile,
  ReverseReport,
  ScopedScore,
  SnapshotKind,
  StoredAuditRecord,
  TrackingSnapshot,
  TrendPoint,
  VerifiedCitation,
} from '../types.js'

const now = () => new Date().toISOString()

// ─── companies ──────────────────────────────────────────────────────────────

export function insertCompany(c: Company): void {
  // Upsert: re-running an audit for an existing company id refreshes the
  // profile (sector, avatar, engine plan…) instead of crashing on the PK.
  connect()
    .prepare(
      `INSERT INTO companies (id, name, sector, location, website, aliases, domain_hints,
                              competitors, buyer_persona, language, slack_webhook, locations,
                              engine_plan, engines, run_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, sector = excluded.sector, location = excluded.location,
         website = excluded.website, aliases = excluded.aliases,
         domain_hints = excluded.domain_hints, competitors = excluded.competitors,
         buyer_persona = excluded.buyer_persona, language = excluded.language,
         slack_webhook = excluded.slack_webhook, locations = excluded.locations,
         engine_plan = excluded.engine_plan, engines = excluded.engines,
         run_scope = excluded.run_scope`,
    )
    .run(
      c.id, c.name, c.sector, c.location, c.website,
      JSON.stringify(c.aliases), JSON.stringify(c.domainHints),
      JSON.stringify(c.competitors), c.buyerPersona, c.language,
      c.slackWebhook ?? null, JSON.stringify(c.locations),
      c.enginePlan ? JSON.stringify(c.enginePlan) : null,
      c.engines ? JSON.stringify(c.engines) : null,
      c.runScope ?? null,
      c.createdAt,
    )
}

export function getCompany(id: string): Company | null {
  const row = connect().prepare('SELECT * FROM companies WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToCompany(row) : null
}

export function listCompanies(): Company[] {
  const rows = connect().prepare('SELECT * FROM companies ORDER BY created_at DESC').all() as
    unknown as Record<string, unknown>[]
  return rows.map(rowToCompany)
}

function rowToCompany(row: Record<string, unknown>): Company {
  const location = String(row.location)
  let locations: string[] = []
  try {
    locations = JSON.parse(String(row.locations ?? '[]')) as string[]
  } catch {
    locations = []
  }
  // pre-migration rows have no locations column — the single location stands in
  if (!Array.isArray(locations) || locations.length === 0) locations = [location]
  return {
    id: String(row.id),
    name: String(row.name),
    sector: String(row.sector),
    location,
    website: String(row.website),
    aliases: JSON.parse(String(row.aliases)) as string[],
    domainHints: JSON.parse(String(row.domain_hints)) as string[],
    competitors: JSON.parse(String(row.competitors)) as string[],
    buyerPersona: String(row.buyer_persona ?? ''),
    language: String(row.language) as Company['language'],
    slackWebhook: row.slack_webhook ? String(row.slack_webhook) : undefined,
    locations,
    enginePlan: safeJson<Company['enginePlan']>(row.engine_plan),
    engines: safeJson<Company['engines']>(row.engines),
    // pre-migration rows have no run_scope — they ran the whole chain
    runScope: (row.run_scope ? String(row.run_scope) : 'full') as Company['runScope'],
    createdAt: String(row.created_at),
  }
}

/**
 * Delete a company and every derived artifact (jobs, events, libraries,
 * records, scores, reports, plans, tracking…). Table-by-table with a
 * defensive try/catch so a missing optional table never aborts the cascade.
 * Report FILES on disk are the caller's job (routes deletes the directory).
 */
export function deleteCompanyCascade(companyId: string): void {
  const con = connect()
  // Children before parents: verified_citations → audit_records → (scores,
  // audit_records) → prompt_libraries → companies. A wrong order leaves rows
  // behind (per-table failures are swallowed) and the final companies delete
  // then trips the FK constraint.
  const byCompany = [
    'audit_records', 'scores', 'prompt_libraries',
    'reports', 'reverse_reports', 'action_plans', 'trends', 'referral_events',
    'api_cost_log', 'bot_visits', 'tracking_snapshots', 'citation_sources',
    'content_gaps', 'competitor_snapshots', 'competitor_pages',
    'freshness_checks', 'ai_summaries', 'learnings', 'client_snapshots',
  ]
  try {
    con.prepare('DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE company_id = ?)').run(companyId)
  } catch { /* optional table */ }
  try {
    // verified_citations has no company_id — it hangs off audit_records
    con
      .prepare(
        'DELETE FROM verified_citations WHERE audit_record_id IN (SELECT id FROM audit_records WHERE company_id = ?)',
      )
      .run(companyId)
  } catch { /* optional table */ }
  for (const table of byCompany) {
    try {
      con.prepare(`DELETE FROM ${table} WHERE company_id = ?`).run(companyId)
    } catch { /* optional table or schema variant */ }
  }
  try {
    con.prepare('DELETE FROM jobs WHERE company_id = ?').run(companyId)
  } catch { /* defensive */ }
  con.prepare('DELETE FROM companies WHERE id = ?').run(companyId)
}

/** Parse an optional JSON column; undefined on NULL or malformed content. */
function safeJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return undefined
  }
}

// ─── prompt libraries ───────────────────────────────────────────────────────

export function insertPromptLibrary(companyId: string, items: PromptItem[]): PromptLibrary {
  const con = connect()
  const version =
    ((con
      .prepare('SELECT MAX(version) AS v FROM prompt_libraries WHERE company_id = ?')
      .get(companyId) as { v: number | null }).v ?? 0) + 1
  const res = con
    .prepare(
      'INSERT INTO prompt_libraries (company_id, version, items, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(companyId, version, JSON.stringify(items), now())
  return { id: Number(res.lastInsertRowid), companyId, version, items, createdAt: now() }
}

export function latestPromptLibrary(companyId: string): PromptLibrary | null {
  const row = connect()
    .prepare(
      'SELECT * FROM prompt_libraries WHERE company_id = ? ORDER BY version DESC LIMIT 1',
    )
    .get(companyId) as Record<string, unknown> | undefined
  return row ? rowToPromptLibrary(row) : null
}

/** One prompt library by row id — the dataset anchors on the SCORED library. */
export function getPromptLibrary(id: number): PromptLibrary | null {
  const row = connect().prepare('SELECT * FROM prompt_libraries WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToPromptLibrary(row) : null
}

function rowToPromptLibrary(row: Record<string, unknown>): PromptLibrary {
  return {
    id: Number(row.id),
    companyId: String(row.company_id),
    version: Number(row.version),
    items: JSON.parse(String(row.items)) as PromptItem[],
    createdAt: String(row.created_at),
  }
}

// ─── audit records ──────────────────────────────────────────────────────────

export function insertAuditRecord(
  companyId: string,
  libraryId: number,
  r: AuditRecord,
): void {
  connect()
    .prepare(
      `INSERT OR IGNORE INTO audit_records
       (company_id, library_id, engine, prompt, scope, persona, tier, run, ok, text, cited_urls, sentiment, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      companyId, libraryId, r.engine, r.prompt, r.scope, r.persona, r.tier, r.run,
      r.ok ? 1 : 0, r.text ?? null, JSON.stringify(r.citedUrls), r.sentiment ?? null,
      r.error ?? null, now(),
    )
}

function rowToAuditRecord(row: Record<string, unknown>): AuditRecord {
  return {
    engine: String(row.engine) as AuditRecord['engine'],
    prompt: String(row.prompt),
    scope: String(row.scope) as AuditRecord['scope'],
    persona: String(row.persona) as AuditRecord['persona'],
    tier: String(row.tier) as AuditRecord['tier'],
    run: Number(row.run),
    ok: Number(row.ok) === 1,
    text: row.text ? String(row.text) : undefined,
    citedUrls: JSON.parse(String(row.cited_urls)) as string[],
    sentiment: row.sentiment
      ? (String(row.sentiment) as NonNullable<AuditRecord['sentiment']>)
      : undefined,
    error: row.error ? String(row.error) : undefined,
  }
}

export function getAuditRecords(companyId: string, libraryId: number): AuditRecord[] {
  const rows = connect()
    .prepare('SELECT * FROM audit_records WHERE company_id = ? AND library_id = ?')
    .all(companyId, libraryId) as unknown as Record<string, unknown>[]
  return rows.map(rowToAuditRecord)
}

/**
 * Row id + cited URLs of every audit record for a library — the verify
 * stage's work list. `getAuditRecords` drops the row id (the runtime
 * AuditRecord type has none), but verified_citations references it.
 */
export function getAuditRecordCitations(
  companyId: string,
  libraryId: number,
): { id: number; citedUrls: string[] }[] {
  const rows = connect()
    .prepare(
      'SELECT id, cited_urls FROM audit_records WHERE company_id = ? AND library_id = ? ORDER BY id',
    )
    .all(companyId, libraryId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    citedUrls: JSON.parse(String(row.cited_urls)) as string[],
  }))
}

/**
 * Every stored audit record for a company across all prompt-library
 * versions, oldest first — the raw dataset the evidence layer verifies
 * against. Includes created_at (dropped by the runtime AuditRecord type).
 */
export function allAuditRecords(companyId: string): StoredAuditRecord[] {
  const rows = connect()
    .prepare('SELECT * FROM audit_records WHERE company_id = ? ORDER BY id')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({ ...rowToAuditRecord(row), createdAt: String(row.created_at) }))
}

/** Triples already stored — the audit stage skips these (idempotent resume). */
export function existingAuditKeys(companyId: string, libraryId: number): Set<string> {
  const rows = connect()
    .prepare(
      'SELECT engine, prompt, run FROM audit_records WHERE company_id = ? AND library_id = ?',
    )
    .all(companyId, libraryId) as unknown as { engine: string; prompt: string; run: number }[]
  return new Set(rows.map((r) => `${r.engine}|${r.prompt}|${r.run}`))
}

// ─── scores ─────────────────────────────────────────────────────────────────

export function insertScore(companyId: string, libraryId: number, payload: ScopedScore): void {
  connect()
    .prepare('INSERT INTO scores (company_id, library_id, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(companyId, libraryId, JSON.stringify(payload), now())
}

export function latestScore(
  companyId: string,
): { libraryId: number; payload: ScopedScore; createdAt: string } | null {
  const row = connect()
    .prepare('SELECT * FROM scores WHERE company_id = ? ORDER BY id DESC LIMIT 1')
    .get(companyId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    libraryId: Number(row.library_id),
    payload: JSON.parse(String(row.payload)) as ScopedScore,
    createdAt: String(row.created_at),
  }
}

// ─── reports ────────────────────────────────────────────────────────────────

export function insertReport(rep: Omit<ReportFile, 'id'>): number {
  const res = connect()
    .prepare(
      'INSERT INTO reports (company_id, scope, lang, kind, path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(rep.companyId, rep.scope, rep.lang, rep.kind, rep.path, rep.createdAt)
  return Number(res.lastInsertRowid)
}

export function listReports(companyId: string): ReportFile[] {
  const rows = connect()
    .prepare('SELECT * FROM reports WHERE company_id = ? ORDER BY id DESC')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: String(row.company_id),
    scope: String(row.scope) as ReportFile['scope'],
    lang: String(row.lang) as ReportFile['lang'],
    kind: String(row.kind) as ReportFile['kind'],
    path: String(row.path),
    createdAt: String(row.created_at),
  }))
}

// ─── api cost log ───────────────────────────────────────────────────────────

/**
 * Every logged provider call, oldest first. The table is small, so the API
 * aggregates in memory rather than per-endpoint SQL.
 */
export function listApiCosts(): ApiCostEntry[] {
  const rows = connect()
    .prepare('SELECT * FROM api_cost_log ORDER BY id')
    .all() as unknown as Record<string, unknown>[]
  return rows.map(rowToApiCost)
}

/** Cost rows for one company, oldest first — the dataset's spend columns. */
export function listApiCostsForCompany(companyId: string): ApiCostEntry[] {
  const rows = connect()
    .prepare('SELECT * FROM api_cost_log WHERE company_id = ? ORDER BY id')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map(rowToApiCost)
}

/** Cost rows for one job, oldest first — the audit detail's spend/timeline. */
export function listApiCostsForJob(jobId: string): ApiCostEntry[] {
  const rows = connect()
    .prepare('SELECT * FROM api_cost_log WHERE job_id = ? ORDER BY id')
    .all(jobId) as unknown as Record<string, unknown>[]
  return rows.map(rowToApiCost)
}

function rowToApiCost(row: Record<string, unknown>): ApiCostEntry {
  return {
    id: Number(row.id),
    jobId: row.job_id ? String(row.job_id) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    vendor: String(row.vendor),
    model: String(row.model),
    kind: String(row.kind) as ApiCostEntry['kind'],
    at: String(row.at),
  }
}

// ─── reverse reports / action plans ─────────────────────────────────────────

export function insertReverseReport(companyId: string, rep: ReverseReport): void {
  connect()
    .prepare(
      'INSERT INTO reverse_reports (company_id, competitor, payload, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(companyId, rep.competitor, JSON.stringify(rep), rep.createdAt)
}

export function listReverseReports(companyId: string): ReverseReport[] {
  const rows = connect()
    .prepare('SELECT payload FROM reverse_reports WHERE company_id = ? ORDER BY id')
    .all(companyId) as unknown as { payload: string }[]
  return rows.map((r) => JSON.parse(r.payload) as ReverseReport)
}

export function insertActionPlan(companyId: string, plan: ActionPlanInput): number {
  const res = connect()
    .prepare('INSERT INTO action_plans (company_id, payload, created_at) VALUES (?, ?, ?)')
    .run(companyId, JSON.stringify(plan), now())
  return Number(res.lastInsertRowid)
}

export function latestActionPlan(companyId: string): ActionPlan | null {
  const row = connect()
    .prepare('SELECT * FROM action_plans WHERE company_id = ? ORDER BY id DESC LIMIT 1')
    .get(companyId) as Record<string, unknown> | undefined
  if (!row) return null
  const payload = JSON.parse(String(row.payload)) as ActionPlanInput
  return { id: Number(row.id), companyId, createdAt: String(row.created_at), ...payload }
}

// ─── trends ─────────────────────────────────────────────────────────────────

export function insertTrend(companyId: string, scope: string, score: AuditScore): void {
  connect()
    .prepare(
      'INSERT INTO trends (company_id, scope, mention_rate, citation_rate, sov, at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(companyId, scope, score.overall.mentionRate, score.overall.citationRate, score.overall.sov, now())
}

export function listTrends(companyId: string): TrendPoint[] {
  const rows = connect()
    .prepare('SELECT * FROM trends WHERE company_id = ? ORDER BY at')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    at: String(row.at),
    scope: String(row.scope) as TrendPoint['scope'],
    mentionRate: Number(row.mention_rate),
    citationRate: Number(row.citation_rate),
    sov: Number(row.sov),
  }))
}

// ─── referral events ────────────────────────────────────────────────────────

export function insertReferralEvent(ev: Omit<ReferralEvent, 'id'>): void {
  connect()
    .prepare(
      'INSERT INTO referral_events (company_id, kind, referrer, page, meta, at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(ev.companyId, ev.kind, ev.referrer, ev.page, JSON.stringify(ev.meta), ev.at)
}

export function referralEvents(companyId: string): ReferralEvent[] {
  const rows = connect()
    .prepare('SELECT * FROM referral_events WHERE company_id = ? ORDER BY at')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: String(row.company_id),
    kind: String(row.kind) as ReferralEvent['kind'],
    referrer: String(row.referrer) as ReferralEvent['referrer'],
    page: String(row.page),
    meta: JSON.parse(String(row.meta)) as Record<string, string>,
    at: String(row.at),
  }))
}

// ─── bot visits (AI crawler log) ────────────────────────────────────────────

export function insertBotVisit(v: Omit<BotVisit, 'id'>): void {
  connect()
    .prepare(
      'INSERT INTO bot_visits (company_id, bot, path, status, at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(v.companyId, v.bot, v.path, v.status, v.at)
}

export function listBotVisits(companyId: string, limit = 200): BotVisit[] {
  const rows = connect()
    .prepare('SELECT * FROM bot_visits WHERE company_id = ? ORDER BY id DESC LIMIT ?')
    .all(companyId, limit) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: String(row.company_id),
    bot: String(row.bot),
    path: String(row.path),
    status: row.status === null || row.status === undefined ? null : Number(row.status),
    at: String(row.at),
  }))
}

/** Per-bot counts + last-seen and per-page counts for the AI-traffic view. */
export function botVisitSummary(companyId: string): BotVisitSummary {
  const con = connect()
  const total = (
    con.prepare('SELECT COUNT(*) AS n FROM bot_visits WHERE company_id = ?').get(companyId) as {
      n: number
    }
  ).n
  const lastSeen = (
    con.prepare('SELECT MAX(at) AS m FROM bot_visits WHERE company_id = ?').get(companyId) as {
      m: string | null
    }
  ).m
  const byBot = con
    .prepare(
      `SELECT bot, COUNT(*) AS count, MAX(at) AS last_seen
       FROM bot_visits WHERE company_id = ?
       GROUP BY bot ORDER BY count DESC, bot`,
    )
    .all(companyId) as unknown as { bot: string; count: number; last_seen: string }[]
  const topPages = con
    .prepare(
      `SELECT path, COUNT(*) AS count
       FROM bot_visits WHERE company_id = ?
       GROUP BY path ORDER BY count DESC, path LIMIT 20`,
    )
    .all(companyId) as unknown as { path: string; count: number }[]
  return {
    total,
    byBot: byBot.map((r) => ({ bot: r.bot, count: r.count, lastSeen: r.last_seen })),
    topPages: topPages.map((r) => ({ path: r.path, count: r.count })),
    lastSeen,
  }
}

// ─── monitoring: tracking snapshots ─────────────────────────────────────────

export function insertTrackingSnapshot(
  snap: Omit<TrackingSnapshot, 'id' | 'createdAt'>,
): number {
  const res = connect()
    .prepare(
      `INSERT INTO tracking_snapshots (company_id, week_start, mention_rate, citation_rate, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snap.companyId, snap.weekStart, snap.mentionRate, snap.citationRate,
      JSON.stringify(snap.changes), now(),
    )
  return Number(res.lastInsertRowid)
}

function rowToTrackingSnapshot(row: Record<string, unknown>): TrackingSnapshot {
  return {
    id: Number(row.id),
    companyId: String(row.company_id),
    weekStart: String(row.week_start),
    mentionRate: Number(row.mention_rate),
    citationRate: Number(row.citation_rate),
    changes: JSON.parse(String(row.changes)) as TrackingSnapshot['changes'],
    createdAt: String(row.created_at),
  }
}

export function listTrackingSnapshots(companyId: string): TrackingSnapshot[] {
  const rows = connect()
    .prepare('SELECT * FROM tracking_snapshots WHERE company_id = ? ORDER BY week_start')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map(rowToTrackingSnapshot)
}

export function latestTrackingSnapshot(companyId: string): TrackingSnapshot | null {
  const row = connect()
    .prepare('SELECT * FROM tracking_snapshots WHERE company_id = ? ORDER BY id DESC LIMIT 1')
    .get(companyId) as Record<string, unknown> | undefined
  return row ? rowToTrackingSnapshot(row) : null
}

// ─── monitoring: citation sources ───────────────────────────────────────────

/** Upsert one domain row; counts/prompt types replace, created_at survives. */
export function upsertCitationSource(
  src: Omit<CitationSource, 'id' | 'createdAt'>,
): void {
  connect()
    .prepare(
      `INSERT INTO citation_sources
         (company_id, domain, company_citations, competitor_citations, prompt_types, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, domain) DO UPDATE SET
         company_citations    = excluded.company_citations,
         competitor_citations = excluded.competitor_citations,
         prompt_types         = excluded.prompt_types,
         last_seen            = excluded.last_seen`,
    )
    .run(
      src.companyId, src.domain, src.companyCitations, src.competitorCitations,
      JSON.stringify(src.promptTypes), src.lastSeen, now(),
    )
}

export function listCitationSources(companyId: string): CitationSource[] {
  const rows = connect()
    .prepare(
      `SELECT * FROM citation_sources WHERE company_id = ?
       ORDER BY (company_citations + competitor_citations) DESC, domain`,
    )
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: String(row.company_id),
    domain: String(row.domain),
    companyCitations: Number(row.company_citations),
    competitorCitations: Number(row.competitor_citations),
    promptTypes: JSON.parse(String(row.prompt_types)) as string[],
    lastSeen: String(row.last_seen),
    createdAt: String(row.created_at),
  }))
}

// ─── monitoring: content gaps ───────────────────────────────────────────────

/** Idempotent insert — UNIQUE(company_id, prompt) keeps re-runs stable. */
export function insertContentGap(gap: Omit<ContentGap, 'id' | 'status' | 'createdAt'>): void {
  connect()
    .prepare(
      `INSERT OR IGNORE INTO content_gaps
         (company_id, prompt, reason, recommended_format, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`,
    )
    .run(gap.companyId, gap.prompt, gap.reason, gap.recommendedFormat, now())
}

export function listContentGaps(companyId: string): ContentGap[] {
  const rows = connect()
    .prepare('SELECT * FROM content_gaps WHERE company_id = ? ORDER BY id')
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: String(row.company_id),
    prompt: String(row.prompt),
    reason: String(row.reason),
    recommendedFormat: String(row.recommended_format) as ContentGap['recommendedFormat'],
    status: String(row.status) as ContentGap['status'],
    createdAt: String(row.created_at),
  }))
}

// ─── monitoring: competitor snapshots ───────────────────────────────────────

export function insertCompetitorSnapshot(
  snap: Omit<CompetitorSnapshot, 'id'>,
): number {
  const res = connect()
    .prepare(
      `INSERT INTO competitor_snapshots
         (company_id, competitor_domain, title, meta_description, headings, pricing, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snap.companyId, snap.competitorDomain, snap.title, snap.metaDescription,
      JSON.stringify(snap.headings), JSON.stringify(snap.pricing), snap.scrapedAt,
    )
  return Number(res.lastInsertRowid)
}

function rowToCompetitorSnapshot(row: Record<string, unknown>): CompetitorSnapshot {
  return {
    id: Number(row.id),
    companyId: String(row.company_id),
    competitorDomain: String(row.competitor_domain),
    title: String(row.title),
    metaDescription: String(row.meta_description),
    headings: JSON.parse(String(row.headings)) as string[],
    pricing: JSON.parse(String(row.pricing)) as string[],
    scrapedAt: String(row.scraped_at),
  }
}

/** Latest snapshot per competitor domain for a company (diff baseline). */
export function latestCompetitorSnapshots(companyId: string): CompetitorSnapshot[] {
  const rows = connect()
    .prepare(
      `SELECT c.* FROM competitor_snapshots c
       JOIN (SELECT competitor_domain, MAX(id) AS max_id
             FROM competitor_snapshots WHERE company_id = ?
             GROUP BY competitor_domain) latest
         ON latest.max_id = c.id`,
    )
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map(rowToCompetitorSnapshot)
}

/** Recent snapshots for change feeds (newest first, capped). */
export function listCompetitorSnapshots(companyId: string, limit = 50): CompetitorSnapshot[] {
  const rows = connect()
    .prepare(
      'SELECT * FROM competitor_snapshots WHERE company_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(companyId, limit) as unknown as Record<string, unknown>[]
  return rows.map(rowToCompetitorSnapshot)
}

// ─── verified citations ─────────────────────────────────────────────────────

export function insertVerifiedCitation(cit: Omit<VerifiedCitation, 'id'>): number {
  const res = connect()
    .prepare(
      `INSERT INTO verified_citations
       (audit_record_id, url, actually_cites_brand, citation_context, page_title, page_schema, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cit.auditRecordId,
      cit.url,
      cit.actuallyCitesBrand ? 1 : 0,
      cit.citationContext ?? null,
      cit.pageTitle ?? null,
      cit.pageSchema ?? null,
      cit.verifiedAt,
    )
  return Number(res.lastInsertRowid)
}

export function listVerifiedCitations(auditRecordId: number): VerifiedCitation[] {
  const rows = connect()
    .prepare('SELECT * FROM verified_citations WHERE audit_record_id = ?')
    .all(auditRecordId) as unknown as Record<string, unknown>[]
  return rows.map(rowToVerifiedCitation)
}

/**
 * Every verified citation for a company (joined through audit_records) —
 * the report's evidence section marks snippet sources with this.
 */
export function listVerifiedCitationsByCompany(companyId: string): VerifiedCitation[] {
  const rows = connect()
    .prepare(
      `SELECT v.* FROM verified_citations v
       JOIN audit_records a ON a.id = v.audit_record_id
       WHERE a.company_id = ?
       ORDER BY v.id`,
    )
    .all(companyId) as unknown as Record<string, unknown>[]
  return rows.map(rowToVerifiedCitation)
}

function rowToVerifiedCitation(row: Record<string, unknown>): VerifiedCitation {
  return {
    id: Number(row.id),
    auditRecordId: Number(row.audit_record_id),
    url: String(row.url),
    actuallyCitesBrand: Number(row.actually_cites_brand) === 1,
    citationContext: row.citation_context ? String(row.citation_context) : undefined,
    pageTitle: row.page_title ? String(row.page_title) : undefined,
    pageSchema: row.page_schema ? String(row.page_schema) : undefined,
    verifiedAt: String(row.verified_at),
  }
}

/**
 * Positive-sentiment share per audit day, oldest first. Only ok answers with
 * a sentiment label count. Powers the report's sentiment trend (rendered
 * only when ≥2 days exist — a single point is not a trend).
 */
export function sentimentTrendByDay(companyId: string): { at: string; positivePct: number }[] {
  const rows = connect()
    .prepare(
      `SELECT date(created_at) AS day,
              SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS pos,
              COUNT(*) AS n
       FROM audit_records
       WHERE company_id = ? AND ok = 1 AND sentiment IS NOT NULL
       GROUP BY day
       ORDER BY day`,
    )
    .all(companyId) as unknown as { day: string; pos: number; n: number }[]
  return rows.map((r) => ({ at: r.day, positivePct: Math.round((1000 * r.pos) / r.n) / 10 }))
}

/**
 * Sentiment breakdown across all ok answers that carry a sentiment label.
 * Powers the dashboard's sentiment donut; `total` is the labelled-answer count
 * so the UI can hide the chart when nothing has been judged yet.
 */
export function sentimentBreakdown(
  companyId: string,
): { total: number; positive: number; neutral: number; negative: number } {
  const row = connect()
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END), 0) AS positive,
              COALESCE(SUM(CASE WHEN sentiment = 'neutral'  THEN 1 ELSE 0 END), 0) AS neutral,
              COALESCE(SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END), 0) AS negative
       FROM audit_records
       WHERE company_id = ? AND ok = 1 AND sentiment IS NOT NULL`,
    )
    .get(companyId) as { total: number; positive: number; neutral: number; negative: number }
  return {
    total: row.total,
    positive: row.positive,
    neutral: row.neutral,
    negative: row.negative,
  }
}

// ─── competitor pages ───────────────────────────────────────────────────────

/**
 * Upsert on (company_id, url): repeated competitor-stage runs re-scrape the
 * same top-cited pages every time, and a plain INSERT was piling up
 * duplicate rows per URL (observed: 185 rows / 164 distinct URLs after a
 * few same-day runs). ON CONFLICT refreshes the analysis in place.
 */
export function insertCompetitorPage(page: Omit<CompetitorPage, 'id'>): number {
  const res = connect()
    .prepare(
      `INSERT INTO competitor_pages
       (company_id, competitor_domain, url, title, meta_description, headings, schema_markup,
        word_count, answer_format, has_statistics, has_faq, has_comparison_table, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, url) DO UPDATE SET
         competitor_domain = excluded.competitor_domain, title = excluded.title,
         meta_description = excluded.meta_description, headings = excluded.headings,
         schema_markup = excluded.schema_markup, word_count = excluded.word_count,
         answer_format = excluded.answer_format, has_statistics = excluded.has_statistics,
         has_faq = excluded.has_faq, has_comparison_table = excluded.has_comparison_table,
         scraped_at = excluded.scraped_at`,
    )
    .run(
      page.companyId,
      page.competitorDomain,
      page.url,
      page.title ?? null,
      page.metaDescription ?? null,
      JSON.stringify(page.headings),
      page.schemaMarkup ?? null,
      page.wordCount ?? null,
      page.answerFormat ?? null,
      page.hasStatistics ? 1 : 0,
      page.hasFaq ? 1 : 0,
      page.hasComparisonTable ? 1 : 0,
      page.scrapedAt,
    )
  // On the UPDATE branch of an upsert, lastInsertRowid is not refreshed by
  // SQLite — re-read the row id explicitly so callers always get the real one.
  if (res.changes > 0 && Number(res.lastInsertRowid) === 0) {
    const row = connect()
      .prepare('SELECT id FROM competitor_pages WHERE company_id = ? AND url = ?')
      .get(page.companyId, page.url) as { id: number } | undefined
    if (row) return row.id
  }
  return Number(res.lastInsertRowid)
}

export function listCompetitorPages(companyId: string, competitorDomain?: string): CompetitorPage[] {
  const query = competitorDomain
    ? 'SELECT * FROM competitor_pages WHERE company_id = ? AND competitor_domain = ? ORDER BY scraped_at DESC'
    : 'SELECT * FROM competitor_pages WHERE company_id = ? ORDER BY scraped_at DESC'
  const params = competitorDomain ? [companyId, competitorDomain] : [companyId]
  const rows = connect().prepare(query).all(...params) as unknown as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: String(row.company_id),
    competitorDomain: String(row.competitor_domain),
    url: String(row.url),
    title: row.title ? String(row.title) : undefined,
    metaDescription: row.meta_description ? String(row.meta_description) : undefined,
    headings: JSON.parse(String(row.headings)) as string[],
    schemaMarkup: row.schema_markup ? String(row.schema_markup) : undefined,
    wordCount: row.word_count ? Number(row.word_count) : undefined,
    answerFormat: row.answer_format ? (String(row.answer_format) as CompetitorPage['answerFormat']) : undefined,
    hasStatistics: Number(row.has_statistics) === 1,
    hasFaq: Number(row.has_faq) === 1,
    hasComparisonTable: Number(row.has_comparison_table) === 1,
    scrapedAt: String(row.scraped_at),
  }))
}

// ─── content freshness checks ───────────────────────────────────────────────

export function insertFreshnessCheck(row: Omit<FreshnessCheck, 'id'>): void {
  connect()
    .prepare(
      'INSERT INTO freshness_checks (company_id, path, reason, detail, checked_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(row.companyId, row.path, row.reason, row.detail, row.checkedAt)
}

function rowToFreshnessCheck(row: Record<string, unknown>): FreshnessCheck {
  return {
    id: Number(row.id),
    companyId: String(row.company_id),
    path: String(row.path),
    reason: String(row.reason) as FreshnessCheck['reason'],
    detail: String(row.detail ?? ''),
    checkedAt: String(row.checked_at),
  }
}

/**
 * Every row of the company's most recent freshness run, or null when no run
 * has completed yet. Each run re-checks every page, so the latest checked_at
 * is the complete current state.
 */
export function latestFreshnessRun(
  companyId: string,
): { checkedAt: string; rows: FreshnessCheck[] } | null {
  const con = connect()
  const latest = (
    con
      .prepare('SELECT MAX(checked_at) AS m FROM freshness_checks WHERE company_id = ?')
      .get(companyId) as { m: string | null }
  ).m
  if (!latest) return null
  const rows = con
    .prepare('SELECT * FROM freshness_checks WHERE company_id = ? AND checked_at = ? ORDER BY path')
    .all(companyId, latest) as unknown as Record<string, unknown>[]
  return { checkedAt: latest, rows: rows.map(rowToFreshnessCheck) }
}

// ─── Retro-learning memory ──────────────────────────────────────────────────

export interface Learning {
  id: number
  scope: 'global' | 'sector' | 'company'
  sectorKey: string | null
  companyId: string | null
  kind: 'prompt_pattern' | 'pitfall' | 'insight' | 'action'
  lesson: string
  evidence: string | null
  weight: number
  sourceJob: string | null
  createdAt: string
  updatedAt: string
}

export interface NewLearning {
  scope: Learning['scope']
  sectorKey?: string
  companyId?: string
  kind: Learning['kind']
  lesson: string
  evidence?: string
  sourceJob?: string
}

/** Normalize a sector label into the stable key lessons are filed under. */
export function sectorKeyOf(sector: string): string {
  return sector
    .toLowerCase()
    .split('/')[0]!
    .trim()
    .replace(/[äàâ]/g, 'a').replace(/[öô]/g, 'o').replace(/[üû]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Insert a lesson — or, when a same-scope lesson with near-identical text
 * already exists, bump its weight instead (re-confirmation beats
 * duplication; weight is what the retrieval ranking sorts by).
 */
export function upsertLearning(l: NewLearning): number {
  const con = connect()
  const now = new Date().toISOString()
  const existing = con
    .prepare(
      `SELECT id, weight FROM learnings
       WHERE scope = ? AND COALESCE(sector_key,'') = ? AND COALESCE(company_id,'') = ?
         AND kind = ? AND lower(lesson) = lower(?)`,
    )
    .get(l.scope, l.sectorKey ?? '', l.companyId ?? '', l.kind, l.lesson) as
    | { id: number; weight: number }
    | undefined
  if (existing) {
    con
      .prepare('UPDATE learnings SET weight = weight + 1, updated_at = ?, source_job = COALESCE(?, source_job) WHERE id = ?')
      .run(now, l.sourceJob ?? null, existing.id)
    return existing.id
  }
  const res = con
    .prepare(
      `INSERT INTO learnings (scope, sector_key, company_id, kind, lesson, evidence, weight, source_job, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      l.scope, l.sectorKey ?? null, l.companyId ?? null, l.kind, l.lesson,
      l.evidence ?? null, l.sourceJob ?? null, now, now,
    )
  return Number(res.lastInsertRowid)
}

function rowToLearning(row: Record<string, unknown>): Learning {
  return {
    id: Number(row.id),
    scope: String(row.scope) as Learning['scope'],
    sectorKey: row.sector_key ? String(row.sector_key) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    kind: String(row.kind) as Learning['kind'],
    lesson: String(row.lesson),
    evidence: row.evidence ? String(row.evidence) : null,
    weight: Number(row.weight),
    sourceJob: row.source_job ? String(row.source_job) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * Lessons relevant to an upcoming run: global ones plus the sector's own,
 * ranked by confirmation weight then recency. `kinds` narrows to the
 * consumer's interest (promptgen wants prompt_pattern + pitfall; the action
 * planner wants insight + action).
 */
export function relevantLearnings(
  sector: string,
  kinds: Learning['kind'][],
  limit = 8,
): Learning[] {
  if (kinds.length === 0) return []
  const key = sectorKeyOf(sector)
  const placeholders = kinds.map(() => '?').join(',')
  const rows = connect()
    .prepare(
      `SELECT * FROM learnings
       WHERE kind IN (${placeholders})
         AND (scope = 'global' OR (scope = 'sector' AND sector_key = ?))
       ORDER BY weight DESC, updated_at DESC LIMIT ?`,
    )
    .all(...kinds, key, limit) as unknown as Record<string, unknown>[]
  return rows.map(rowToLearning)
}

/** All lessons, newest-confirmed first (dashboard/API listing). */
export function listLearnings(limit = 100): Learning[] {
  const rows = connect()
    .prepare('SELECT * FROM learnings ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as unknown as Record<string, unknown>[]
  return rows.map(rowToLearning)
}

// ─── AI summaries (persistent cache) ────────────────────────────────────────

export interface StoredAiSummary {
  companyId: string
  cacheKey: string
  summary: string
  generatedAt: string
}

export function saveAiSummary(s: StoredAiSummary): void {
  connect()
    .prepare(
      `INSERT INTO ai_summaries (company_id, cache_key, summary, generated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id) DO UPDATE SET
         cache_key = excluded.cache_key, summary = excluded.summary,
         generated_at = excluded.generated_at`,
    )
    .run(s.companyId, s.cacheKey, s.summary, s.generatedAt)
}

export function getAiSummary(companyId: string): StoredAiSummary | null {
  const row = connect()
    .prepare('SELECT * FROM ai_summaries WHERE company_id = ?')
    .get(companyId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    companyId: String(row.company_id),
    cacheKey: String(row.cache_key),
    summary: String(row.summary),
    generatedAt: String(row.generated_at),
  }
}

// ─── LeadEngine Data (client_snapshots) ─────────────────────────────────────

/**
 * Ordered list of the client_snapshots data columns, i.e. every column except
 * the surrogate id and the payload blob. Both the INSERT statement and the
 * row reader are generated from it, so adding a column to ClientSnapshot +
 * the migration is the only edit needed.
 */
const SNAPSHOT_COLUMNS: (keyof NewClientSnapshot)[] = [
  'company_id', 'snapshot_at', 'kind', 'job_id', 'library_version',
  'sector', 'sector_key', 'niche_services', 'locations', 'primary_location',
  'avatar', 'website', 'language',
  'prompts_total', 'prompts_general', 'prompts_avatar', 'prompts_multilingual',
  'engines', 'runs_planned', 'runs_ok', 'runs_failed',
  'mention_rate', 'citation_rate', 'sov', 'avg_rank', 'top_competitor_sov',
  'sentiment_pos_pct', 'per_engine',
  'competitors', 'top_competitor', 'citations_total', 'citations_own',
  'citations_directory', 'citations_earned', 'citations_other',
  'top_cited_domains', 'visibility_citation_gap',
  'reports_generated', 'pages_generated', 'action_plan_pages',
  'directory_listings', 'entity_tasks', 'teardowns', 'content_gaps', 'pack_folder',
  'mention_delta', 'citation_delta', 'sentiment_delta', 'new_competitors',
  'lost_competitors', 'weeks_tracked',
  'api_calls', 'estimated_usd', 'usd_per_mention_point',
  'what_worked', 'what_did_not', 'lessons_count',
]

/** Numeric columns — read back as numbers (SQLite returns them typed, but
 *  NULL must stay null and legacy TEXT values must not leak into the API). */
const SNAPSHOT_NUMERIC = new Set<string>([
  'library_version', 'prompts_total', 'prompts_general', 'prompts_avatar',
  'prompts_multilingual', 'runs_planned', 'runs_ok', 'runs_failed',
  'mention_rate', 'citation_rate', 'sov', 'avg_rank', 'top_competitor_sov',
  'sentiment_pos_pct', 'citations_total', 'citations_own', 'citations_directory',
  'citations_earned', 'citations_other', 'visibility_citation_gap',
  'reports_generated', 'pages_generated', 'action_plan_pages', 'directory_listings',
  'entity_tasks', 'teardowns', 'content_gaps', 'mention_delta', 'citation_delta',
  'sentiment_delta', 'weeks_tracked', 'api_calls', 'estimated_usd',
  'usd_per_mention_point', 'lessons_count',
])

/** Columns that may legitimately be NULL (everything else defaults non-null). */
const SNAPSHOT_NULLABLE = new Set<string>([
  'job_id', 'library_version', 'avg_rank', 'sentiment_pos_pct',
  'mention_delta', 'citation_delta', 'sentiment_delta',
])

function rowToClientSnapshot(row: Record<string, unknown>): ClientSnapshot {
  const out: Record<string, unknown> = { id: Number(row.id) }
  for (const col of SNAPSHOT_COLUMNS) {
    const raw = row[col]
    if ((raw === null || raw === undefined) && SNAPSHOT_NULLABLE.has(col)) {
      out[col] = null
      continue
    }
    out[col] = SNAPSHOT_NUMERIC.has(col) ? Number(raw ?? 0) : String(raw ?? '')
  }
  return out as unknown as ClientSnapshot
}

/**
 * Append one dataset row. Append-only by design: nothing updates an existing
 * snapshot, so the client's timeline stays intact. `payload` is the full JSON
 * of the collection (superset of the columns).
 */
export function insertClientSnapshot(
  snap: NewClientSnapshot,
  payload: unknown = {},
): ClientSnapshot {
  const placeholders = SNAPSHOT_COLUMNS.map(() => '?').join(', ')
  const values = SNAPSHOT_COLUMNS.map((col) => {
    const v = snap[col]
    return v === undefined ? null : (v as string | number | null)
  })
  const res = connect()
    .prepare(
      `INSERT INTO client_snapshots (${SNAPSHOT_COLUMNS.join(', ')}, payload)
       VALUES (${placeholders}, ?)`,
    )
    .run(...values, JSON.stringify(payload ?? {}))
  return { ...snap, id: Number(res.lastInsertRowid) }
}

/** All dataset rows, newest first (the admin dataset table + CSV export). */
export function listClientSnapshots(limit = 500): ClientSnapshot[] {
  const rows = connect()
    .prepare('SELECT * FROM client_snapshots ORDER BY snapshot_at DESC, id DESC LIMIT ?')
    .all(limit) as unknown as Record<string, unknown>[]
  return rows.map(rowToClientSnapshot)
}

/** One company's lifecycle timeline, newest first. */
export function listClientSnapshotsForCompany(
  companyId: string,
  limit = 500,
): ClientSnapshot[] {
  const rows = connect()
    .prepare(
      'SELECT * FROM client_snapshots WHERE company_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT ?',
    )
    .all(companyId, limit) as unknown as Record<string, unknown>[]
  return rows.map(rowToClientSnapshot)
}

/** Latest snapshot per company — the "current state" view the overview averages. */
export function latestClientSnapshotPerCompany(): ClientSnapshot[] {
  const rows = connect()
    .prepare(
      `SELECT s.* FROM client_snapshots s
       JOIN (SELECT company_id, MAX(id) AS max_id FROM client_snapshots GROUP BY company_id) latest
         ON latest.max_id = s.id
       ORDER BY s.snapshot_at DESC`,
    )
    .all() as unknown as Record<string, unknown>[]
  return rows.map(rowToClientSnapshot)
}

export function countClientSnapshots(): number {
  return (
    connect().prepare('SELECT COUNT(*) AS n FROM client_snapshots').get() as { n: number }
  ).n
}

/** Snapshot counts by kind — dataset composition for the overview. */
export function clientSnapshotCountsByKind(): { kind: SnapshotKind; count: number }[] {
  const rows = connect()
    .prepare('SELECT kind, COUNT(*) AS count FROM client_snapshots GROUP BY kind ORDER BY count DESC')
    .all() as unknown as { kind: string; count: number }[]
  return rows.map((r) => ({ kind: r.kind as SnapshotKind, count: r.count }))
}

// ─── system-health aggregates (admin overview / weak spots) ─────────────────

/** Job counts per status — how many audits ran and how many died. */
export function jobCountsByStatus(): { status: string; count: number }[] {
  const rows = connect()
    .prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status')
    .all() as unknown as { status: string; count: number }[]
  return rows
}

/** Stages where jobs failed, most failures first — where the SYSTEM breaks. */
export function failedJobStages(): { stage: string; count: number }[] {
  const rows = connect()
    .prepare(
      `SELECT stage, COUNT(*) AS count FROM jobs
       WHERE status = 'failed' GROUP BY stage ORDER BY count DESC, stage`,
    )
    .all() as unknown as { stage: string; count: number }[]
  return rows
}

/** Lesson counts per kind (+ total) for the overview's learning block. */
export function learningCountsByKind(): { kind: Learning['kind']; count: number }[] {
  const rows = connect()
    .prepare('SELECT kind, COUNT(*) AS count FROM learnings GROUP BY kind ORDER BY count DESC, kind')
    .all() as unknown as { kind: string; count: number }[]
  return rows.map((r) => ({ kind: r.kind as Learning['kind'], count: r.count }))
}
