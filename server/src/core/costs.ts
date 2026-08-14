/**
 * Per-call cost estimation — the single source of truth for spend numbers.
 *
 * api_cost_log stores no token counts (see schema.sql), so spend can only be
 * approximated per call. This table used to live inline in api/routes.ts;
 * the dataset collector needs exactly the same numbers, so it moved here to
 * make drift between the two impossible.
 *
 * Keys are matched against the LOWERCASE vendor string as stored in
 * api_cost_log.vendor; unknown vendors fall back to FALLBACK_COST_PER_CALL_USD.
 */

/** Blended input+output estimate per API call in USD, by vendor. */
export const COST_PER_CALL_USD: Record<string, number> = {
  openai: 0.03, // gpt-4o-mini class
  google: 0.005, // gemini flash class
  gemini: 0.005, // stored vendor name for the google provider
  perplexity: 0.01, // sonar class
  anthropic: 0.02,
  deepseek: 0.002,
  moonshot: 0.01, // kimi
  kimi: 0.01, // stored vendor name for the moonshot provider
  exa: 0.01,
}

export const FALLBACK_COST_PER_CALL_USD = 0.01

/** Estimated USD for one logged call from its vendor string. */
export function priceOfCall(vendor: string): number {
  return COST_PER_CALL_USD[vendor.toLowerCase()] ?? FALLBACK_COST_PER_CALL_USD
}

/** Estimated USD across a set of logged calls. */
export function estimateUsd(entries: { vendor: string }[]): number {
  return entries.reduce((sum, e) => sum + priceOfCall(e.vendor), 0)
}

/** 4-decimal rounding — the precision every USD figure is reported at. */
export const round4 = (n: number): number => Math.round(n * 10000) / 10000
