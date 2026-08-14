/**
 * Stage: promptgen — demand-shaped prompt library, grounded in live search data.
 *
 * Pipeline per run:
 *  1. Seed prompts are derived from the company profile (sector, location,
 *     services split off the sector label).
 *  2. Exa demand layer (skipped silently when EXA_API_KEY is unset):
 *       - findPeopleAlsoAsk: real question-style phrasings buyers ask
 *       - expandWithQueryFanOut: pricing/comparison/local/how-to variations
 *       - validateSearchVolume: every Exa-derived candidate must return live
 *         results before it may enter the library
 *  3. The LLM draft (the original backbone, kept as the fallback) receives
 *     the validated demand signals as evidence, so its 50-per-scope output
 *     is demand-shaped rather than imagined.
 *  4. Slot filling (50 per scope: 25 general / 25 avatar, geo-tiered)
 *     prefers Exa-validated items, then LLM items, then deterministic
 *     templates — a full-template fallback is logged loudly, never shipped
 *     silently.
 *  5. A multilingual layer (French + Italian for the Swiss market) is
 *     appended on top of the 100 core German prompts → 100+ per library.
 *
 * The labor model mirrors the real buyer journey (Profound's query fan-out:
 * one buyer question fans out into component searches). Hard rules: zero
 * brand names, natural buyer phrasing, balanced personas. Every Exa call
 * failure degrades gracefully to the original LLM-only generation.
 */
import { z } from 'zod'
import { jsonAgent } from '../../agents/jsonAgent.js'
import { learningsBlock } from '../../agents/retroAnalyzer.js'
import { insertPromptLibrary, latestPromptLibrary, relevantLearnings } from '../../db/repo.js'
import { KEYS, MOCK_PROVIDERS, SCOPE_B_IS_DE_CH } from '../../config.js'
import { exaSearch } from '../../providers/index.js'
import type { ExaResult } from '../../providers/index.js'
import type { Company, PromptItem, PromptLibrary, Scope } from '../../types.js'

const PromptItemSchema = z.object({
  text: z.string().min(8),
  persona: z.enum(['general', 'avatar']),
  tier: z.enum(['city', 'region', 'canton', 'cantons', 'ch', 'dach']),
})

const REGIONAL_TIERS = ['city', 'region', 'canton', 'cantons', 'ch'] as const

// ─── Exa demand layer ───────────────────────────────────────────────────────
// Exa is a labor/research provider (never a measured surface). Every public
// function here is failure-tolerant: no key, HTTP errors and timeouts all
// resolve to "no signal" so promptgen always falls back to LLM-only mode.

/** True when the Exa demand layer can run (real key, or mock dry-run mode). */
function exaEnabled(): boolean {
  return Boolean(KEYS.exa) || MOCK_PROVIDERS
}

/** German question openers — used to spot "people also ask"-style titles. */
const QUESTION_WORDS =
  /^(wer|was|wie|welch|wo|wann|warum|wieso|wozu|lohnt|kann|soll|sollte|ist|sind|gibt|braucht|kostet)\b/i

/** A result title counts as PAA-style when it reads like a buyer question. */
function looksLikeQuestion(title: string): boolean {
  const t = title.trim()
  return t.includes('?') || QUESTION_WORDS.test(t)
}

/**
 * Drop the site-name trailer from a search-result title. Covers pipe/bullet
 * separators (" | Site", " • Site") and hyphen/dash separators
 * (" - Site", " – Site", " — Site") — the latter previously survived and
 * leaked publisher names ("...Preise 2026 - Digital-PR") straight into
 * generated prompts, pushing them past the 90-char cap.
 */
function cleanTitle(title: string): string {
  return (title.split(/\s[|•·]\s|\s[-–—]\s(?=[^-–—]*$)/)[0] ?? title).trim()
}

/**
 * Find "people also ask"-style questions for a topic via Exa neural search.
 * Exa has no literal PAA box, so we run a question-rich query and keep only
 * result titles that read like real buyer questions (FAQs, forums, guides).
 * Returns [] on any failure — callers treat empty as "no demand signal".
 */
