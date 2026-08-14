/**
 * Exa — neural web search for fan-out / source discovery.
 * Port of the exa_* functions in geo/providers.py.
 */
import { KEYS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult, Validation } from './types.js'

const URL = 'https://api.exa.ai/search'

export interface ExaResult {
  url: string
  title: string
  score: number
}

// Minimal search response shape — cast from the generic JSON body.
interface ExaBody {
  results?: { url?: string; title?: string; score?: number }[]
}

/** Key check: numResults:1 probe. */
export async function exaValidate(): Promise<Validation> {
  if (!KEYS.exa) return { ok: false, detail: 'no key' }
  const { status, body } = await request(
    'POST',
    URL,
    { query: 'test', numResults: 1 },
    { 'x-api-key': KEYS.exa },
    30_000,
  )
  if (status === 200) return { ok: true, detail: 'ok — search reachable' }
  return { ok: false, detail: `HTTP ${status}: ${errText(body, 200)}` }
}

/** Neural search — results mapped to { url, title, score } in raw. */
export async function exaSearch(query: string, n = 10): Promise<ProviderResult> {
  const { status, body } = await request(
    'POST',
    URL,
    { query, numResults: n },
    { 'x-api-key': KEYS.exa },
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'exa', 'exa-search', 'research')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const results: ExaResult[] = ((body as unknown as ExaBody).results ?? []).map((r) => ({
    url: r.url ?? '',
    title: r.title ?? '',
    score: r.score ?? 0,
  }))
  return { ok: true, raw: results }
}
