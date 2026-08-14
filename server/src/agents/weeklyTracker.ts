/**
 * Weekly tracker — re-runs a sample of key prompts against the live engines
 * and diffs the result against the previous week's snapshot.
 *
 * Flow:
 *   1. sampleKeyPromptItems picks the key prompts from the latest prompt
 *      library (variance-prioritized — see below).
 *   2. requeryKeyPrompts re-runs them through every measured engine
 *      (chatgpt / gemini / perplexity, 2 runs each) and persists the fresh
 *      answers as audit_records under a NEW prompt-library version, so the
 *      weekly measurement never mixes with the original full audit.
 *   3. runWeeklyTracking computes metrics over the fresh records and diffs
 *      them against the latest tracking snapshot.
 *
 * Resilience: when the live re-query is impossible (missing API keys,
 * network down, zero successful runs) runWeeklyTracking falls back to the
 * pre-requery behavior — comparing the latest STORED audit records. All
 * errors are logged; a single failing engine call never fails the job.
 */
import { AUDIT } from '../config.js'
import {
  getAuditRecords,
  getCompany,
  insertAuditRecord,
  insertPromptLibrary,
  insertTrackingSnapshot,
  latestPromptLibrary,
  latestTrackingSnapshot,
} from '../db/repo.js'
import { aliasPattern, clientPattern } from '../core/regex.js'
import { brandCited } from '../core/citations.js'
import { discoverCompetitors } from '../core/competitors.js'
import { round1 } from '../core/scoring.js'
import { getMeasuredEngines, setCallContext } from '../providers/index.js'
import { analyzeSentiment, PERSONA_TEXT } from '../workflow/stages/audit.js'
import { collectClientSnapshot } from './datasetCollector.js'
import type {
  AuditRecord,
  Company,
  Engine,
  PromptItem,
  PromptLibrary,
  TrackingChanges,
  TrackingSnapshot,
} from '../types.js'

/** Key prompts re-queried per weekly run (spec: 15–20). */
const SAMPLE_SIZE = 18

/** Runs per prompt per engine during the weekly re-query. */
const REQUERY_RUNS = 2

export interface WeeklyTrackingResult {
  snapshot: TrackingSnapshot
  summary: string
}

/** Result of a successful live re-query: fresh records + their library. */
export interface RequeryResult {
  /** New prompt-library version holding exactly the sampled key prompts. */
  library: PromptLibrary
  /** All records persisted this run (including ok:false failures). */
  records: AuditRecord[]
}

/**
 * Deterministic sample of up to `n` key prompts from the latest library.
 *
 * Prioritization: prompts are ranked by the VARIANCE of their mention
 * outcome across the stored audit records (p·(1−p), where p is the fraction
 * of ok runs mentioning the brand). High-variance prompts are the ones where
 * visibility is unstable — exactly where week-over-week movement shows up
 * first. Ties (and prompts with no stored data) fall back to library order,
 * which promptgen orders by funnel importance. The selected set is returned
 * in library order so diffs stay stable.
 */
export function sampleKeyPromptItems(companyId: string, n = SAMPLE_SIZE): PromptItem[] {
  const library = latestPromptLibrary(companyId)
  if (!library) return []
  const items = library.items
  if (items.length <= n) return items.slice()

  const company = getCompany(companyId)
  if (!company) return items.slice(0, n)

  // Aggregate mention outcomes per prompt from the stored audit records.
  const records = getAuditRecords(companyId, library.id)
  const clientRx = clientPattern(company)
  const byPrompt = new Map<string, { mentioned: number; total: number }>()
  for (const r of records) {
    if (!r.ok || !r.text) continue
    const agg = byPrompt.get(r.prompt) ?? { mentioned: 0, total: 0 }
    agg.total += 1
    if (clientRx.test(r.text)) agg.mentioned += 1
    byPrompt.set(r.prompt, agg)
  }
  const varianceOf = (item: PromptItem): number => {
    const agg = byPrompt.get(item.text)
    if (!agg || agg.total === 0) return 0
    const p = agg.mentioned / agg.total
    return p * (1 - p)
  }

  return items
    .map((item, index) => ({ item, index, variance: varianceOf(item) }))
    .sort((a, b) => b.variance - a.variance || a.index - b.index)
    .slice(0, n)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item)
}

