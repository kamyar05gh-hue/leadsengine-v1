/**
 * narrative.ts — Kimi writes the LeadEngine report content as Markdown.
 *
 * Port of pipeline/leadengine/kimi_report.py. Kimi is the writer/executor:
 * it receives ONLY the measured audit data and turns it into executive-grade
 * report copy. Hard rules enforced by prompt + parser: no invented numbers,
 * fixed section schema, one-line bullets (max 90 chars). Numbers rendered
 * into cards/charts always come from the scoring JSON, never from the LLM.
 *
 * LLM routing: Kimi drafts -> OpenAI copy-edits (no-number-changes rule) ->
 * DeepSeek is the polish fallback -> raw Kimi text is the last resort.
 */
import type { AuditScore, Company, ImpactModel, ReportLang, ReportSections } from '../types.js'
import { LLM_ADOPTION_PCT } from '../config.js'
import { kimiGenerate, openaiGenerate, deepseekGenerate } from '../providers/index.js'

export const SECTIONS = [
  'EXEC_SUMMARY',
  'KEY_INSIGHTS',
  'COMPETITOR',
  'CITATIONS',
  'ANALYSIS',
  'MARKET',
  'ACTIONS',
  'CLOSER',
] as const

export type SectionKey = (typeof SECTIONS)[number]

/**
 * Fixed professional fallbacks — used whenever Kimi fails or a section
 * parses empty. NEVER anything resembling "Rohdaten-JSON" / raw-JSON copy:
 * these strings are client-facing.
 */
export const FALLBACK: Record<ReportLang, Record<SectionKey, string[]>> = {
  de: {
    EXEC_SUMMARY: [
      'Die KI-Sichtbarkeit liegt unter dem Marktpotenzial — Wettbewerber werden häufiger genannt.',
    ],
    KEY_INSIGHTS: ['Erwähnungen und Zitationen konzentrieren sich auf wenige Wettbewerber.'],
    COMPETITOR: ['Die führenden Wettbewerber profitieren von stärkerer digitaler Präsenz.'],
    CITATIONS: ['Verzeichnisse und Fachmedien dominieren die Zitationsquellen.'],
    ANALYSIS: ['Die Lücke entsteht durch fehlende Entitätsklarheit und zitierfähige Inhalte.'],
    MARKET: [`Rund ${LLM_ADOPTION_PCT} % der Zielgruppe nutzt bereits KI-gestützte Suche.`],
    ACTIONS: ['Entity-Aufbau, strukturierte Inhalte und Verzeichnis-Optimierung priorisieren.'],
    CLOSER: ['In 15 Minuten zeigen wir Ihnen, wie Sie in KI-Antworten sichtbar werden.'],
  },
  en: {
    EXEC_SUMMARY: ['AI visibility is below market potential — competitors are cited more often.'],
    KEY_INSIGHTS: ['Mentions and citations are concentrated among a few competitors.'],
    COMPETITOR: ['Leading competitors benefit from stronger digital presence.'],
    CITATIONS: ['Directories and trade media dominate the citation sources.'],
    ANALYSIS: ['The gap stems from missing entity clarity and citable content.'],
    MARKET: [`Around ${LLM_ADOPTION_PCT} % of the target audience already uses AI-assisted search.`],
    ACTIONS: ['Prioritize entity building, structured content, and directory optimization.'],
    CLOSER: ['In 15 minutes we show you how to become visible in AI answers.'],
  },
}

/**
 * The measured-data block — the ONLY numbers the writer model may use.
 * Anything not in this block must not appear in the narrative.
 */
