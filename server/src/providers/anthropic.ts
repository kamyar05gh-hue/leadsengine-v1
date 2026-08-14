/**
 * Anthropic (Claude) — Messages API with the web_search_20250305 server tool.
 * The measured run enables server-side web search so Claude actually browses
 * and returns citations (the audit needs cited URLs). Haiku tier for cost.
 */
import { KEYS, MODELS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult, Validation } from './types.js'

const BASE = 'https://api.anthropic.com/v1'
const API_VERSION = '2023-06-01'

/** Cap server-side searches per request — each search is billed. */
const MAX_WEB_SEARCH_USES = 6

// Minimal Messages API shapes — cast from the generic JSON body.
interface AnthropicCitation {
  type?: string
  url?: string
}
interface AnthropicSearchResult {
  type?: string
  url?: string
}
interface AnthropicContentBlock {
  type?: string
  text?: string
  citations?: AnthropicCitation[]
  // web_search_tool_result.content is an array of web_search_result blocks
  content?: AnthropicSearchResult[]
}
interface AnthropicMessagesBody {
  content?: AnthropicContentBlock[]
}

function auth(): Record<string, string> {
  return { 'x-api-key': KEYS.anthropic, 'anthropic-version': API_VERSION }
}

/** Key check: list models. */
export async function anthropicValidate(): Promise<Validation> {
  if (!KEYS.anthropic) return { ok: false, detail: 'no key' }
  const { status, body } = await request('GET', `${BASE}/models`, undefined, auth(), 30_000)
  if (status === 200) {
    const data = (body as unknown as { data?: unknown[] }).data ?? []
    return { ok: true, detail: `ok — ${data.length} models visible` }
  }
  return { ok: false, detail: `HTTP ${status}: ${errText(body, 200)}` }
}

/**
 * Claude with server-side web search. Cited URLs come from the
 * web_search_tool_result blocks (every page Claude opened) plus the inline
 * citations on the final text, deduped.
 */
export async function anthropicRun(prompt: string): Promise<ProviderResult> {
  if (!KEYS.anthropic) return { ok: false, error: 'no key' }
  const { status, body } = await request(
    'POST',
    `${BASE}/messages`,
    {
      model: MODELS.measuredClaude,
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCH_USES }],
      messages: [{ role: 'user', content: prompt }],
    },
    auth(),
    90_000,
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'anthropic', MODELS.measuredClaude, 'measured')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as AnthropicMessagesBody // provider JSON shape
  let text = ''
  const seen = new Set<string>()
  const urls: string[] = []
  const push = (u?: string): void => {
    if (u && !seen.has(u)) {
      seen.add(u)
      urls.push(u)
    }
  }
  for (const block of b.content ?? []) {
    if (block.type === 'web_search_tool_result') {
      for (const r of block.content ?? []) {
        if (r.type === 'web_search_result') push(r.url)
      }
    }
    if (block.type === 'text') {
      text += block.text ?? ''
      for (const c of block.citations ?? []) push(c.url)
    }
  }
  return { ok: true, text, citedUrls: urls, raw: {} }
}
