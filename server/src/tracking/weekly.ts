/**
 * Weekly measurement loop — the Profound baseline-advancing pattern:
 * re-run the audit with the SAME prompt library version, diff against the
 * previous baseline, advance the baseline, store trend rows, compose a
 * briefing and (optionally) push it to the company's Slack webhook.
 *
 * Runs on WEEKLY_CRON for every registered company.
 */
import cron from 'node-cron'
import { WEEKLY_CRON } from '../config.js'
import {
  getAuditRecords,
  latestPromptLibrary,
  latestScore,
  listCompanies,
} from '../db/repo.js'
import { runAudit } from '../workflow/stages/audit.js'
import { runScore } from '../workflow/stages/score.js'
import { kimiGenerate } from '../providers/index.js'
import type { Company, ScopedScore } from '../types.js'

interface Delta {
  metric: string
  before: number
  after: number
}

function diff(before: ScopedScore, after: ScopedScore): Delta[] {
  const out: Delta[] = []
  for (const scope of ['regional', 'dach', 'combined'] as const) {
    for (const metric of ['mentionRate', 'citationRate', 'sov'] as const) {
      out.push({
        metric: `${scope}.${metric}`,
        before: before[scope].overall[metric],
        after: after[scope].overall[metric],
      })
    }
  }
  return out
}

async function composeBriefing(company: Company, deltas: Delta[]): Promise<string> {
  const lines = deltas
    .map((d) => `${d.metric}: ${d.before} → ${d.after} (${(d.after - d.before).toFixed(1)})`)
    .join('\n')
  const res = await kimiGenerate(
    `You are the LeadEngine weekly briefing writer. One Slack message, German, scannable in 30 seconds: what moved in this company's AI visibility this week, driven by what, and whether action is needed. No recommendations beyond one line. Data:\nCompany: ${company.name}\n${lines}`,
    800,
  )
  return res.text ?? `Wöchentliches Briefing ${company.name}\n${lines}`
}

async function sendSlack(webhook: string, text: string): Promise<void> {
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.warn('[weekly] slack webhook failed:', err)
  }
}

/** Run one company's weekly cycle. Exported for CLI/manual triggering. */
export async function weeklyCycle(company: Company): Promise<void> {
  const library = latestPromptLibrary(company.id)
  if (!library) {
    console.log(`[weekly] ${company.id}: no prompt library yet — skipped`)
    return
  }
  const before = latestScore(company.id)?.payload ?? null
  const records = await runAudit(company, library)
  if (records.filter((r) => r.ok).length === 0) {
    console.warn(`[weekly] ${company.id}: all calls failed — baseline NOT advanced`)
    return
  }
  const { scoped } = runScore(company, library, records)
  if (before) {
    const briefing = await composeBriefing(company, diff(before, scoped))
    console.log(`[weekly] ${company.id} briefing:\n${briefing}`)
    if (company.slackWebhook) await sendSlack(company.slackWebhook, briefing)
  } else {
    console.log(`[weekly] ${company.id}: first baseline stored`)
  }
}

/** Start the cron schedule. Called once from index.ts. */
export function startWeeklyCron(): void {
  cron.schedule(WEEKLY_CRON, () => {
    console.log('[weekly] cycle starting')
    for (const company of listCompanies()) {
      weeklyCycle(company).catch((err) =>
        console.warn(`[weekly] ${company.id} failed:`, err),
      )
    }
  })
  console.log(`[weekly] cron armed: ${WEEKLY_CRON}`)
}

/** Read stored records for a company (used by CLI inspection). */
export function weeklyRecords(companyId: string): ReturnType<typeof getAuditRecords> {
  const library = latestPromptLibrary(companyId)
  if (!library) return []
  return getAuditRecords(companyId, library.id)
}