/** Texts of the sampled key prompts (convenience wrapper). */
export function sampleKeyPrompts(companyId: string, n = SAMPLE_SIZE): string[] {
  return sampleKeyPromptItems(companyId, n).map((item) => item.text)
}

/** Mention/citation/competitor metrics over a record set, for a prompt sample. */
export function computeMetrics(
  records: AuditRecord[],
  prompts: string[],
  company: Company,
): { mentionRate: number; citationRate: number; competitors: string[]; evaluated: number } {
  const wanted = new Set(prompts)
  const sample = records.filter((r) => r.ok && r.text && wanted.has(r.prompt))
  if (sample.length === 0) return { mentionRate: 0, citationRate: 0, competitors: [], evaluated: 0 }

  const clientRx = clientPattern(company)
  const mentioned = sample.filter((r) => clientRx.test(r.text ?? '')).length
  const cited = sample.filter((r) => brandCited(r.citedUrls, company.domainHints)).length

  // Competitor set = configured names + names the engines bold in answers.
  const known = new Set(company.competitors.map((c) => c.toLowerCase()))
  const competitors = new Map<string, true>()
  for (const { name } of discoverCompetitors(sample, company, 20)) {
    if (!known.has(name.toLowerCase())) competitors.set(name, true)
  }
  for (const name of company.competitors) {
    const rx = aliasPattern([name])
    if (sample.some((r) => rx.test(r.text ?? ''))) competitors.set(name, true)
  }

  return {
    mentionRate: round1((mentioned / sample.length) * 100),
    citationRate: round1((cited / sample.length) * 100),
    competitors: [...competitors.keys()],
    evaluated: sample.length,
  }
}

/**
 * Positive-mention share (%) over the sampled records: of the ok runs that
 * mention the brand AND carry a judged sentiment, how many are positive.
 * Returns null when nothing was judged (no mentions, or sentiment skipped) —
 * a null never produces a bogus "drop to 0%" change.
 */
export function computeSentimentPosPct(
  records: AuditRecord[],
  prompts: string[],
  company: Company,
): number | null {
  const wanted = new Set(prompts)
  const clientRx = clientPattern(company)
  const judged = records.filter(
    (r) => r.ok && r.text && r.sentiment && wanted.has(r.prompt) && clientRx.test(r.text),
  )
  if (judged.length === 0) return null
  const positive = judged.filter((r) => r.sentiment === 'positive').length
  return round1((positive / judged.length) * 100)
}

/** ISO date (YYYY-MM-DD) of the Monday of the week containing `d`. */
export function weekStartOf(d: Date): string {
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = (day.getUTCDay() + 6) % 7 // Monday = 0
  day.setUTCDate(day.getUTCDate() - dow)
  return day.toISOString().slice(0, 10)
}

/**
 * Re-run the sampled key prompts through every measured engine (2 runs each)
 * and persist the answers as audit_records under a NEW prompt-library
 * version. Mirrors the audit stage's execution model (persona-wrapped
 * prompt, concurrency-limited worker pool, per-call sentiment) but on the
 * small weekly sample instead of the full library.
 *
 * Never throws on individual call failures: a failing engine call is logged
 * and persisted as an ok:false record, so one broken vendor cannot abort the
 * whole re-query. Throws only on setup problems (unknown company, no
 * library, no engines) — the caller falls back to stored data then.
 */
