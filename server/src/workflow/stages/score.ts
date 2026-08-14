/**
 * Stage: score — turn raw audit records into metrics.
 * Pure computation, no network: per-scope + combined scores, trend rows.
 */
import { computeImpact } from '../../core/impact.js'
import { scoreScoped } from '../../core/scoring.js'
import { insertScore, insertTrend } from '../../db/repo.js'
import type {
  AuditRecord,
  Company,
  ImpactModel,
  PromptLibrary,
  ScopedScore,
} from '../../types.js'

export interface ScoreResult {
  scoped: ScopedScore
  impact: ImpactModel
}

export function runScore(
  company: Company,
  library: PromptLibrary,
  records: AuditRecord[],
): ScoreResult {
  const scoped = scoreScoped(records, company)
  insertScore(company.id, library.id, scoped)
  insertTrend(company.id, 'regional', scoped.regional)
  insertTrend(company.id, 'dach', scoped.dach)
  const impact = computeImpact(scoped.combined.overall, records, company)
  return { scoped, impact }
}