export async function findPeopleAlsoAsk(sector: string, location: string): Promise<string[]> {
  if (!exaEnabled()) return []
  try {
    const res = await exaSearch(`${sector} ${location} — häufige Fragen, Kosten und Erfahrungen`, 8)
    if (!res.ok) return []
    const results = (res.raw ?? []) as ExaResult[]
    const seen = new Set<string>()
    const questions: string[] = []
    for (const r of results) {
      const q = cleanTitle(r.title)
      const key = q.toLowerCase()
      // too short/long → not a usable prompt; dedupe case-insensitively
      if (q.length < 12 || q.length > 120 || !looksLikeQuestion(q) || seen.has(key)) continue
      seen.add(key)
      questions.push(q)
    }
    return questions.slice(0, 8)
  } catch {
    return [] // network/parse failure → no signal, never break promptgen
  }
}

/**
 * Search-volume proxy: a prompt has real demand when a live Exa search for
 * it returns any results. Returns null when validation is unavailable (no
 * key, HTTP error) so callers can distinguish "no volume" from "unknown".
 */
export async function validateSearchVolume(prompt: string): Promise<boolean | null> {
  if (!exaEnabled()) return null
  try {
    const res = await exaSearch(prompt, 3)
    if (!res.ok) return null
    return ((res.raw ?? []) as ExaResult[]).length > 0
  } catch {
    return null
  }
}

/**
 * Query fan-out (deterministic, zero-cost): one buyer question fans out
 * into the four component searches of the real buyer journey — pricing,
 * comparison, local provider search, and how-to/selection.
 */
export function expandWithQueryFanOut(seedPrompt: string): string[] {
  const s = seedPrompt.trim().replace(/[?.!]+$/, '')
  return [
    `Was kostet ${s}?`, // pricing
    `Beste ${s} im Vergleich`, // comparison
    `${s} — Empfehlungen in der Nähe`, // local
    `${s} — worauf achten? Auswahl und Ablauf`, // how-to
  ]
}

/**
 * Seed topics from the company profile: primary service + city, the service
 * nationally, secondary services locally, and one DACH-wide seed. These are
 * noun phrases so the fan-out templates above read naturally.
 */
function buildSeeds(company: Company): string[] {
  const services = company.sector
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  const primary = services[0] ?? company.sector.trim()
  // Seed every audited location (e.g. Bern AND Zürich), not just the primary.
  const cities = (company.locations.length ? company.locations : [company.location])
    .map((l) => l.split(/[,/]/)[0]?.trim() ?? l)
    .filter((c) => c && !/^(schweiz|dach)$/i.test(c))
    .slice(0, 3)
  const seeds = [
    ...cities.map((city) => `${primary} ${city}`),
    `${primary} Schweiz`,
    ...services.slice(1, 3).flatMap((s) => cities.slice(0, 1).map((city) => `${s} ${city}`)),
  ]
  return [...new Set(seeds)].slice(0, 6)
}

/** Guess the geo-tier of a free-text question from the place it mentions. */
function inferTier(text: string, company: Company): PromptItem['tier'] {
  const t = text.toLowerCase()
  const cities = (company.locations.length ? company.locations : [company.location])
    .map((l) => (l.split(/[,/]/)[0]?.trim() ?? '').toLowerCase())
    .filter((c) => c && !/^(schweiz|dach)$/.test(c))
  if (cities.some((city) => t.includes(city))) return 'city'
  if (/region|nähe|umgebung/.test(t)) return 'region'
  if (/kanton/.test(t)) return 'canton'
  if (/deutschschweiz/.test(t)) return 'cantons'
  if (/dach|deutschland|österreich/.test(t)) return 'dach'
  return 'ch'
}

/** Expert vocabulary marks the professional buyer; everything else is lay. */
function inferPersona(text: string): PromptItem['persona'] {
  return /fach|kriterien|anbieter|kmu|roi|budget|vergleich|auswahl/.test(text.toLowerCase())
    ? 'avatar'
    : 'general'
}

/** Bounded-concurrency map — Exa calls run 3–5 wide, never all at once. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return out
}

/** What the Exa demand layer harvested for one company. */
interface DemandHarvest {
  /** Volume-validated candidate prompts, tier/persona/scope inferred. */
  items: PromptItem[]
  /** Short demand-signal lines injected into the LLM brief as evidence. */
  signals: string[]
}

