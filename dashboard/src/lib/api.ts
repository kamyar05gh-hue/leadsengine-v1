const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:7002/api'

export { API_BASE }

/** Human-readable API host for error copy, e.g. "localhost:7002". */
export const API_HOST: string = API_BASE.replace(/^https?:\/\//, '').replace(/\/api\/?$/, '')

// ---------- Types ----------

/**
 * 'queued' is a real backend job status — it counts as live (the backend
 * refuses to delete a company whose job is queued or running).
 */
export type AuditStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed'

export interface CompetitorMetric {
  name: string
  mentionRate: number // 0-1
  citationRate: number // 0-1
}

/** Engines the pipeline can run. */
export type EngineId = 'chatgpt' | 'gemini' | 'perplexity' | 'claude'

export type AuditStageStatus = 'done' | 'running' | 'failed' | 'pending'

/** One pipeline stage of a running audit (GET /api/audits/:id `timeline`). */
export interface AuditStageInfo {
  stage: string // 'intake'|'promptgen'|'audit'|'verify'|'score'|'reverse'|'competitors'|'report'|'actions'|'pages'
  label: string // human label, e.g. "AI engine audit"
  status: AuditStageStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  calls: number
  estimatedUsd: number
  lastMessage: string | null
}

export interface Audit {
  id: string
  companyId: string
  companyName: string
  websiteUrl?: string
  industry?: string
  region?: string
  competitors: string[]
  promptCount: number
  engines: string[]
  status: AuditStatus
  progress?: number // 0-100 while running
  mentionRate?: number // 0-1
  citationRate?: number // 0-1
  competitorMetrics?: CompetitorMetric[]
  recommendations?: string[]
  createdAt: string
  /** Pipeline extensions — present once the staged backend deploys. */
  stage?: string
  locations?: string[]
  timeline?: AuditStageInfo[]
  spend?: { calls: number; estimatedUsd: number }
  /** Avatar (target audience) the audit impersonates in LLM runs. */
  avatar?: string
  /** Per-engine prompt allocation the backend resolved for this run. */
  enginePlan?: Record<string, number>
  /** How far this run goes (see RunScope). */
  runScope?: RunScope
  /** Failure reason when status === 'failed'. */
  error?: string
}

/**
 * How far a workflow run goes. Each scope is a prefix of the same chain —
 * a shorter run stops earlier, it is never a different pipeline.
 *
 *  report  — measure + score + PDF report deck
 *  actions — additionally the action plan (+ its PDFs)
 *  full    — additionally the AI crawl pack / landing pages
 */
export type RunScope = 'report' | 'actions' | 'full'

export interface CreateAuditInput {
  companyName: string
  websiteUrl: string
  industry: string
  /** Kept for backward compat; the form sends `locations` and mirrors [0] here. */
  region?: string
  locations: string[]
  competitors: string[]
  promptCount: number
  engines: string[]
  /**
   * Avatar (target audience): free-text description of the buyer the audit
   * impersonates, e.g. "CEO of a small-to-mid-size company looking for
   * social media marketing". The backend scopes prompts to this persona.
   */
  avatar?: string
  /**
   * Per-engine prompt allocation. Omitted engines run `promptCount` prompts.
   */
  enginePrompts?: Partial<Record<EngineId, number>>
  /** How far the run goes; defaults to the full workflow. */
  runScope?: RunScope
}

export interface EvidenceItem {
  id: string
  prompt: string
  engine: string
  topic?: string
  answer: string
  citedUrls: string[]
  mentioned: boolean
  /** True when the answer cited the company's own domain. */
  cited?: boolean
  createdAt?: string
}

export interface TrackingPoint {
  date: string
  mentionRate: number // 0-1
  citationRate?: number // 0-1
  /** Positive-mention share (%) for the period, when judged. */
  sentimentPosPct?: number | null
  engine?: string
  topic?: string
}

export interface TrackingChange {
  id: string
  date: string
  type: string
  description: string
  /** Signed percentage-point delta when the change is a rate movement. */
  delta?: number | null
  engine?: string
  topic?: string
}

export interface TrackingData {
  points: TrackingPoint[]
  changes: TrackingChange[]
}

export interface CitationDomain {
  domain: string
  companyCitations: number
  competitorCitations: number
  competitors?: string[]
  /** Prompt categories the domain was cited in (backend: promptTypes). */
  promptTypes?: string[]
  lastSeen?: string
}

export type ContentGapFormat = 'faq' | 'table' | 'comparison' | 'listicle' | 'guide' | string

export interface ContentGap {
  id: string
  prompt: string
  topic?: string
  reason: string
  recommendedFormat: ContentGapFormat
  status?: 'open' | 'in_progress' | 'done' | 'dismissed'
}

export interface LandingPage {
  id: string
  title: string
  url: string
  screenshotUrl?: string
  htmlUrl?: string
  createdAt?: string
}

// ---------- Sentiment ----------

/** Sentiment breakdown + daily trend for a company's judged AI answers. */
export interface SentimentReport {
  /** Ok answers carrying a sentiment label (the breakdown basis). */
  total: number
  positive: number
  neutral: number
  negative: number
  /** Positive share per audit day, oldest first. */
  trend: { at: string; positivePct: number }[]
}

// ---------- Citation supply chain ----------

export interface SupplyChainDomain {
  domain: string
  citations: number
  /** True when the domain belongs to the company itself. */
  isOwn: boolean
  /** Competitor brands co-mentioned in answers that cited this domain. */
  competitors: string[]
  topics: string[]
  engines: string[]
}

export interface CitationSupplyChain {
  companyId: string
  generatedAt: string
  totalCitations: number
  /** All cited domains, ranked by citation frequency. */
  domains: SupplyChainDomain[]
  /** Citation hubs: domains co-occurring with >= 2 competitor brands. */
  hubs: SupplyChainDomain[]
}

// ---------- Answer shapes ----------

export interface AnswerShapeGroup {
  /** Format signature, e.g. 'list+numbers', 'table', 'prose'. */
  signature: string
  answers: number
  avgChars: number
  avgCitedUrls: number
  citationRate: number // 0-1
  mentionRate: number // 0-1
}

export interface AnswerShapeAnalysis {
  companyId: string
  generatedAt: string
  answersAnalyzed: number
  prevalence: { lists: number; tables: number; numbers: number; avgChars: number }
  groups: AnswerShapeGroup[]
}

// ---------- Backend wire shapes (internal) ----------

/** Backend EvidenceResponse — one stored prompt/answer pair. */
interface WireEvidenceResponse {
  engine: string
  prompt: string
  answerExcerpt: string
  citedUrls: string[]
  mentioned: boolean
  cited: boolean
  createdAt: string
}

interface WireTopicCluster {
  topic: string
  responses: WireEvidenceResponse[]
}

interface WireEvidenceBundle {
  topics?: WireTopicCluster[]
}

/** Backend TrackingSnapshot — one weekly monitoring snapshot. */
interface WireTrackingSnapshot {
  id: number
  companyId: string
  weekStart: string
  mentionRate: number
  citationRate: number
  changes?: {
    mentionRateChange?: number | null
    citationRateChange?: number | null
    sentimentPosPct?: number | null
    sentimentChange?: number | null
    newCompetitors?: string[]
    lostCompetitors?: string[]
    promptsSampled?: number
  }
  createdAt: string
}

/** Backend CitationSource row. */
interface WireCitationSource {
  id: number
  domain: string
  companyCitations: number
  competitorCitations: number
  promptTypes?: string[]
  lastSeen?: string
}

/** Backend ContentGap row (numeric id, no topic). */
interface WireContentGap {
  id: number | string
  prompt: string
  reason: string
  recommendedFormat: string
  status?: ContentGap['status']
  createdAt?: string
}

// ---------- Fetch helper ----------

/** Error carrying the HTTP status + backend `{error}` message when present. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = `API request failed: ${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (body && typeof body.error === 'string') detail = body.error
    } catch {
      // non-JSON error body — keep the status line
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

// The backend may return bare arrays or wrapped objects; normalize both.
function unwrapList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object' && key in data) {
    const inner = (data as Record<string, unknown>)[key]
    if (Array.isArray(inner)) return inner as T[]
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// ---------- Scale + status normalization ----------

/**
 * The backend reports rates on a percent scale (0-100, e.g. 1.5 = 1.5%)
 * while the UI works in fractions (0-1) and multiplies by 100 at render
 * time. Normalize once at the API boundary.
 */
function pctToFraction(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 100
}

/** Job statuses use 'done'; the UI speaks 'completed'. */
function normalizeStatus(status: string): AuditStatus {
  return status === 'done' ? 'completed' : (status as AuditStatus)
}

function normalizeAudit(audit: Audit): Audit {
  return {
    ...audit,
    status: normalizeStatus(audit.status as string),
    mentionRate: pctToFraction(audit.mentionRate),
    citationRate: pctToFraction(audit.citationRate),
    competitorMetrics: audit.competitorMetrics?.map((c) => ({
      ...c,
      mentionRate: c.mentionRate / 100,
      citationRate: c.citationRate / 100,
    })),
  }
}

// ---------- Endpoints ----------

export async function getAudits(): Promise<Audit[]> {
  const data = await request<unknown>('/audits')
  return unwrapList<Audit>(data, 'audits').map(normalizeAudit)
}

export async function getAudit(id: string): Promise<Audit> {
  return normalizeAudit(await request<Audit>(`/audits/${id}`))
}

export function createAudit(input: CreateAuditInput): Promise<Audit> {
  return request<Audit>('/audits', { method: 'POST', body: JSON.stringify(input) })
}

// ---------- Jobs ----------

/** One pipeline log line from GET /api/jobs/:id (last 50 kept). */
export interface JobEvent {
  stage: string
  message: string
  at: string
}

export interface JobEventsResponse {
  job: {
    id: string
    status: AuditStatus
    stage?: string
    progress?: number
    error?: string
  }
  events: JobEvent[]
}

/**
 * Live pipeline log for a job. Best-effort: returns null on 404 (job not
 * found / old backend) or any other failure so polling never throws.
 */
export async function getJobEvents(jobId: string): Promise<JobEventsResponse | null> {
  try {
    const data = await request<unknown>(`/jobs/${jobId}`)
    if (!isRecord(data)) return null
    /**
     * The backend answers with the job's fields at the top level plus
     * `events` ({ id, status, stage, progress, error, events }). An older
     * wrapped `{ job, events }` shape is still accepted.
     */
    const raw = isRecord(data.job) ? data.job : data
    return {
      job: {
        id: typeof raw.id === 'string' ? raw.id : jobId,
        status: normalizeStatus(typeof raw.status === 'string' ? raw.status : 'pending'),
        stage: typeof raw.stage === 'string' ? raw.stage : undefined,
        progress: typeof raw.progress === 'number' ? raw.progress : undefined,
        error: typeof raw.error === 'string' ? raw.error : undefined,
      },
      events: Array.isArray(data.events) ? (data.events as JobEvent[]) : [],
    }
  } catch {
    return null
  }
}

/** Retry a failed job in place; the job keeps its id and resumes polling. */
export function retryJob(jobId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/jobs/${jobId}/retry`, { method: 'POST' })
}

/**
 * Cancel a live job (marks it failed on the backend). 409 (already done)
 * and 404 surface as ApiError — callers chaining cancel → delete usually
 * want to proceed regardless, so they catch.
 */
export function cancelJob(jobId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/jobs/${jobId}/cancel`, { method: 'POST' })
}

