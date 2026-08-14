/**
 * Company quick-lookup — prefills the audit form from a company name +
 * website. Research stack is Exa + Kimi ONLY (user requirement): homepage
 * fetch (plain HTTP) + one Exa search for evidence, then ONE Kimi call
 * (kimi-k2.6, cheap) extracts sector, location, a one-sentence description
 * and three suggested competitors. Never throws, never calls another vendor.
 */
import { z } from 'zod'
import { exaSearch, kimiGenerate } from '../providers/index.js'

export interface CompanyLookup {
  sector: string
  location: string
  description: string
  suggestedCompetitors: string[]
}

const LookupSchema = z.object({
  sector: z.string().min(2).max(120),
  location: z.string().min(2).max(120),
  description: z.string().min(2).max(120),
  suggestedCompetitors: z.array(z.string().min(1).max(80)).max(5),
})

const FETCH_TIMEOUT_MS = 10_000
// Small evidence set: k2.6 reasons over the whole prompt, so 4k+ chars of
// homepage blows the provider's 90s timeout. 1.5k homepage + Exa is plenty
// for a form prefill.
const HOMEPAGE_CHARS = 1500
/** German output must be Latin script — CJK leakage invalidates the reply. */
const CJK_RX = /[一-鿿　-〿＀-￯]/

/** Strip tags/scripts and collapse whitespace — raw text for the LLM. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain fetch of the homepage, same style as designExtractor.fetchSiteStructure. */
async function fetchHomepageText(url: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LeadEngine/1.0; +company-lookup)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return null
    const text = htmlToText(await res.text())
    return text ? text.slice(0, HOMEPAGE_CHARS) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Exa evidence block: top results as "title — url" lines. Never throws. */
async function exaEvidence(name: string): Promise<string> {
  const res = await exaSearch(`${name} company`, 5).catch(() => null)
  const results = (res?.raw ?? []) as { url?: string; title?: string }[]
  return results
    .map((r) => `${r.title ?? ''} — ${r.url ?? ''}`)
    .filter((s) => s.length > 3)
    .join('\n')
}

function buildPrompt(name: string, website: string, evidence: string): string {
  return (
    `Research the company "${name}" (website: ${website}). ` +
    'Based on the evidence below, output raw JSON only: ' +
    '{"sector": string, "location": string, "description": string, "suggestedCompetitors": [string, string, string]}. ' +
    'Rules: sector = the business category in the company\'s own language (German if the site is German), ' +
    'e.g. "Social Media & Online Marketing Agentur". location = city + country/region, e.g. "Bern, Schweiz". ' +
    'description = ONE sentence, max 120 characters, in the company\'s language. ' +
    'suggestedCompetitors = exactly 3 real competitor company names from the same sector and region.\n\n' +
    `EVIDENCE:\n${evidence}`
  )
}

/** Parse + validate the Kimi reply. Returns null on any malformed output. */
function parseLookupJson(raw: string): CompanyLookup | null {
  if (CJK_RX.test(raw)) return null
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = LookupSchema.parse(JSON.parse(cleaned.slice(start, end + 1)))
    return {
      sector: parsed.sector,
      location: parsed.location,
      description: parsed.description.slice(0, 120),
      suggestedCompetitors: parsed.suggestedCompetitors.slice(0, 3),
    }
  } catch {
    return null
  }
}

/**
 * Quick company research for form prefill. Returns null on total failure —
 * the route maps that to { ok: false } with HTTP 200.
 */
export async function lookupCompany(name: string, website: string): Promise<CompanyLookup | null> {
  // Evidence: homepage text (plain HTTP) + Exa search results. No other vendors.
  const [homepage, exa] = await Promise.all([fetchHomepageText(website), exaEvidence(name)])
  const evidence = [homepage, exa].filter(Boolean).join('\n\n')
  if (!evidence) return null
  // Synthesis: exactly one Kimi call (routed to kimi-k2.6 via config).
  // 2500 tokens: enough for reasoning + JSON, bounded so the 90s provider
  // timeout is not hit on large evidence.
  const res = await kimiGenerate(buildPrompt(name, website, evidence), 2500)
  if (!res.ok || !res.text) return null
  return parseLookupJson(res.text)
}