/**
 * Harvest real demand: PAA questions per seed + query fan-out per seed,
 * deduped, brand-filtered, then validated for live search volume. Any
 * total failure (no key, outage) returns an empty harvest and the caller
 * continues with the original LLM-only generation.
 */
async function harvestDemand(company: Company): Promise<DemandHarvest> {
  const empty: DemandHarvest = { items: [], signals: [] }
  if (!exaEnabled()) {
    console.log('[promptgen] EXA_API_KEY not set — LLM-only generation (fallback)')
    return empty
  }
  try {
    const seeds = buildSeeds(company)

    // 1) people-also-ask per seed (3-wide) + 2) deterministic fan-out per seed
    const paaLists = await mapLimit(seeds, 3, (s) => findPeopleAlsoAsk(s, company.location))
    const candidates: string[] = []
    for (const seed of seeds) candidates.push(...expandWithQueryFanOut(seed))
    for (const list of paaLists) candidates.push(...list)

    // dedupe (case-insensitive), length cap, zero brand names
    const seenKeys = new Set<string>()
    const uniq: string[] = []
    for (const c of candidates) {
      const text = c.trim()
      const key = text.toLowerCase()
      if (text.length < 12 || text.length > 120 || seenKeys.has(key) || hasBrandName(text, company)) continue
      seenKeys.add(key)
      uniq.push(text)
    }

    // 3) search-volume validation (5-wide); null = validation unavailable
    const verdicts = await mapLimit(uniq, 5, (c) => validateSearchVolume(c))
    const validated = uniq.filter((_, i) => verdicts[i] === true)
    if (validated.length === 0 && uniq.length > 0 && verdicts.every((v) => v === null)) {
      // every single call failed → Exa outage, not "no demand": fall back
      console.warn('[promptgen] WARNING: Exa unreachable — LLM-only generation (fallback)')
      return empty
    }

    const items: PromptItem[] = validated.map((text) => {
      const tier = inferTier(text, company)
      const scope: Scope = tier === 'dach' ? 'dach' : 'regional'
      return { text, scope, persona: inferPersona(text), tier }
    })
    console.log(`[promptgen] exa demand: ${validated.length}/${uniq.length} candidates with real search volume`)
    return { items, signals: validated.slice(0, 20) }
  } catch (err) {
    console.warn(
      `[promptgen] WARNING: Exa demand harvest failed (${err instanceof Error ? err.message : String(err)}) — LLM-only fallback`,
    )
    return empty
  }
}

// ─── LLM generation (original backbone + fallback) ──────────────────────────

