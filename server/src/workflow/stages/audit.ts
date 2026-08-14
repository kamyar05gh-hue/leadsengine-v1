/**
 * Stage: audit — the measured run.
 *
 * Every prompt × every measured engine (chatgpt forced-search, gemini
 * grounding, perplexity sonar) × R runs. Concurrency-limited, one retry per
 * call, records streamed into the DB so a crashed job resumes without
 * re-paying for completed calls (idempotent via existingAuditKeys).
 * Cost ceiling: AUDIT.maxCallsPerJob guards against runaway spend.
 */
import { AUDIT } from '../../config.js'
import { aliasPattern } from '../../core/regex.js'
import { isCanceled } from '../cancellation.js'
import {
  existingAuditKeys,
  getAuditRecords,
  insertAuditRecord,
} from '../../db/repo.js'
import {
  deepseekGenerate,
  geminiGenerate,
  getMeasuredEngines,
  setCallContext,
} from '../../providers/index.js'
import type {
  AuditRecord,
  Company,
  Engine,
  PromptItem,
  PromptLibrary,
} from '../../types.js'

/** Sentiment label stored on audit_records.sentiment. */
export type Sentiment = NonNullable<AuditRecord['sentiment']>

/** Chars of context kept on each side of the brand mention for classification. */
const SENTIMENT_CONTEXT_CHARS = 100

export const PERSONA_TEXT: Record<PromptItem['persona'], string> = {
  general:
    'Person, die Anbieter vergleicht und eine Kaufentscheidung vorbereitet. Antworte auf Deutsch.',
  avatar:
    'Fachperson mit eigener Betriebspraxis, 15 Jahre Berufserfahrung, fragt als Expertin. Antworte auf Deutsch.',
}

/**
 * Persona text for a run. The avatar persona uses the company's actual
 * Avatar (target audience) description when one was captured — the audit
 * then impersonates the real buyer ("CEO of a small-to-mid-size company
 * looking for social media marketing") instead of a generic Fachperson.
 */
export function personaText(persona: PromptItem['persona'], company: Company): string {
  if (persona === 'avatar' && company.buyerPersona.trim()) {
    return `${company.buyerPersona.trim()} Antworte auf Deutsch.`
  }
  return PERSONA_TEXT[persona]
}

interface CallJob {
  engine: Engine
  item: PromptItem
  run: number
}

/**
 * Extract the context window around a brand mention: the mention itself plus
 * up to SENTIMENT_CONTEXT_CHARS characters on each side. Falls back to the
 * head of the text when the mention cannot be located (defensive — callers
 * normally pass a mention they just matched in the text).
 */
export function mentionContext(text: string, brandMention: string): string {
  const idx = text.toLowerCase().indexOf(brandMention.toLowerCase())
  if (idx < 0) return text.slice(0, SENTIMENT_CONTEXT_CHARS * 2)
  const start = Math.max(0, idx - SENTIMENT_CONTEXT_CHARS)
  const end = Math.min(text.length, idx + brandMention.length + SENTIMENT_CONTEXT_CHARS)
  return text.slice(start, end)
}

/**
 * Parse a one-word LLM sentiment reply into a Sentiment. Returns null when
 * the reply contains no recognizable label (caller then defaults).
 */
function parseSentimentReply(reply: string): Sentiment | null {
  const m = /\b(positive|neutral|negative)\b/i.exec(reply)
  return m ? (m[1]!.toLowerCase() as Sentiment) : null
}

/**
 * Classify the sentiment of a brand mention inside an AI answer using a
 * cheap labor LLM (DeepSeek first, Gemini as fallback — never a measured
 * engine, so sentiment calls don't pollute the audit surface).
 *
 * Sentiment is judged on the ±100-char window around the mention, not the
 * whole answer — long answers may praise one brand and criticize another.
 *
 * Never throws: any provider failure or unparseable reply yields 'neutral',
 * so a broken labor key can never fail the audit stage.
 */
export async function analyzeSentiment(
  text: string,
  brandMention: string,
): Promise<Sentiment> {
  const context = mentionContext(text, brandMention)
  const prompt =
    'Classify the sentiment of this brand mention as positive, neutral, or negative. ' +
    'Return only one word.\n\n' +
    `Brand: ${brandMention}\n` +
    `Context: "${context}"`

  const res = await deepseekGenerate(prompt, 10).catch(() => null)
  const parsed = res?.ok && res.text ? parseSentimentReply(res.text) : null
  if (parsed) return parsed

  // DeepSeek failed or returned garbage — one Gemini retry before defaulting.
  try {
    const fallback = await geminiGenerate(prompt, 10)
    const parsedFallback = fallback.ok && fallback.text ? parseSentimentReply(fallback.text) : null
    return parsedFallback ?? 'neutral'
  } catch {
    return 'neutral'
  }
}

