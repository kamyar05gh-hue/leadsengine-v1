/**
 * Kimi (Moonshot) — plain completions for writing labor, plus the builtin
 * $web_search handshake for grounded runs. Labor only, never a measured
 * surface. Port of the kimi_* functions in geo/providers.py.
 *
 * Timeout behaviour (why this file does not use the shared default):
 * kimi-k2.6 is a REASONING model. Left alone it emits a long
 * `reasoning_content` block before the first answer token — measured 78s /
 * 2123 reasoning tokens for a 300-word ask, against the shared 90s call
 * budget. That is what surfaced as "Kimi timeouts": the abort fired
 * mid-thought, the labor call returned status -1, and every report section
 * silently fell through to the DeepSeek fallback or a canned paragraph.
 *
 * Three things keep it inside budget now:
 *  1. `thinking: {type:'disabled'}` — same prompt drops to ~16s (5x faster)
 *     with no measurable quality loss on report copy, which is drafting
 *     work, not deduction.
 *  2. A dedicated KIMI_TIMEOUT_MS budget well above the audit-call budget,
 *     so a long section render has room even with thinking re-enabled.
 *  3. Reasoning-only replies (`content` empty, `reasoning_content` full) are
 *     reported as a real error instead of an empty success, so the caller
 *     falls back deliberately rather than rendering a blank section.
 *
 * Do NOT send `temperature` to this model — Moonshot rejects any value
 * except 1 with HTTP 400 ("invalid temperature: only 1 is allowed").
 */
import { KEYS, MODELS } from '../config.js'
import { getCallContext, logCost } from './index.js'
import { errText, request } from './http.js'
import type { ProviderResult, Validation } from './types.js'

const KIMI_BASE = 'https://api.moonshot.ai/v1'

/**
 * Call budget for Kimi labor, independent of AUDIT.callTimeoutMs. Long-form
 * section drafting legitimately runs minutes; the audit budget is sized for
 * short measured queries and was aborting these mid-flight.
 */
const KIMI_TIMEOUT_MS = Number(process.env.LE_KIMI_TIMEOUT_MS ?? 300_000)

/**
 * Whether to let k2.6 think. Off by default: drafting work does not need the
 * reasoning pass and it costs ~5x wall time. Set LE_KIMI_THINKING=1 to
 * re-enable for genuinely analytical prompts.
 */
const KIMI_THINKING = process.env.LE_KIMI_THINKING === '1'

/** Thinking switch, only sent when disabled — omitted means model default. */
function thinkingParam(): Record<string, unknown> {
  return KIMI_THINKING ? {} : { thinking: { type: 'disabled' } }
}