function buildScopePrompt(company: Company, scope: Scope, signals: string[]): string {
  const cities = (company.locations.length ? company.locations : [company.location])
    .filter((l) => !/^(schweiz|dach)$/i.test(l))
    .join(', ')
  const scopeRules =
    scope === 'regional'
      ? `50 prompts, tiers: 10 city, 10 region, 10 canton, 10 cantons, 10 ch — city/region/canton prompts must be spread across ALL audited locations (${cities || company.location}), cantons = German-speaking Switzerland, ch = whole Switzerland`
      : SCOPE_B_IS_DE_CH
        ? '50 prompts, tiers: 10 ch, 40 cantons — German-speaking Switzerland only (Zürich, Bern, Luzern, Basel, St. Gallen, Aargau etc.). NO Germany/Austria phrasing.'
        : '50 prompts, tiers: 10 ch, 40 dach — DACH-wide incl. Germany/Austria phrasing'
  // Exa-derived demand evidence: real questions with verified search volume.
  // The LLM adapts them into the correct persona/tier slots instead of
  // imagining demand from scratch.
  const demandBlock = signals.length
    ? `\nREAL DEMAND SIGNALS (live web research — questions buyers actually ask in this sector, all with verified search volume; adapt the fitting ones into correct persona/tier slots, rephrase freely):\n${signals.map((s) => `- ${s}`).join('\n')}\n`
    : ''
  // Retro-learning memory: lessons distilled from previous audits (this
  // sector + global). Winning prompt shapes become few-shot exemplars,
  // pitfalls become guardrails — the system improves run over run.
  const memory = learningsBlock(relevantLearnings(company.sector, ['prompt_pattern', 'pitfall']))
  const avatar = company.buyerPersona || 'potential customers comparing providers'
  return `You are a senior SEO/AEO strategist. Build benchmark search prompts for an AI-search visibility audit.

CLIENT SECTOR: ${company.sector} (locations: ${cities || company.location})
AVATAR (target audience): ${avatar}
${demandBlock}${memory}
Generate EXACTLY 50 prompts that real buyers of this sector type into AI assistants (ChatGPT, Gemini). Output: raw JSON array of 50 objects, each:
{"text": "...", "persona": "general"|"avatar", "tier": "..."}

RULES:
- ${scopeRules}
- 25 persona="general" (layperson comparing options) + 25 persona="avatar" — avatar prompts are what the AVATAR above would actually type: their goals, budget language, decision criteria and vocabulary. Write them from that person's real situation, not a generic "expert".
- HIGH-FREQUENCY PHRASING ONLY: model each prompt on the most-asked question patterns for this niche ("beste X in Y", "X Agentur Y Empfehlung", "was kostet X", "X vs Y was lohnt sich", "wer macht X für KMU in Y"). No invented long-tail essays, no academic phrasing — if a real person would not type it into ChatGPT, drop it.
- Use the niche's concrete SERVICE vocabulary (for a social-media agency: Instagram, LinkedIn, TikTok, Ads, Content, Community Management, Employer Branding…), never the literal sector label with slashes or jargon
- Mirror the real buyer journey: ~20% early-stage informational (costs, process), ~20% category choice (which type of provider), ~20% comparison/reputation ("best", "reviews", "experiences"), ~20% technical/how-it-works, ~20% provider search ("who offers X in Y")
- Comparison/reputation and provider-search prompts are the ones where AI assistants actually name companies — make them concrete and local
- NEVER include any brand or company name (not the client, not competitors)
- Language: German (Swiss standard German, no ß)
- Each prompt max 90 characters, natural phrasing, deduped
- Raw JSON array only, no markdown fences, no commentary`
}

// ─── Multilingual layer (Swiss market: FR + IT on top of the German core) ───

const MultilingualItemSchema = z.object({
  text: z.string().min(8),
  lang: z.enum(['fr', 'it']),
  persona: z.enum(['general', 'avatar']),
  tier: z.enum(['city', 'region', 'canton', 'cantons', 'ch']),
})

function buildMultilingualPrompt(company: Company): string {
  return `You are a senior SEO/AEO strategist for the Swiss market. Build benchmark search prompts for an AI-search visibility audit.

CLIENT SECTOR: ${company.sector} (location: ${company.location})
BUYER PERSONA: ${company.buyerPersona || 'potential customers comparing providers'}

Generate EXACTLY 16 prompts that real buyers type into AI assistants — 8 in French, 8 in Italian. Output: raw JSON array of 16 objects, each:
{"text": "...", "lang": "fr"|"it", "persona": "general"|"avatar", "tier": "city"|"region"|"canton"|"cantons"|"ch"}

RULES:
- French prompts target the client's area and French-speaking Switzerland (Romandie); Italian prompts target the client's area and Ticino
- Per language: 4 persona="general" + 4 persona="avatar", mixed tiers
- Mirror the real buyer journey (costs, comparison, reputation, how-it-works, provider search)
- NEVER include any brand or company name (not the client, not competitors)
- Each prompt max 90 characters, natural native phrasing, deduped
- Raw JSON array only, no markdown fences, no commentary`
}

/**
 * French + Italian prompts for the Swiss market, appended beyond the 100
 * core German prompts (set LE_PROMPTGEN_MULTILINGUAL=0 to disable).
 * Failure is non-fatal: the core library stands on its own.
 */
async function generateMultilingual(company: Company, seen: Set<string>): Promise<PromptItem[]> {
  if (process.env.LE_PROMPTGEN_MULTILINGUAL === '0') return []
  const raw = await jsonAgent(buildMultilingualPrompt(company), z.array(MultilingualItemSchema), {
    maxTokens: 3000,
  })
  if (!raw) {
    console.warn('[promptgen] WARNING: multilingual (fr/it) generation failed — library stays German-only')
    return []
  }
  const out: PromptItem[] = []
  for (const r of raw) {
    const text = r.text.trim()
    const key = text.toLowerCase()
    if (seen.has(key) || hasBrandName(text, company)) continue
    seen.add(key)
    // `lang` is carried through from the generator (fr/it) so the stored
    // library records it as fact — the dataset collector no longer has to
    // infer the multilingual layer from the prompt text.
    out.push({ text, scope: 'regional', persona: r.persona, tier: r.tier, lang: r.lang })
  }
  return out
}

