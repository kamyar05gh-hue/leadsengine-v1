/**
 * API routes.
 *
 * POST /api/companies            → validate, persist, trigger workflow → { jobId }
 * POST /api/companies/lookup     → quick company research for form prefill
 * GET  /api/companies            → list with latest score summary
 * GET  /api/companies/:id        → detail + trends + attribution
 * GET  /api/jobs/:id             → stage/progress/events (dashboard polling)
 * POST /api/jobs/:id/retry       → resume failed job
 * GET  /api/reports/:companyId   → generated files (PDFs, playbook)
 * GET  /api/companies/:id/attribution → AI click/lead funnel by month
 * GET  /api/companies/:id/ai-traffic  → AI crawler visits + AI-sourced human referrals
 * POST /api/track/pageview|lead  → client-site snippet events
 * POST /api/track/bot            → forwarded server/CDN log of an AI crawler visit
 * GET  /track.js                 → the snippet itself (?company=<id>)
 * GET  /api/health               → engine-key validation status
 *
 * Dashboard compatibility — the frontend talks in "audits" while the backend
 * stores "companies" + "jobs". Treat the job id as the audit id.
 *
 * GET  /api/audits               → list audits (latest job per company)
 * POST /api/audits               → create company + start workflow
 * GET  /api/audits/:id           → audit detail (job + company + score)
 * GET  /api/audits/:id/pdf       → redirect to latest PDF report
 * GET  /api/landing-pages/:companyId → list generated site pages
 * POST /api/landing-pages       → generate one page from a content gap
 *
 * Evidence layer (see src/agents/evidenceExtractor.ts etc. — pure reads of
 * audit_records, no external calls):
 * GET  /api/evidence/:companyId              → full evidence bundle
 * GET  /api/evidence/:companyId/topics       → prompt topic clusters
 * GET  /api/evidence/:companyId/citations    → citation supply chain
 * GET  /api/evidence/:companyId/answer-shapes → answer format analysis
 * GET  /api/evidence/:companyId/sentiment    → sentiment breakdown + daily trend
 *
 * Monitoring suite (see src/cron/scheduler.ts, src/agents/*):
 * GET  /api/tracking/:companyId         → tracking snapshot history
 * GET  /api/tracking/:companyId/latest  → latest snapshot only
 * GET  /api/citations/:companyId        → citation sources + opportunity domains
 * GET  /api/gaps/:companyId             → content gap prompts
 * GET  /api/competitors/:companyId/changes → recent competitor snapshot changes
 * POST /api/monitoring/start/:companyId → arm all cron monitors
 * POST /api/monitoring/stop/:companyId  → stop all cron monitors
 *
 * Costs + company drill-downs:
 * GET  /api/costs/summary            → API call volume + estimated spend
 * GET  /api/companies/:id/mentions   → audit answers that mention the brand
 * GET  /api/companies/:id/prompts    → latest prompt library (?refresh=1 appends new prompts)
 * GET  /api/companies/:id/files      → categorized, deduplicated generated files
 * GET  /api/companies/:id/freshness  → latest content-freshness run (stale pages)
 *
 * LeadEngine Data — the client knowledge dataset (see agents/datasetCollector):
 * GET  /api/admin/dataset             → columns + all snapshots (newest first, max 500) + totals
 * GET  /api/admin/dataset.csv         → the same rows as an RFC4180 CSV download
 * GET  /api/admin/dataset/:companyId  → one company's lifecycle timeline
 * POST /api/admin/dataset/collect/:companyId → force a 'manual' snapshot now
 * GET  /api/admin/overview            → cross-client aggregates + system weak spots
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  allAuditRecords,
  countClientSnapshots,
  deleteCompanyCascade,
  failedJobStages,
  getCompany,
  insertReport,
  jobCountsByStatus,
  latestActionPlan,
  latestClientSnapshotPerCompany,
  latestPromptLibrary,
  latestScore,
  latestTrackingSnapshot,
  learningCountsByKind,
  listApiCosts,
  listApiCostsForJob,
  listCitationSources,
  listClientSnapshots,
  listClientSnapshotsForCompany,
  listCompanies,
  listCompetitorSnapshots,
  listContentGaps,
  listReports,
  listTrackingSnapshots,
  listTrends,
  listReverseReports,
  insertBotVisit,
  latestFreshnessRun,
  listLearnings,
  sentimentBreakdown,
  sentimentTrendByDay,
} from '../db/repo.js'
import {
  collectClientSnapshot,
  DATASET_COLUMNS,
  toCsv,
} from '../agents/datasetCollector.js'
import { ensureAiSummary } from '../agents/aiSummarizer.js'
import { runWeeklyTracking } from '../agents/weeklyTracker.js'
import { getJob, jobEvents, latestJobFor, logEvent, updateJob } from '../workflow/queue.js'
import { retryWorkflow, stagesFor, startWorkflow } from '../workflow/pipeline.js'
import { requestCancel } from '../workflow/cancellation.js'
import { NewCompanySchema, slugify } from '../workflow/stages/intake.js'
import { getBrandProfile } from '../agents/brandStyle.js'
import { buildPage, generateFromEvidence, slugToFilename } from '../agents/pageBuilder.js'
import { PATHS } from '../config.js'
import type { Company, NewCompanyInput, PageSpec, StageName } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'
import { attributionByMonth, trackEvent } from '../tracking/referrals.js'
import { aiTrafficSummary } from '../tracking/aiTraffic.js'
import { trackingSnippet } from '../tracking/snippet.js'
import { getMeasuredEngines } from '../providers/index.js'
import { lookupCompany } from '../agents/companyLookup.js'
import { isOpportunity } from '../agents/citationMonitor.js'
import { diffSnapshots } from '../agents/competitorWatcher.js'
import { monitoredCompanies, startMonitoring, stopMonitoring } from '../cron/scheduler.js'
import { extractDesignSystem } from '../agents/designExtractor.js'
import { analyzeScreenshots } from '../agents/visionAnalyzer.js'
import { extractEvidence } from '../agents/evidenceExtractor.js'
import { refreshClientPrompts } from '../agents/promptRefresher.js'
import { analyzeCitationSupplyChain } from '../agents/citationSupplyChain.js'
import { analyzeAnswerShapes } from '../agents/answerShapeAnalyzer.js'
import { firstIdx } from '../core/scoring.js'
import { priceOfCall, round4 } from '../core/costs.js'
import { isPlausibleCompanyName } from '../core/competitors.js'

const DesignExtractSchema = z.object({ url: z.string().url() })

const CompanyLookupSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().min(4).max(500),
})

const TrackSchema = z.object({
  companyId: z.string().min(1),
  referrer: z.string().max(500).default(''),
  page: z.string().max(300).default(''),
  meta: z.record(z.string()).optional(),
})

const TrackBotSchema = z.object({
  companyId: z.string().min(1).max(200),
  bot: z.string().min(1).max(100),
  path: z.string().max(500).default(''),
})

// Dashboard compatibility schemas (the frontend talks in "audits").
const AuditListSchema = z.object({})
const CreateAuditSchema = z
  .object({
    companyName: z.string().min(2),
    websiteUrl: z.string().min(4),
    industry: z.string().min(2),
    region: z.string().min(2).optional(), // legacy single-location field
    locations: z.array(z.string().min(2)).min(1).optional(),
    competitors: z.array(z.string()).default([]),
    promptCount: z.number().int().min(1).max(200).default(50),
    engines: z.array(z.enum(['chatgpt', 'gemini', 'perplexity', 'claude'])).default(['chatgpt', 'gemini']),
    /**
     * Avatar (target audience): who the audit impersonates, e.g. "CEO of a
     * small-to-mid-size company looking for social media marketing". Drives
     * avatar-persona prompts and the persona injected into measured runs.
     */
    avatar: z.string().max(600).optional(),
    /** Per-engine prompt allocation, e.g. { chatgpt: 20, gemini: 20, perplexity: 10, claude: 10 }. */
    enginePrompts: z
      .record(z.enum(['chatgpt', 'gemini', 'perplexity', 'claude']), z.number().int().min(1).max(200))
      .optional(),
    /**
     * How far the run goes: 'report' stops after the PDF deck, 'actions'
     * additionally builds the action plan, 'full' additionally builds the
     * AI crawl pack / landing pages. Defaults to the full chain.
     */
    runScope: z.enum(['report', 'actions', 'full']).default('full'),
  })
  .refine((d) => (d.locations?.length ?? 0) > 0 || !!d.region, {
    message: 'locations (or legacy region) is required',
  })
