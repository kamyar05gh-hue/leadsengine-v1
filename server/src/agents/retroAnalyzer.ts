/**
 * Retro analyzer — the platform's learning loop (few-shot + retro framing).
 *
 * Runs once at the end of every completed audit. It looks back over the
 * whole run — which prompt shapes actually earned mentions/citations, which
 * produced nothing, what the citation supply chain rewarded, what went wrong
 * operationally — and distills durable lessons into the `learnings` table.
 *
 * The next audit (for ANY company) retrieves those lessons:
 *   - promptgen injects prompt_pattern lessons as few-shot exemplars and
 *     pitfall lessons as guardrails, so prompt libraries start from what has
 *     already been measured to work in this sector instead of from zero;
 *   - the action planner injects insight/action lessons so recommendations
 *     compound across clients.
 *
 * Two extraction mechanisms, deliberately layered:
 *   1. DETERMINISTIC — winning/losing prompt texts are computed from the
 *      scored records (no LLM opinion involved). These become
 *      prompt_pattern evidence verbatim: real few-shot data.
 *   2. DISTILLED — one Kimi call generalizes the run into 3-6 transferable
 *      lessons (why those prompts won, what the supply chain rewards, what
 *      to avoid). Anything vague or non-transferable is dropped by schema
 *      + length guards.
 *
 * Failure-tolerant by contract: any error logs a warning and returns — the
 * retro step must never fail a finished audit.
 */
import { z } from 'zod'
import { jsonAgent } from './jsonAgent.js'
import { sectorKeyOf, upsertLearning } from '../db/repo.js'
import { firstIdx } from '../core/scoring.js'
import { brandCited } from '../core/citations.js'
import type { AuditRecord, Company, ScopedScore } from '../types.js'

/** Max winning/losing exemplar prompts stored per run. */
const MAX_EXEMPLARS = 5

const LessonSchema = z.object({
  kind: z.enum(['prompt_pattern', 'pitfall', 'insight', 'action']),
  scope: z.enum(['global', 'sector']),
  lesson: z.string().min(20).max(300),
})

export interface RetroResult {
  lessonsStored: number
  winningPrompts: string[]
}

/** Per-prompt outcome over the run's ok records. */
interface PromptOutcome {
  prompt: string
  runs: number
  mentions: number
  citations: number
}

/** Aggregate mention/citation outcomes per distinct prompt. */
export function promptOutcomes(records: AuditRecord[], company: Company): PromptOutcome[] {
  const byPrompt = new Map<string, PromptOutcome>()
  for (const r of records) {
    if (!r.ok || !r.text) continue
    const o = byPrompt.get(r.prompt) ?? { prompt: r.prompt, runs: 0, mentions: 0, citations: 0 }
    o.runs += 1
    if (firstIdx(r.text, company.aliases) !== null) o.mentions += 1
    if (brandCited(r.citedUrls, company.domainHints)) o.citations += 1
    byPrompt.set(r.prompt, o)
  }
  return [...byPrompt.values()]
}

function buildRetroPrompt(
  company: Company,
  scoped: ScopedScore,
  winners: PromptOutcome[],
  losers: PromptOutcome[],
): string {
  const sc = scoped.combined
  return `You are the retro facilitator of a GEO/AEO audit platform. An audit just completed; distill 3-6 DURABLE, TRANSFERABLE lessons that will make FUTURE audits (for other companies too) better. Base every lesson strictly on the data below — no generic SEO folklore.

RUN CONTEXT
Sector: ${company.sector} · Locations: ${company.locations.join(', ')} · Avatar: ${company.buyerPersona || 'n/a'}
Overall: mention ${sc.overall.mentionRate}% · own-domain citation ${sc.overall.citationRate}% · SoV ${sc.overall.sov}% over ${sc.overall.runsOk} answers
Per engine: ${Object.entries(sc.perEngine).map(([e, s]) => `${e}: m${s?.mentionRate}%/c${s?.citationRate}%`).join(' · ')}
Competitors surfaced: ${sc.competitors.map((c) => c.name).join(', ') || 'none'}
Top cited domains: ${sc.topCitedDomains.slice(0, 8).map((d) => `${d.domain}(${d.citations})`).join(', ')}

PROMPTS THAT EARNED VISIBILITY (mention or citation):
${winners.map((w) => `- "${w.prompt}" → ${w.mentions}/${w.runs} mentions, ${w.citations}/${w.runs} citations`).join('\n') || '- none'}

PROMPTS THAT EARNED NOTHING (0 mentions, 0 citations):
${losers.map((l) => `- "${l.prompt}"`).join('\n') || '- none'}

Output: raw JSON array of 3-6 objects {"kind": "prompt_pattern"|"pitfall"|"insight"|"action", "scope": "global"|"sector", "lesson": "..."}.
RULES:
- kind=prompt_pattern: what STRUCTURAL property separated winning prompts from losing ones (tier? persona? phrasing? service specificity?). Never just restate a prompt.
- kind=insight: what the citation supply chain rewards in this market (directories? listicles? which domains gate visibility?).
- kind=pitfall: something that measurably produced nothing and should be avoided or down-weighted next run.
- kind=action: an intervention pattern the data supports (e.g. "profile on X directory gates visibility for Y-type queries").
- scope=sector when the lesson is specific to this market; global only when it clearly transfers to any sector.
- Each lesson one sentence, concrete, in English, max 40 words. No company names of the client in global lessons.
- Raw JSON array only.`
}

