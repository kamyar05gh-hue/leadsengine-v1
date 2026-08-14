/**
 * Provider registry — measured engines plus labor functions.
 *
 * Measured engines are the audited surfaces (chatgpt, gemini, perplexity,
 * claude). ChatGPT deliberately uses the FORCED web-search variant: organic
 * mode lets
 * the model skip retrieval on niche queries, which starves citation data.
 * Kimi/DeepSeek stay available as labor functions but are excluded.
 *
 * Also home of cost logging: every provider run/generate call inserts one row
 * into api_cost_log via logCost(). Providers read job/company ids from the
 * module-level call context set by the job runner (setCallContext).
 */
import { MOCK_PROVIDERS, ENABLED_ENGINES } from '../config.js'
import { connect } from '../db/client.js'
import type { Engine } from '../types.js'
import { anthropicRun, anthropicValidate } from './anthropic.js'
import { geminiRun, geminiValidate, geminiGenerate as geminiGenerateReal } from './gemini.js'
import { makeMockEngines } from './mock.js'
import { openaiRunForced, openaiValidate } from './openai.js'
import { perplexityRun as perplexityRunReal, perplexityValidate } from './perplexity.js'
import type { ProviderResult, Validation } from './types.js'

export type { ProviderResult, Validation } from './types.js'

export interface MeasuredEngineApi {
  validate(): Promise<Validation>
  run(prompt: string): Promise<ProviderResult>
}

// ─── Call context + cost logging ────────────────────────────────────────────

export interface CallContext {
  jobId?: string
  companyId?: string
}

let callContext: CallContext = {}

/** Set by the job runner before a stage so cost rows get job/company ids. */
export function setCallContext(ctx: CallContext): void {
  callContext = ctx
}

/** Read by provider modules when logging costs. */
export function getCallContext(): CallContext {
  return callContext
}

export type CostKind = 'measured' | 'labor' | 'research'

/**
 * Insert one row into api_cost_log. Best-effort: wrapped in try/catch so
 * logging can never break a provider call.
 */
export function logCost(
  jobId: string | null,
  companyId: string | null,
  vendor: string,
  model: string,
  kind: CostKind,
): void {
  try {
    connect()
      .prepare(
        'INSERT INTO api_cost_log (job_id, company_id, vendor, model, kind, at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(jobId, companyId, vendor, model, kind, new Date().toISOString())
  } catch {
    // swallow — cost logging must never break a call
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * Measured answer engines — audited surfaces only, filtered to the engines
 * enabled via LE_ENGINES (drop a vendor whose key is down without touching
 * code). Returns deterministic mock engines when MOCK_PROVIDERS is on.
 */
export function getMeasuredEngines(): Partial<Record<Engine, MeasuredEngineApi>> {
  const all: Record<Engine, MeasuredEngineApi> = MOCK_PROVIDERS
    ? makeMockEngines()
    : {
        chatgpt: { validate: openaiValidate, run: openaiRunForced },
        gemini: { validate: geminiValidate, run: geminiRun },
        perplexity: { validate: perplexityValidate, run: perplexityRun },
        claude: { validate: anthropicValidate, run: anthropicRun },
      }
  const out: Partial<Record<Engine, MeasuredEngineApi>> = {}
  for (const e of ENABLED_ENGINES) out[e] = all[e]
  return out
}

// ─── Labor functions (never measured surfaces) ──────────────────────────────
// In MOCK mode every labor/research call is routed to the mock module so a
// full dry run makes literally zero network requests.

import { kimiGenerate as kimiGenerateReal } from './kimi.js'
import { deepseekGenerate as deepseekGenerateReal } from './deepseek.js'
import { openaiGenerate as openaiGenerateReal } from './openai.js'
import { exaSearch as exaSearchReal } from './exa.js'
import { mockExaSearch, mockGenerate, mockPerplexityRun } from './mock.js'

export function kimiGenerate(prompt: string, maxTokens?: number, model?: string): Promise<ProviderResult> {
  return MOCK_PROVIDERS ? mockGenerate(prompt) : kimiGenerateReal(prompt, maxTokens, model)
}
export function deepseekGenerate(prompt: string, maxTokens?: number, reasoning?: boolean): Promise<ProviderResult> {
  return MOCK_PROVIDERS ? mockGenerate(prompt) : deepseekGenerateReal(prompt, maxTokens, reasoning)
}
export function openaiGenerate(prompt: string, model?: string, maxTokens?: number): Promise<ProviderResult> {
  return MOCK_PROVIDERS ? mockGenerate(prompt) : openaiGenerateReal(prompt, model, maxTokens)
}
export function perplexityRun(prompt: string, kind: CostKind = 'measured'): Promise<ProviderResult> {
  return MOCK_PROVIDERS ? mockPerplexityRun(prompt) : perplexityRunReal(prompt, kind)
}
export function exaSearch(query: string, n?: number): Promise<ProviderResult> {
  return MOCK_PROVIDERS ? mockExaSearch(query) : exaSearchReal(query, n)
}
export function geminiGenerate(prompt: string, maxTokens?: number, model?: string): Promise<ProviderResult> {
  return MOCK_PROVIDERS ? mockGenerate(prompt) : geminiGenerateReal(prompt, maxTokens, model)
}

export { openaiRun, openaiRunForced } from './openai.js'
export { kimiRun, kimiValidate } from './kimi.js'
export { perplexityValidate } from './perplexity.js'
export { anthropicRun, anthropicValidate } from './anthropic.js'
export { geminiRun, geminiValidate } from './gemini.js'
export { exaValidate } from './exa.js'
export type { ExaResult } from './exa.js'