export function dataBlock(score: AuditScore, impact: ImpactModel, company: Company): string {
  const o = score.overall
  const lines = [
    `CLIENT: ${company.name} — ${company.sector}, ${company.location}`,
    `DATE: ${new Date().toISOString().slice(0, 10)}`,
    `OVERALL: mention_rate=${o.mentionRate}% citation_rate=${o.citationRate}% ` +
      `sov=${o.sov}% avg_rank=${o.avgRank ?? 'n/a'} top_competitor_sov=${o.topCompetitorSov}%`,
    'PER ENGINE: ' +
      Object.entries(score.perEngine)
        .map(
          ([k, v]) =>
            `${k}: mention ${v.mentionRate}%, citation ${v.citationRate}%, ` +
            `sov ${v.sov}%, rank ${v.avgRank ?? 'n/a'}`,
        )
        .join('; '),
    'COMPETITORS: ' + score.competitors.map((c) => `${c.name} (${c.rawHits} mentions)`).join('; '),
    `CITATION CLASSES: ${JSON.stringify(score.citationClasses)}`,
    'TOP CITED DOMAINS: ' +
      score.topCitedDomains
        .slice(0, 8)
        .map((d) => `${d.domain} (${d.citations}×)`)
        .join('; '),
    `IMPACT MODEL: diverted_clicks=${impact.divertedClicksMonth}/month, ` +
      `lost_leads=${impact.lostLeadsMonth}/month, ` +
      `lost_chf=${impact.lostChfMonth}/month, ` +
      `competitor_leads=${impact.competitorLeadsMonth}/month, ` +
      `competitor_chf=${impact.competitorChfMonth}/month`,
    `ASSUMPTIONS: project value CHF ${impact.assumptions.projectValueChf}, ` +
      `monthly AI queries ${impact.assumptions.queriesPerMonth}`,
  ]
  return lines.join('\n')
}

const CJK_RX = /[一-鿿　-〿＀-￯]/

/**
 * Draft the report copy with Kimi. Same prompt structure as kimi_write():
 * senior-strategist persona, fixed ## SECTION markers, 90-char bullet cap,
 * no invented numbers, no technical tokens. CJK leakage is a hard failure
 * condition -> retry up to 3 times.
 */
async function kimiWrite(
  score: AuditScore,
  impact: ImpactModel,
  company: Company,
  lang: ReportLang,
): Promise<string | null> {
  // "no ß" alone makes some models over-transliterate and write "Erwaehnung"
  // — spell out that umlauts stay normal, only ß becomes ss.
  const langname =
    lang === 'de'
      ? 'German (Swiss business German: use ä/ö/ü normally, write ss instead of ß — never transliterate umlauts as ae/oe/ue)'
      : 'English'
  const prompt = `You are the senior strategist at Future Media, a Swiss marketing agency.
Write the content for a client-facing "AI Search Audit" report, in ${langname}.

MEASURED DATA (the only numbers you may use — inventing numbers is forbidden):
${dataBlock(score, impact, company)}

Output EXACTLY these sections, each starting with its marker line, nothing else:

## EXEC_SUMMARY
(5-6 bullets, each exactly ONE line, each a hard business fact about the
visibility gap or its financial impact — this section sells the problem)

## KEY_INSIGHTS
(3 bullets, one line each: what the data actually shows — platform spread,
mention vs citation, competitor pattern)

## COMPETITOR
(3 bullets, one line each: who dominates, why, and what that means for the client)

## CITATIONS
(3 bullets, one line each: what the citation source mix means — which source
types the engines trust for this sector, and where the client must appear)

## ANALYSIS
(5 bullets, one line each — the deep read: WHY the numbers look like this.
Cover the platform split, the mention-vs-citation gap, the citation source
mix, the competitor pattern, and the single biggest strategic lever. This is
the analyst's voice: diagnostic, specific, no fluff)

## MARKET
(3 bullets, one line each: AI adoption and query-volume context for this
sector in Switzerland — clearly framed as estimates)

## ACTIONS
(5 bullets, one line each, concrete and specific to this sector: the GEO
recovery moves, highest leverage first)

## CLOSER
(1 sentence: a confident, non-needy call to action for a consultation)

Rules: bullets start with "- ". EVERY bullet must be at most 90 characters —
short, punchy, complete words, never cut mid-thought. EMPHASIS: wrap the 1-3
most important substrings of each bullet in **double asterisks** — always
emphasize numbers, CHF amounts, percentages, and company/domain names. The
emphasized substring must be verbatim text from the bullet. Write ONLY in
${langname} — never output Chinese characters or any other script; this is a
hard failure condition. Never use raw field names or technical tokens
(mention_rate, citation_rate, SOV, avg_rank) — translate every metric into
natural business language. No headings other than the markers. No
commentary, no disclaimers inside bullets. Tone: authoritative, precise,
senior consultant — never generic AI filler. Frame financial figures as
modeled recovery potential, not as literal lost revenue; if a modeled figure
is zero because the client leads, omit it instead of writing "0". CRITICAL:
lost_chf is the CLIENT's modeled loss; competitor_chf is what COMPETITORS
gain — never present competitor_chf as the client's loss, and never mix the
two. If the client's measured visibility is 0%, state plainly that zero
mentions were measured — do not dramatize with invented figures. If the
client already leads a metric, say so plainly and pivot to defending the
lead. Sector is B2B (${company.sector}), so address business impact.`
  let text = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await kimiGenerate(prompt)
    if (!res.ok || !res.text) {
      console.warn('kimiGenerate failed:', res.error)
      return null
    }
    text = res.text
    if (!CJK_RX.test(text)) return text
    console.warn(`CJK leakage in Kimi output (attempt ${attempt + 1}) — retrying`)
  }
  return text // last resort: parser + fallbacks still validate sections
}