const CreateLandingPageSchema = z.object({
  companyId: z.string().min(1),
  gapId: z.string().min(1),
})

/** Local YYYY-MM-DD for bucketing cost rows by calendar day. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function registerRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => {
    const engines = getMeasuredEngines()
    const checks: Record<string, string> = {}
    for (const [name, eng] of Object.entries(engines)) {
      const v = await eng.validate()
      checks[name] = v.ok ? `ok — ${v.detail}` : `FAIL — ${v.detail}`
    }
    return { ok: Object.values(checks).every((c) => c.startsWith('ok')), engines: checks }
  })

  app.post('/api/companies', async (req, reply) => {
    const parsed = NewCompanySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    }
    const job = startWorkflow(parsed.data)
    return reply.code(201).send({ ok: true, jobId: job.id })
  })

  app.post('/api/companies/lookup', async (req, reply) => {
    const parsed = CompanyLookupSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    }
    // Never throws — total failure is a graceful { ok: false } with HTTP 200.
    const result = await lookupCompany(parsed.data.name, parsed.data.website).catch(() => null)
    if (!result) return { ok: false }
    return { ok: true, ...result }
  })

  app.get('/api/companies', async () => {
    return listCompanies().map((c) => {
      const score = latestScore(c.id)
      const job = latestJobFor(c.id)
      return {
        ...c,
        latestScore: score?.payload.combined.overall ?? null,
        job: job ? { id: job.id, status: job.status, stage: job.stage, progress: job.progress } : null,
      }
    })
  })

  app.get('/api/companies/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const company = getCompany(id)
    if (!company) return reply.code(404).send({ error: 'not found' })
    return {
      company,
      latestScore: latestScore(id)?.payload ?? null,
      trends: listTrends(id),
      attribution: attributionByMonth(id),
      actionPlan: latestActionPlan(id),
      // filter out any stale teardown rows whose stored name no longer
      // passes the competitor-name quality gate (see runReverse for why)
      reverseReports: listReverseReports(id).filter((r) => isPlausibleCompanyName(r.competitor)),
    }
  })

  /**
   * Delete a company and everything derived from it: all DB rows (cascade)
   * plus the generated files directory under PATHS.reports. A company with a
   * live running job cannot be deleted — cancel the job first.
   */
  app.delete('/api/companies/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const company = getCompany(id)
    if (!company) return reply.code(404).send({ error: 'not found' })
    const job = latestJobFor(id)
    if (job && (job.status === 'running' || job.status === 'queued')) {
      // ?force=1 (the dashboard's "cancel job & delete" path): stop the
      // executor first, then delete. Without the cancellation request the
      // in-process workflow would keep writing rows for a company that no
      // longer exists.
      const force = (req.query as { force?: string }).force === '1'
      if (!force) {
        return reply
          .code(409)
          .send({ error: 'company has a live job — cancel it first (POST /api/jobs/:id/cancel)' })
      }
      requestCancel(job.id)
      updateJob(job.id, { status: 'failed', error: 'canceled by operator (company deleted)' })
      // Give the executor a moment to notice the flag and unwind before the
      // rows disappear underneath it — it checks between every API call.
      await new Promise((r) => setTimeout(r, 1_500))
    }
    deleteCompanyCascade(id) // removes ai_summaries + company-scoped learnings too
    // generated files (reports, landing pages) live under reports/<companyId>
    const dir = path.join(PATHS.reports, id)
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      // DB rows are gone; a locked file should not fail the API call
      console.warn(`[delete] could not remove ${dir}:`, err)
    }
    return { ok: true, deleted: id }
  })

  /**
   * AI executive summary — one Kimi-written brief per company, composed from
   * the latest score, competitors, citation supply chain and action plan.
   */
  app.get('/api/companies/:id/ai-summary', async (req, reply) => {
    const { id } = req.params as { id: string }
    // Persisted + pre-generated at audit completion; this call normally
    // serves straight from the DB and only regenerates after a NEW audit.
    const result = await ensureAiSummary(id)
    if (result === null) return reply.code(404).send({ error: 'no audit results yet' })
    if ('error' in result) return reply.code(502).send({ error: result.error })
    return result
  })

  /** Retro-learning memory: distilled lessons the system applies to new runs. */
  app.get('/api/learnings', async () => ({ learnings: listLearnings() }))

  app.get('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = getJob(id)
    if (!job) return reply.code(404).send({ error: 'not found' })
    return { ...job, events: jobEvents(id).slice(-50) }
  })

  app.post('/api/jobs/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      retryWorkflow(id)
      return { ok: true }
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  /**
   * Cancel a job: marks it failed so it is excluded from boot-time orphan
   * resume and the dashboard stops treating it as live. Does not interrupt
   * an executor already running in-process — restart the server for that.
   */
  app.post('/api/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = getJob(id)
    if (!job) return reply.code(404).send({ error: 'not found' })
    if (job.status === 'done') return reply.code(409).send({ error: 'job already done' })
    // Register the intent FIRST: the running executor checks this flag at
    // every stage boundary and before each audit call, so it actually stops
    // instead of writing `running` back over the row on its next update.
    requestCancel(id)
    updateJob(id, { status: 'failed', error: 'canceled by operator' })
    logEvent(id, job.stage, 'CANCELED by operator')
    return { ok: true }
  })

  app.post('/api/design/extract', async (req, reply) => {
    const parsed = DesignExtractSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'body must be { url: string } with a valid URL' })
    try {
      const shots = await extractDesignSystem(parsed.data.url)
      const designTokens = await analyzeScreenshots(shots.paths)
      return { ok: true, domain: shots.domain, screenshots: shots.paths, designTokens }
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get('/api/reports/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    return listReports(companyId).map((r) => {
      // relative path from the reports root so site/ subdirs stay intact
      const rel = r.path.replace(/\\/g, '/').split(`/reports/`).pop() ?? r.path.split(/[\\/]/).pop()
      return { ...r, url: `/reports/${rel}` }
    })
  })

  app.get('/api/companies/:id/attribution', async (req) => {
    const { id } = req.params as { id: string }
    return attributionByMonth(id)
  })

  for (const kind of ['pageview', 'lead'] as const) {
    app.post(`/api/track/${kind}`, async (req, reply) => {
      const parsed = TrackSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid payload' })
      const tracked = trackEvent(
        parsed.data.companyId,
        kind,
        parsed.data.referrer,
        parsed.data.page,
        parsed.data.meta ?? {},
      )
      return { ok: tracked }
    })
  }

  // Server-log forwarder for client sites: AI crawlers don't execute JS, so
  // the snippet never sees them — the client's server (or a true CDN
  // integration, e.g. a Cloudflare/Vercel log push) posts the bot visit here.
  app.post('/api/track/bot', async (req, reply) => {
    const parsed = TrackBotSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid payload' })
    try {
      insertBotVisit({
        companyId: parsed.data.companyId,
        bot: parsed.data.bot,
        path: parsed.data.path,
        status: null, // forwarded log — no HTTP status from our pipeline
        at: new Date().toISOString(),
      })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // AI-traffic section: crawler visits (bot_visits) + human visits from AI
  // citations (referral_events), both derived from existing tables.
  app.get('/api/companies/:id/ai-traffic', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!getCompany(id)) return reply.code(404).send({ error: 'not found' })
    return aiTrafficSummary(id)
  })

  app.get('/track.js', async (req, reply) => {
    const { company } = req.query as { company?: string }
    if (!company) return reply.code(400).send('// missing ?company=<id>')
    return reply
      .header('Content-Type', 'application/javascript')
      .header('Cache-Control', 'no-store')
      .send(trackingSnippet(company))
  })

  // ─── evidence layer ───────────────────────────────────────────────────────

  // Full evidence bundle: topic clusters + visibility matrix + top snippets,
  // plus the citation supply chain and answer-shape analysis.
  app.get('/api/evidence/:companyId', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    const bundle = extractEvidence(companyId)
    if (!bundle) return reply.code(404).send({ error: 'not found' })
    return {
      bundle,
      supplyChain: analyzeCitationSupplyChain(companyId),
      shapes: analyzeAnswerShapes(companyId),
    }
  })

  app.get('/api/evidence/:companyId/topics', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    const bundle = extractEvidence(companyId)
    if (!bundle) return reply.code(404).send({ error: 'not found' })
    return {
      companyId: bundle.companyId,
      generatedAt: bundle.generatedAt,
      runsOk: bundle.runsOk,
      topics: bundle.topics,
      visibilityMatrix: bundle.visibilityMatrix,
    }
  })

  app.get('/api/evidence/:companyId/citations', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    const chain = analyzeCitationSupplyChain(companyId)
    if (!chain) return reply.code(404).send({ error: 'not found' })
    return chain
  })

  app.get('/api/evidence/:companyId/answer-shapes', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    const shapes = analyzeAnswerShapes(companyId)
    if (!shapes) return reply.code(404).send({ error: 'not found' })
    return shapes
  })

  // Sentiment breakdown + trend for the dashboard's sentiment charts. Returns
  // zeros (not 404) when no answers have been judged yet — the UI hides the
  // chart on total === 0.
  app.get('/api/evidence/:companyId/sentiment', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    if (!getCompany(companyId)) return reply.code(404).send({ error: 'not found' })
    return { ...sentimentBreakdown(companyId), trend: sentimentTrendByDay(companyId) }
  })

  // ─── monitoring suite ─────────────────────────────────────────────────────

  app.get('/api/tracking/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    return listTrackingSnapshots(companyId)
  })

  app.get('/api/tracking/:companyId/latest', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    const snapshot = latestTrackingSnapshot(companyId)
    if (!snapshot) return reply.code(404).send({ error: 'no tracking snapshots yet' })
    return snapshot
  })

  /**
   * Run a tracking check-up NOW (the dashboard's manual trigger). Default is
   * a live re-query of the key prompts (costs measured calls); ?stored=1
   * snapshots from the latest stored audit records instead (free).
   */
  app.post('/api/tracking/:companyId/run', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    if (!getCompany(companyId)) return reply.code(404).send({ error: 'not found' })
    const stored = (req.query as { stored?: string }).stored === '1'
    const result = await runWeeklyTracking(companyId, stored ? { source: 'stored' } : {})
    if (!result) return reply.code(409).send({ error: 'tracking skipped — no prompt library or no records yet' })
    return { ok: true, snapshot: result.snapshot, summary: result.summary }
  })

  app.get('/api/citations/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    const sources = listCitationSources(companyId)
    return { sources, opportunities: sources.filter(isOpportunity) }
  })

  app.get('/api/gaps/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    return listContentGaps(companyId)
  })

  app.get('/api/competitors/:companyId/changes', async (req) => {
    const { companyId } = req.params as { companyId: string }
    // Rebuild the change feed from stored snapshot pairs (newest first).
    const snapshots = listCompetitorSnapshots(companyId)
    const latestByDomain = new Map<string, typeof snapshots>()
    for (const s of snapshots) {
      const list = latestByDomain.get(s.competitorDomain) ?? []
      if (list.length < 2) list.push(s) // snapshots are id-DESC: [latest, previous]
      latestByDomain.set(s.competitorDomain, list)
    }
    const changes = []
    for (const [latest, previous] of latestByDomain.values()) {
      if (latest && previous) {
        for (const c of diffSnapshots(previous, latest)) {
          changes.push({ ...c, detectedAt: latest.scrapedAt })
        }
      }
    }
    return changes
  })

  app.post('/api/monitoring/start/:companyId', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    if (!getCompany(companyId)) return reply.code(404).send({ error: 'not found' })
    const result = startMonitoring(companyId)
    return { ok: true, ...result, monitored: monitoredCompanies() }
  })

  app.post('/api/monitoring/stop/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    const result = stopMonitoring(companyId)
    return { ok: true, ...result, monitored: monitoredCompanies() }
  })

  // ─── costs + company drill-downs ──────────────────────────────────────────

  // API call volume + estimated spend. The log has no token counts, so spend
  // is a per-call estimate via core/costs.ts (shared with the dataset).
  app.get('/api/costs/summary', async () => {
    const rows = listApiCosts()

    const nowDate = new Date()
    const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
    const weekAgo = new Date(startOfToday.getTime() - 6 * 86400_000)
    const monthAgo = new Date(startOfToday.getTime() - 29 * 86400_000)

    const totals = {
      today: { calls: 0, estimatedUsd: 0 },
      week: { calls: 0, estimatedUsd: 0 },
      month: { calls: 0, estimatedUsd: 0 },
      all: { calls: 0, estimatedUsd: 0 },
    }
    const byVendor = new Map<string, { calls: number; estimatedUsd: number }>()
    const byModel = new Map<string, { vendor: string; model: string; kind: string; calls: number; estimatedUsd: number }>()
    const byDay = new Map<string, { calls: number; estimatedUsd: number }>()
    const byCompany = new Map<string, { calls: number; estimatedUsd: number }>()

    for (const row of rows) {
      const price = priceOfCall(row.vendor)
      const at = new Date(row.at)

      totals.all.calls += 1
      totals.all.estimatedUsd += price
      if (at >= monthAgo) {
        totals.month.calls += 1
        totals.month.estimatedUsd += price
      }
      if (at >= weekAgo) {
        totals.week.calls += 1
        totals.week.estimatedUsd += price
      }
      if (at >= startOfToday) {
        totals.today.calls += 1
        totals.today.estimatedUsd += price
      }

      const v = byVendor.get(row.vendor) ?? { calls: 0, estimatedUsd: 0 }
      v.calls += 1
      v.estimatedUsd += price
      byVendor.set(row.vendor, v)

      const modelKey = `${row.vendor}|${row.model}|${row.kind}`
      const m = byModel.get(modelKey) ?? { vendor: row.vendor, model: row.model, kind: row.kind, calls: 0, estimatedUsd: 0 }
      m.calls += 1
      m.estimatedUsd += price
      byModel.set(modelKey, m)

      const day = dayKey(at)
      if (at >= monthAgo) {
        const d = byDay.get(day) ?? { calls: 0, estimatedUsd: 0 }
        d.calls += 1
        d.estimatedUsd += price
        byDay.set(day, d)
      }

      const companyKey = row.companyId ?? 'system'
      const c = byCompany.get(companyKey) ?? { calls: 0, estimatedUsd: 0 }
      c.calls += 1
      c.estimatedUsd += price
      byCompany.set(companyKey, c)
    }

    const companyNames = new Map(listCompanies().map((c) => [c.id, c.name]))

    // Zero-fill the last 30 days so the chart has no gaps.
    const days: { date: string; calls: number; estimatedUsd: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const date = dayKey(new Date(startOfToday.getTime() - i * 86400_000))
      const d = byDay.get(date) ?? { calls: 0, estimatedUsd: 0 }
      days.push({ date, calls: d.calls, estimatedUsd: round4(d.estimatedUsd) })
    }

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        today: { calls: totals.today.calls, estimatedUsd: round4(totals.today.estimatedUsd) },
        week: { calls: totals.week.calls, estimatedUsd: round4(totals.week.estimatedUsd) },
        month: { calls: totals.month.calls, estimatedUsd: round4(totals.month.estimatedUsd) },
        all: { calls: totals.all.calls, estimatedUsd: round4(totals.all.estimatedUsd) },
      },
      byVendor: [...byVendor.entries()]
        .map(([vendor, v]) => ({ vendor, calls: v.calls, estimatedUsd: round4(v.estimatedUsd) }))
        .sort((a, b) => b.calls - a.calls),
      byModel: [...byModel.values()]
        .map((m) => ({ ...m, estimatedUsd: round4(m.estimatedUsd) }))
        .sort((a, b) => b.calls - a.calls),
      byDay: days,
      byCompany: [...byCompany.entries()]
        .map(([companyId, c]) => ({
          companyId,
          companyName: companyNames.get(companyId) ?? (companyId === 'system' ? 'system' : companyId),
          calls: c.calls,
          estimatedUsd: round4(c.estimatedUsd),
        }))
        .sort((a, b) => b.calls - a.calls),
    }
  })

  // Latest prompt library for the Prompts tab. ?refresh=1 runs the
  // promptRefresher first (appends up to 15 new prompts as a new version).
  app.get('/api/companies/:id/prompts', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { refresh } = req.query as { refresh?: string }
    if (!getCompany(id)) return reply.code(404).send({ error: 'not found' })
    if (refresh === '1') await refreshClientPrompts(id)
    const library = latestPromptLibrary(id)
    if (!library) {
      return { companyId: id, version: 0, total: 0, updatedAt: null, prompts: [] }
    }
    return {
      companyId: id,
      version: library.version,
      total: library.items.length,
      updatedAt: library.createdAt,
      prompts: library.items,
    }
  })

  // Every audit answer that mentions the client brand — the Mentions tab.
  app.get('/api/companies/:id/mentions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const company = getCompany(id)
    if (!company) return reply.code(404).send({ error: 'not found' })

    const records = allAuditRecords(id)
    const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

    const mentions = []
    for (const r of records) {
      const text = r.text ?? ''
      const idx = firstIdx(text, company.aliases)
      if (idx === null) continue
      const flat = collapse(text)
      // Find the match position inside the collapsed text for the context window.
      const flatIdx = firstIdx(flat, company.aliases) ?? 0
      mentions.push({
        engine: r.engine,
        prompt: r.prompt,
        scope: r.scope,
        persona: r.persona,
        excerpt: flat.slice(0, 300),
        mentionContext: flat.slice(Math.max(0, flatIdx - 120), flatIdx + 120),
        sentiment: r.sentiment ?? null,
        citedUrls: r.citedUrls,
        createdAt: r.createdAt,
      })
    }
    mentions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return {
      companyId: id,
      total: mentions.length,
      mentionRate: records.length > 0 ? round4(mentions.length / records.length) : 0,
      mentions: mentions.slice(0, 500),
    }
  })

  // Categorized, deduplicated generated files — the Generated Files tab.
  app.get('/api/companies/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!getCompany(id)) return reply.code(404).send({ error: 'not found' })

    interface FileEntry {
      id: number
      name: string
      kind: string
      scope?: string
      lang?: string
      url: string
      createdAt: string
    }
    const categories: { reports: FileEntry[]; landingPages: FileEntry[]; data: FileEntry[] } = {
      reports: [],
      landingPages: [],
      data: [],
    }

    // listReports is id-DESC, so the first occurrence per key is the newest.
    const seenPaths = new Set<string>()
    const seenPageNames = new Set<string>()
    for (const r of listReports(id)) {
      const rel = r.path.replace(/\\/g, '/').split('/reports/').pop() ?? r.path.split(/[\\/]/).pop() ?? r.path
      const name = rel.split('/').pop() ?? rel
      if (seenPaths.has(rel)) continue
      if (r.kind === 'page') {
        // the pipeline has produced duplicate pages under different paths
        if (seenPageNames.has(name)) continue
        seenPageNames.add(name)
      }
      seenPaths.add(rel)
      const entry: FileEntry = {
        id: r.id,
        name,
        kind: r.kind,
        url: `/reports/${rel}`,
        createdAt: r.createdAt,
      }
      if (r.kind === 'pdf' || r.kind === 'digest') {
        categories.reports.push({ ...entry, scope: r.scope, lang: r.lang })
      } else if (r.kind === 'page') {
        categories.landingPages.push(entry)
      } else {
        categories.data.push(entry)
      }
    }

    return {
      companyId: id,
      categories,
      counts: {
        reports: categories.reports.length,
        landingPages: categories.landingPages.length,
        data: categories.data.length,
      },
    }
  })

  // Latest content-freshness run: checked count + stale rows only.
  app.get('/api/companies/:id/freshness', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!getCompany(id)) return reply.code(404).send({ error: 'not found' })
    const run = latestFreshnessRun(id)
    if (!run) return { checked: 0, stale: [] }
    return {
      checked: new Set(run.rows.map((r) => r.path)).size,
      stale: run.rows
        .filter((r) => r.reason !== 'ok')
        .map((r) => ({ path: r.path, reason: r.reason, detail: r.detail, checkedAt: r.checkedAt })),
    }
  })

  // ─── dashboard compatibility: audits + landing pages ────────────────────────

  /** Human labels for the audit-detail timeline (one entry per pipeline stage). */
  const STAGE_LABELS: Record<StageName, string> = {
    intake: 'Company intake',
    promptgen: 'Prompt library',
    audit: 'AI engine audit',
    verify: 'Citation verification',
    score: 'Scoring',
    reverse: 'Competitor teardowns',
    competitors: 'Competitor pages',
    report: 'PDF reports',
    actions: 'Action plan',
    pages: 'Site pages',
    done: 'Done',
  }

  interface TimelineEntry {
    stage: StageName
    label: string
    status: 'done' | 'running' | 'failed' | 'pending'
    startedAt: string | null
    finishedAt: string | null
    durationMs: number | null
    calls: number
    estimatedUsd: number
    lastMessage: string | null
  }

  /**
   * One timeline entry per pipeline stage. Stage start = first job_event with
   * that stage; stage end = start of the next stage that has events (or
   * job.updatedAt/now for the last active one). Cost rows are bucketed into
   * stage windows by timestamp; rows outside every window go to the stage
   * with the nearest start. Best-effort: a job with no events/costs still
   * returns a well-formed timeline and zero spend.
   */
  function buildTimeline(job: NonNullable<ReturnType<typeof getJob>>): TimelineEntry[] {
    // Only the stages this run's scope will actually execute — a 'report'
    // run must not show the action-plan and pages stages hanging in
    // 'pending' forever.
    const STAGES = stagesFor(getCompany(job.companyId)?.runScope ?? 'full')
    const events = jobEvents(job.id)
    const firstAt = new Map<StageName, string>()
    const lastMsg = new Map<StageName, string>()
    for (const ev of events) {
      if (!firstAt.has(ev.stage)) firstAt.set(ev.stage, ev.at)
      lastMsg.set(ev.stage, ev.message)
    }

    const currentIdx = STAGES.indexOf(job.stage as StageName)
    const statusOf = (i: number): TimelineEntry['status'] => {
      if (job.status === 'done') return 'done'
      if (currentIdx < 0) return 'pending' // unknown stage — nothing to compare against
      if (i < currentIdx) return 'done'
      if (i === currentIdx) return job.status === 'failed' ? 'failed' : 'running'
      return 'pending'
    }

    // Stage end = start of the next stage that has events; the last stage with
    // events runs until the job's last update (or now).
    const endOf = (i: number): string | null => {
      for (let j = i + 1; j < STAGES.length; j++) {
        const at = firstAt.get(STAGES[j] as StageName)
        if (at) return at
      }
      return job.updatedAt || new Date().toISOString()
    }

    const entries: TimelineEntry[] = STAGES.map((stage, i) => {
      const startedAt = firstAt.get(stage) ?? null
      const finishedAt = startedAt ? endOf(i) : null
      return {
        stage,
        label: STAGE_LABELS[stage],
        status: statusOf(i),
        startedAt,
        finishedAt,
        durationMs:
          startedAt && finishedAt
            ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
            : null,
        calls: 0,
        estimatedUsd: 0,
        lastMessage: lastMsg.get(stage) ?? null,
      }
    })

    // Bucket the job's cost rows into stage windows [start, end).
    const windowed = entries.filter((e) => e.startedAt !== null)
    for (const row of listApiCostsForJob(job.id)) {
      const at = Date.parse(row.at)
      let target = windowed.find(
        (e) =>
          at >= Date.parse(e.startedAt as string) &&
          (e.finishedAt === null || at < Date.parse(e.finishedAt)),
      )
      if (!target && windowed.length > 0) {
        // outside every window — nearest stage start wins (earliest stage on ties)
        target = windowed.reduce((best, e) =>
          Math.abs(at - Date.parse(e.startedAt as string)) <
          Math.abs(at - Date.parse(best.startedAt as string))
            ? e
            : best,
        )
      }
      // no events at all → attribute to the current stage (entries[currentIdx])
      const bucket = target ?? (currentIdx >= 0 ? entries[currentIdx] : undefined)
      if (!bucket) continue
      bucket.calls += 1
      bucket.estimatedUsd = round4(bucket.estimatedUsd + priceOfCall(row.vendor))
    }
    return entries
  }

  /** Shape a backend job + company into the frontend's Audit object. */
  function auditFromJob(job: NonNullable<ReturnType<typeof getJob>>): Record<string, unknown> {
    const company = getCompany(job.companyId)
    const score = latestScore(job.companyId)
    const plan = latestActionPlan(job.companyId)
    const sc = score?.payload
    const overall = sc?.combined?.overall
    const costs = listApiCostsForJob(job.id)
    return {
      id: job.id,
      companyId: job.companyId,
      companyName: company?.name ?? job.companyId,
      websiteUrl: company?.website ?? '',
      industry: company?.sector ?? '',
      region: company?.location ?? '',
      locations: company?.locations ?? [],
      competitors: company?.competitors ?? [],
      avatar: company?.buyerPersona || undefined,
      runScope: company?.runScope ?? 'full',
      promptCount: company?.enginePlan
        ? Math.max(...Object.values(company.enginePlan), 0)
        : 50,
      engines:
        company?.engines ??
        (company?.enginePlan ? Object.keys(company.enginePlan) : ['chatgpt', 'gemini']),
      enginePlan: company?.enginePlan,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.error ?? undefined,
      mentionRate: overall?.mentionRate ?? sc?.regional?.overall?.mentionRate ?? 0,
      citationRate: overall?.citationRate ?? sc?.regional?.overall?.citationRate ?? 0,
      sov: overall?.sov ?? sc?.regional?.overall?.sov ?? 0,
      recommendations: [],
      spend: {
        calls: costs.length,
        estimatedUsd: round4(costs.reduce((sum, r) => sum + priceOfCall(r.vendor), 0)),
      },
      timeline: buildTimeline(job),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }
  }

  app.get('/api/audits', async () => {
    // One audit per company = the latest job.
    const audits = []
    for (const c of listCompanies()) {
      const job = latestJobFor(c.id)
      if (!job) continue
      audits.push(auditFromJob(job))
    }
    return audits.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  })

  app.post('/api/audits', async (req, reply) => {
    const parsed = CreateAuditSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    }
    // Multi-location: explicit list wins; the legacy single `region` field is
    // the fallback. The primary location stays in `location` (contract).
    const locations = parsed.data.locations?.length
      ? parsed.data.locations
      : [parsed.data.region as string]
    // Engine plan: explicit per-engine counts win; otherwise every selected
    // engine runs promptCount prompts.
    const enginePlan =
      parsed.data.enginePrompts ??
      Object.fromEntries(parsed.data.engines.map((e) => [e, parsed.data.promptCount]))
    const input: NewCompanyInput = {
      name: parsed.data.companyName,
      sector: parsed.data.industry,
      location: locations[0] as string,
      locations,
      website: parsed.data.websiteUrl,
      competitors: parsed.data.competitors.filter(Boolean),
      buyerPersona: parsed.data.avatar?.trim() || undefined,
      engines: parsed.data.engines,
      enginePlan,
      runScope: parsed.data.runScope,
      language: 'de',
    }
    const job = startWorkflow(input)
    return reply.code(201).send(auditFromJob(job))
  })

  app.get('/api/audits/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = getJob(id)
    if (!job) return reply.code(404).send({ error: 'not found' })
    return auditFromJob(job)
  })

  app.get('/api/audits/:id/pdf', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = getJob(id)
    if (!job) return reply.code(404).send({ error: 'not found' })
    const reports = listReports(job.companyId).filter((r) => r.kind === 'pdf')
    const latest = reports[0]
    if (!latest) return reply.code(404).send({ error: 'no pdf report yet' })
    const rel = latest.path.replace(/\\/g, '/').split('/reports/').pop() ?? latest.path.split(/[\\/]/).pop()
    return reply.redirect(`/reports/${rel}`)
  })

  app.get('/api/landing-pages/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    const reports = listReports(companyId).filter((r) => r.kind === 'page')
    return reports.map((r) => {
      const rel = r.path.replace(/\\/g, '/').split('/reports/').pop() ?? r.path.split(/[\\/]/).pop()
      return {
        id: String(r.id),
        title: path.basename(r.path),
        url: `/reports/${rel}`,
        htmlUrl: `/reports/${rel}`,
        createdAt: r.createdAt,
      }
    })
  })

  app.post('/api/landing-pages', async (req, reply) => {
    const parsed = CreateLandingPageSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid payload' })
    const { companyId, gapId } = parsed.data
    const company = getCompany(companyId)
    if (!company) return reply.code(404).send({ error: 'company not found' })
    const gap = listContentGaps(companyId).find((g) => String(g.id) === gapId)
    if (!gap) return reply.code(404).send({ error: 'gap not found' })

    // Build a single page from the gap. When audit evidence exists, prefer
    // the evidence-based builder (citation supply chain + vision design
    // tokens); it falls back to classic buildPage logic internally whenever
    // competitor pages, topic evidence or the vision pipeline are missing.
    const brandProfile = await getBrandProfile(company)
    const pageSlug = `/geo/${slugify(gap.prompt.slice(0, 60))}`
    const spec: PageSpec = {
      title: gap.prompt,
      slug: pageSlug,
      targetQuery: gap.prompt,
      answerCapsule: gap.reason,
      schemaType: gap.recommendedFormat === 'faq' ? 'FAQPage' : 'Article',
      priority: 1,
      status: 'done',
    }
    const evidence = extractEvidence(company.id)
    const built = evidence
      ? await generateFromEvidence(company, gap, evidence)
      : await buildPage(company, spec, brandProfile, [spec])
    const dir = path.join(PATHS.reports, companyId, 'site')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, built.filename)
    fs.writeFileSync(filePath, built.html, 'utf8')
    const reportId = insertReport({
      companyId,
      scope: 'regional',
      lang: company.language,
      kind: 'page',
      path: filePath,
      createdAt: new Date().toISOString(),
    })
    const rel = filePath.replace(/\\/g, '/').split('/reports/').pop() ?? built.filename
    return reply.code(201).send({
      id: String(reportId),
      title: gap.prompt,
      url: `/reports/${rel}`,
      htmlUrl: `/reports/${rel}`,
      createdAt: new Date().toISOString(),
    })
  })

  // ─── LeadEngine Data (admin knowledge dataset) ────────────────────────────

  /** Max dataset rows returned by the list endpoints (contract). */
  const DATASET_LIMIT = 500

  // The whole dataset: canonical columns + rows (newest first) + totals.
  app.get('/api/admin/dataset', async () => {
    const rows = listClientSnapshots(DATASET_LIMIT)
    const costs = listApiCosts()
    return {
      generatedAt: new Date().toISOString(),
      columns: DATASET_COLUMNS,
      rows,
      totals: {
        companies: listCompanies().length,
        snapshots: countClientSnapshots(),
        apiCalls: costs.length,
        estimatedUsd: round4(costs.reduce((sum, r) => sum + priceOfCall(r.vendor), 0)),
      },
    }
  })

  // Same rows as an RFC4180 CSV download.
  app.get('/api/admin/dataset.csv', async (_req, reply) => {
    const csv = toCsv(listClientSnapshots(DATASET_LIMIT))
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="leadengine-dataset.csv"')
      .send(csv)
  })

  // One company's lifecycle timeline, newest first.
  app.get('/api/admin/dataset/:companyId', async (req) => {
    const { companyId } = req.params as { companyId: string }
    return { companyId, snapshots: listClientSnapshotsForCompany(companyId, DATASET_LIMIT) }
  })

  // Force a 'manual' snapshot now (e.g. after a mid-cycle change).
  app.post('/api/admin/dataset/collect/:companyId', async (req, reply) => {
    const { companyId } = req.params as { companyId: string }
    const row = collectClientSnapshot(companyId, 'manual')
    if (!row) return reply.code(404).send({ error: 'company not found' })
    return reply.code(201).send(row)
  })

  /**
   * Cross-client overview — the product-improvement lens. Averages are taken
   * over the LATEST snapshot per company (one vote per client, not per row),
   * so a heavily-tracked client cannot dominate the picture.
   *
   * `weakSpots` are observations about the SYSTEM, not about clients:
   * engines that never produce a mention, sectors where visibility does not
   * convert into citations, and the pipeline stages that fail most.
   */
  app.get('/api/admin/overview', async () => {
    const latest = latestClientSnapshotPerCompany()
    const costs = listApiCosts()
    const jobStatuses = jobCountsByStatus()

    const avg = (values: number[]): number =>
      values.length === 0 ? 0 : round4(values.reduce((a, b) => a + b, 0) / values.length)

    // ── per sector ──
    interface SectorAcc {
      companies: number
      mention: number[]
      citation: number[]
      usd: number[]
    }
    const sectors = new Map<string, SectorAcc>()
    for (const row of latest) {
      const key = row.sector_key || 'unknown'
      const acc = sectors.get(key) ?? { companies: 0, mention: [], citation: [], usd: [] }
      acc.companies += 1
      acc.mention.push(row.mention_rate)
      acc.citation.push(row.citation_rate)
      acc.usd.push(row.estimated_usd)
      sectors.set(key, acc)
    }
    const bySector = [...sectors.entries()]
      .map(([sectorKey, acc]) => ({
        sectorKey,
        companies: acc.companies,
        avgMentionRate: avg(acc.mention),
        avgCitationRate: avg(acc.citation),
        avgUsd: avg(acc.usd),
      }))
      .sort((a, b) => b.companies - a.companies || a.sectorKey.localeCompare(b.sectorKey))

    // ── per engine (parsed out of the per_engine JSON column) ──
    const engineAcc = new Map<string, { mention: number[]; citation: number[] }>()
    for (const row of latest) {
      let parsed: Record<string, { mentionRate?: number; citationRate?: number }> = {}
      try {
        parsed = JSON.parse(row.per_engine || '{}') as typeof parsed
      } catch {
        parsed = {}
      }
      for (const [engine, stats] of Object.entries(parsed)) {
        if (!stats) continue
        const acc = engineAcc.get(engine) ?? { mention: [], citation: [] }
        acc.mention.push(stats.mentionRate ?? 0)
        acc.citation.push(stats.citationRate ?? 0)
        engineAcc.set(engine, acc)
      }
    }
    const byEngine = [...engineAcc.entries()]
      .map(([engine, acc]) => ({
        engine,
        avgMention: avg(acc.mention),
        avgCitation: avg(acc.citation),
      }))
      .sort((a, b) => b.avgMention - a.avgMention || a.engine.localeCompare(b.engine))

    // ── weak spots: where WE underperform ──
    const weakSpots: string[] = []
    for (const e of byEngine) {
      if (e.avgMention === 0) {
        weakSpots.push(
          `Engine '${e.engine}': 0% mention rate across all ${latest.length} tracked companies — the client never surfaces there.`,
        )
      } else if (e.avgCitation === 0) {
        weakSpots.push(
          `Engine '${e.engine}': mentions the client (${e.avgMention}% avg) but never cites its domain.`,
        )
      }
    }
    for (const s of bySector) {
      const gap = round4(s.avgMentionRate - s.avgCitationRate)
      if (gap > 20) {
        weakSpots.push(
          `Sector '${s.sectorKey}': visibility-citation gap of ${gap}pp over ${s.companies} ` +
            'company(ies) — mentions are not converting into own-domain citations.',
        )
      }
    }
    for (const stage of failedJobStages().slice(0, 3)) {
      weakSpots.push(`Pipeline stage '${stage.stage}': ${stage.count} failed job(s).`)
    }
    const noCitations = latest.filter((r) => r.citations_own === 0)
    if (noCitations.length > 0) {
      weakSpots.push(
        `${noCitations.length}/${latest.length} companies have ZERO own-domain citations ` +
          `(${noCitations.map((r) => r.company_id).slice(0, 5).join(', ')}).`,
      )
    }
    if (latest.length === 0) {
      weakSpots.push('No dataset snapshots collected yet — run scripts/backfill-dataset.mts.')
    }

    const learningKinds = learningCountsByKind()
    return {
      companies: listCompanies().length,
      audits: jobStatuses.find((s) => s.status === 'done')?.count ?? 0,
      totalCalls: costs.length,
      estimatedUsd: round4(costs.reduce((sum, r) => sum + priceOfCall(r.vendor), 0)),
      avgMentionRate: avg(latest.map((r) => r.mention_rate)),
      avgCitationRate: avg(latest.map((r) => r.citation_rate)),
      bySector,
      byEngine,
      learnings: {
        total: learningKinds.reduce((sum, k) => sum + k.count, 0),
        byKind: learningKinds,
      },
      weakSpots,
    }
  })
}
