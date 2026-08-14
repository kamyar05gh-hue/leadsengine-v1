/**
 * The workflow DAG — orchestrates all stages for one company.
 *
 * Stage order: intake → promptgen → audit → verify → score → reverse →
 * competitors → report → actions → pages → done. Progress is reported as
 * 0..100 to the job row. Every stage is idempotent, so retry resumes at the
 * failed stage.
 */
import {
  createJob,
  getJob,
  logEvent,
  updateJob,
} from './queue.js'
import { setCallContext } from '../providers/index.js'
import { connect } from '../db/client.js'
import { getCompany } from '../db/repo.js'
import { runIntake } from './stages/intake.js'
import { runPromptgen } from './stages/promptgen.js'
import { runAudit } from './stages/audit.js'
import { runVerify } from './stages/verify.js'
import { runScore } from './stages/score.js'
import { runReport } from './stages/report.js'
import { runReverse } from './stages/reverse.js'
import { runCompetitors } from './stages/competitors.js'
import { runActions } from './stages/actions.js'
import { runPages } from './stages/pages.js'
import { findContentGaps } from '../agents/contentGapAnalyzer.js'
import { runRetro } from '../agents/retroAnalyzer.js'
import { collectClientSnapshot } from '../agents/datasetCollector.js'
import { ensureAiSummary } from '../agents/aiSummarizer.js'
import { runWeeklyTracking } from '../agents/weeklyTracker.js'
import { startMonitoring } from '../cron/scheduler.js'
import { CanceledError, clearCancel, isCanceled, throwIfCanceled } from './cancellation.js'
import type { Job, NewCompanyInput, RunScope, StageName } from '../types.js'

export const STAGE_ORDER: StageName[] = [
  'intake',
  'promptgen',
  'audit',
  'verify',
  'score',
  'reverse',
  'competitors',
  'report',
  'actions',
  'pages',
]

/** Progress slice each stage owns, so the bar maps to wall time roughly. */
export const PROGRESS: Record<StageName, [number, number]> = {
  intake: [0, 5],
  promptgen: [5, 15],
  audit: [15, 55],
  verify: [55, 65],
  score: [65, 70],
  reverse: [70, 75],
  competitors: [75, 80],
  report: [80, 90],
  actions: [90, 95],
  pages: [95, 100],
  done: [100, 100],
}

/**
 * The stage chain per run scope. Each scope is a PREFIX of the full chain —
 * a shorter run is the same pipeline stopping earlier, never a different
 * one, so scoring, evidence and every downstream artifact stay identical.
 */
export function stagesFor(scope: RunScope = 'full'): StageName[] {
  const last: Record<RunScope, StageName> = {
    report: 'report',
    actions: 'actions',
    full: 'pages',
  }
  return STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(last[scope]) + 1)
}

/**
 * Progress ceiling of a scope — the `hi` of its final stage. Used to rescale
 * the bar so a 'report' run still finishes at 100% instead of stalling at
 * the 90% the full chain would have left for the action plan and pages.
 */
export function progressCeiling(scope: RunScope = 'full'): number {
  const stages = stagesFor(scope)
  const lastStage = stages[stages.length - 1] ?? 'pages'
  return PROGRESS[lastStage][1]
}

/**
 * Terminal handler shared by start and retry. A cancellation is a deliberate
 * operator action, not a crash: it gets its own message and log line, and it
 * must not overwrite the row a concurrent delete may already have removed.
 */