// ---------- Company lookup ----------

export interface CompanyLookupResult {
  ok: boolean
  sector?: string
  location?: string
  description?: string
  suggestedCompetitors?: string[]
}

/**
 * Quick company lookup used to prefill the audit form. Best-effort:
 * returns null on any failure so the form keeps working offline.
 */
export async function lookupCompany(
  name: string,
  website: string,
): Promise<CompanyLookupResult | null> {
  try {
    return await request<CompanyLookupResult>('/companies/lookup', {
      method: 'POST',
      body: JSON.stringify({ name, website }),
    })
  } catch {
    return null
  }
}

/**
 * Evidence items flattened from the backend's evidence bundle
 * ({ bundle: { topics: [{ responses: [...] }] } }). Each item is one
 * prompt -> answer -> citations triple. Falls back to a bare array or
 * an `{ evidence: [...] }` wrapper for backward compatibility.
 */
export async function getEvidence(companyId: string): Promise<EvidenceItem[]> {
  const data = await request<unknown>(`/evidence/${companyId}`)

  // Real backend shape: { bundle, supplyChain, shapes }.
  if (isRecord(data) && isRecord(data.bundle)) {
    const bundle = data.bundle as WireEvidenceBundle
    const items: EvidenceItem[] = []
    for (const topic of bundle.topics ?? []) {
      for (const [index, r] of (topic.responses ?? []).entries()) {
        items.push({
          id: `${topic.topic}-${r.engine}-${index}`,
          prompt: r.prompt,
          engine: r.engine,
          topic: topic.topic,
          answer: r.answerExcerpt,
          citedUrls: r.citedUrls ?? [],
          mentioned: r.mentioned,
          cited: r.cited,
          createdAt: r.createdAt,
        })
      }
    }
    return items
  }

  return unwrapList<EvidenceItem>(data, 'evidence')
}

