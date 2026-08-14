/**
 * Stage: reverse — competitor teardown for the top N by mention share
 * (default 5 — the deliverable contract is "client + 5 competitors").
 * Teardowns run in parallel; each is independent research labor.
 * Idempotent-ish: skips competitors that already have a stored teardown
 * for this company (teardowns don't expire within a job run).
 */
import { reverseEngineer } from '../../agents/reverseEngineer.js'
import { isPlausibleCompanyName } from '../../core/competitors.js'
import { insertReverseReport, listReverseReports } from '../../db/repo.js'
import type { Company, ReverseReport, ScopedScore } from '../../types.js'

export async function runReverse(
  company: Company,
  scoped: ScopedScore,
  topN = Number(process.env.LE_REVERSE_TOP_N ?? 5),
): Promise<ReverseReport[]> {
  // Re-validate cached rows against the current name-quality rules — a prior
  // discovery-logic bug could have stored teardowns for service-noun "brands"
  // (e.g. "Employer Branding") that this run's competitor list no longer
  // produces; those cache hits must not be served just because they exist.
  const existing = new Map(
    listReverseReports(company.id)
      .filter((r) => isPlausibleCompanyName(r.competitor))
      .map((r) => [r.competitor, r]),
  )
  const targets = scoped.combined.competitors.slice(0, topN)
  const results = await Promise.all(
    targets.map(async (comp) => {
      const cached = existing.get(comp.name)
      if (cached) return cached
      const rep = await reverseEngineer(comp, company).catch((err) => {
        console.warn(`[reverse] teardown failed for ${comp.name}:`, err)
        return null
      })
      if (rep) insertReverseReport(company.id, rep)
      return rep
    }),
  )
  return results.filter((r): r is ReverseReport => r !== null)
}