/**
 * Run the retro and persist lessons. Returns what was stored.
 * Never throws — errors are logged and swallowed (see module header).
 */
export async function runRetro(
  company: Company,
  records: AuditRecord[],
  scoped: ScopedScore,
  jobId?: string,
): Promise<RetroResult> {
  const empty: RetroResult = { lessonsStored: 0, winningPrompts: [] }
  try {
    const outcomes = promptOutcomes(records, company)
    if (outcomes.length === 0) return empty

    const winners = outcomes
      .filter((o) => o.mentions > 0 || o.citations > 0)
      .sort((a, b) => b.mentions + b.citations - (a.mentions + a.citations))
      .slice(0, MAX_EXEMPLARS)
    const losers = outcomes
      .filter((o) => o.mentions === 0 && o.citations === 0)
      .slice(0, MAX_EXEMPLARS)

    const sectorKey = sectorKeyOf(company.sector)
    let stored = 0

    // 1) Deterministic few-shot exemplars: the winning prompt texts
    //    themselves, filed as one sector-scoped prompt_pattern lesson whose
    //    evidence is the raw data. Retrieval injects these verbatim.
    if (winners.length > 0) {
      upsertLearning({
        scope: 'sector',
        sectorKey,
        kind: 'prompt_pattern',
        lesson: `Measured winners in ${sectorKey || 'this sector'}: reuse these prompt shapes as few-shot exemplars.`,
        evidence: winners
          .map((w) => `"${w.prompt}" (${w.mentions}/${w.runs} mentions, ${w.citations}/${w.runs} citations)`)
          .join(' | '),
        sourceJob: jobId,
      })
      stored++
    }

    // 2) LLM distillation into transferable lessons.
    const raw = await jsonAgent(
      buildRetroPrompt(company, scoped, winners, losers),
      z.array(LessonSchema),
      { maxTokens: 1500 },
    )
    for (const l of raw ?? []) {
      upsertLearning({
        scope: l.scope,
        ...(l.scope === 'sector' ? { sectorKey } : {}),
        kind: l.kind,
        lesson: l.lesson.trim(),
        sourceJob: jobId,
      })
      stored++
    }

    console.log(
      `[retro] ${company.id}: ${stored} lessons stored (${winners.length} winning prompts, ${losers.length} dry)`,
    )
    return { lessonsStored: stored, winningPrompts: winners.map((w) => w.prompt) }
  } catch (err) {
    console.warn(`[retro] ${company.id}: retro failed (non-fatal):`, err)
    return empty
  }
}

/**
 * Format retrieved lessons as a prompt block for generation-time injection.
 * Returns '' when there is nothing relevant — callers append unconditionally.
 */
export function learningsBlock(
  lessons: { kind: string; lesson: string; evidence: string | null; weight: number }[],
  title = 'LEARNED FROM PREVIOUS AUDITS (measured, not guessed — apply where relevant)',
): string {
  if (lessons.length === 0) return ''
  const lines = lessons.map((l) => {
    const ev = l.evidence ? ` Evidence: ${l.evidence.slice(0, 400)}` : ''
    return `- [${l.kind}${l.weight > 1 ? ` ×${l.weight}` : ''}] ${l.lesson}${ev}`
  })
  return `\n${title}:\n${lines.join('\n')}\n`
}
