/**
 * Stage: intake — validate and persist the company, nothing else.
 * The workflow is triggered by POST /api/companies; this stage exists so the
 * DAG has an explicit, resumable entry point.
 */
import { z } from 'zod'
import { insertCompany } from '../../db/repo.js'
import type { Company, NewCompanyInput } from '../../types.js'

export const NewCompanySchema = z.object({
  name: z.string().min(2),
  sector: z.string().min(2),
  location: z.string().min(2),
  website: z.string().min(4),
  aliases: z.array(z.string()).optional(),
  competitors: z.array(z.string()).optional(),
  buyerPersona: z.string().optional(),
  language: z.enum(['de', 'en']).optional(),
  slackWebhook: z.string().url().optional(),
  locations: z.array(z.string().min(2)).optional(),
  engines: z.array(z.enum(['chatgpt', 'gemini', 'perplexity', 'claude'])).optional(),
  enginePlan: z
    .record(z.enum(['chatgpt', 'gemini', 'perplexity', 'claude']), z.number().int().min(1).max(200))
    .optional(),
  runScope: z.enum(['report', 'actions', 'full']).optional(),
})

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[ä]/g, 'ae')
      .replace(/[ö]/g, 'oe')
      .replace(/[ü]/g, 'ue')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'company'
  )
}

/**
 * Domain hints for citation matching. A single first-label hint missed real
 * citations whenever the URL spelled the brand differently (future-media vs
 * futuremedia) — so emit the full apex host plus the first label in both its
 * hyphenated and de-hyphenated forms. brandCited() is a substring test, so
 * more (still brand-specific) variants only ever add true positives.
 */
function domainHints(website: string): string[] {
  const host = (website.replace(/^https?:\/\//, '').split('/')[0] ?? '').replace(/^www\./, '')
  const label = host.split('.')[0] ?? host
  const hints = new Set<string>()
  if (host.includes('.')) hints.add(host) // full apex domain, strongest signal
  if (label.length > 3) {
    hints.add(label)
    if (label.includes('-')) hints.add(label.replace(/-/g, ''))
  }
  return [...hints].filter(Boolean)
}

/** Pure + deterministic — no LLM, no network. Throws zod errors on bad input. */
export function runIntake(input: NewCompanyInput): Company {
  const data = NewCompanySchema.parse(input)
  const name = data.name.trim()
  // short brand form: engines write "Future Media", not "Future Media GmbH"
  const short = name.replace(/\s+(GmbH|AG|SA|Ltd|LLC|Inc|KG|OHG|mbH)$/i, '').trim()
  // Multi-location: the form sends the primary as `location`; any explicit
  // list wins (deduped), otherwise the single location is the whole list.
  const locations = data.locations?.length
    ? [...new Set(data.locations.map((l) => l.trim()).filter(Boolean))]
    : [data.location.trim()]
  const company: Company = {
    id: slugify(data.name),
    name,
    sector: data.sector.trim(),
    location: data.location.trim(),
    website: data.website.trim(),
    aliases: [name, ...(short !== name ? [short] : []), ...(data.aliases ?? []).filter((a) => a && a !== data.name)],
    domainHints: domainHints(data.website),
    competitors: (data.competitors ?? []).filter(Boolean),
    buyerPersona: data.buyerPersona?.trim() ?? '',
    language: data.language ?? 'de',
    slackWebhook: data.slackWebhook,
    locations,
    engines: data.engines?.length ? data.engines : undefined,
    enginePlan: data.enginePlan,
    runScope: data.runScope ?? 'full',
    createdAt: new Date().toISOString(),
  }
  insertCompany(company)
  return company
}