export async function requeryKeyPrompts(companyId: string): Promise<RequeryResult> {
  const company = getCompany(companyId)
  if (!company) throw new Error(`unknown company ${companyId}`)
  // Bound const: hoisted function declarations (worker below) do not inherit
  // control-flow narrowing, so the closure needs its own non-null reference.
  const aliases = company.aliases
  const items = sampleKeyPromptItems(companyId)
  if (items.length === 0) throw new Error('no prompt library — nothing to re-query')

  const engines = getMeasuredEngines()
  const engineNames = (Object.keys(engines) as Engine[]).filter((e) => engines[e] !== undefined)
  if (engineNames.length === 0) throw new Error('no measured engines enabled')

  // Fresh library version: this week's records stay isolated from the
  // original audit and from previous weeks (prompt libraries are versioned
  // per company; version auto-increments in insertPromptLibrary).
  const library = insertPromptLibrary(companyId, items)

  interface CallJob {
    engine: Engine
    item: PromptItem
    run: number
  }
  const queue: CallJob[] = []
  for (const item of items) {
    for (const engine of engineNames) {
      for (let run = 0; run < REQUERY_RUNS; run++) {
        queue.push({ engine, item, run })
      }
    }
  }

  setCallContext({ companyId })
  const records: AuditRecord[] = []
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const job = queue[cursor++] as CallJob
      const textPrompt =
        `Du antwortest einer Person mit diesem Profil: ${PERSONA_TEXT[job.item.persona]}` +
        `\n\nFrage: ${job.item.text}`
      let rec: AuditRecord
      try {
        const res = await engines[job.engine]!.run(textPrompt)
        rec = {
          engine: job.engine,
          prompt: job.item.text,
          scope: job.item.scope,
          persona: job.item.persona,
          tier: job.item.tier,
          run: job.run,
          ok: res.ok,
          text: res.text,
          citedUrls: res.citedUrls ?? [],
          error: res.error?.slice(0, 200),
        }
        // Sentiment of the brand mention, judged by a labor LLM (same
        // semantics as the audit stage: no mention → unset, failure → neutral).
        if (res.ok && res.text) {
          const mention = aliasPattern(aliases).exec(res.text)
          if (mention) {
            try {
              rec.sentiment = await analyzeSentiment(res.text, mention[0])
            } catch {
              rec.sentiment = 'neutral'
            }
          }
        }
      } catch (err) {
        // Engine call threw (timeout, network, auth) — keep the failure as
        // data instead of aborting the batch.
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(
          `[weekly-tracker] ${companyId}: ${job.engine} call failed (${msg.slice(0, 120)})`,
        )
        rec = {
          engine: job.engine,
          prompt: job.item.text,
          scope: job.item.scope,
          persona: job.item.persona,
          tier: job.item.tier,
          run: job.run,
          ok: false,
          citedUrls: [],
          error: msg.slice(0, 200),
        }
      }
      insertAuditRecord(companyId, library.id, rec)
      records.push(rec)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(AUDIT.concurrency, queue.length) }, () => worker()),
  )

  const ok = records.filter((r) => r.ok).length
  console.log(
    `[weekly-tracker] ${companyId}: re-queried ${items.length} prompts × ` +
      `${engineNames.length} engines × ${REQUERY_RUNS} runs — ${ok}/${records.length} ok ` +
      `(library v${library.version})`,
  )
  return { library, records }
}

/**
 * Run one weekly tracking cycle for a company: re-query the key prompts
 * live (falling back to the latest stored audit records when the re-query
 * is impossible), compute metrics, diff against the previous snapshot,
 * persist, and return the change summary. With no previous snapshot the
 * diff fields stay null and the new snapshot becomes the baseline.
 * Skips cleanly when the company or its prompt library does not exist yet.
 *
 * `opts.source = 'stored'` skips the live re-query entirely and snapshots
 * from the latest stored audit records — the zero-cost path the pipeline
 * uses at audit completion to lay down the tracking baseline immediately
 * (so the Tracking tab has data from day one instead of waiting a week).
 */
