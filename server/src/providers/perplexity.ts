/**
 * Perplexity Sonar — grounded answers with structured citations.
 * Port of the perplexity_* functions in geo/providers.py.
 */
import { KEYS, MODELS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult, Validation } from './types.js'
import type { CostKind } from './index.js'

const URL = 'https://api.perplexity.ai/chat/completions'

// Minimal chat/completions response shape — cast from the generic JSON body.
interface PerplexityBody {
  choices?: { message?: { content?: string } }[]
  citations?: string[]
  search_results?: unknown[]
}

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${KEYS.perplexity}` }
}

/** Key check: 16-token "Say OK" probe. */
export async function perplexityValidate(): Promise<Validation> {
  if (!KEYS.perplexity) return { ok: false, detail: 'no key' }
  const { status, body } = await request(
    'POST',
    URL,
    {
      model: MODELS.measuredPerplexity,
      messages: [{ role: 'user', content: 'Say OK' }],
      max_tokens: 16,
    },
    auth(),
    30_000,
  )
  if (status === 200) return { ok: true, detail: 'ok — sonar reachable' }
  return { ok: false, detail: `HTTP ${status}: ${errText(body, 200)}` }
}

/**
 * Perplexity Sonar — grounded answers with structured citations.
 * `kind` defaults to 'measured' (the audited surface); callers doing
 * research labor (e.g. reverseEngineer's competitor lookups) must pass
 * 'research' so cost logs don't overcount the measured-call total.
 */
export async function perplexityRun(prompt: string, kind: CostKind = 'measured'): Promise<ProviderResult> {
  const { status, body } = await request(
    'POST',
    URL,
    { model: MODELS.measuredPerplexity, messages: [{ role: 'user', content: prompt }] },
    auth(),
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'perplexity', MODELS.measuredPerplexity, kind)
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as PerplexityBody // provider JSON shape
  const text = b.choices?.[0]?.message?.content ?? ''
  const urls = b.citations ?? []
  return { ok: true, text, citedUrls: urls, raw: { search_results: b.search_results ?? [] } }
}