// ─── Shared validation / fallback helpers ───────────────────────────────────

/** Brand-name check; returns true if the prompt mentions client/competitor. */
function hasBrandName(text: string, company: Company): boolean {
  const key = text.toLowerCase()
  const brandTerms = [company.name, ...company.aliases, ...company.competitors]
    .map((s) => s.toLowerCase().split(/\s+/)[0] ?? '')
    .filter((s) => s.length > 3)
  return brandTerms.some((b) => key.includes(b))
}

/** Deterministic top-up items for slots the LLM didn't fill. */
function topUpTemplates(company: Company, scope: Scope, persona: 'general' | 'avatar', tier: PromptItem['tier'], count: number): PromptItem[] {
  const sector = company.sector.split('/')[0]?.trim().toLowerCase() ?? company.sector.toLowerCase()
  const city = company.location.split(/[,/]/)[0]?.trim() ?? company.location
  const where: Record<string, string> = {
    city: ` in ${city}`,
    region: ` in der Region ${city}`,
    canton: ` im Kanton ${city}`,
    cantons: ' in der Deutschschweiz',
    ch: ' in der Schweiz',
    dach: SCOPE_B_IS_DE_CH ? ' in der Deutschschweiz' : ' in der DACH-Region',
  }
  const w = where[tier] ?? ''
  const general = [
    `Was kostet eine ${sector}${w}?`,
    `Beste ${sector}${w} — Vergleich`,
    `Welche ${sector}${w} ist empfehlenswert?`,
    `Erfahrungen mit ${sector}${w}?`,
    `${sector}${w} — worauf achten?`,
  ]
  const avatar = [
    `${sector}${w} — Anbietervergleich für Fachpersonen?`,
    `Kostenrahmen ${sector}${w} — was ist realistisch?`,
    `Erfahrene ${sector}${w} gesucht — Kriterien?`,
    `Qualitätskriterien bei der Wahl einer ${sector}${w}?`,
    `${sector}${w} — ROI und Budget für KMU?`,
  ]
  const src = persona === 'general' ? general : avatar
  return src.slice(0, count).map((text) => ({ text, scope, persona, tier }))
}

/**
 * Generate (or reuse) the company's prompt library. Idempotent: returns the
 * latest existing library unless force=true (weekly re-audits reuse the
 * same version so trends stay comparable).
 *
 * Composition: 100 core German prompts (50 regional / 50 scope-B, balanced
 * 25 general / 25 avatar per scope, geo-tiered city→DACH) filled from
 * Exa-validated real-demand questions first, then the demand-shaped LLM
 * draft, then deterministic templates — plus up to 16 multilingual (FR/IT)
 * prompts for the Swiss market on top.
 */
