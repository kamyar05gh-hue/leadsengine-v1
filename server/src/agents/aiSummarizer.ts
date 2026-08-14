/**
 * AI summarizer — the executive summary shown on the dashboard's AI Summary
 * tab. Generated ONCE per audited state (cache key = libraryId|score
 * timestamp) and persisted in ai_summaries, so:
 *   - the pipeline pre-generates it at audit completion (the tab is preset —
 *     no button press, no on-demand wait, no per-visit cost);
 *   - the API serves it from the DB and only regenerates when a NEW audit
 *     produced a new score (the old in-memory cache died on every restart
 *     and forced paid regenerations).
 */
import { kimiGenerate } from '../providers/index.js'
import {
  getAiSummary,
  getCompany,
  latestActionPlan,
  latestScore,
  saveAiSummary,
} from '../db/repo.js'

export interface AiSummaryResult {
  companyId: string
  summary: string
  generatedAt: string
  cached: boolean
}

function buildPrompt(companyId: string): { prompt: string; cacheKey: string } | null {
  const company = getCompany(companyId)
  if (!company) return null
  const score = latestScore(companyId)
  if (!score) return null
  const sc = score.payload.combined
  const plan = latestActionPlan(companyId)
  const prompt = `You are a senior GEO/AEO strategist writing for a client dashboard. Write an executive AI-visibility summary in ${company.language === 'en' ? 'English' : 'German (Swiss standard: use ä/ö/ü normally, ss instead of ß)'}.

CLIENT: ${company.name} (${company.sector}, ${company.locations.join(' & ')})
AVATAR: ${company.buyerPersona || 'n/a'}
METRICS (measured over ${sc.overall.runsOk} AI-engine answers): mention rate ${sc.overall.mentionRate}%, own-domain citation rate ${sc.overall.citationRate}%, share of voice ${sc.overall.sov}%, avg rank when mentioned ${sc.overall.avgRank ?? 'n/a'}, strongest competitor SoV ${sc.overall.topCompetitorSov}%.
PER ENGINE: ${Object.entries(sc.perEngine).map(([e, s]) => `${e}: mention ${s?.mentionRate}% / citation ${s?.citationRate}%`).join(' · ')}
COMPETITORS SEEN IN ANSWERS: ${sc.competitors.map((c) => c.name).join(', ') || 'none'}
TOP CITED DOMAINS: ${sc.topCitedDomains.slice(0, 6).map((d) => d.domain).join(', ')}
TOP ACTIONS: ${plan ? plan.pages.slice(0, 3).map((p) => p.title).join(' | ') : 'n/a'}

FORMAT (markdown, max 220 words): one bold verdict sentence; then sections "**Wo Sie stehen**", "**Wer gewinnt**", "**Was jetzt zu tun ist**" (or English equivalents) with 2-3 short bullets each, every bullet leading with a concrete number or name. No fluff, no invented data.`
  return { prompt, cacheKey: `${score.libraryId}|${score.createdAt}` }
}

/**
 * Return the summary for the company's current audited state, generating
 * and persisting it only when the state changed since the stored one.
 * Null when the company or its score does not exist; throws never — LLM
 * failures surface as an Error result for the caller to map to a 502.
 */
export async function ensureAiSummary(
  companyId: string,
): Promise<AiSummaryResult | { error: string } | null> {
  const built = buildPrompt(companyId)
  if (!built) return null
  const stored = getAiSummary(companyId)
  if (stored && stored.cacheKey === built.cacheKey) {
    return {
      companyId,
      summary: stored.summary,
      generatedAt: stored.generatedAt,
      cached: true,
    }
  }
  const res = await kimiGenerate(built.prompt, 1200)
  if (!res.ok || !res.text) {
    return { error: `summary generation failed: ${res.error ?? 'empty'}` }
  }
  const generatedAt = new Date().toISOString()
  saveAiSummary({ companyId, cacheKey: built.cacheKey, summary: res.text, generatedAt })
  return { companyId, summary: res.text, generatedAt, cached: false }
}