/**
 * Copy-edit pass: OpenAI polishes Kimi's draft (grammar, tone, bullet
 * length) under a hard no-number-changes rule. DeepSeek is the fallback;
 * raw Kimi text is the last resort.
 */
async function polish(text: string, lang: ReportLang): Promise<string> {
  const langname =
    lang === 'de'
      ? 'Swiss German (ä/ö/ü stay as umlauts, ss instead of ß — never ae/oe/ue transliteration)'
      : 'English'
  const prompt = `Copy-edit this report content. Language: ${langname}.

Rules:
- NEVER change, add, or remove any number, percentage, date, or company name.
- Keep the **double asterisk** emphasis markers exactly where they are — they
  drive bold rendering. You may adjust which substring is wrapped if grammar
  demands it, but never delete all markers from a bullet.
- Fix grammar and style; make it sound like a senior consultant wrote it.
- Keep the "## SECTION" markers and "- " bullet format exactly as they are.
- Every bullet max 90 characters, complete words only.
- Output only the edited text, nothing else.

TEXT:
${text}`
  const ds = await deepseekGenerate(prompt)
  if (ds.ok && ds.text?.trim()) return ds.text
  const res = await openaiGenerate(prompt)
  if (res.ok && res.text?.trim()) return res.text
  return text
}

/** Parse "## SECTION" + "- " bullets back into the section map. */
export function parseSections(md: string | null | undefined): Partial<Record<SectionKey, string[]>> {
  const out: Partial<Record<SectionKey, string[]>> = {}
  let current: SectionKey | null = null
  for (const line of (md ?? '').split(/\r?\n/)) {
    const m = /^##\s+([A-Z_]+)/.exec(line.trim())
    if (m) {
      const key = m[1] as SectionKey
      if ((SECTIONS as readonly string[]).includes(key)) {
        current = key
        out[current] = out[current] ?? []
      }
    } else if (current && line.trim().startsWith('- ')) {
      out[current]?.push(line.trim().slice(2).trim())
    }
  }
  return out
}

/**
 * Full narrative for one language: Kimi draft -> polish -> parse -> fill any
 * missing section from the fixed professional fallbacks. Never throws on LLM
 * failure — a fallback-backed report is always returned.
 */