/**
 * Tracking snapshots mapped to chart-ready points + a human-readable change
 * feed. The backend stores weekly snapshots with a diff payload; each
 * meaningful diff becomes one TrackingChange row.
 */
export async function getTracking(companyId: string): Promise<TrackingData> {
  const data = await request<unknown>(`/tracking/${companyId}`)

  // Real backend shape: TrackingSnapshot[] (rates on a percent scale).
  if (Array.isArray(data)) {
    const snapshots = data as WireTrackingSnapshot[]
    const points: TrackingPoint[] = snapshots.map((s) => ({
      date: s.weekStart,
      mentionRate: s.mentionRate / 100,
      citationRate: s.citationRate / 100,
      sentimentPosPct: s.changes?.sentimentPosPct ?? null,
    }))
    const changes: TrackingChange[] = []
    for (const s of snapshots) {
      const c = s.changes
      if (!c) continue
      // Backend deltas are percentage-point differences of percent-scale
      // rates; convert to fraction-scale so the UI's *100 renders pp.
      const toFractionDelta = (v: number | null | undefined) =>
        v === null || v === undefined ? v : v / 100
      const push = (suffix: string, type: string, description: string, delta?: number | null) =>
        changes.push({ id: `${s.id}-${suffix}`, date: s.weekStart, type, description, delta })
      if (c.mentionRateChange != null && c.mentionRateChange !== 0) {
        push(
          'mention',
          'Mention rate',
          `Mention rate moved ${formatPp(c.mentionRateChange)} week over week`,
          toFractionDelta(c.mentionRateChange),
        )
      }
      if (c.citationRateChange != null && c.citationRateChange !== 0) {
        push(
          'citation',
          'Citation rate',
          `Citation rate moved ${formatPp(c.citationRateChange)} week over week`,
          toFractionDelta(c.citationRateChange),
        )
      }
      if (c.sentimentChange != null && c.sentimentChange !== 0) {
        push(
          'sentiment',
          'Sentiment',
          `Positive-mention share moved ${formatPp(c.sentimentChange)} week over week`,
          toFractionDelta(c.sentimentChange),
        )
      }
      for (const name of c.newCompetitors ?? []) {
        push(`new-${name}`, 'New competitor', `${name} appeared in AI answers this week`)
      }
      for (const name of c.lostCompetitors ?? []) {
        push(`lost-${name}`, 'Competitor lost', `${name} disappeared from AI answers this week`)
      }
    }
    // Newest first — the change feed reads like an activity log.
    return { points, changes: changes.reverse() }
  }

  // Legacy fallback: { points, changes } wrapper.
  if (isRecord(data)) {
    const d = data as Partial<TrackingData>
    return { points: d.points ?? [], changes: d.changes ?? [] }
  }
  return { points: [], changes: [] }
}

