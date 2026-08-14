/**
 * Content gap analyzer — finds prompts where the company is invisible but
 * competitors win, especially when the AI answer itself is weak or generic.
 * Each hit is a content opportunity: a page/FAQ/table we could own.
 *
 * Pure heuristic analysis over stored audit_records — no LLM calls. The
 * format recommender is keyword-based; an LLM judge can later replace
 * `recommendFormat`/`isWeakAnswer` without touching persistence or API.
 */
import {
  getAuditRecords,
  getCompany,
  insertContentGap,
  latestPromptLibrary,
  listContentGaps,
} from '../db/repo.js'
import { aliasPattern, clientPattern } from '../core/regex.js'
import { discoverCompetitors } from '../core/competitors.js'
import type { AuditRecord, Company, ContentGap, ContentGapFormat } from '../types.js'

/** Below this many characters an answer is treated as thin/generic. */
const WEAK_MIN_LENGTH = 400
/** Answers bolding fewer names than this give the user no real shortlist. */
const WEAK_MIN_BOLD_NAMES = 3
/** Phrases that signal a generic, non-committal answer (de/en/fr). */
const GENERIC_RX =
  /es gibt viele|there are many|hängt von|depends on|verschiedene faktoren|several factors|pauschal|generally speaking/i

const BOLD_RX = /\*\*([^*]{2,45})\*\*/g

export interface GapCandidate {
  prompt: string
  reason: string
  recommendedFormat: ContentGapFormat
}

/** Weak/generic answer: thin, nameless, or non-committal. */
export function isWeakAnswer(text: string): boolean {
  if (text.length < WEAK_MIN_LENGTH) return true
  if (GENERIC_RX.test(text)) return true
  const boldNames = new Set([...text.matchAll(BOLD_RX)].map((m) => m[1]))
  return boldNames.size < WEAK_MIN_BOLD_NAMES
}

/** Best content format to win the prompt, from its phrasing. */
export function recommendFormat(prompt: string): ContentGapFormat {
  const p = prompt.toLowerCase()
  if (/\bvs\.?\b|vergleich|compare|comparison|oder besser/.test(p)) return 'comparison'
  if (/kosten|preis|price|cost|gebühr|tarif/.test(p)) return 'table'
  if (/^(wie|was|warum|wann|welche|how|what|why|when|which)\b/.test(p)) return 'faq'
  if (/beste|best |top |liste|list|empfehl|recommend/.test(p)) return 'listicle'
  return 'guide'
}

/**
 * Gap prompts from a record set: company absent, at least one competitor
 * present, answer weak/generic. One candidate per distinct prompt.
 */
export function findGapCandidates(records: AuditRecord[], company: Company): GapCandidate[] {
  const clientRx = clientPattern(company)
  const competitorRx = aliasPattern(company.competitors)
  const discovered = discoverCompetitors(records, company, 20).map((c) => c.name)
  const discoveredRx = aliasPattern(discovered)
  const byPrompt = new Map<string, GapCandidate>()

  for (const r of records) {
    if (!r.ok || !r.text || byPrompt.has(r.prompt)) continue
    if (clientRx.test(r.text)) continue // company visible — not a gap
    const configuredHit = company.competitors.length > 0 && competitorRx.test(r.text)
    const discoveredHit = discovered.length > 0 && discoveredRx.test(r.text)
    if (!configuredHit && !discoveredHit) continue // nobody we track wins here
    if (!isWeakAnswer(r.text)) continue // strong answer — hard to displace

    byPrompt.set(r.prompt, {
      prompt: r.prompt,
      reason:
        `Company not mentioned while competitor(s) are; ` +
        `answer is weak/generic (${r.text.length} chars, ${r.engine}).`,
      recommendedFormat: recommendFormat(r.prompt),
    })
  }
  return [...byPrompt.values()]
}

/**
 * Analyze the company's latest audit records, persist new gap prompts
 * (idempotent per company+prompt), and return the full stored gap list.
 */
export async function findContentGaps(companyId: string): Promise<ContentGap[] | null> {
  const company = getCompany(companyId)
  if (!company) {
    console.warn(`[content-gaps] ${companyId}: unknown company — skipped`)
    return null
  }
  const library = latestPromptLibrary(companyId)
  if (!library) {
    console.warn(`[content-gaps] ${companyId}: no prompt library — skipped`)
    return null
  }

  const candidates = findGapCandidates(getAuditRecords(companyId, library.id), company)
  for (const c of candidates) {
    insertContentGap({
      companyId,
      prompt: c.prompt,
      reason: c.reason,
      recommendedFormat: c.recommendedFormat,
    })
  }

  const gaps = listContentGaps(companyId)
  console.log(`[content-gaps] ${companyId}: ${candidates.length} candidates, ${gaps.length} stored`)
  return gaps
}