// Minimal chat/completions shapes — cast from the generic JSON body.
interface KimiToolCall {
  id?: string
}
interface KimiMessage {
  role: string
  content?: string | null
  /** k2.6 reasoning trace — present and long when thinking is enabled. */
  reasoning_content?: string | null
  tool_calls?: KimiToolCall[]
  tool_call_id?: string
}
interface KimiBody {
  choices?: { message?: KimiMessage; finish_reason?: string }[]
}

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${KEYS.kimi}` }
}

/** Transient statuses worth a retry: network/timeout (-1), rate limit, 5xx. */
function isTransient(status: number): boolean {
  return status === -1 || status === 429 || status >= 500
}

/**
 * Retrying request wrapper for Moonshot calls. Kimi is the main labor brain;
 * a single timed-out call used to cascade into blank report sections and
 * stalled promptgen stages. Up to `tries` attempts with linear backoff
 * (2s, 4s); non-transient HTTP errors return immediately.
 */
async function kimiRequest(
  payload: Record<string, unknown>,
  timeoutMs: number,
  tries = 3,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let last: { status: number; body: Record<string, unknown> } = {
    status: -1,
    body: { error: 'not attempted' },
  }
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000 * attempt))
    last = await request('POST', `${KIMI_BASE}/chat/completions`, payload, auth(), timeoutMs)
    if (!isTransient(last.status)) return last
    console.warn(
      `[kimi] transient failure (attempt ${attempt + 1}/${tries}): ` +
        `${last.status === -1 ? errText(last.body) : `HTTP ${last.status}`}`,
    )
  }
  return last
}

/**
 * Plain Kimi completion, no web search — writing/execution labor
 * (report generation, content drafting).
 */
export async function kimiGenerate(prompt: string, maxTokens = 4000, model?: string): Promise<ProviderResult> {
  if (!KEYS.kimi) return { ok: false, error: 'no key' }
  const useModel = model ?? MODELS.laborNarrative
  const { status, body } = await kimiRequest(
    {
      model: useModel,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      ...thinkingParam(),
    },
    KIMI_TIMEOUT_MS,
  )
  const ctx = getCallContext()
  logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'kimi', useModel, 'labor')
  if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
  const msg = (body as unknown as KimiBody).choices?.[0]?.message
  const content = msg?.content
  if (typeof content !== 'string') return { ok: false, error: 'malformed response' }
  // Reasoning-only reply: the whole token budget went into the thinking
  // trace and no answer was emitted. Surface it as an error so the caller
  // falls back on purpose instead of writing an empty section.
  if (content.trim() === '') {
    const thought = (msg?.reasoning_content ?? '').length
    return {
      ok: false,
      error: thought > 0
        ? `empty content — ${thought} reasoning chars only (raise max_tokens or keep thinking disabled)`
        : 'empty content',
    }
  }
  return { ok: true, text: content }
}

/** Key check: 16-token "Say OK" probe. */
export async function kimiValidate(): Promise<Validation> {
  if (!KEYS.kimi) return { ok: false, detail: 'no key' }
  const { status, body } = await request(
    'POST',
    `${KIMI_BASE}/chat/completions`,
    {
      model: MODELS.laborNarrative,
      messages: [{ role: 'user', content: 'Say OK' }],
      // 16 tokens is not a valid probe for a reasoning model — the budget is
      // consumed by the thinking trace and `content` comes back empty, which
      // reads as a dead key. Thinking off + a little headroom instead.
      max_tokens: 64,
      thinking: { type: 'disabled' },
    },
    auth(),
    30_000,
  )
  if (status === 200) return { ok: true, detail: 'ok — moonshot reachable' }
  return { ok: false, detail: `HTTP ${status}: ${errText(body, 200)}` }
}

/**
 * Kimi with the builtin $web_search tool. Moonshot's handshake: the model
 * emits a tool_calls turn for the builtin function; we echo it back so the
 * server-side search executes, then read the final answer. Kimi returns no
 * structured citation array, so URLs are extracted from the answer text.
 */
export async function kimiRun(prompt: string): Promise<ProviderResult> {
  const messages: KimiMessage[] = [{ role: 'user', content: prompt }]
  const tools = [{ type: 'builtin_function', function: { name: '$web_search' } }]
  let text = ''
  for (let i = 0; i < 4; i++) {
    // bounded tool-call loop
    const { status, body } = await kimiRequest(
      { model: MODELS.laborNarrative, messages, tools, ...thinkingParam() },
      KIMI_TIMEOUT_MS,
    )
    // each loop iteration is one billable API call
    const ctx = getCallContext()
    logCost(ctx.jobId ?? null, ctx.companyId ?? null, 'kimi', MODELS.laborNarrative, 'measured')
    if (status !== 200) return { ok: false, error: `HTTP ${status}: ${errText(body)}` }
    const choice = (body as unknown as KimiBody).choices?.[0]
    const msg = choice?.message
    if (!msg) return { ok: false, error: 'malformed response' }
    const finish = choice?.finish_reason ?? ''
    if (finish === 'tool_calls' && msg.tool_calls) {
      messages.push(msg)
      for (const tc of msg.tool_calls) {
        // builtin: the server executes the search, we just ack the call
        messages.push({ role: 'tool', tool_call_id: tc.id ?? '', content: '' })
      }
      continue
    }
    text = msg.content ?? ''
    break
  }
  const urls = text.match(/https?:\/\/[^\s)\]"'>]+/g) ?? []
  return { ok: true, text, citedUrls: urls, raw: {} }
}