/** Format a percent-scale delta as percentage points, e.g. "+12.5 pp". */
function formatPp(delta: number): string {
  const pp = Math.round(Math.abs(delta) * 10) / 10
  return delta > 0 ? `+${pp} pp` : `-${pp} pp`
}

/**
 * Citation domains for a company. The backend returns
 * { sources, opportunities }; both legacy shapes (bare array, { citations })
 * are still accepted.
 */
export async function getCitations(companyId: string): Promise<CitationDomain[]> {
  const data = await request<unknown>(`/citations/${companyId}`)

  if (isRecord(data) && Array.isArray(data.sources)) {
    return (data.sources as WireCitationSource[]).map((s) => ({
      domain: s.domain,
      companyCitations: s.companyCitations,
      competitorCitations: s.competitorCitations,
      promptTypes: s.promptTypes ?? [],
      lastSeen: s.lastSeen,
    }))
  }

  return unwrapList<CitationDomain>(data, 'citations')
}

/** Content gaps; numeric backend ids are normalized to strings. */
export async function getGaps(companyId: string): Promise<ContentGap[]> {
  const data = await request<unknown>(`/gaps/${companyId}`)
  const rows = unwrapList<WireContentGap>(data, 'gaps')
  return rows.map((g) => ({
    id: String(g.id),
    prompt: g.prompt,
    reason: g.reason,
    recommendedFormat: g.recommendedFormat,
    status: g.status,
  }))
}

