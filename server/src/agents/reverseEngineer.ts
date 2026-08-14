/**
 * Agent: reverse engineer — why do competitors win AI citations?
 *
 * Per competitor (top 3 by mention share):
 *  1. Exa fetches their web surface (top pages for their brand + niche)
 *  2. Perplexity researches why engines recommend them (grounded, cited)
 *  3. A Kimi JSON agent synthesizes both into a ReverseReport contract
 *
 * The JSON schema is the contract — free-text teardowns are not allowed to
 * reach the action-planning stage.
 */
import { z } from 'zod'
import { jsonAgent } from './jsonAgent.js'
import { exaSearch, perplexityRun } from '../providers/index.js'
import type { Company, Competitor, ReverseReport } from '../types.js'

const ReverseSchema = z.object({
  whyTheyWin: z.array(z.string()).min(2).max(6),
  tactics: z.object({
    content: z.array(z.string()),
    schema: z.array(z.string()),
    directories: z.array(z.string()),
    earned: z.array(z.string()),
    entity: z.array(z.string()),
  }),
})

async function gatherEvidence(
  competitor: string,
  company: Company,
): Promise<{ pages: string; research: string; urls: string[] }> {
  const urls: string[] = []
  const queries = [
    `${competitor} ${company.sector}`,
    `${competitor} FAQ Wissen Ratgeber`,
    `${competitor} Preise Ablauf Kosten`,
  ]
  const pageLines: string[] = []
  for (const q of queries) {
    const res = await exaSearch(q, 4)
    const results = (res.raw ?? []) as { url: string; title: string }[]
    for (const r of results) {
      urls.push(r.url)
      pageLines.push(`- ${r.title} — ${r.url}`)
    }
  }
  const research = await perplexityRun(
    `Warum wird das Unternehmen "${competitor}" (${company.sector}, ${company.location}) ` +
      `in KI-Suchmaschinen wie ChatGPT und Perplexity häufig empfohlen und zitiert? ` +
      `Analysiere: Website-Struktur, FAQ/Wissens-Seiten, Schema.org-Markup, Branchenverzeichnisse, ` +
      `Fachpresse-Erwähnungen, Wikipedia/Wikidata-Präsenz. Konkret, mit Belegen. Antworte auf Deutsch.`,
    'research', // labor/research call — not a measured audit surface
  )
  return {
    pages: pageLines.join('\n'),
    research: research.text ?? '',
    urls: [...new Set(urls)].slice(0, 12),
  }
}

function buildSynthesisPrompt(
  competitor: string,
  company: Company,
  evidence: { pages: string; research: string },
): string {
  return `You are a senior AEO analyst. Reverse-engineer why one company wins AI-search visibility.

CONTEXT: "${competitor}" is cited and mentioned by AI answer engines (ChatGPT, Gemini, Perplexity) far more often than our client "${company.name}" (${company.sector}, ${company.location}).

EVIDENCE — their web surface (search results):
${evidence.pages || '(none found)'}

EVIDENCE — grounded research:
${evidence.research || '(none)'}

TASK: Diagnose the exact reasons they win, compared to a lower-ranked client. Output raw JSON only:
{
  "whyTheyWin": ["2-6 concrete reasons, one line each, German"],
  "tactics": {
    "content": ["what content they publish: page types, topics, structure"],
    "schema": ["structured data / technical markup they use"],
    "directories": ["which directories/portals carry their data"],
    "earned": ["press, guest articles, media mentions"],
    "entity": ["Wikidata/Wikipedia/knowledge-panel presence"]
  }
}
Rules: every claim grounded in the evidence; no speculation without marking it as such; German; raw JSON only.`
}

/** Teardown one competitor. Returns null if every synthesis attempt fails. */
export async function reverseEngineer(
  competitor: Competitor,
  company: Company,
): Promise<ReverseReport | null> {
  const evidence = await gatherEvidence(competitor.name, company)
  const parsed = await jsonAgent(buildSynthesisPrompt(competitor.name, company, evidence), ReverseSchema)
  if (!parsed) return null
  return {
    competitor: competitor.name,
    whyTheyWin: parsed.whyTheyWin,
    tactics: parsed.tactics,
    evidenceUrls: evidence.urls,
    createdAt: new Date().toISOString(),
  }
}
