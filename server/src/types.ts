/**
 * Domain types — the single contract for the whole platform.
 * Every stage, agent, report and API response is typed from here.
 */

// ─── Company ────────────────────────────────────────────────────────────────

export interface Company {
  id: string
  name: string
  sector: string
  location: string
  website: string
  aliases: string[]
  domainHints: string[]
  competitors: string[]
  /**
   * Avatar (target audience) — a concrete description of the buyer the audit
   * should impersonate, e.g. "CEO of a small-to-mid-size company looking for
   * social media marketing". Drives avatar-persona prompt generation and the
   * persona injected into avatar-scoped measured runs.
   */
  buyerPersona: string
  language: 'de' | 'en'
  slackWebhook?: string
  /** All locations (first = primary, duplicated in `location`). */
  locations: string[]
  /**
   * Per-engine prompt allocation for the measured audit, e.g.
   * { chatgpt: 20, gemini: 20, perplexity: 10, claude: 10 }. An engine
   * missing from the plan runs the full library (legacy behaviour).
   */
  enginePlan?: Partial<Record<Engine, number>>
  /** Requested measured engines (subset of the enabled engines). */
  engines?: Engine[]
  /** How far the workflow runs (see RunScope). Defaults to 'full'. */
  runScope?: RunScope
  createdAt: string
}

/**
 * How far a workflow run goes. Each scope is a prefix of the full stage
 * chain, so a shorter run is never a different pipeline — just an earlier
 * stop. Completion hooks (content gaps, monitoring, tracking baseline, AI
 * summary, retro, dataset snapshot) run in every scope: they all derive
 * from the score, which every scope produces.
 *
 *  report  — through the PDF report deck (no action plan, no site pages)
 *  actions — additionally the action plan + its PDFs
 *  full    — additionally the AI crawl pack / landing pages
 */
export type RunScope = 'report' | 'actions' | 'full'

export interface NewCompanyInput {
  name: string
  sector: string
  location: string
  website: string
  aliases?: string[]
  competitors?: string[]
  buyerPersona?: string
  language?: 'de' | 'en'
  slackWebhook?: string
  /** All locations; first is the primary and is also sent as `location`. */
  locations?: string[]
  /** Per-engine prompt allocation (see Company.enginePlan). */
  enginePlan?: Partial<Record<Engine, number>>
  /** Requested measured engines. */
  engines?: Engine[]
  /** How far the workflow runs (see RunScope). Defaults to 'full'. */
  runScope?: RunScope
}

// ─── Prompt library ─────────────────────────────────────────────────────────

export type Scope = 'regional' | 'dach'
export type Persona = 'general' | 'avatar'
export type GeoTier = 'city' | 'region' | 'canton' | 'cantons' | 'ch' | 'dach'

export interface PromptItem {
  text: string
  scope: Scope
  persona: Persona
  tier: GeoTier
  /**
   * Prompt language. Optional for backward compatibility: libraries stored
   * before this field existed carry no `lang`, and consumers fall back to
   * text-based detection. New libraries always set it, so the multilingual
   * layer is counted exactly instead of guessed.
   */
  lang?: 'de' | 'fr' | 'it'
}

export interface PromptLibrary {
  id: number
  companyId: string
  version: number
  items: PromptItem[]
  createdAt: string
}

// ─── Audit records ──────────────────────────────────────────────────────────

export type Engine = 'chatgpt' | 'gemini' | 'perplexity' | 'claude'

export interface AuditRecord {
  engine: Engine
  prompt: string
  scope: Scope
  persona: Persona
  tier: GeoTier
  run: number
  ok: boolean
  text?: string
  citedUrls: string[]
  sentiment?: 'positive' | 'neutral' | 'negative'
  error?: string
}

// ─── Citation verification ──────────────────────────────────────────────────