export async function getLandingPages(companyId: string): Promise<LandingPage[]> {
  const data = await request<unknown>(`/landing-pages/${companyId}`)
  return unwrapList<LandingPage>(data, 'landingPages')
}

export function createLandingPage(companyId: string, gapId: string): Promise<LandingPage> {
  return request<LandingPage>('/landing-pages', {
    method: 'POST',
    body: JSON.stringify({ companyId, gapId }),
  })
}

/** Citation supply chain: cited domains ranked, with own/competitor split. */
export async function getSupplyChain(companyId: string): Promise<CitationSupplyChain | null> {
  try {
    const data = await request<CitationSupplyChain>(`/evidence/${companyId}/citations`)
    return {
      companyId: data.companyId ?? companyId,
      generatedAt: data.generatedAt ?? '',
      totalCitations: data.totalCitations ?? 0,
      domains: data.domains ?? [],
      hubs: data.hubs ?? [],
    }
  } catch {
    return null
  }
}

/**
 * Merge citation-source rows with supply-chain domains into one dataset.
 *
 * Competitor attribution: citation sources carry explicit competitor counts
 * once the citation monitor has classified them; until then the supply
 * chain's co-occurrence data is the signal — a non-own domain co-mentioned
 * with competitor brands feeds their visibility, so its citation volume
 * counts toward competitors.
 */
export function mergeSupplyChain(
  sources: CitationDomain[],
  chain: CitationSupplyChain | null,
): CitationDomain[] {
  if (!chain) return sources

  const byDomain = new Map(sources.map((s) => [s.domain, s]))
  const merged = new Map<string, CitationDomain>()

  for (const d of chain.domains) {
    const existing = byDomain.get(d.domain)
    const derivedCompetitorCitations =
      !d.isOwn && d.competitors.length > 0 ? d.citations : 0
    merged.set(d.domain, {
      domain: d.domain,
      companyCitations: existing?.companyCitations ?? (d.isOwn ? d.citations : 0),
      competitorCitations:
        existing && existing.competitorCitations > 0
          ? existing.competitorCitations
          : derivedCompetitorCitations,
      competitors: d.competitors,
      promptTypes: existing?.promptTypes,
      lastSeen: existing?.lastSeen,
    })
  }
  // Keep citation sources the supply chain did not see.
  for (const s of sources) {
    if (!merged.has(s.domain)) merged.set(s.domain, s)
  }
  return [...merged.values()]
}

/** Answer-format analysis (which answer shapes win citations). */
export async function getAnswerShapes(companyId: string): Promise<AnswerShapeAnalysis | null> {
  try {
    return await request<AnswerShapeAnalysis>(`/evidence/${companyId}/answer-shapes`)
  } catch {
    return null
  }
}

/** Sentiment breakdown + daily trend; null when the endpoint is unavailable. */
export async function getSentiment(companyId: string): Promise<SentimentReport | null> {
  try {
    const data = await request<SentimentReport>(`/evidence/${companyId}/sentiment`)
    return {
      total: data.total ?? 0,
      positive: data.positive ?? 0,
      neutral: data.neutral ?? 0,
      negative: data.negative ?? 0,
      trend: data.trend ?? [],
    }
  } catch {
    return null
  }
}

export function getReportPdfUrl(auditId: string): string {
  return `${API_BASE}/audits/${auditId}/pdf`
}

// ---------- Companies ----------

/** Overall visibility score. Rates are fractions (0-1) in the UI. */
export interface ScoreOverall {
  mentionRate: number
  citationRate: number
  sov: number
}

export interface CompanyJob {
  id: string
  status: AuditStatus
  stage?: string
  progress?: number
}

/** /api/companies row: the company record plus its latest score and job. */
export interface CompanySummary {
  id: string
  name: string
  sector: string
  location: string
  website: string
  language?: string
  /** Avatar (target audience) the client's audits impersonate. */
  buyerPersona?: string
  createdAt: string
  latestScore: ScoreOverall | null
  job: CompanyJob | null
}