export async function runWeeklyTracking(
  companyId: string,
  opts: { source?: 'requery' | 'stored' } = {},
): Promise<WeeklyTrackingResult | null> {
  const company = getCompany(companyId)
  if (!company) {
    console.warn(`[weekly-tracker] ${companyId}: unknown company — skipped`)
    return null
  }
  const library = latestPromptLibrary(companyId)
  if (!library) {
    console.warn(`[weekly-tracker] ${companyId}: no prompt library — skipped`)
    return null
  }

  // 1) Live re-query (preferred). ANY failure — missing keys, network down,
  //    zero successful runs — falls back to comparing stored audit records.
  let prompts: string[]
  let records: AuditRecord[]
  let source: 'requery' | 'stored'
  try {
    if (opts.source === 'stored') throw new Error('stored-records mode requested')
    const fresh = await requeryKeyPrompts(companyId)
    if (fresh.records.every((r) => !r.ok)) {
      throw new Error('re-query returned zero successful runs')
    }
    prompts = fresh.library.items.map((item) => item.text)
    records = fresh.records
    source = 'requery'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[weekly-tracker] ${companyId}: live re-query failed (${msg}) — ` +
        'falling back to stored audit records',
    )
    prompts = sampleKeyPrompts(companyId)
    if (prompts.length === 0) {
      console.warn(`[weekly-tracker] ${companyId}: no prompt library — skipped`)
      return null
    }
    records = getAuditRecords(companyId, library.id)
    source = 'stored'
  }

  // 2) Metrics over the (fresh or stored) records for the sampled prompts.
  const metrics = computeMetrics(records, prompts, company)
  if (metrics.evaluated === 0) {
    console.warn(`[weekly-tracker] ${companyId}: no audit records for sampled prompts — skipped`)
    return null
  }
  const sentimentPosPct = computeSentimentPosPct(records, prompts, company)

  // 3) Diff against the previous snapshot (null deltas → this week is the baseline).
  const previous = latestTrackingSnapshot(companyId)
  const prevCompetitors = new Set(
    (previous?.changes.competitors ?? []).map((c) => c.toLowerCase()),
  )
  const prevSentimentPosPct = previous?.changes.sentimentPosPct ?? null
  const changes: TrackingChanges = {
    mentionRateChange: previous ? round1(metrics.mentionRate - previous.mentionRate) : null,
    citationRateChange: previous ? round1(metrics.citationRate - previous.citationRate) : null,
    sentimentPosPct,
    sentimentChange:
      previous && sentimentPosPct !== null && prevSentimentPosPct !== null
        ? round1(sentimentPosPct - prevSentimentPosPct)
        : null,
    newCompetitors: metrics.competitors.filter((c) => !prevCompetitors.has(c.toLowerCase())),
    lostCompetitors: (previous?.changes.competitors ?? []).filter(
      (c) => !metrics.competitors.some((now) => now.toLowerCase() === c.toLowerCase()),
    ),
    competitors: metrics.competitors,
    promptsSampled: prompts.length,
  }

  const id = insertTrackingSnapshot({
    companyId,
    weekStart: weekStartOf(new Date()),
    mentionRate: metrics.mentionRate,
    citationRate: metrics.citationRate,
    changes,
  })

  const snapshot: TrackingSnapshot = {
    id,
    companyId,
    weekStart: weekStartOf(new Date()),
    mentionRate: metrics.mentionRate,
    citationRate: metrics.citationRate,
    changes,
    createdAt: new Date().toISOString(),
  }
  const summary =
    `mention ${fmtDelta(metrics.mentionRate, changes.mentionRateChange)}, ` +
    `citation ${fmtDelta(metrics.citationRate, changes.citationRateChange)}, ` +
    `sentiment ${fmtSentiment(sentimentPosPct, changes.sentimentChange ?? null)}, ` +
    `competitors +${changes.newCompetitors.length}/-${changes.lostCompetitors.length} ` +
    `[${source}]`
  console.log(`[weekly-tracker] ${companyId}: ${summary}`)

  // Append this week's row to the LeadEngine Data dataset (movement columns
  // come from the snapshot just written). Best-effort: the dataset is a
  // by-product and must never fail a completed tracking cycle.
  try {
    collectClientSnapshot(companyId, 'weekly')
  } catch (err) {
    console.warn(`[weekly-tracker] ${companyId}: dataset snapshot failed (non-fatal):`, err)
  }

  return { snapshot, summary }
}

function fmtDelta(value: number, delta: number | null): string {
  return delta === null ? `${value}% (baseline)` : `${value}% (${delta >= 0 ? '+' : ''}${delta})`
}

function fmtSentiment(value: number | null, delta: number | null): string {
  if (value === null) return 'n/a'
  return fmtDelta(value, delta)
}