export async function runPromptgen(company: Company, force = false): Promise<PromptLibrary> {
  const existing = latestPromptLibrary(company.id)
  if (existing && !force) return existing

  // Exa demand layer — empty harvest means "LLM-only", by design.
  const demand = await harvestDemand(company)

  const items: PromptItem[] = []
  const seen = new Set<string>()
  let llmItems = 0
  let exaItems = 0

  // Exa-validated candidates, shared across scopes: slot filling retiers and
  // rescopes them exactly like LLM items (real demand beats imagined demand).
  const demandPool = demand.items.map((d) => ({ ...d }))

  for (const scope of ['regional', 'dach'] as const) {
    // expected counts per (persona, tier) for this scope
    const tiers: PromptItem['tier'][] =
      scope === 'regional'
        ? [...REGIONAL_TIERS]
        : SCOPE_B_IS_DE_CH
          ? ['ch', 'cantons', 'cantons', 'cantons', 'cantons']
          : ['ch', 'dach', 'dach', 'dach', 'dach']
    const want: { persona: 'general' | 'avatar'; tier: PromptItem['tier'] }[] = []
    for (const tier of tiers) {
      for (let i = 0; i < 5; i++) want.push({ persona: 'general', tier }, { persona: 'avatar', tier })
    }

    let raw: z.infer<typeof PromptItemSchema>[] | null = null
    for (let attempt = 0; attempt < 3 && !raw; attempt++) {
      raw = await jsonAgent(buildScopePrompt(company, scope, demand.signals), z.array(PromptItemSchema), {
        maxTokens: 6000,
      })
    }

    const pool = (raw ?? []).filter(
      (r, i, arr) =>
        !hasBrandName(r.text, company) &&
        !seen.has(r.text.trim().toLowerCase()) &&
        arr.findIndex((x) => x.text.trim().toLowerCase() === r.text.trim().toLowerCase()) === i,
    )
    if (!raw) console.warn(`[promptgen] WARNING: LLM failed for scope=${scope} — using template top-up for all 50`)

    // fill each (persona, tier) slot from the pool; top up with templates
    const take = (idx: number): z.infer<typeof PromptItemSchema> => {
      const r = pool.splice(idx, 1)[0]!
      // purge any same-text twins so no slot can pick a duplicate
      const key = r.text.trim().toLowerCase()
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i]!.text.trim().toLowerCase() === key) pool.splice(i, 1)
      }
      return r
    }
    for (const slot of want) {
      // Defensive purge: `pool` was filtered against `seen` once at
      // construction, but `seen` keeps growing as slots fill (from Exa
      // picks, other pool picks, and template top-ups). The same demand
      // signal gets injected into BOTH scopes' LLM prompts, so identical
      // phrasing can independently surface in this scope's pool after the
      // other scope already committed it — purge live, right before every
      // pick, so no stale pool entry can ever be selected as a duplicate.
      for (let i = pool.length - 1; i >= 0; i--) {
        if (seen.has(pool[i]!.text.trim().toLowerCase())) pool.splice(i, 1)
      }
      let item: PromptItem
      // 1) Exa-validated real-demand items: exact persona+tier, else retier
      let di = demandPool.findIndex(
        (d) => d.persona === slot.persona && d.tier === slot.tier && !seen.has(d.text.toLowerCase()),
      )
      if (di < 0) di = demandPool.findIndex((d) => d.persona === slot.persona && !seen.has(d.text.toLowerCase()))
      if (di >= 0) {
        const d = demandPool.splice(di, 1)[0]!
        item = { text: d.text, scope, persona: d.persona, tier: slot.tier }
        exaItems++
        seen.add(item.text.toLowerCase())
        items.push(item)
        continue
      }
      // 2) demand-shaped LLM draft
      const idx = pool.findIndex((r) => r.persona === slot.persona && r.tier === slot.tier)
      if (idx >= 0) {
        const r = take(idx)
        item = { text: r.text.trim(), scope, persona: r.persona, tier: r.tier }
        llmItems++
      } else {
        // try any item with the right persona, retier it
        const anyIdx = pool.findIndex((r) => r.persona === slot.persona)
        if (anyIdx >= 0) {
          const r = take(anyIdx)
          item = { text: r.text.trim(), scope, persona: r.persona, tier: slot.tier }
          llmItems++
        } else {
          // 3) deterministic template top-up (logged via the count below)
          const [t] = topUpTemplates(company, scope, slot.persona, slot.tier, 1)
          let text = t!.text
          let n = 2
          while (seen.has(text.toLowerCase())) text = `${t!.text.replace(/\?$/, '')} (Variante ${n++})?`
          item = { text, scope, persona: slot.persona, tier: slot.tier }
        }
      }
      seen.add(item.text.toLowerCase())
      items.push(item)
    }
  }

  // multilingual layer (FR/IT) — appended beyond the 100 core prompts
  const multilingual = await generateMultilingual(company, seen)
  items.push(...multilingual)

  if (items.length < 100) throw new Error(`promptgen built ${items.length} prompts, expected at least 100`)
  console.log(
    `[promptgen] library: ${exaItems} exa-validated, ${llmItems} LLM-generated, ` +
      `${100 - exaItems - llmItems} template top-up, +${multilingual.length} multilingual (total ${items.length})`,
  )
  return insertPromptLibrary(company.id, items)
}
