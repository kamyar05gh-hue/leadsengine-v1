/**
 * Monitoring scheduler — per-company node-cron jobs for the monitors.
 *
 * Nothing starts automatically: jobs are armed via startMonitoring()
 * (POST /api/monitoring/start/:companyId) and torn down via stopMonitoring().
 * All job bodies are fire-and-forget async with their own error handling, so
 * one failing company never kills the schedule.
 */
import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { runWeeklyTracking } from '../agents/weeklyTracker.js'
import { monitorCitationSources } from '../agents/citationMonitor.js'
import { findContentGaps } from '../agents/contentGapAnalyzer.js'
import { watchCompetitors } from '../agents/competitorWatcher.js'
import { refreshClientPrompts } from '../agents/promptRefresher.js'
import { checkContentFreshness } from '../agents/freshnessChecker.js'
import { generateDigest } from '../report/digest.js'

/** Cron expressions (local time). Overridable per deployment via env. */
export const MONITORING_SCHEDULES = {
  weeklyTracking: process.env.LE_CRON_WEEKLY_TRACKING ?? '0 9 * * 1', // Mon 09:00
  citationMonitor: process.env.LE_CRON_CITATIONS ?? '0 0 * * *', // daily 00:00
  contentGaps: process.env.LE_CRON_GAPS ?? '0 18 * * 0', // Sun 18:00
  competitorWatch: process.env.LE_CRON_COMPETITORS ?? '0 3 * * *', // daily 03:00
  promptRefresh: process.env.LE_CRON_PROMPT_REFRESH ?? '30 4 */3 * *', // every 3 days 04:30
  digestWeekly: process.env.LE_CRON_DIGEST_WEEKLY ?? '0 8 * * 1', // Mon 08:00
  digestMonthly: process.env.LE_CRON_DIGEST_MONTHLY ?? '15 8 1 * *', // 1st of month 08:15
  freshness: process.env.LE_CRON_FRESHNESS ?? '0 7 * * 0', // Sun 07:00
} as const

type MonitorName = keyof typeof MONITORING_SCHEDULES

type MonitorFn = (companyId: string) => Promise<unknown>

const MONITORS: Record<MonitorName, MonitorFn> = {
  weeklyTracking: runWeeklyTracking,
  citationMonitor: monitorCitationSources,
  contentGaps: findContentGaps,
  competitorWatch: watchCompetitors,
  promptRefresh: refreshClientPrompts,
  digestWeekly: (companyId) => generateDigest(companyId, 'weekly'),
  digestMonthly: (companyId) => generateDigest(companyId, 'monthly'),
  freshness: checkContentFreshness,
}

/** companyId → its armed tasks. */
const running = new Map<string, ScheduledTask[]>()

function arm(name: MonitorName, companyId: string): ScheduledTask {
  const expression = MONITORING_SCHEDULES[name]
  return cron.schedule(expression, () => {
    console.log(`[scheduler] ${name} starting for ${companyId}`)
    MONITORS[name](companyId)
      .then(() => console.log(`[scheduler] ${name} done for ${companyId}`))
      .catch((err) => console.warn(`[scheduler] ${name} failed for ${companyId}:`, err))
  })
}

/**
 * Arm all monitors for a company. Idempotent: starting an already-
 * monitored company is a no-op (returns started:false).
 */
export function startMonitoring(companyId: string): { started: boolean; jobs: MonitorName[] } {
  if (running.has(companyId)) {
    console.log(`[scheduler] ${companyId}: monitoring already running`)
    return { started: false, jobs: Object.keys(MONITORS) as MonitorName[] }
  }
  const tasks = (Object.keys(MONITORS) as MonitorName[]).map((name) => arm(name, companyId))
  running.set(companyId, tasks)
  console.log(`[scheduler] ${companyId}: ${tasks.length} monitor jobs armed`)
  return { started: true, jobs: Object.keys(MONITORS) as MonitorName[] }
}

/** Stop and destroy all monitor jobs for a company. */
export function stopMonitoring(companyId: string): { stopped: boolean } {
  const tasks = running.get(companyId)
  if (!tasks) return { stopped: false }
  for (const task of tasks) {
    task.stop()
    // destroy() exists only on newer node-cron builds — stop() suffices on v3.
    if (typeof task.destroy === 'function') task.destroy()
  }
  running.delete(companyId)
  console.log(`[scheduler] ${companyId}: monitoring stopped`)
  return { stopped: true }
}

/** Company ids with armed monitoring (for status/debug endpoints). */
export function monitoredCompanies(): string[] {
  return [...running.keys()]
}
