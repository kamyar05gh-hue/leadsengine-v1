/**
 * Regex helpers — brand/alias matching for the scoring core.
 * Ported from the Python pipeline: geo/parse.py substring matching plus the
 * hardcoded CLIENT_RX in leadengine/pdf_final.py / run_audit.py.
 *
 * Why umlaut flexibility: Swiss brand names surface in engine answers in
 * several spellings (Häubi / Haubi / Haeubi). Python hardcoded
 * `h[äa]ubi|haeubi|diepraxisplaner`; here that is generalized so ANY alias
 * containing 'ä' or 'ae' matches all three written forms.
 */
import type { Company } from '../types.js'

/** Escape a literal string for safe embedding in a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Make an escaped alias umlaut-flexible, single pass (no re-nesting):
 *  - 'ä'  → (?:[äa]|ae)   covers Häubi, Haubi, Haeubi
 *  - 'ae' → (?:ae|[äa])   alias already stored in ascii-folded form
 */
function umlautFlex(escaped: string): string {
  return escaped.replace(/ae|ä/g, (m) => (m === 'ä' ? '(?:[äa]|ae)' : '(?:ae|[äa])'))
}

/**
 * Case-insensitive alternation of all aliases, each escaped and made
 * umlaut-flexible. Substring semantics (no word boundaries), matching the
 * Python client_rx.search(name) behavior. Empty input yields a regex that
 * never matches.
 */
export function aliasPattern(aliases: string[]): RegExp {
  if (aliases.length === 0) return /(?!)/ // never matches — no aliases configured
  const body = aliases.map((a) => umlautFlex(escapeRegExp(a))).join('|')
  return new RegExp(body, 'i')
}

/**
 * CLIENT_RX equivalent: aliases + domain hints of the company. Used wherever
 * the Python pipeline used the hardcoded
 * `h[äa]ubi|haeubi|diepraxisplaner` pattern (competitor skip-list,
 * tier_mention, brand_engine_stats rank math).
 */
export function clientPattern(company: Company): RegExp {
  return aliasPattern([...company.aliases, ...company.domainHints])
}