export async function writeNarrative(
  score: AuditScore,
  impact: ImpactModel,
  company: Company,
  lang: ReportLang,
): Promise<ReportSections> {
  let md = await kimiWrite(score, impact, company, lang)
  if (md) md = await polish(md, lang)
  const parsed = parseSections(md)
  const out = {} as Record<SectionKey, string[]>
  for (const sec of SECTIONS) {
    const bullets = parsed[sec]
    out[sec] = bullets && bullets.length > 0 ? bullets : FALLBACK[lang][sec]
  }
  return out
}

const RAW_JSON_RX = /(rohdaten[- ]?json|raw json|see raw|details im json|json[- ]?datei)/gi

/**
 * Strip any leftover raw-data / JSON references from client-facing copy
 * (port of _sanitize_sections — a Kimi draft must never leak "see raw JSON"
 * into a sales deck).
 */
export function sanitize(sections: ReportSections): ReportSections {
  const out = {} as Record<SectionKey, string[]>
  for (const sec of SECTIONS) {
    out[sec] = sections[sec].map((b) =>
      b.replace(RAW_JSON_RX, '').replace(/^[\s\-—]+|[\s\-—]+$/g, ''),
    )
  }
  return out
}

/** Swiss-style thousands separator: 150000 -> "150'000". */
function chf(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

/**
 * The .md companion document (port of to_markdown) — same sections plus a
 * measured-data appendix, so the client gets the numbers in text form too.
 */
export function toMarkdown(
  score: AuditScore,
  impact: ImpactModel,
  company: Company,
  sections: ReportSections,
  lang: ReportLang,
): string {
  const o = score.overall
  const t =
    lang === 'de'
      ? {
          title: '# AI Search Audit',
          exec: '## Executive Summary',
          ins: '## Zentrale Erkenntnisse',
          comp: '## Wettbewerb',
          cit: '## Zitationsquellen',
          ana: '## Analyse',
          mkt: '## Marktintelligenz (Schätzwerte)',
          act: '## Nächste Schritte',
          data: '## Anhang — Messdaten',
        }
      : {
          title: '# AI Search Audit',
          exec: '## Executive Summary',
          ins: '## Key Insights',
          comp: '## Competition',
          cit: '## Citation Sources',
          ana: '## Analysis',
          mkt: '## Market Intelligence (estimates)',
          act: '## Next Actions',
          data: '## Appendix — Measured Data',
        }
  const date = new Date().toISOString().slice(0, 10)
  const L: string[] = [
    t.title,
    '',
    `**${company.name}** — ${company.sector} · ${company.location} · ${date}`,
    '',
    'LeadEngine by Future Media',
    '',
  ]
  const order: Array<[SectionKey, string]> = [
    ['EXEC_SUMMARY', t.exec],
    ['KEY_INSIGHTS', t.ins],
    ['COMPETITOR', t.comp],
    ['CITATIONS', t.cit],
    ['ANALYSIS', t.ana],
    ['MARKET', t.mkt],
    ['ACTIONS', t.act],
  ]
  for (const [key, hdr] of order) {
    L.push(hdr, '', ...sections[key].map((b) => '- ' + b), '')
  }
  L.push(
    `**${sections.CLOSER[0] ?? ''}**`,
    '',
    t.data,
    '',
    '| Engine | Mention | Citation | SoV | Avg rank |',
    '|---|---|---|---|---|',
  )
  for (const [eng, e] of Object.entries(score.perEngine)) {
    L.push(`| ${eng} | ${e.mentionRate}% | ${e.citationRate}% | ${e.sov}% | ${e.avgRank ?? '—'} |`)
  }
  L.push(
    '',
    `Overall: SoV ${o.sov}% · mention ${o.mentionRate}% · citation ${o.citationRate}% · ` +
      `top competitor SoV ${o.topCompetitorSov}%`,
    `Impact model: ~${impact.divertedClicksMonth} diverted clicks/mo · ` +
      `~${impact.lostLeadsMonth} lost inquiries/mo · ~CHF ${chf(impact.lostChfMonth)}/mo recoverable`,
    'Figures: sampled, directional. Financial figures: modeled estimates.',
    '',
  )
  return L.join('\n')
}
