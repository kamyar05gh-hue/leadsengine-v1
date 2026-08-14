/**
 * Manual ops CLI — run individual stages without the API.
 *
 * Usage:
 *   npm run stage -- --company <id> --stage promptgen|audit|score|report|reverse|actions|weekly
 *   npm run stage -- --add '{"name":"...","sector":"...","location":"...","website":"..."}'
 *
 * Mock dry run (zero network):
 *   LE_MOCK_PROVIDERS=1 npm run stage -- --company demo --stage all
 */
import { getCompany } from './db/repo.js'
import { latestPromptLibrary, getAuditRecords, latestScore, listReverseReports } from './db/repo.js'
import { startWorkflow } from './workflow/pipeline.js'
import { runPromptgen } from './workflow/stages/promptgen.js'
import { runAudit } from './workflow/stages/audit.js'
import { runScore } from './workflow/stages/score.js'
import { runReport } from './workflow/stages/report.js'
import { runReverse } from './workflow/stages/reverse.js'
import { runActions } from './workflow/stages/actions.js'
import { runPages } from './workflow/stages/pages.js'
import { weeklyCycle } from './tracking/weekly.js'
import type { Company, NewCompanyInput } from './types.js'

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : null
}

async function main(): Promise<void> {
  const add = arg('--add')
  if (add) {
    const input = JSON.parse(add) as NewCompanyInput
    const job = startWorkflow(input)
    console.log(`workflow started — job ${job.id} (poll GET /api/jobs/${job.id})`)
    return
  }

  const companyId = arg('--company')
  const stage = arg('--stage') ?? 'all'
  if (!companyId) {
    console.error('usage: --company <id> --stage <name> | --add <json>')
    process.exit(1)
  }
  const company = getCompany(companyId) as Company | null
  if (!company) {
    console.error(`company '${companyId}' not found`)
    process.exit(1)
  }

  const need = (s: string) => stage === 'all' || stage === s

  if (need('weekly')) {
    await weeklyCycle(company)
    return
  }

  let library = latestPromptLibrary(company.id)
  if (need('promptgen') || !library) {
    console.log('[stage] promptgen')
    library = await runPromptgen(company, need('promptgen') && stage !== 'all')
    console.log(`  library v${library.version}: ${library.items.length} prompts`)
  }

  let records = getAuditRecords(company.id, library.id)
  if (need('audit') || records.length === 0) {
    console.log('[stage] audit')
    records = await runAudit(company, library, (d, t) => {
      if (d % 20 === 0 || d === t) console.log(`  ${d}/${t}`)
    })
    console.log(`  ${records.filter((r) => r.ok).length}/${records.length} ok`)
  }

  let score = latestScore(company.id)?.payload ?? null
  let impact = null as ReturnType<typeof runScore>['impact'] | null
  if (need('score') || !score) {
    console.log('[stage] score')
    const res = runScore(company, library, records)
    score = res.scoped
    impact = res.impact
    console.log(
      `  combined: mention ${score.combined.overall.mentionRate}% · citation ${score.combined.overall.citationRate}% · SoV ${score.combined.overall.sov}%`,
    )
  } else {
    impact = runScore(company, library, records).impact
  }

  if (need('report')) {
    console.log('[stage] report')
    const files = await runReport(company, records, score, impact)
    for (const f of files) console.log(`  ${f.path}`)
  }

  let reverse = listReverseReports(company.id)
  if (need('reverse')) {
    console.log('[stage] reverse')
    reverse = await runReverse(company, score)
    console.log(`  ${reverse.length} teardowns`)
  }

  if (need('actions')) {
    console.log('[stage] actions')
    const planId = await runActions(company, score, reverse)
    console.log(`  action plan #${planId}`)
  }

  if (need('pages')) {
    console.log('[stage] pages')
    const n = await runPages(company)
    console.log(`  ${n} site files`)
  }

  console.log('done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
