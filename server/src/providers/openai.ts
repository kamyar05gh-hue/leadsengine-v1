/**
 * OpenAI (ChatGPT) — Responses API with the web_search_preview tool.
 * Port of the openai_* functions in geo/providers.py. The measured registry
 * uses the FORCED variant: organic mode lets the model skip retrieval on
 * niche queries (~6%), which starves citation data.
 */
import { KEYS, MODELS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult, Validation } from './types.js'

const BASE = 'https://api.openai.com/v1'

// Minimal Responses API shapes — cast from the generic JSON body.
interface OpenAiAnnotation {
  type?: string
  url?: string
}
interface OpenAiContentPart {
  type?: string
  text?: string
  annotations?: OpenAiAnnotation[]
}
interface OpenAiOutputItem {
  type?: string
  action?: { sources?: { url?: string }[] }
  content?: OpenAiContentPart[]
}
interface OpenAiResponsesBody {
  output?: OpenAiOutputItem[]
}

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${KEYS.openai}` }
}

/**
 * Plain completion (Responses API, no tools) — polish/rewrite labor.
 * Defaults to the cheap polish tier (MODELS.laborPolish).
 */
export async function openaiGenerate(
  prompt: string,
  model?: string,
  maxTokens = 4000,
): Promise<ProviderResult> {
  if (!KEYS.openai) return { ok: false, error: 'no key' }
  const used = model ?? MODELS.laborPolish
  // GPT-5-family models are reasoning models on the Responses API: without
  // an effort cap the thinking trace can consume the whole output budget and
  // return an empty message. Low effort + headroom keeps drafting fast.
  const gpt5 = /^gpt-5/.test(used)
  const { status, body } = await request(
    'POST',
    `${BASE}/responses`,
    {
      model: used,
      input: prompt,
      max_output_tokens: gpt5 ? maxTokens + 2000 : maxTokens,
      ...(gpt5 ? { reasoning: { effort: 'low' } } : {}),
    },
    auth(),
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'openai', used, 'labor')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as OpenAiResponsesBody // provider JSON shape
  let text = ''
  for (const item of b.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') text += part.text ?? ''
      }
    }
  }
  return { ok: true, text }
}

/**
 * ChatGPT with FORCED web search + full source list. Cited URLs come from
 * the search action's source list plus inline annotations, with tracking
 * params stripped and duplicates removed.
 */
export async function openaiRunForced(prompt: string): Promise<ProviderResult> {
  const { status, body } = await request(
    'POST',
    `${BASE}/responses`,
    {
      model: MODELS.measuredChatgpt,
      input: prompt,
      tools: [{ type: 'web_search_preview' }],
      tool_choice: { type: 'web_search_preview' },
      include: ['web_search_call.action.sources'],
    },
    auth(),
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'openai', MODELS.measuredChatgpt, 'measured')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as OpenAiResponsesBody // provider JSON shape
  let text = ''
  const urls: string[] = []
  for (const item of b.output ?? []) {
    if (item.type === 'web_search_call') {
      for (const s of item.action?.sources ?? []) {
        if (s.url) urls.push(s.url)
      }
    }
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') {
          text += part.text ?? ''
          for (const ann of part.annotations ?? []) {
            if (ann.type === 'url_citation' && ann.url) urls.push(ann.url)
          }
        }
      }
    }
  }
  // dedupe, strip tracking params for cleaner domain matching
  const seen = new Set<string>()
  const clean: string[] = []
  for (const raw of urls) {
    const u = raw.split('?utm_source')[0] ?? raw
    if (!seen.has(u)) {
      seen.add(u)
      clean.push(u)
    }
  }
  return { ok: true, text, citedUrls: clean, raw: {} }
}

/** Key check: list models. */
export async function openaiValidate(): Promise<Validation> {
  if (!KEYS.openai) return { ok: false, detail: 'no key' }
  const { status, body } = await request('GET', `${BASE}/models`, undefined, auth(), 30_000)
  if (status === 200) {
    const data = (body as unknown as { data?: unknown[] }).data ?? []
    return { ok: true, detail: `ok — ${data.length} models visible` }
  }
  return { ok: false, detail: `HTTP ${status}: ${errText(body, 200)}` }
}

/** ChatGPT with live web search (Responses API, organic tool choice). */
export async function openaiRun(prompt: string): Promise<ProviderResult> {
  const { status, body } = await request(
    'POST',
    `${BASE}/responses`,
    { model: MODELS.measuredChatgpt, input: prompt, tools: [{ type: 'web_search_preview' }] },
    auth(),
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'openai', MODELS.measuredChatgpt, 'measured')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as OpenAiResponsesBody // provider JSON shape
  let text = ''
  const urls: string[] = []
  for (const item of b.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') {
          text += part.text ?? ''
          for (const ann of part.annotations ?? []) {
            if (ann.type === 'url_citation') urls.push(ann.url ?? '')
          }
        }
      }
    }
  }
  return { ok: true, text, citedUrls: urls, raw: body }
}
