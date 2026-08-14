/**
 * Agent: action planner — parallel JSON agents that turn audit + teardown
 * findings into a concrete execution plan.
 *
 * Four planners run concurrently, each with its own zod contract:
 *  - content-strategist: which pages to create (slug, target fan-out query,
 *    answer capsule, schema type, priority)
 *  - schema-engineer: concrete JSON-LD snippets + robots/llms.txt diffs
 *  - directory-agent: which directories, exact NAP payload
 *  - measurement-agent: tracking setup (snippet, GA4 segments, weekly KPIs)
 * Merged into one ActionPlan. Missing planners degrade gracefully — the
 * plan ships with the sections that succeeded.
 */
import { z } from 'zod'
import { jsonAgent } from './jsonAgent.js'
import { learningsBlock } from './retroAnalyzer.js'
import { relevantLearnings } from '../db/repo.js'
import type {
  ActionPlanInput,
  Company,
  ReverseReport,
  ScopedScore,
} from '../types.js'

const PagesSchema = z.object({
  pages: z
    .array(
      z.object({
        slug: z.string(),
        title: z.string(),
        targetQuery: z.string(),
        answerCapsule: z.string(),
        schemaType: z.enum(['FAQPage', 'Article']),
        priority: z.number().int().min(1).max(10),
      }),
    )
    .min(4)
    .max(15),
})

const SchemaSchema = z.object({
  schemaSnippets: z.array(z.object({ page: z.string(), type: z.string(), jsonLd: z.string() })),
  entityTasks: z.array(z.object({ task: z.string(), where: z.string(), detail: z.string() })),
})

const DirectorySchema = z.object({
  directoryListings: z.array(
    z.object({
      directory: z.string(),
      url: z.string(),
      action: z.enum(['claim', 'create', 'update']),
      payload: z.record(z.string()),
    }),
  ),
})

const MeasurementSchema = z.object({
  measurement: z.object({
    snippetInstructions: z.string(),
    ga4Segments: z.array(z.string()),
    weeklyKpis: z.array(z.string()),
  }),
})

function contextBlock(company: Company, scoped: ScopedScore, reverse: ReverseReport[]): string {
  const o = scoped.combined.overall
  const tops = scoped.combined.competitors.slice(0, 5).map((c) => c.name).join(', ')
  const secrets = reverse
    .map((r) => `${r.competitor}: ${r.whyTheyWin.join('; ')}`)
    .join('\n')
  // Retro-learning memory: intervention patterns and market insights from
  // previous audits feed every planner, so recommendations compound.
  const memory = learningsBlock(relevantLearnings(company.sector, ['insight', 'action']))
  return [
    `CLIENT: ${company.name} — ${company.sector}, ${company.location}, ${company.website}`,
    `AUDIT: mention ${o.mentionRate}%, citation ${o.citationRate}%, SoV ${o.sov}%, top competitor SoV ${o.topCompetitorSov}%`,
    `TOP COMPETITORS: ${tops || 'none discovered'}`,
    `COMPETITOR TEARDOWN:\n${secrets || '(no teardown data)'}`,
    memory.trimEnd(),
  ].filter(Boolean).join('\n')
}

/**
 * Run all four planners in parallel and merge. Each planner is optional —
 * its section falls back to an empty/default value, never blocks the plan.
 */
