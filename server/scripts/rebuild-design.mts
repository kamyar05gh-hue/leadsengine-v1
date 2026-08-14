/**
 * Verification script: rebuild the design profile for one company against
 * the live site and generate one real landing page with the new pipeline.
 *
 * Usage: npx tsx scripts/rebuild-design.mts <companyId> <outDir>
 */
import fs from 'node:fs'
import path from 'node:path'
import { clearClientDesignCache, cloneClientDesign } from '../src/agents/designCloner.js'
import { buildPage } from '../src/agents/pageBuilder.js'
import { getCompany } from '../src/db/repo.js'
import type { PageSpec } from '../src/types.js'

const companyId = process.argv[2] ?? 'future-media'
const outDir = process.argv[3] ?? '.'

const company = getCompany(companyId)
if (!company) {
  console.error(`company ${companyId} not found`)
  process.exit(1)
}

clearClientDesignCache(companyId)
console.log('[1/3] extracting live design (Playwright + vision)…')
const design = await cloneClientDesign(company)
console.log('rendered design:', design.rendered ? 'OK' : 'MISSING')
console.log('vision notes:', design.visionNotes ? `${design.visionNotes.length} chars` : 'MISSING')
console.log('master prompt:', design.masterPrompt ? `${design.masterPrompt.length} chars` : 'MISSING')
if (design.masterPrompt) {
  fs.writeFileSync(path.join(outDir, 'master-prompt.txt'), design.masterPrompt, 'utf8')
}

console.log('[2/3] building one real page…')
const spec: PageSpec = {
  title: 'Was kostet Social Media Marketing in Bern?',
  slug: '/wissen/social-media-marketing-kosten-bern',
  targetQuery: 'Social Media Marketing Kosten Bern',
  answerCapsule:
    'Social Media Marketing in Bern kostet je nach Umfang zwischen wenigen hundert und mehreren tausend Franken pro Monat. Future Media aus Bern kombiniert organische Reichweite, TikTok Ads, Instagram Ads und Facebook Ads zu einer Strategie mit messbaren Resultaten — Ergebnisse in 90 Tagen.',
  schemaType: 'FAQPage',
  priority: 1,
  status: 'done',
}
const siblings: PageSpec[] = [
  spec,
  { ...spec, slug: '/wissen/tiktok-agentur-schweiz', title: 'TikTok Agentur Schweiz', targetQuery: 'TikTok Agentur Schweiz' },
  { ...spec, slug: '/wissen/mitarbeitergewinnung-social-media', title: 'Mitarbeitergewinnung über Social Media', targetQuery: 'Mitarbeitergewinnung Social Media' },
]
const page = await buildPage(company, spec, '', siblings)
const outFile = path.join(outDir, 'generated-page.html')
fs.writeFileSync(outFile, page.html, 'utf8')
console.log('[3/3] wrote', outFile)