/** /api/companies/:id payload (only the fields the dashboard reads). */
export interface CompanyDetail {
  company: {
    id: string
    name: string
    sector: string
    location: string
    website: string
    language?: string
    createdAt: string
  }
  latestScore: { combined: { overall: ScoreOverall } } | null
}

interface WireScoreOverall {
  mentionRate?: number
  citationRate?: number
  sov?: number
}

/** Backend scores are percent-scale; normalize to fractions once here. */
function normalizeScoreOverall(raw: WireScoreOverall | null | undefined): ScoreOverall | null {
  if (!raw) return null
  return {
    mentionRate: (raw.mentionRate ?? 0) / 100,
    citationRate: (raw.citationRate ?? 0) / 100,
    sov: (raw.sov ?? 0) / 100,
  }
}

interface WireCompanySummary extends Omit<CompanySummary, 'latestScore' | 'job'> {
  latestScore?: WireScoreOverall | null
  job?: (Omit<CompanyJob, 'status'> & { status: string }) | null
}

export async function getCompanies(): Promise<CompanySummary[]> {
  const data = await request<unknown>('/companies')
  return unwrapList<WireCompanySummary>(data, 'companies').map((c) => ({
    ...c,
    latestScore: normalizeScoreOverall(c.latestScore),
    job: c.job ? { ...c.job, status: normalizeStatus(c.job.status) } : null,
  }))
}

export async function getCompany(id: string): Promise<CompanyDetail> {
  const data = await request<{
    company: CompanyDetail['company']
    latestScore?: { combined?: { overall?: WireScoreOverall } } | null
  }>(`/companies/${id}`)
  return {
    company: data.company,
    latestScore: data.latestScore?.combined?.overall
      ? { combined: { overall: normalizeScoreOverall(data.latestScore.combined.overall)! } }
      : null,
  }
}

export interface DeleteCompanyResult {
  ok: boolean
  deleted: string
}

/**
 * Delete a company and everything derived from it (audits, reports,
 * landing pages, generated files). Throws ApiError with status 409 when the
 * company has a live job — cancel it first (cancelJob), then retry.
 *
 * `force` takes the backend's stop-then-delete path: it requests real
 * cancellation of the running workflow, waits for the executor to unwind,
 * and only then removes the rows. Use it for the "cancel job & delete" flow.
 */
export function deleteCompany(id: string, force = false): Promise<DeleteCompanyResult> {
  return request<DeleteCompanyResult>(`/companies/${id}${force ? '?force=1' : ''}`, {
    method: 'DELETE',
  })
}

// ---------- AI executive summary ----------

export interface AiSummary {
  companyId: string
  /** Markdown brief written by the LLM from the latest audit. */
  summary: string
  generatedAt: string
  /** True when served from the backend cache (invalidated by a new audit). */
  cached: boolean
}

/**
 * AI executive summary for a company. The backend pre-generates and persists
 * it at audit completion, so this returns instantly from the DB and only
 * regenerates after a new audit. Throws ApiError: 404 when the company has
 * no audit results yet, 502 when generation failed.
 */
export function getAiSummary(companyId: string): Promise<AiSummary> {
  return request<AiSummary>(`/companies/${companyId}/ai-summary`)
}

/** Latest weekly tracking snapshot; null when none exist yet (404). */
export interface LatestSnapshot {
  weekStart: string
  mentionRate: number // fraction
  citationRate: number // fraction
  createdAt: string
}

/**
 * Trigger a tracking check-up now — a live re-query of the key prompts
 * across the AI engines. Can take 1-3 minutes, so the request carries a
 * long abort timeout. Throws ApiError with the backend's message on 409
 * (no prompt library / no records yet).
 */