export async function planActions(
  company: Company,
  scoped: ScopedScore,
  reverse: ReverseReport[],
): Promise<ActionPlanInput> {
  const ctx = contextBlock(company, scoped, reverse)

  const [pages, schema, directories, measurement] = await Promise.all([
    jsonAgent(
      `${ctx}\n\nYou are the content strategist. Define the answer-shaped pages the client must publish on their OWN domain to win AI citations. One page per fan-out query cluster from the audit. Output raw JSON: {"pages": [{"slug", "title", "targetQuery", "answerCapsule" (40-60 words, German, the direct answer), "schemaType": "FAQPage"|"Article", "priority" 1-10}]}. 8-12 pages, highest leverage first. Raw JSON only.`,
      PagesSchema,
      // Page-related reasoning is Kimi-only (no DeepSeek in page chains).
      { laborOrder: 'kimi-only' },
    ),
    jsonAgent(
      `${ctx}\n\nYou are the schema engineer. Produce the structured-data and entity setup: FAQPage/Article JSON-LD for the planned pages, LocalBusiness with sameAs for the homepage, robots.txt AI-crawler rules, llms.txt content, Wikidata task. Output raw JSON: {"schemaSnippets": [{"page", "type", "jsonLd" (stringified JSON-LD)}], "entityTasks": [{"task", "where", "detail"}]}. Raw JSON only.`,
      SchemaSchema,
    ),
    jsonAgent(
      `${ctx}\n\nYou are the directory agent. Which directories and portals must carry this company's data (Switzerland/DACH focus: local.ch, search.ch, moneyhouse, Google Business, wlw, Bing Places, industry portals)? Identical NAP everywhere. Output raw JSON: {"directoryListings": [{"directory", "url", "action": "claim"|"create"|"update", "payload" (object of field:value)}]}. Raw JSON only.`,
      DirectorySchema,
    ),
    jsonAgent(
      `${ctx}\n\nYou are the measurement agent. Define how results get tracked: the referral-snippet placement instructions, GA4 referrer segments for AI engines (chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com), and the weekly KPI list (mention rate, citation rate, SoV, AI referral clicks, leads). Output raw JSON: {"measurement": {"snippetInstructions", "ga4Segments": [], "weeklyKpis": []}}. Raw JSON only.`,
      MeasurementSchema,
    ),
  ])

  return {
    pages: (pages?.pages ?? []).map((p) => ({ ...p, status: 'pending' as const })),
    schemaSnippets: schema?.schemaSnippets ?? [],
    directoryListings: directories?.directoryListings ?? [],
    entityTasks: schema?.entityTasks ?? [],
    measurement: measurement?.measurement ?? {
      snippetInstructions: 'Tracking-Snippet vor </body> einfügen (wird vom LeadEngine-Server ausgeliefert).',
      ga4Segments: ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com'],
      weeklyKpis: ['Mention rate', 'Citation rate', 'SoV', 'AI referral clicks', 'Leads'],
    },
  }
}

/** Render the plan as a client-facing Markdown playbook. */
export function planToMarkdown(
  company: Company,
  plan: ActionPlanInput,
  reverse: ReverseReport[],
): string {
  const L: string[] = [
    `# GEO Action Plan — ${company.name}`,
    '',
    `${company.sector} · ${company.location} · ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Warum Wettbewerber gewinnen',
    '',
  ]
  for (const r of reverse) {
    L.push(`### ${r.competitor}`)
    for (const w of r.whyTheyWin) L.push(`- ${w}`)
    L.push('')
  }
  L.push('## Zu erstellende Seiten (eigene Domain)', '')
  for (const p of [...plan.pages].sort((a, b) => a.priority - b.priority)) {
    L.push(`### P${p.priority} — ${p.title}`)
    L.push(`- URL: ${p.slug}`)
    L.push(`- Ziel-Query: ${p.targetQuery}`)
    L.push(`- Schema: ${p.schemaType}`)
    L.push(`- Antwort-Kapsel: ${p.answerCapsule}`)
    L.push('')
  }
  L.push('## Verzeichnisse', '')
  for (const d of plan.directoryListings) {
    L.push(`- ${d.directory} (${d.action}) — ${d.url}`)
  }
  L.push('', '## Entity & Schema', '')
  for (const t of plan.entityTasks) L.push(`- ${t.task} — ${t.where}: ${t.detail}`)
  L.push('', '## Messung', '')
  L.push(plan.measurement.snippetInstructions, '')
  for (const k of plan.measurement.weeklyKpis) L.push(`- ${k}`)
  L.push('')
  return L.join('\n')
}
