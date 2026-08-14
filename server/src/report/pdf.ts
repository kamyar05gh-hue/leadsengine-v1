/**
 * pdf.ts — report orchestrator.
 *
 * Renders the 6-page Dark Executive Report (report/executive/) for ONE scope
 * in DE + EN into PATHS.reports/<companyId>/, plus the .md companions
 * (narrative.toMarkdown). Pipeline: measured data → self-contained HTML with
 * TS-generated inline-SVG charts → headless-Chromium PDF (Playwright).
 * Pure TypeScript end to end — no Python dependency.
 */
import fs from 'node:fs'
import path from 'node:path'

import type {
  AuditRecord,
  AuditScore,
  Company,
  CompetitorPage,
  ImpactModel,
  ReportEvidence,
  ReportLang,
  ReportSections,
  Scope,
  SentimentReport,
} from '../types.js'
import { PATHS } from '../config.js'
import { renderExecutiveReport, withBrowser } from './executive/index.js'
import { toMarkdown, sanitize } from './narrative.js'
import { buildEvidenceFromRecords } from '../agents/evidenceExtractor.js'
import { analyzeSupplyChainFromRecords } from '../agents/citationSupplyChain.js'
import { analyzeAnswerShapesFromRecords } from '../agents/answerShapeAnalyzer.js'
import {
  latestActionPlan,
  listCompetitorPages,
  listReverseReports,
  listVerifiedCitationsByCompany,
  sentimentTrendByDay,
} from '../db/repo.js'

/** Well-known competitor regexes (port of BRAND_RX in pdf_final.py). The
 * caller's discovered competitors are matched against these first; anything
 * unknown falls back to an escaped literal of its name. */
const KNOWN_BRAND_RX: Record<string, string> = {
  'Schein Dental': 'schein',
  Plandent: 'plandent',
  KaVo: '\\bkavo\\b',
  Sirona: 'sirona|dentsply',
  Planmeca: 'planmeca',
  'dental bauer': 'dental[\\s-]?bauer',
  'Kaladent AG': 'kaladent',
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build brand name -> regex source from the discovered competitors. */
export function buildBrands(score: AuditScore): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of score.competitors) {
    out[c.name] = KNOWN_BRAND_RX[c.name] ?? escapeRx(c.name)
  }
  return out
}

function slug(name: string): string {
  return name.replace(/\s+/g, '_')
}

/** URL → actuallyCitesBrand for every verified citation of the company. */
function verificationByUrl(companyId: string): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const v of listVerifiedCitationsByCompany(companyId)) {
    map[v.url] = v.actuallyCitesBrand
  }
  return map
}

/** Sentiment breakdown over the scope's ok answers + company-wide trend.
 * Returns undefined when no answer carries a sentiment label — the report
 * then skips the block entirely. */
function buildSentiment(companyId: string, records: AuditRecord[]): SentimentReport | undefined {
  const labeled = records.filter((r) => r.ok && r.sentiment !== undefined)
  if (labeled.length === 0) return undefined
  return {
    total: labeled.length,
    positive: labeled.filter((r) => r.sentiment === 'positive').length,
    neutral: labeled.filter((r) => r.sentiment === 'neutral').length,
    negative: labeled.filter((r) => r.sentiment === 'negative').length,
    trend: sentimentTrendByDay(companyId),
  }
}

/** Latest scrape per URL (input is newest-first, so first occurrence wins). */
function dedupeByUrl(pages: CompetitorPage[]): CompetitorPage[] {
  const seen = new Set<string>()
  return pages.filter((p) => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })
}

export interface RenderedReport {
  path: string
  lang: ReportLang
}

/**
 * Render DE + EN executive PDFs (and .md companions) for one scope.
 * `records` must already be filtered to this scope by the caller.
 * `nameSuffix` (the persona family 'general' | 'avatar', or a location slug)
 * is appended to the generated filenames before the lang/extension:
 * `..._<scope>_<suffix>_DE.pdf`.
 */
export async function renderScope(
  company: Company,
  records: AuditRecord[],
  scopeScore: AuditScore,
  impact: ImpactModel,
  sections: Record<ReportLang, ReportSections>,
  scope: Scope,
  nameSuffix?: string,
): Promise<RenderedReport[]> {
  const dir = path.join(PATHS.reports, company.id)
  fs.mkdirSync(dir, { recursive: true })
  const brands = buildBrands(scopeScore)
  // Evidence layer: built from the SAME scope-filtered records as the rest
  // of the report, so every exhibit reconciles with the headline metrics.
  const evidence: ReportEvidence = {
    bundle: buildEvidenceFromRecords(records, company),
    supplyChain: analyzeSupplyChainFromRecords(records, company),
    shapes: analyzeAnswerShapesFromRecords(records, company),
    // URL → actuallyCitesBrand; evidence exhibits get their ✓/✗ from this
    verification: verificationByUrl(company.id),
  }
  // Sentiment block: breakdown over THIS scope's ok answers; the trend is
  // longitudinal by nature, so it spans all audits.
  const sentiment = buildSentiment(company.id, records)
  // Latest scrape per URL (listCompetitorPages is newest first).
  const competitorPages = dedupeByUrl(listCompetitorPages(company.id))
  // Stored reverse-engineering teardowns — the "why they win" + tactics
  // evidence behind every competitor deep-dive page.
  const teardowns = listReverseReports(company.id)
  // Roadmap fuel: top page specs of the latest action plan, if one exists.
  const plan = latestActionPlan(company.id)
  const actionPages = plan?.pages
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((p) => ({ title: p.title, targetQuery: p.targetQuery }))

  const out: RenderedReport[] = []
  await withBrowser(async (browser) => {
    for (const lang of ['de', 'en'] as const) {
      const clean = sanitize(sections[lang])
      const base = path.join(
        dir,
        `LeadEngine_Audit_${slug(company.name)}_${scope}${nameSuffix ? `_${nameSuffix}` : ''}_${lang.toUpperCase()}`,
      )
      await renderExecutiveReport(
        browser,
        {
          company,
          records,
          score: scopeScore,
          impact,
          sections: clean,
          evidence,
          competitorPages,
          teardowns,
          brands,
          lang,
          scope,
          // nameSuffix is the persona family ('general' | 'avatar') — the
          // report labels its cover kicker + footers with it.
          variant: nameSuffix ?? 'general',
          ...(sentiment ? { sentiment } : {}),
          ...(actionPages && actionPages.length > 0 ? { actionPages } : {}),
        },
        `${base}.pdf`,
      )
      fs.writeFileSync(`${base}.md`, toMarkdown(scopeScore, impact, company, clean, lang), 'utf8')
      out.push({ path: `${base}.pdf`, lang })
    }
  })
  return out
}
