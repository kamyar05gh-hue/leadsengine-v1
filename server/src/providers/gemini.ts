/**
 * Gemini — generateContent with Google Search grounding.
 * Port of the gemini_* functions in geo/providers.py.
 */
import { KEYS, MODELS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult, Validation } from './types.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

// Minimal generateContent response shape — cast from the generic JSON body.
interface GeminiBody {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
  }[]
}

/**
 * Gemini grounding returns redirect stubs
 * (https://vertexaisearch.cloud.google.com/grounding-api-redirect/<opaque>)
 * instead of publisher URLs — stored raw, every Gemini citationRate was
 * structurally 0 and the redirect host polluted "top cited domains".
 *
 * Resolution order per chunk:
 *  1. follow the redirect once (HEAD-less GET, redirect:'manual', 6s cap)
 *     and take the Location header — the true publisher URL;
 *  2. fall back to `web.title`, which Google sets to the source domain
 *     (e.g. "future-media.ch") — prefixed with https:// so downstream
 *     domain parsing keeps working;
 *  3. keep the stub only when both fail.
 * Resolved URLs are cached per process — grounding chunks repeat heavily
 * across runs of the same audit.
 */
const redirectCache = new Map<string, string>()

function isRedirectStub(uri: string): boolean {
  return uri.includes('vertexaisearch.cloud.google.com/grounding-api-redirect')
}

async function resolveGroundingUri(uri: string, title?: string): Promise<string> {
  if (!isRedirectStub(uri)) return uri
  const cached = redirectCache.get(uri)
  if (cached) return cached
  let resolved = ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6_000)
    const res = await fetch(uri, { method: 'GET', redirect: 'manual', signal: controller.signal })
    clearTimeout(timer)
    const loc = res.headers.get('location')
    if (loc && /^https?:\/\//.test(loc)) resolved = loc
    // drain/cancel the body so the socket is released
    await res.body?.cancel().catch(() => undefined)
  } catch {
    // network failure → fall through to the title
  }
  if (!resolved && title && title.includes('.') && !title.includes(' ')) {
    resolved = `https://${title.replace(/^https?:\/\//, '')}`
  }
  const final = resolved || uri
  redirectCache.set(uri, final)
  return final
}

/** Key check: list models. */
export async function geminiValidate(): Promise<Validation> {
  if (!KEYS.gemini) return { ok: false, detail: 'no key' }
  const { status, body } = await request(
    'GET',
    `${BASE}/models?key=${KEYS.gemini}`,
    undefined,
    {},
    30_000,
  )
  if (status === 200) {
    const models = (body as unknown as { models?: unknown[] }).models ?? []
    return { ok: true, detail: `ok — ${models.length} models visible` }
  }
  return { ok: false, detail: `HTTP ${status}: ${errText(body, 200)}` }
}

/** Gemini with Google Search grounding. */
export async function geminiRun(prompt: string): Promise<ProviderResult> {
  const url = `${BASE}/models/${MODELS.measuredGemini}:generateContent?key=${KEYS.gemini}`
  const { status, body } = await request('POST', url, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  })
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'gemini', MODELS.measuredGemini, 'measured')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as GeminiBody // provider JSON shape
  let text = ''
  const cand = b.candidates?.[0]
  for (const part of cand?.content?.parts ?? []) text += part.text ?? ''
  // Resolve grounding redirect stubs to real publisher URLs (bounded 4-wide).
  const chunks = (cand?.groundingMetadata?.groundingChunks ?? []).filter((c) => c.web?.uri)
  const urls: string[] = new Array(chunks.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (next < chunks.length) {
        const i = next++
        const web = chunks[i]!.web!
        urls[i] = await resolveGroundingUri(web.uri!, web.title)
      }
    }),
  )
  return { ok: true, text, citedUrls: urls.filter(Boolean), raw: body }
}

/**
 * Plain Gemini completion — writing labor (landing-page content), never a
 * measured surface. Defaults to the cheap flash-lite tier.
 */
export async function geminiGenerate(
  prompt: string,
  maxTokens = 8000,
  model?: string,
): Promise<ProviderResult> {
  if (!KEYS.gemini) return { ok: false, error: 'no key' }
  const useModel = model ?? 'gemini-3.5-flash-lite'
  const url = `${BASE}/models/${useModel}:generateContent?key=${KEYS.gemini}`
  const { status, body } = await request('POST', url, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  })
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'gemini', useModel, 'labor')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const b = body as unknown as GeminiBody
  let text = ''
  for (const part of b.candidates?.[0]?.content?.parts ?? []) text += part.text ?? ''
  if (!text) return { ok: false, error: 'empty response' }
  return { ok: true, text, raw: body }
}
