/**
 * Stage: actions — parallel planning agents → ActionPlan + designed PDF
 * playbook (DE + EN, lavender "mission briefing" family — see
 * report/executive/actionplan.ts). Replaces the former raw .md playbook.
 */
import { planActions } from '../../agents/actionPlanner.js'
import { insertActionPlan, insertReport } from '../../db/repo.js'
import { renderActionPlanPdfs } from '../../report/executive/actionplan.js'
import { PATHS } from '../../config.js'
import fs from 'node:fs'
import path from 'node:path'
import type { Company, ReverseReport, ScopedScore } from '../../types.js'

export async function runActions(
  company: Company,
  scoped: ScopedScore,
  reverse: ReverseReport[],
): Promise<number> {
  const plan = await planActions(company, scoped, reverse)
  const planId = insertActionPlan(company.id, plan)

  const dir = path.join(PATHS.reports, company.id)
  fs.mkdirSync(dir, { recursive: true })
  const rendered = await renderActionPlanPdfs(company, plan, reverse, dir)
  for (const r of rendered) {
    insertReport({
      companyId: company.id,
      scope: 'regional', // playbook is scope-agnostic; column reuse, documented
      lang: r.lang,
      kind: 'playbook',
      path: r.path,
      createdAt: new Date().toISOString(),
    })
  }
  return planId
}
