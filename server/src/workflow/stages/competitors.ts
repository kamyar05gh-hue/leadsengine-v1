/**
 * Stage: competitors — competitor content analysis.
 *
 * Runs the competitorAnalyzer agent: find cited domains that co-occur with
 * competitor brands, scrape their top pages, analyze content structure and
 * GEO signals (schema, FAQ, comparison tables, statistics), persist to
 * competitor_pages, and distill the cross-page patterns. The patterns feed
 * the report's competitor section.
 *
 * Per-page scrape failures are logged and skipped inside the agent, so one
 * broken competitor site never fails the stage.
 */
import { analyzeCompetitors } from '../../agents/competitorAnalyzer.js'
import type { CompetitorAnalysisSummary } from '../../agents/competitorAnalyzer.js'
import type { Company } from '../../types.js'

/**
 * Analyze the competitor pages that win AI citations for this company.
 * Returns the analysis summary; an unknown company (cannot happen here —
 * the pipeline resolved the company already) degrades to a zeroed summary
 * instead of failing the job.
 */
export async function runCompetitors(
  company: Company,
  onProgress: (scraped: number, total: number) => void = () => {},
): Promise<CompetitorAnalysisSummary> {
  const summary = await analyzeCompetitors(company.id, onProgress)
  return summary ?? { competitorsAnalyzed: 0, pagesScraped: 0, patterns: [] }
}