function finishWithError(jobId: string, err: unknown): void {
  if (err instanceof CanceledError) {
    updateJob(jobId, { status: 'failed', error: 'canceled by operator' })
    logEvent(jobId, getJob(jobId)?.stage ?? 'intake', 'CANCELED — workflow stopped')
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  updateJob(jobId, { status: 'failed', error: message })
  logEvent(jobId, getJob(jobId)?.stage ?? 'intake', `FAILED: ${message}`)
}

/** Start the full workflow for a new company. Returns the job immediately. */
export function startWorkflow(input: NewCompanyInput): Job {
  const job = createJob('pending') // placeholder until intake assigns the id
  void execute(job.id, input).catch((err) => finishWithError(job.id, err))
  return job
}

/** Resume a failed job at its current stage. */
export function retryWorkflow(jobId: string): void {
  const job = getJob(jobId)
  if (!job) throw new Error(`job ${jobId} not found`)
  // Drop any stale cancellation from this job's previous life, or the
  // resumed run would abort at its first checkpoint.
  clearCancel(jobId)
  updateJob(jobId, { status: 'queued', error: undefined })
  void execute(jobId, null, job.companyId).catch((err) => finishWithError(jobId, err))
}

async function execute(
  jobId: string,
  input: NewCompanyInput | null,
  existingCompanyId?: string,
): Promise<void> {
  setCallContext({ jobId, companyId: existingCompanyId })
  /**
   * Run scope — resolved after intake (the company row carries it). Until
   * then the full chain is assumed, which only affects the intake stage's
   * own progress slice.
   */
  let scope: RunScope = 'full'
  /**
   * Stage checkpoint + progress write. Throws when the job was canceled, so
   * every `at()` call doubles as an abort point — and, critically, a canceled
   * job is never written back to `running` (that resurrection is exactly what
   * made cancel look like a no-op).
   *
   * Progress is rescaled to the scope's ceiling so every scope finishes at
   * 100%: a 'report' run would otherwise stop at the 90% the full chain
   * reserves for the action plan and site pages.
   */
  const at = (stage: StageName, frac = 0) => {
    throwIfCanceled(jobId)
    const [lo, hi] = PROGRESS[stage]
    const raw = lo + (hi - lo) * frac
    const scale = 100 / progressCeiling(scope)
    updateJob(jobId, {
      status: 'running',
      stage,
      progress: Math.min(100, Math.round(raw * scale)),
    })
  }

  // intake
  at('intake')
  let companyId = existingCompanyId
  let company = companyId ? getCompany(companyId) : null
  if (!company) {
    if (!input) throw new Error('intake requires company input')
    company = runIntake(input)
    companyId = company.id
    // re-point the job row at the real company id
    connect().prepare('UPDATE jobs SET company_id = ? WHERE id = ?').run(companyId, jobId)
    setCallContext({ jobId, companyId })
    logEvent(jobId, 'intake', `company '${company.name}' registered`)
  }
  scope = company.runScope ?? 'full'
  if (scope !== 'full') {
    const chain = stagesFor(scope)
    logEvent(jobId, 'intake', `run scope '${scope}' — stops after ${chain[chain.length - 1]}`)
  }

  // promptgen
  at('promptgen')
  const library = await runPromptgen(company)
  logEvent(jobId, 'promptgen', `library v${library.version}: ${library.items.length} prompts`)

  // audit
  const records = await runAudit(
    company,
    library,
    (done, total) => {
      at('audit', done / total)
      if (done % 50 === 0 || done === total) {
        logEvent(jobId, 'audit', `${done}/${total} calls`)
      }
    },
    jobId,
  )
  const okCount = records.filter((r) => r.ok).length
  logEvent(jobId, 'audit', `done — ${okCount}/${records.length} ok`)

  // verify — fetch every cited URL and confirm it actually mentions the brand
  const verification = await runVerify(company, library.id, (done, total) => {
    at('verify', done / total)
  })
  logEvent(
    jobId,
    'verify',
    `${verification.verified}/${verification.urlsChecked} citations verified` +
      (verification.recordsSkipped > 0 ? ` (${verification.recordsSkipped} records resumed)` : ''),
  )

  // score
  at('score')
  const { scoped, impact } = runScore(company, library, records)
  logEvent(
    jobId,
    'score',
    `combined: mention ${scoped.combined.overall.mentionRate}% · citation ${scoped.combined.overall.citationRate}% · SoV ${scoped.combined.overall.sov}%`,
  )

  // reverse
  at('reverse')
  const reverse = await runReverse(company, scoped)
  logEvent(jobId, 'reverse', `${reverse.length} competitor teardowns`)

  // competitors — scrape and analyze the pages that win AI citations.
  // The scrape can run for many minutes; per-page progress keeps the job row
  // moving so the dashboard never reads as frozen (observed: a 40-minute
  // silent stage that looked hung while scraping 248 pages).
  at('competitors')
  const competitorAnalysis = await runCompetitors(company, (scraped, total) => {
    at('competitors', total > 0 ? scraped / total : 0)
  })
  logEvent(
    jobId,
    'competitors',
    `${competitorAnalysis.pagesScraped} pages scraped, ${competitorAnalysis.patterns.length} patterns`,
  )

  // report
  at('report')
  const reports = await runReport(company, records, scoped, impact)
  logEvent(jobId, 'report', `${reports.length} PDFs rendered`)

  // actions — skipped in the 'report' scope
  const chain = stagesFor(scope)
  if (chain.includes('actions')) {
    at('actions')
    await runActions(company, scoped, reverse)
    logEvent(jobId, 'actions', 'action plan + playbook stored')
  }

  // pages — 'full' scope only
  if (chain.includes('pages')) {
    at('pages')
    const pageCount = await runPages(company)
    logEvent(jobId, 'pages', `${pageCount} site files rendered`)
  }

  // Completion hooks — the parts that used to be manual and were forgotten:
  // 1. Content-gap analysis (fills the dashboard Gaps tab immediately
  //    instead of waiting for the Sunday cron).
  // 2. Arm the weekly/monthly monitoring suite for this company so the
  //    check-up cadence starts without a manual API call.
  // Both are best-effort: a failure here never fails a finished audit.
  try {
    const gaps = await findContentGaps(company.id)
    logEvent(jobId, 'done', `content gaps analyzed — ${gaps?.length ?? 0} stored`)
  } catch (err) {
    console.warn(`[pipeline] content-gap analysis failed for ${company.id}:`, err)
  }
  try {
    startMonitoring(company.id)
    logEvent(jobId, 'done', 'weekly/monthly monitoring armed')
  } catch (err) {
    console.warn(`[pipeline] monitoring arm failed for ${company.id}:`, err)
  }
  // 3. Tracking baseline from THIS run's stored records (zero extra cost) —
  //    the Tracking tab has data immediately instead of waiting for Monday.
  try {
    const t = await runWeeklyTracking(company.id, { source: 'stored' })
    if (t) logEvent(jobId, 'done', `tracking baseline: ${t.summary}`)
  } catch (err) {
    console.warn(`[pipeline] tracking baseline failed for ${company.id}:`, err)
  }
  // 4. Pre-generate the AI executive summary so the dashboard tab is preset.
  try {
    const s = await ensureAiSummary(company.id)
    logEvent(jobId, 'done', s && !('error' in s) ? 'AI summary pre-generated' : 'AI summary skipped')
  } catch (err) {
    console.warn(`[pipeline] AI summary pregen failed for ${company.id}:`, err)
  }
  // 5. RETRO — the learning loop: distill this run into durable lessons the
  //    NEXT audit (any company) applies in promptgen and action planning.
  try {
    const retro = await runRetro(company, records, scoped, jobId)
    logEvent(jobId, 'done', `retro: ${retro.lessonsStored} lessons stored for future runs`)
  } catch (err) {
    console.warn(`[pipeline] retro failed for ${company.id}:`, err)
  }
  // 6. DATASET — append this client's head-to-toe lifecycle row (niche +
  //    location + avatar + performance + delivery + cost + lessons). Feeds
  //    the retro-framing protocol and our own product improvement.
  try {
    const snap = collectClientSnapshot(company.id, 'audit', jobId)
    if (snap) logEvent(jobId, 'done', `dataset snapshot stored (row #${snap.id})`)
  } catch (err) {
    console.warn(`[pipeline] dataset snapshot failed for ${company.id}:`, err)
  }

  updateJob(jobId, { status: 'done', stage: 'done', progress: 100 })
  logEvent(jobId, 'done', 'workflow complete')
}
