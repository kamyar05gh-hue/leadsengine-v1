/**
 * Backfill the "LeadEngine Data" dataset (client_snapshots).
 *
 * Collects one 'audit'-kind snapshot for every company that already has a
 * score, so the table is populated from the history that already exists
 * instead of starting empty and only filling up from the next audit onward.
 *
 * Usage:
 *   npx tsx scripts/backfill-dataset.mts            # every scored company
 *   npx tsx scripts/backfill-dataset.mts future-media [...ids]
 *   npx tsx scripts/backfill-dataset.mts --all       # include unscored companies
 *   npx tsx scripts/backfill-dataset.mts --csv       # also print the CSV
 */
import { collectClientSnapshot, DATASET_COLUMNS, toCsv } from '../src/agents/datasetCollector.js'
import { latestScore, listCompanies } from '../src/db/repo.js'
import type { ClientSnapshot } from '../src/types.js'

const args = process.argv.slice(2)
const includeUnscored = args.includes('--all')
const printCsv = args.includes('--csv')
const explicitIds = args.filter((a) => !a.startsWith('--'))

const companies = listCompanies()
const targets = (
  explicitIds.length > 0 ? companies.filter((c) => explicitIds.includes(c.id)) : companies
).filter((c) => includeUnscored || latestScore(c.id) !== null)

if (explicitIds.length > 0) {
  for (const id of explicitIds) {
    if (!companies.some((c) => c.id === id)) console.error(`! unknown company: ${id}`)
  }
}

if (targets.length === 0) {
  console.log('nothing to backfill (no company with a score — pass --all to include unscored)')
  process.exit(0)
}

console.log(`backfilling ${targets.length} company/companies…\n`)

const rows: ClientSnapshot[] = []
for (const company of targets) {
  try {
    const row = collectClientSnapshot(company.id, 'audit')
    if (!row) {
      console.error(`! ${company.id}: collector returned null`)
      continue
    }
    rows.push(row)
    console.log(`✓ ${company.id} → client_snapshots row #${row.id}`)
    for (const col of DATASET_COLUMNS) {
      const value = row[col.key]
      const shown =
        typeof value === 'string' && value.length > 160 ? `${value.slice(0, 157)}…` : value
      console.log(`    ${col.group.padEnd(11)} ${col.key.padEnd(24)} ${String(shown ?? '')}`)
    }
    console.log('')
  } catch (err) {
    console.error(`! ${company.id}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`done — ${rows.length} snapshot(s) stored, ${DATASET_COLUMNS.length} columns each`)

if (printCsv) {
  console.log('\n--- CSV ---')
  process.stdout.write(toCsv(rows))
}
