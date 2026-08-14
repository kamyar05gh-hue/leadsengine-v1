/**
 * LeadEngine server bootstrap: config → db → orphan-job recovery → API →
 * weekly cron. The workflow itself is triggered per company via
 * POST /api/companies (or /api/audits from the dashboard).
 */
import { connect } from './db/client.js'
import { startApi } from './api/server.js'
import { startWeeklyCron } from './tracking/weekly.js'
import { retryWorkflow } from './workflow/pipeline.js'
import { startMonitoring } from './cron/scheduler.js'
import { listCompanies, latestScore } from './db/repo.js'
import { MOCK_PROVIDERS, PATHS } from './config.js'
import fs from 'node:fs'

/**
 * Resume jobs orphaned by a previous process death. A job row stuck in
 * 'running'/'queued' with no executor would otherwise sit at its last
 * progress forever (observed: promptgen 5% for six hours). Stages are
 * idempotent, so re-entering the pipeline never re-pays for completed calls.
 */
function resumeOrphanedJobs(): void {
  if (process.env.LE_RESUME_ORPHANS === '0') {
    console.log('[boot] orphan resume disabled (LE_RESUME_ORPHANS=0)')
    return
  }
  const rows = connect()
    .prepare("SELECT id, stage, progress FROM jobs WHERE status IN ('running', 'queued')")
    .all() as unknown as { id: string; stage: string; progress: number }[]
  for (const row of rows) {
    console.warn(
      `[boot] resuming orphaned job ${row.id} (was ${row.stage} @ ${row.progress}%)`,
    )
    try {
      retryWorkflow(row.id)
    } catch (err) {
      console.error(`[boot] failed to resume job ${row.id}:`, err)
    }
  }
  if (rows.length === 0) console.log('[boot] no orphaned jobs')
}

/**
 * Re-arm the weekly/monthly monitoring suite for every audited company.
 * The scheduler's task registry is in-memory only — before this, every
 * server restart silently killed all armed monitors and the check-up
 * cadence (weekly tracking, digests, gap/citation/competitor watches)
 * stopped without anyone noticing. Companies without a completed audit
 * are skipped: their monitors would only log "no data" noise.
 */
function armMonitoringForAudited(): void {
  if (process.env.LE_AUTO_MONITORING === '0') {
    console.log('[boot] auto-monitoring disabled (LE_AUTO_MONITORING=0)')
    return
  }
  let armed = 0
  for (const company of listCompanies()) {
    if (!latestScore(company.id)) continue
    try {
      startMonitoring(company.id)
      armed++
    } catch (err) {
      console.warn(`[boot] monitoring arm failed for ${company.id}:`, err)
    }
  }
  console.log(`[boot] monitoring armed for ${armed} audited compan${armed === 1 ? 'y' : 'ies'}`)
}

async function main(): Promise<void> {
  fs.mkdirSync(PATHS.reports, { recursive: true })
  connect()
  console.log('[boot] database ready')
  if (MOCK_PROVIDERS) console.log('[boot] MOCK PROVIDERS — no live API calls will be made')
  resumeOrphanedJobs()
  armMonitoringForAudited()
  await startApi()
  startWeeklyCron()
}

// The server must never die from a stray async failure inside an agent or a
// provider call — log loudly and keep serving. Job-level failures are already
// caught and written to the job row by pipeline.startWorkflow.
process.on('unhandledRejection', (reason) => {
  console.error('[guard] unhandled rejection (server kept alive):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[guard] uncaught exception (server kept alive):', err)
})

main().catch((err) => {
  console.error('[boot] fatal:', err)
  process.exit(1)
})
