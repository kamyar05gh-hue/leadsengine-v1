/**
 * JSON-output LLM agent helper.
 *
 * All research/planning agents in this platform are JSON contracts, not
 * free-text parsing (the Profound "marketing engineer" pattern): a zod
 * schema defines the output, the model is instructed to emit raw JSON only,
 * and invalid output is retried with the validation errors fed back.
 * Labor routing: Kimi primary, DeepSeek fallback — cheapest labor tier.
 * Page-related agents pass laborOrder:'kimi-only' (no DeepSeek anywhere in
 * page chains).
 */
import { z } from 'zod'
import { deepseekGenerate, kimiGenerate } from '../providers/index.js'

export interface JsonAgentOptions {
  /** Max repair attempts after the first invalid answer. Default 1. */
  retries?: number
  maxTokens?: number
  /** Kimi model override (e.g. MODELS.laborPages for long outputs). */
  model?: string
  /**
   * Labor routing order — 'deepseek-first' for the cheapest tier,
   * 'kimi-only' for page-related chains (DeepSeek is banned from every
   * page-related chain; Kimi retries itself instead of falling back).
   * Default 'kimi-first'.
   */
  laborOrder?: 'kimi-first' | 'deepseek-first' | 'kimi-only'
}

/** Extract the first JSON array/object from a model answer (fences tolerated). */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.search(/[[{]/)
  if (start < 0) throw new Error('no JSON found in model output')
  const open = cleaned[start] as string
  const close = open === '[' ? ']' : '}'
  const end = cleaned.lastIndexOf(close)
  if (end <= start) throw new Error('unterminated JSON in model output')
  return JSON.parse(cleaned.slice(start, end + 1))
}

/**
 * Call a labor LLM and validate its answer against a zod schema.
 * Returns the parsed value, or null when every attempt fails validation —
 * callers decide the fallback (never crash a job on a malformed draft).
 */
export async function jsonAgent<S extends z.ZodType>(
  prompt: string,
  schema: S,
  opts: JsonAgentOptions = {},
): Promise<z.infer<S> | null> {
  const retries = opts.retries ?? 1
  let lastErrors = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    const p = attempt === 0
      ? prompt
      : `${prompt}\n\nYour previous answer failed validation:\n${lastErrors}\nReturn corrected raw JSON only.`
    let res =
      opts.laborOrder === 'deepseek-first'
        ? await deepseekGenerate(p, opts.maxTokens ?? 4000)
        : await kimiGenerate(p, opts.maxTokens ?? 4000, opts.model)
    if (!res.ok || !res.text) {
      // Fallback vendor. 'kimi-only' chains never touch DeepSeek — they
      // retry Kimi once instead (transient failures) and stop there.
      res =
        opts.laborOrder === 'deepseek-first'
          ? await kimiGenerate(p, opts.maxTokens ?? 4000, opts.model)
          : opts.laborOrder === 'kimi-only'
            ? await kimiGenerate(p, opts.maxTokens ?? 4000, opts.model)
            : await deepseekGenerate(p, opts.maxTokens ?? 4000)
    }
    if (!res.ok || !res.text) return null
    try {
      return schema.parse(extractJson(res.text))
    } catch (err) {
      lastErrors = err instanceof Error ? err.message.slice(0, 800) : String(err)
    }
  }
  return null
}
