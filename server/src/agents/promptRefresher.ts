/**
 * Prompt refresher — keeps a client's prompt library current between audits.
 *
 * Runs on a 3-day cron (see cron/scheduler.ts) and on demand via
 * GET /api/companies/:id/prompts?refresh=1. Each run asks the cheapest labor
 * tier (DeepSeek first, Kimi fallback — via jsonAgent) for up to 15 NEW
 * niche-specific buyer prompts, then stores a new library version with the
 * survivors appended.
 *
 * Hard rules (same as promptgen):
 *  - BIAS GUARD: a generated prompt may NEVER contain the client's name,
 *    aliases, domain hints, or their de-umlauted forms (ae/oe/ue/ss) —
 *    enforced programmatically, not just in the prompt text.
 *  - Dedupe against the existing library (exact + normalized).
 *  - Never throw: any LLM failure returns { added: 0 } with the library
 *    untouched.
 */
import { z } from 'zod'
import { jsonAgent } from './jsonAgent.js'
import { getCompany, insertPromptLibrary, latestPromptLibrary } from '../db/repo.js'
import type { Company, PromptItem } from '../types.js'

/** Cadence of the cron refresh — every 3 days. */
export const PROMPT_REFRESH_DAYS = 3

/** How many fresh prompts a single refresh may add at most. */
const MAX_NEW_PROMPTS = 15

const RefreshItemSchema = z.object({ text: z.string().min(8).max(120) })

/** ä/ö/ü/ß → ae/oe/ue/ss so brand checks catch both spellings. */
function deUmlaut(s: string): string {
  return s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

/**
 * Brand tokens derived from the company profile: full name/alias/domain-hint
 * strings, their first words (>3 chars, like promptgen's hasBrandName) and
 * domain SLDs (TLD stripped) — each in original and de-umlauted form, all
 * lowercased. Individual middle/last words are NOT tokens: a niche word like
 * "Dental" inside "Mock Dental AG" must not flag generic category prompts.
 */
function brandTokens(company: Company): string[] {
  const sources = [company.name, ...company.aliases, ...company.domainHints]
  const tokens = new Set<string>()
  for (const src of sources) {
    for (const variant of [src, deUmlaut(src)]) {
      const v = variant.toLowerCase().trim()
      if (v.length > 3) tokens.add(v)
      const firstWord = v.split(/[^a-z0-9.]+/)[0] ?? ''
      if (firstWord.length > 3) tokens.add(firstWord)
      const sld = v.replace(/\.[a-z]{2,}$/, '')
      if (sld !== v && sld.length > 3) tokens.add(sld)
    }
  }
  return [...tokens]
}

/**
 * BIAS GUARD — true when the prompt mentions the client by name, alias or
 * domain hint (case-insensitive, umlaut-flexible in both directions).
 * Exported for tests; refreshClientPrompts rejects every hit.
 */
export function mentionsClientBrand(text: string, company: Company): boolean {
  const raw = text.toLowerCase()
  const folded = deUmlaut(raw)
  return brandTokens(company).some((t) => raw.includes(t) || folded.includes(t))
}

/** Normalized dedupe key: lowercase + collapsed whitespace. */
function normKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Guess the geo-tier of a free-text prompt — same heuristic as promptgen. */
function inferTier(text: string, company: Company): PromptItem['tier'] {
  const t = deUmlaut(text.toLowerCase())
  const city = (company.location.split(/[,/]/)[0]?.trim() ?? '').toLowerCase()
  if (city && t.includes(city)) return 'city'
  if (/region|nähe|umgebung/.test(t)) return 'region'
  if (/kanton/.test(t)) return 'canton'
  if (/deutschschweiz/.test(t)) return 'cantons'
  if (/dach|deutschland|osterreich|österreich/.test(t)) return 'dach'
  return 'ch'
}

function buildRefreshPrompt(company: Company, existingSample: string[]): string {
  const de = company.language === 'de'
  const existingBlock = existingSample.length
    ? `\nEXISTING PROMPTS (do NOT repeat or lightly rephrase any of these):\n${existingSample.map((p) => `- ${p}`).join('\n')}\n`
    : ''
  // Marker phrase "prompt library refresh" routes the mock provider.
  return `You are a senior SEO/AEO strategist running a prompt library refresh for an AI-search visibility audit.

CLIENT NICHE: ${company.sector} (industry/region: ${company.location})
BUYER PERSONA: ${company.buyerPersona || 'potential customers comparing providers'}
${existingBlock}
Generate up to ${MAX_NEW_PROMPTS} NEW prompts that real users of this niche would type into AI assistants (ChatGPT, Gemini, Perplexity). Output: raw JSON array of objects, each:
{"text": "..."}

RULES:
- Commercial intent, medium granularity: base query + qualifiers (audience, criteria, constraints, or comparison)
- Mirror the real buyer journey: costs, provider comparison, reputation/reviews, selection criteria, local provider search
- NEVER include any brand, company, domain or person name — generic category prompts only (e.g. "beste Online-Marketing-Agentur Bern", never a specific firm)
- Language: ${de ? 'German (Swiss standard German, no ß)' : 'English'}
- Each prompt 8–120 characters, natural phrasing, deduped
- Raw JSON array only, no markdown fences, no commentary`
}

export interface RefreshResult {
  added: number
  total: number
}

/**
 * Append up to 15 fresh, brand-free, deduped prompts to the company's
 * library as a new version. Returns { added, total }; on any LLM failure
 * returns { added: 0, total: <existing count> } and never throws.
 */
export async function refreshClientPrompts(companyId: string): Promise<RefreshResult> {
  try {
    const company = getCompany(companyId)
    if (!company) {
      console.warn(`[promptRefresher] unknown company ${companyId}`)
      return { added: 0, total: 0 }
    }
    const existing = latestPromptLibrary(companyId)
    const items = existing?.items ?? []
    const total = items.length

    const raw = await jsonAgent(
      buildRefreshPrompt(company, items.slice(-25).map((i) => i.text)),
      z.array(RefreshItemSchema),
      { maxTokens: 2500, laborOrder: 'deepseek-first' },
    )
    if (!raw) {
      console.warn(`[promptRefresher] WARNING: LLM failed for ${companyId} — library unchanged`)
      return { added: 0, total }
    }

    const seen = new Set(items.map((i) => normKey(i.text)))
    const newItems: PromptItem[] = []
    for (const r of raw) {
      if (newItems.length >= MAX_NEW_PROMPTS) break
      const text = r.text.trim()
      const key = normKey(text)
      if (seen.has(key) || mentionsClientBrand(text, company)) continue
      seen.add(key)
      const tier = inferTier(text, company)
      newItems.push({ text, scope: tier === 'dach' ? 'dach' : 'regional', persona: 'general', tier })
    }

    if (newItems.length === 0) {
      console.log(`[promptRefresher] ${companyId}: no new prompts survived filtering`)
      return { added: 0, total }
    }

    const lib = insertPromptLibrary(companyId, [...items, ...newItems])
    console.log(`[promptRefresher] ${companyId}: +${newItems.length} prompts (v${lib.version}, total ${lib.items.length})`)
    return { added: newItems.length, total: lib.items.length }
  } catch (err) {
    console.warn(
      `[promptRefresher] WARNING: refresh failed for ${companyId} (${err instanceof Error ? err.message : String(err)})`,
    )
    return { added: 0, total: latestPromptLibrary(companyId)?.items.length ?? 0 }
  }
}
