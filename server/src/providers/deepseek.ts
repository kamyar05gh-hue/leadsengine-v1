/**
 * DeepSeek — chat completions for reasoning/drafting labor. No web search
 * exists on this API, so it is never a measured engine.
 * Port of deepseek_generate in geo/providers.py.
 */
import { KEYS, MODELS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult } from './types.js'

const URL = 'https://api.deepseek.com/chat/completions'

// Minimal chat/completions response shape — cast from the generic JSON body.
interface DeepseekBody {
  choices?: { message?: { content?: string } }[]
}

/** DeepSeek chat completion — cheap reasoning/drafting labor only. */
export async function deepseekGenerate(
  prompt: string,
  maxTokens = 4000,
  reasoning = false,
): Promise<ProviderResult> {
  const model = reasoning ? MODELS.deepseekReasoner : MODELS.deepseekChat
  const { status, body } = await request(
    'POST',
    URL,
    { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    { Authorization: `Bearer ${KEYS.deepseek}` },
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'deepseek', model, 'labor')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const content = (body as unknown as DeepseekBody).choices?.[0]?.message?.content
  if (typeof content !== 'string') return { ok: false, error: 'malformed response' }
  return { ok: true, text: content }
}
