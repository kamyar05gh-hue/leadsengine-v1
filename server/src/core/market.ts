/**
 * Market sizing — sector/location-based directional estimates for reports.
 *
 * All tables below are deliberately small and explicit. They are ESTIMATES
 * (based on public 2025/26 AI-adoption studies and relative city sizes),
 * footnoted as such wherever they are rendered. They steer the narrative;
 * they are never presented as measured facts.
 */
import { IMPACT_ASSUMPTIONS, LLM_ADOPTION_PCT } from '../config.js'

/**
 * LLM-adoption estimates (% of the sector's audience already using AI
 * assistants for provider research). First matching row wins; anything
 * unmatched falls back to the global default (config.LLM_ADOPTION_PCT).
 */
const SECTOR_ADOPTION: ReadonlyArray<readonly [RegExp, number]> = [
  [/dental|zahn|medizin|medical|arzt|praxis/i, 45], // medical professions, DACH
  [/legal|anwalt|recht|kanzlei|notar/i, 38],
  [/agentur|agency|marketing|werbung|media/i, 55], // early adopters
  [/retail|handel|shop|e-?commerce/i, 42],
]

/** Estimated % of the sector's audience using LLM search (directional). */
export function llmAdoptionPct(sector: string): number {
  for (const [rx, pct] of SECTOR_ADOPTION) {
    if (rx.test(sector)) return pct
  }
  return LLM_ADOPTION_PCT
}

/**
 * Query-volume factors relative to the base location (Canton Bern = 1.0).
 * Rough proxy for population/economic weight of the market — directional.
 */
const LOCATION_FACTOR: ReadonlyArray<readonly [RegExp, number]> = [
  [/zürich|zurich/i, 2.5],
  [/genf|geneva|genève/i, 1.8],
  [/basel/i, 1.6],
  [/lausanne/i, 1.4],
  [/bern/i, 1.0],
]

/** Sector demand factors relative to the base B2B niche (1.0). Directional. */
const SECTOR_QUERY_FACTOR: ReadonlyArray<readonly [RegExp, number]> = [
  [/dental|zahn|medizin|medical|arzt|praxis/i, 1.0],
  [/legal|anwalt|recht|kanzlei|notar/i, 0.8],
  [/agentur|agency|marketing|werbung|media/i, 1.2],
  [/retail|handel|shop|e-?commerce/i, 1.5],
]

function lookup(table: ReadonlyArray<readonly [RegExp, number]>, s: string): number {
  for (const [rx, f] of table) {
    if (rx.test(s)) return f
  }
  return 1.0
}

/**
 * Estimated monthly high-intent AI queries for the company's market:
 * base queriesPerMonth (config) × location factor × sector factor.
 */
export function monthlyAiQueries(sector: string, location: string): number {
  const base = IMPACT_ASSUMPTIONS.queriesPerMonth
  return Math.round(base * lookup(LOCATION_FACTOR, location) * lookup(SECTOR_QUERY_FACTOR, sector))
}

/**
 * One-line audience phrasing for report covers (the adoption hook).
 * German for lang='de', English otherwise.
 */
export function audienceNote(sector: string, lang: 'de' | 'en'): string {
  const pct = llmAdoptionPct(sector)
  return lang === 'de'
    ? `~${pct}% der Zielgruppe (${sector}) nutzen bereits KI-Assistenten bei der Anbietersuche — Schätzwert, Tendenz steigend.`
    : `~${pct}% of the target audience (${sector}) already use AI assistants when researching providers — estimate, trending up.`
}
