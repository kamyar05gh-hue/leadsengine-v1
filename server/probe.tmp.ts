import { allAuditRecords, getCompany, listReverseReports, listCompetitorPages } from './src/db/repo.js'
import { firstIdx } from './src/core/scoring.js'

const cid = 'future-media'
const c = getCompany(cid)!
console.log('configured competitors', JSON.stringify(c.competitors))
const recs = allAuditRecords(cid)
const brands = listReverseReports(cid).map((r) => r.competitor)
for (const persona of ['general', 'avatar'] as const) {
  const sel = recs.filter((r) => r.persona === persona && r.ok)
  console.log('== persona', persona, sel.length)
  for (const b of brands) {
    const hits = sel.filter((r) => firstIdx(r.text ?? '', [b]) !== null)
    console.log('  ', b, hits.length, JSON.stringify([...new Set(hits.map((h) => h.engine))]))
  }
  // citations to competitor domains
  for (const b of ['sortlist', 'webrepublic', 'kingfluencers', 'webella', 'nordfabrik']) {
    const cites = sel.filter((r) => r.citedUrls.some((u) => u.toLowerCase().includes(b)))
    if (cites.length) console.log('   cite', b, cites.length)
  }
}
// pages for the 5
const pages = listCompetitorPages(cid)
for (const b of ['sortlist', 'webrepublic', 'kingfluencers', 'webella', 'nordfabrik']) {
  const ps = pages.filter((p) => p.competitorDomain.includes(b))
  console.log('PAGES', b, ps.length)
  for (const p of ps.slice(0, 3)) {
    console.log('   ', p.url, '|', p.answerFormat, '|', p.wordCount, '| faq', p.hasFaq, '| tbl', p.hasComparisonTable, '| stats', p.hasStatistics, '| schema', (p.schemaMarkup ?? '').slice(0, 60).replace(/\s+/g, ' '))
  }
}