/** A cited URL that has been fetched and verified to actually mention the brand. */
export interface VerifiedCitation {
  id: number
  auditRecordId: number
  url: string
  actuallyCitesBrand: boolean
  citationContext?: string
  pageTitle?: string
  pageSchema?: string
  verifiedAt: string
}

// ─── Competitor analysis ────────────────────────────────────────────────────

/** A scraped competitor page with content structure analysis. */
export interface CompetitorPage {
  id: number
  companyId: string
  competitorDomain: string
  url: string
  title?: string
  metaDescription?: string
  headings: string[]
  schemaMarkup?: string
  wordCount?: number
  answerFormat?: 'faq' | 'table' | 'list' | 'prose'
  hasStatistics: boolean
  hasFaq: boolean
  hasComparisonTable: boolean
  scrapedAt: string
}

// ─── Evidence layer ─────────────────────────────────────────────────────────

/** Topic buckets every audit prompt is clustered into (evidenceExtractor). */
export type TopicKey = 'pricing' | 'comparison' | 'local' | 'service' | 'general'

/** An audit record as stored — repo adds created_at to the runtime type. */
export interface StoredAuditRecord extends AuditRecord {
  createdAt: string
}

/** One stored prompt/answer pair, trimmed for evidence display. */
export interface EvidenceResponse {
  engine: Engine
  prompt: string
  /** First 300 chars of the raw AI answer — verbatim, never paraphrased. */
  answerExcerpt: string
  citedUrls: string[]
  mentioned: boolean
  cited: boolean
  createdAt: string
}

export interface TopicCluster {
  topic: TopicKey
  /** Unique prompts in this cluster. */
  prompts: string[]
  responses: EvidenceResponse[]
  /** Cited URLs grouped by domain, ranked by frequency. */
  citedDomains: TopDomain[]
  runsOk: number
  mentionRate: number
  citationRate: number
  perEngine: Partial<Record<Engine, { runsOk: number; mentionRate: number; citationRate: number }>>
}

/** A single verifiable exhibit for the report's evidence section. */
export interface EvidenceSnippet {
  engine: Engine
  topic: TopicKey
  prompt: string
  answerExcerpt: string
  citedUrls: string[]
  mentioned: boolean
  cited: boolean
}

export interface EvidenceBundle {
  companyId: string
  generatedAt: string
  runsOk: number
  topics: TopicCluster[]
  /** Topic → engine → mention rate (null = no ok runs for that cell). */
  visibilityMatrix: Record<TopicKey, Partial<Record<Engine, number | null>>>
  topSnippets: EvidenceSnippet[]
}

export interface SupplyChainDomain {
  domain: string
  citations: number
  /** True when the domain matches one of the client's domain hints. */
  isOwn: boolean
  /**
   * Competitor brands mentioned in answers that cited this domain
   * (co-occurrence proxy — the domain's page content is not fetched).
   */
  competitors: string[]
  /** Topic clusters the domain appears in. */
  topics: TopicKey[]
  engines: Engine[]
}

export interface CitationSupplyChain {
  companyId: string
  generatedAt: string
  totalCitations: number
  /** All cited domains, ranked by citation frequency. */
  domains: SupplyChainDomain[]
  /** Citation hubs: domains co-occurring with ≥2 competitor brands. */
  hubs: SupplyChainDomain[]
}

export interface AnswerShapeGroup {
  /** Format signature, e.g. 'list+numbers', 'table', 'prose'. */
  signature: string
  answers: number
  avgChars: number
  avgCitedUrls: number
  /** % of answers in this group where the client's domain was cited. */
  citationRate: number
  /** % of answers in this group where the client was mentioned. */
  mentionRate: number
}

export interface AnswerShapeAnalysis {
  companyId: string
  generatedAt: string
  answersAnalyzed: number
  /** % of answers using each format feature + overall average length. */
  prevalence: { lists: number; tables: number; numbers: number; avgChars: number }
  /** Format groups ranked by avg citations per answer (which shapes win). */
  groups: AnswerShapeGroup[]
}