export function runTrackingNow(companyId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/tracking/${companyId}/run`, {
    method: 'POST',
    signal: AbortSignal.timeout(5 * 60 * 1000),
  })
}

export async function getLatestTrackingSnapshot(companyId: string): Promise<LatestSnapshot | null> {
  try {
    const s = await request<WireTrackingSnapshot>(`/tracking/${companyId}/latest`)
    return {
      weekStart: s.weekStart,
      mentionRate: s.mentionRate / 100,
      citationRate: s.citationRate / 100,
      createdAt: s.createdAt,
    }
  } catch {
    return null
  }
}

// ---------- Monitoring ----------

export interface MonitoringResult {
  ok: boolean
  monitored: string[]
}

export function startMonitoring(companyId: string): Promise<MonitoringResult> {
  return request<MonitoringResult>(`/monitoring/start/${companyId}`, { method: 'POST' })
}

export function stopMonitoring(companyId: string): Promise<MonitoringResult> {
  return request<MonitoringResult>(`/monitoring/stop/${companyId}`, { method: 'POST' })
}

// ---------- API costs ----------

export interface CostBucket {
  calls: number
  estimatedUsd: number
}

export interface CostsSummary {
  generatedAt: string
  totals: { today: CostBucket; week: CostBucket; month: CostBucket; all: CostBucket }
  byVendor: { vendor: string; calls: number; estimatedUsd: number }[]
  byModel: { vendor: string; model: string; kind: string; calls: number; estimatedUsd: number }[]
  byDay: { date: string; calls: number; estimatedUsd: number }[]
  byCompany: { companyId: string; companyName: string; calls: number; estimatedUsd: number }[]
}

export function getCostsSummary(): Promise<CostsSummary> {
  return request<CostsSummary>('/costs/summary')
}

// ---------- Mentions ----------

export type MentionSentiment = 'positive' | 'neutral' | 'negative' | null

export interface Mention {
  engine: string
  prompt: string
  scope: string
  persona: string
  excerpt: string
  mentionContext: string
  sentiment: MentionSentiment
  citedUrls: string[]
  createdAt: string
}

export interface MentionsResponse {
  companyId: string
  total: number
  mentionRate: number // percent scale from the backend; normalized to fraction
  mentions: Mention[]
}

export async function getMentions(companyId: string): Promise<MentionsResponse> {
  const data = await request<MentionsResponse>(`/companies/${companyId}/mentions`)
  return { ...data, mentionRate: (data.mentionRate ?? 0) / 100 }
}

// ---------- Prompt library ----------

export interface ClientPromptItem {
  text: string
  scope: string
  persona: string
  tier: string
}

export interface ClientPromptLibrary {
  companyId: string
  version: number
  total: number
  updatedAt: string | null
  prompts: ClientPromptItem[]
}

/**
 * Latest prompt library for a client. refresh=true asks the backend to run
 * the prompt refresher first (new library version when prompts were added).
 */
export function getClientPrompts(companyId: string, refresh = false): Promise<ClientPromptLibrary> {
  return request<ClientPromptLibrary>(`/companies/${companyId}/prompts${refresh ? '?refresh=1' : ''}`)
}

// ---------- Generated files ----------

export interface CompanyFile {
  id: number
  name: string
  kind: string
  scope?: string
  lang?: string
  url: string
  createdAt: string
}

export interface CompanyFiles {
  companyId: string
  categories: {
    reports: CompanyFile[]
    landingPages: CompanyFile[]
    data: CompanyFile[]
  }
  counts: { reports: number; landingPages: number; data: number }
}

export function getCompanyFiles(companyId: string): Promise<CompanyFiles> {
  return request<CompanyFiles>(`/companies/${companyId}/files`)
}

/** Absolute URL for a file path returned by the files/reports endpoints. */
export function fileUrl(path: string): string {
  return `${API_BASE.replace(/\/api$/, '')}${path}`
}

// ---------- AI traffic (crawler visits + AI-sourced human referrals) ----------

export interface AiTrafficBot {
  bot: string
  count: number
  lastSeen: string
}

export interface AiTraffic {
  botVisits: {
    total: number
    byBot: AiTrafficBot[]
    topPages: { path: string; count: number }[]
    lastSeen: string | null
  }
  humanReferrals: {
    total: number
    byReferrer: { referrer: string; count: number }[]
    topPages: { page: string; count: number }[]
  }
}

export function getAiTraffic(companyId: string): Promise<AiTraffic> {
  return request<AiTraffic>(`/companies/${companyId}/ai-traffic`)
}

// ---------- Content freshness ----------

export type FreshnessReason = 'undated' | 'stale' | 'no-main-links'

export interface FreshnessStaleRow {
  path: string
  reason: FreshnessReason
  detail: string
  checkedAt: string
}

export interface FreshnessReport {
  checked: number
  stale: FreshnessStaleRow[]
}

// ---------- Admin: LeadEngine knowledge dataset ----------

/** Column groups the dataset filter chips toggle. */
export const DATASET_GROUPS = [
  'profile',
  'setup',
  'performance',
  'market',
  'delivery',
  'movement',
  'efficiency',
  'learning',
] as const

export type DatasetGroup = (typeof DATASET_GROUPS)[number]

export interface DatasetColumn {
  key: string
  label: string
  /** One of DATASET_GROUPS; unknown groups are rendered under "other". */
  group: string
}

/** A dataset cell — the backend emits scalars only. */
export type DatasetCell = string | number | boolean | null

/** One snapshot row, keyed by DatasetColumn.key. */
export type DatasetRow = Record<string, DatasetCell>

export interface DatasetTotals {
  companies: number
  snapshots: number
  apiCalls: number
  estimatedUsd: number
}

export interface AdminDataset {
  generatedAt: string
  columns: DatasetColumn[]
  rows: DatasetRow[]
  totals: DatasetTotals
}

export interface AdminSectorStat {
  sectorKey: string
  companies: number
  avgMentionRate: number
  avgCitationRate: number
  avgUsd: number
}

export interface AdminEngineStat {
  engine: string
  avgMention: number
  avgCitation: number
}

export interface AdminLearningKindCount {
  kind: string
  count: number
}

export interface AdminOverview {
  companies: number
  audits: number
  totalCalls: number
  estimatedUsd: number
  /** Percent scale (0-100), matching the rest of the backend's rate fields. */
  avgMentionRate: number
  avgCitationRate: number
  bySector: AdminSectorStat[]
  byEngine: AdminEngineStat[]
  learnings: { total: number; byKind: AdminLearningKindCount[] }
  /** Human-readable diagnoses of where the system underperforms. */
  weakSpots: string[]
}

export type LearningKind = 'prompt_pattern' | 'insight' | 'action' | 'pitfall'

export interface Learning {
  id: number | string
  scope: string
  sectorKey: string | null
  companyId: string | null
  /** Known kinds are LearningKind; the backend may add more. */
  kind: string
  lesson: string
  evidence: string | null
  /** Confidence/importance, typically 1-5. */
  weight: number
  createdAt: string
  updatedAt: string
}

/**
 * GET helper for endpoints that may not be deployed yet: a 404 resolves to
 * null (the caller renders an empty state) while real failures still throw.
 */
async function requestOptional<T>(path: string): Promise<T | null> {
  try {
    return await request<T>(path)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Full client knowledge dataset; null when the endpoint isn't available. */
export async function getAdminDataset(): Promise<AdminDataset | null> {
  const data = await requestOptional<AdminDataset>('/admin/dataset')
  if (!data) return null
  return {
    generatedAt: data.generatedAt ?? '',
    columns: data.columns ?? [],
    rows: data.rows ?? [],
    totals: data.totals ?? { companies: 0, snapshots: 0, apiCalls: 0, estimatedUsd: 0 },
  }
}

/** Cross-client rollup powering the KPI strip and weak-spot panel. */
export async function getAdminOverview(): Promise<AdminOverview | null> {
  const data = await requestOptional<AdminOverview>('/admin/overview')
  if (!data) return null
  return {
    companies: data.companies ?? 0,
    audits: data.audits ?? 0,
    totalCalls: data.totalCalls ?? 0,
    estimatedUsd: data.estimatedUsd ?? 0,
    avgMentionRate: data.avgMentionRate ?? 0,
    avgCitationRate: data.avgCitationRate ?? 0,
    bySector: data.bySector ?? [],
    byEngine: data.byEngine ?? [],
    learnings: data.learnings ?? { total: 0, byKind: [] },
    weakSpots: data.weakSpots ?? [],
  }
}

/** Accumulated lessons the pipeline has written back. */
export async function getLearnings(): Promise<Learning[]> {
  const data = await requestOptional<unknown>('/learnings')
  if (data === null) return []
  return unwrapList<Learning>(data, 'learnings')
}

/** Direct download URL for the dataset CSV export. */
export function datasetCsvUrl(): string {
  return `${API_BASE}/admin/dataset.csv`
}

/** Force a fresh dataset snapshot for one company. */
export function collectDatasetSnapshot(companyId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/dataset/collect/${companyId}`, { method: 'POST' })
}

/** Latest freshness run; empty report when none exists yet (or on error). */
export async function getFreshness(companyId: string): Promise<FreshnessReport> {
  try {
    const data = await request<FreshnessReport>(`/companies/${companyId}/freshness`)
    return { checked: data.checked ?? 0, stale: data.stale ?? [] }
  } catch {
    return { checked: 0, stale: [] }
  }
}
