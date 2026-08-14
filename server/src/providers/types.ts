/**
 * Provider contract types — the shape every LLM/search client returns.
 * Mirrors the dicts returned by the Python geo/providers.py functions.
 */

export interface ProviderResult {
  ok: boolean
  text?: string
  citedUrls?: string[]
  error?: string
  raw?: unknown
}

export interface Validation {
  ok: boolean
  detail: string
}