/** Everything the report's "Evidence & Verification" section renders. */
export interface ReportEvidence {
  bundle: EvidenceBundle
  supplyChain: CitationSupplyChain
  shapes: AnswerShapeAnalysis
  /**
   * Citation verification status by URL (from verified_citations):
   * true = the page was fetched and does cite the brand, false = fetched and
   * does NOT cite it. URLs absent from the map are not yet verified — the
   * report marks them as pending rather than guessing.
   */
  verification?: Record<string, boolean>
}

/** Sentiment breakdown + trend for the report's evidence section. */
export interface SentimentReport {
  /** Ok answers carrying a sentiment label (the breakdown basis). */
  total: number
  positive: number
  neutral: number
  negative: number
  /** Positive share per audit day, oldest first — rendered when ≥2 points. */
  trend: { at: string; positivePct: number }[]
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface EngineStats {
  runsOk: number
  mentionRate: number
  citationRate: number
  sov: number
  avgRank: number | null
  sentimentPosPct: number | null
}

export interface OverallStats {
  runsOk: number
  mentionRate: number
  citationRate: number
  sov: number
  avgRank: number | null
  topCompetitorSov: number
}

export interface Competitor {
  name: string
  rawHits: number
}

export type CitationClass = 'own' | 'directories' | 'earned' | 'other'

export interface TopDomain {
  domain: string
  citations: number
}

export interface AuditScore {
  perEngine: Partial<Record<Engine, EngineStats>>
  overall: OverallStats
  competitors: Competitor[]
  citationClasses: Record<CitationClass, number>
  topCitedDomains: TopDomain[]
  brandMentions: Record<string, number>
}

/** Scores split by scope — regional vs DACH compared. */
export interface ScopedScore {
  regional: AuditScore
  dach: AuditScore
  combined: AuditScore
}

// ─── Impact model ───────────────────────────────────────────────────────────

export interface ImpactModel {
  divertedClicksMonth: number
  lostLeadsMonth: number
  lostChfMonth: number
  competitorLeadsMonth: number
  competitorChfMonth: number
  assumptions: {
    projectValueChf: number
    queriesPerMonth: number
    ctrOther: number
    conversion: number
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────

export type ReportLang = 'de' | 'en'

export interface ReportFile {
  id: number
  companyId: string
  scope: Scope
  lang: ReportLang
  kind: 'pdf' | 'playbook' | 'page' | 'digest'
  path: string
  createdAt: string
}

// ─── API cost log ───────────────────────────────────────────────────────────

/** One logged provider call — no token counts, so cost is estimated per call. */
export interface ApiCostEntry {
  id: number
  jobId: string | null
  companyId: string | null
  vendor: string
  model: string
  kind: 'measured' | 'labor' | 'research'
  at: string
}

export interface ReportSections {
  EXEC_SUMMARY: string[]
  KEY_INSIGHTS: string[]
  COMPETITOR: string[]
  CITATIONS: string[]
  ANALYSIS: string[]
  MARKET: string[]
  ACTIONS: string[]
  CLOSER: string[]
}

// ─── Reverse engineering ────────────────────────────────────────────────────

export interface ReverseTactics {
  content: string[]
  schema: string[]
  directories: string[]
  earned: string[]
  entity: string[]
}

export interface ReverseReport {
  competitor: string
  whyTheyWin: string[]
  tactics: ReverseTactics
  evidenceUrls: string[]
  createdAt: string
}

// ─── Action plan ────────────────────────────────────────────────────────────

export interface PageSpec {
  slug: string
  title: string
  targetQuery: string
  answerCapsule: string
  schemaType: 'FAQPage' | 'Article'
  priority: number
  status: 'pending' | 'done'
}

export interface SchemaSnippet {
  page: string
  type: string
  jsonLd: string
}

export interface DirectoryListing {
  directory: string
  url: string
  action: 'claim' | 'create' | 'update'
  payload: Record<string, string>
}

export interface EntityTask {
  task: string
  where: string
  detail: string
}

export interface MeasurementSetup {
  snippetInstructions: string
  ga4Segments: string[]
  weeklyKpis: string[]
}

export interface ActionPlan {
  id: number
  companyId: string
  pages: PageSpec[]
  schemaSnippets: SchemaSnippet[]
  directoryListings: DirectoryListing[]
  entityTasks: EntityTask[]
  measurement: MeasurementSetup
  createdAt: string
}

/** What the planner agents produce — persistence adds id/companyId/createdAt. */
export type ActionPlanInput = Omit<ActionPlan, 'id' | 'companyId' | 'createdAt'>

// ─── Jobs / workflow ────────────────────────────────────────────────────────

export type StageName =
  | 'intake'
  | 'promptgen'
  | 'audit'
  | 'verify'
  | 'score'
  | 'reverse'
  | 'competitors'
  | 'report'
  | 'actions'
  | 'pages'
  | 'done'

export type JobStatus = 'queued' | 'running' | 'failed' | 'done'

export interface Job {
  id: string
  companyId: string
  status: JobStatus
  stage: StageName
  progress: number
  error?: string
  createdAt: string
  updatedAt: string
}

export interface JobEvent {
  jobId: string
  stage: StageName
  message: string
  at: string
}

// ─── Tracking / attribution ─────────────────────────────────────────────────

export type AiReferrer =
  | 'chatgpt'
  | 'perplexity'
  | 'gemini'
  | 'copilot'
  | 'claude'
  | 'other'

export interface ReferralEvent {
  id: number
  companyId: string
  kind: 'pageview' | 'lead'
  referrer: AiReferrer
  page: string
  meta: Record<string, string>
  at: string
}

export interface AttributionMonth {
  month: string
  clicks: number
  leads: number
  byEngine: Partial<Record<AiReferrer, { clicks: number; leads: number }>>
}

/** One AI-crawler request against hosted pages (or a forwarded server log). */
export interface BotVisit {
  id: number
  companyId: string
  bot: string
  path: string
  /** HTTP status; null when the row came from a forwarded server log. */
  status: number | null
  at: string
}

export interface BotVisitSummary {
  total: number
  byBot: { bot: string; count: number; lastSeen: string }[]
  topPages: { path: string; count: number }[]
  /** Most recent visit across all bots; null when no visits exist. */
  lastSeen: string | null
}

// ─── Weekly trends ──────────────────────────────────────────────────────────

export interface TrendPoint {
  at: string
  scope: Scope
  mentionRate: number
  citationRate: number
  sov: number
}

// ─── Monitoring suite ───────────────────────────────────────────────────────

/** Diff payload stored in tracking_snapshots.changes (JSON). */
export interface TrackingChanges {
  mentionRateChange: number | null // null on the first snapshot (no baseline)
  citationRateChange: number | null
  /** Positive-mention share (%) this week; null when no mention was judged. */
  sentimentPosPct?: number | null
  /** Week-over-week change in positive-mention share; null without a baseline. */
  sentimentChange?: number | null
  newCompetitors: string[] // mentioned this week, not in the previous snapshot
  lostCompetitors: string[] // in the previous snapshot, absent this week
  competitors: string[] // full competitor set seen this week (next week's baseline)
  promptsSampled: number
}

export interface TrackingSnapshot {
  id: number
  companyId: string
  weekStart: string
  mentionRate: number
  citationRate: number
  changes: TrackingChanges
  createdAt: string
}

export interface CitationSource {
  id: number
  companyId: string
  domain: string
  companyCitations: number
  competitorCitations: number
  promptTypes: string[]
  lastSeen: string
  createdAt: string
}

export type ContentGapFormat = 'faq' | 'table' | 'comparison' | 'listicle' | 'guide'
export type ContentGapStatus = 'open' | 'in_progress' | 'done' | 'dismissed'

export interface ContentGap {
  id: number
  companyId: string
  prompt: string
  reason: string
  recommendedFormat: ContentGapFormat
  status: ContentGapStatus
  createdAt: string
}

export interface CompetitorSnapshot {
  id: number
  companyId: string
  competitorDomain: string
  title: string
  metaDescription: string
  headings: string[]
  pricing: string[]
  scrapedAt: string
}

/** One detected difference between two consecutive competitor snapshots. */
export interface CompetitorChange {
  competitorDomain: string
  kind: 'title' | 'meta' | 'headings' | 'pricing'
  detail: string
}

// ─── LeadEngine Data (client knowledge dataset) ─────────────────────────────

/** Lifecycle event a client_snapshots row was collected for. */
export type SnapshotKind = 'audit' | 'weekly' | 'monthly' | 'manual'

/** Column families the dataset UI groups by. */
export type DatasetGroup =
  | 'profile'
  | 'setup'
  | 'performance'
  | 'market'
  | 'delivery'
  | 'movement'
  | 'efficiency'
  | 'learning'

/**
 * One head-to-toe dataset row — deliberately FLAT and snake_case-keyed, so
 * the SQLite column names, the API row keys, the DATASET_COLUMNS keys and the
 * CSV header are literally the same strings and cannot drift apart.
 *
 * Comma-list columns are strings (CSV-shaped by contract); `per_engine` is a
 * JSON string of Partial<Record<Engine, EngineStats>>.
 */
export interface ClientSnapshot {
  id: number
  company_id: string
  snapshot_at: string
  kind: SnapshotKind
  job_id: string | null
  library_version: number | null

  // profile
  sector: string
  sector_key: string
  niche_services: string
  locations: string
  primary_location: string
  avatar: string
  website: string
  language: string

  // setup
  prompts_total: number
  prompts_general: number
  prompts_avatar: number
  prompts_multilingual: number
  engines: string
  runs_planned: number
  runs_ok: number
  runs_failed: number

  // performance
  mention_rate: number
  citation_rate: number
  sov: number
  avg_rank: number | null
  top_competitor_sov: number
  sentiment_pos_pct: number | null
  per_engine: string

  // market
  competitors: string
  top_competitor: string
  citations_total: number
  citations_own: number
  citations_directory: number
  citations_earned: number
  citations_other: number
  top_cited_domains: string
  visibility_citation_gap: number

  // delivery
  reports_generated: number
  pages_generated: number
  action_plan_pages: number
  directory_listings: number
  entity_tasks: number
  teardowns: number
  content_gaps: number
  pack_folder: string

  // movement
  mention_delta: number | null
  citation_delta: number | null
  sentiment_delta: number | null
  new_competitors: string
  lost_competitors: string
  weeks_tracked: number

  // efficiency
  api_calls: number
  estimated_usd: number
  usd_per_mention_point: number

  // learning
  what_worked: string
  what_did_not: string
  lessons_count: number
}

/** Every key of a dataset row — the canonical column identifiers. */
export type DatasetKey = keyof ClientSnapshot

export interface DatasetColumn {
  key: DatasetKey
  label: string
  group: DatasetGroup
}

/** A snapshot before persistence (the DB assigns the id). */
export type NewClientSnapshot = Omit<ClientSnapshot, 'id'>

// ─── Content freshness ──────────────────────────────────────────────────────

/** 'ok' rows mark clean pages; the other three are stale reasons. */
export type FreshnessReason = 'ok' | 'undated' | 'stale' | 'no-main-links'

/** One row of a weekly content-freshness check run (freshness_checks). */
export interface FreshnessCheck {
  id: number
  companyId: string
  path: string
  reason: FreshnessReason
  detail: string
  checkedAt: string
}