async function execute(
  company: Company,
  library: PromptLibrary,
  onProgress: (done: number, total: number) => void,
  jobId?: string,
): Promise<number> {
  const engines = getMeasuredEngines()
  // Requested engines (company.engines) intersected with what's enabled;
  // engines the company never asked for are skipped entirely.
  const engineNames = (Object.keys(engines) as Engine[]).filter(
    (e) => !company.engines || company.engines.includes(e),
  )
  const existing = existingAuditKeys(company.id, library.id)

  /**
   * Per-engine prompt allocation. With a plan like {chatgpt:20, gemini:20,
   * perplexity:10, claude:10} each engine runs only its first N prompts of a
   * priority-ordered library view: regional before DACH, city→country within
   * a scope, personas interleaved — so a small budget lands on the most
   * niche-specific, most local prompts where a regional brand can actually
   * surface, instead of a random slice.
   */
  const tierRank: Record<PromptItem['tier'], number> = {
    city: 0, region: 1, canton: 2, cantons: 3, ch: 4, dach: 5,
  }
  const prioritized = [...library.items].sort(
    (a, b) =>
      (a.scope === 'dach' ? 1 : 0) - (b.scope === 'dach' ? 1 : 0) ||
      tierRank[a.tier] - tierRank[b.tier],
  )
  // Interleave personas so any prefix keeps a ~50/50 general/avatar balance.
  const generals = prioritized.filter((i) => i.persona === 'general')
  const avatars = prioritized.filter((i) => i.persona === 'avatar')
  const interleaved: PromptItem[] = []
  for (let i = 0; i < Math.max(generals.length, avatars.length); i++) {
    if (generals[i]) interleaved.push(generals[i]!)
    if (avatars[i]) interleaved.push(avatars[i]!)
  }

  const queue: CallJob[] = []
  for (const engine of engineNames) {
    const quota = company.enginePlan?.[engine]
    const items = quota ? interleaved.slice(0, quota) : library.items
    for (const item of items) {
      for (let run = 0; run < AUDIT.runsPerPrompt; run++) {
        if (!existing.has(`${engine}|${item.text}|${run}`)) {
          queue.push({ engine, item, run })
        }
      }
    }
  }
  const total = queue.length
  if (total === 0) return 0
  if (total > AUDIT.maxCallsPerJob) {
    throw new Error(`audit would need ${total} calls — above ceiling ${AUDIT.maxCallsPerJob}`)
  }

  setCallContext({ jobId, companyId: company.id })
  let done = 0
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      // Cancellation checkpoint: the audit is the long, expensive stage, so
      // it must stop within one in-flight call instead of burning the rest
      // of the queue's paid API calls after the operator hit cancel.
      if (jobId && isCanceled(jobId)) return
      const job = queue[cursor++] as CallJob
      const tp =
        `Du antwortest einer Person mit diesem Profil: ${personaText(job.item.persona, company)}` +
        `\n\nFrage: ${job.item.text}`
      let res = await engines[job.engine]!.run(tp)
      // One retry per failed call: transient timeouts/rate limits are common
      // on grounded runs and a stored ok:false permanently loses the sample.
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1_500))
        res = await engines[job.engine]!.run(tp)
      }
      const rec: AuditRecord = {
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
      // Sentiment of the brand mention, judged by a labor LLM on the
      // ±100-char window around the first alias hit. No mention → null
      // (column stays NULL); any failure → 'neutral' — never fails the job.
      if (res.ok && res.text) {
        const mention = aliasPattern(company.aliases).exec(res.text)
        if (mention) {
          try {
            rec.sentiment = await analyzeSentiment(res.text, mention[0])
          } catch {
            rec.sentiment = 'neutral'
          }
        }
      }
      insertAuditRecord(company.id, library.id, rec)
      done++
      if (done % 10 === 0 || done === total) onProgress(done, total)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(AUDIT.concurrency, total) }, () => worker()),
  )
  return done
}

/**
 * Run (or resume) the measured audit. Returns all records for the library —
 * including previously stored ones — so scoring always sees the full set.
 */
export async function runAudit(
  company: Company,
  library: PromptLibrary,
  onProgress: (done: number, total: number) => void = () => {},
  jobId?: string,
): Promise<AuditRecord[]> {
  await execute(company, library, onProgress, jobId)
  return getAuditRecords(company.id, library.id)
}
