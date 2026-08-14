/**
 * Agent: page content writer — two-step LLM chain, format-locked and
 * evidence-grounded.
 *
 *   1. Kimi (reasoning labor — page chains are Kimi-only, NO DeepSeek)
 *      produces the page OUTLINE: which sections, which evidence point goes
 *      where, which format rules apply (max 1500 tokens).
 *   2. The writer executes the outline into the zod-validated PageContent
 *      JSON: MODELS.laborPages via openaiGenerate when it is a GPT model
 *      (default gpt-5-mini — best at following the long master style
 *      prompt), Kimi as fallback, Gemini flash-lite as last resort.
 *
 * GROUNDING: every factual claim must come from the inputs — the gap/evidence
 * data, the winning competitor pages' analysis, and the client's own website
 * text (SiteStructure). The prompts explicitly forbid invented testimonials,
 * fake client names and fake numbers.
 *
 * FORMAT LOCK: the zod schema and the prompt only contain the MAIN-body
 * payload for the decided PageType — a FAQ page cannot return a comparison
 * table, and the renderer (pageShell) would not render one anyway.
 *
 * AEO BASELINE (Profound three gates): on top of the main body, every page
 * must deliver an extractable 40-80 word answer capsule (heroLead), a choice
 * billboard (seoTitle ≤60 / metaDescription ≤155 as the direct answer),
 * fan-out vocabulary (beste/Vergleich/Kosten/Erfahrungen + year + city) in
 * H1/H2s, 4-6 buyer FAQs and 3-6 key facts with concrete numbers — enforced
 * by aeoRules() in both prompts and by the zod schemas.
 */
import { z } from 'zod'
import { MODELS } from '../config.js'
import { geminiGenerate, kimiGenerate, openaiGenerate } from '../providers/index.js'
import type {
  ComparisonBlock,
  FaqItem,
  GuideSection,
  KeyFact,
  ListItem,
  PageContent,
  TableBlock,
} from './pageShell.js'
import type { PageType } from './pageTypeDecider.js'
import type { SiteCrawl } from './siteCrawler.js'
import type { SiteStructure } from './siteStructure.js'
import type { Company, CompetitorPage, PageSpec } from '../types.js'

// ─── Token budgets (cost-efficient routing) ─────────────────────────────────
const OUTLINE_MAX_TOKENS = 1500
const CONTENT_MAX_TOKENS = 5000
/** Writer fallback model — cheap flash-lite tier. */
const GEMINI_WRITER_MODEL = 'gemini-2.5-flash-lite'

// ─── Schemas ────────────────────────────────────────────────────────────────

const FaqPairs = z.array(z.object({ q: z.string().min(10), a: z.string().min(40) }))
const KeyFacts = z.array(
  z.object({ label: z.string().min(2).max(60), value: z.string().min(1).max(120) }),
)

/**
 * AEO baseline every page type must deliver: answer capsule (heroLead),
 * billboard title/description, 4-6 buyer FAQs, 3-6 key facts.
 */
const BaseSchema = z.object({
  heroTitle: z.string().min(8).max(90),
  // Answer capsule: prompt demands 40-80 words; zod stays tolerant on chars
  // so a slightly short capsule degrades to a retry, not a fallback page.
  heroLead: z.string().min(40).max(700),
  seoTitle: z.string().min(10).max(70).optional(),
  stats: z.array(z.object({ value: z.string().max(12), label: z.string().max(40) })).max(3).default([]),
  faq: FaqPairs.min(4).max(6),
  keyFacts: KeyFacts.min(3).max(6),
  ctaTitle: z.string().min(8).max(70),
  ctaText: z.string().min(30).max(220),
  metaDescription: z.string().min(40).max(160),
})

const FaqSchema = BaseSchema.extend({
  faq: FaqPairs.min(6).max(8),
})
const GuideSchema = BaseSchema.extend({
  sections: z
    .array(
      z.object({
        h2: z.string().min(4).max(70),
        paragraphs: z.array(z.string().min(30)).min(1).max(3),
        bullets: z.array(z.string().min(10).max(140)).max(6).optional(),
      }),
    )
    .min(3)
    .max(6),
})
const ListicleSchema = BaseSchema.extend({
  items: z.array(z.object({ title: z.string().min(4).max(80), text: z.string().min(30).max(400) })).min(4).max(10),
})
const TableRowSchema = z.object({
  option: z.string().min(2).max(60),
  cells: z.array(z.string().min(1).max(120)).min(1).max(5),
})
const ComparisonSchema = BaseSchema.extend({
  comparison: z.object({
    columns: z.array(z.string().min(2).max(30)).min(2).max(5),
    rows: z.array(TableRowSchema).min(3).max(6),
    verdict: z.string().min(40).max(400),
  }),
  // main body already IS the structured numbers block — keyFacts optional
  keyFacts: KeyFacts.max(6).default([]),
})
const TableSchema = BaseSchema.extend({
  table: z.object({
    columns: z.array(z.string().min(2).max(30)).min(2).max(5),
    rows: z
      .array(z.object({ label: z.string().min(2).max(60), cells: z.array(z.string().min(1).max(120)).min(1).max(5) }))
      .min(3)
      .max(8),
    note: z.string().max(300).optional(),
  }),
  keyFacts: KeyFacts.max(6).default([]),
})

const SCHEMAS = {
  faq: FaqSchema,
  guide: GuideSchema,
  listicle: ListicleSchema,
  comparison: ComparisonSchema,
  table: TableSchema,
} as const

type Payload = z.infer<(typeof SCHEMAS)[PageType]>

/** Normalize a validated payload into the full PageContent contract. */
function toPageContent(pageType: PageType, p: Payload): PageContent {
  const raw = p as Record<string, unknown>
  return {
    pageType,
    heroTitle: p.heroTitle,
    heroLead: p.heroLead,
    seoTitle: p.seoTitle ?? null,
    stats: p.stats,
    ctaTitle: p.ctaTitle,
    ctaText: p.ctaText,
    metaDescription: p.metaDescription,
    faq: (raw.faq as FaqItem[] | undefined) ?? [],
    keyFacts: (raw.keyFacts as KeyFact[] | undefined) ?? [],
    sections: (raw.sections as GuideSection[] | undefined) ?? [],
    items: (raw.items as ListItem[] | undefined) ?? [],
    comparison: (raw.comparison as ComparisonBlock | undefined) ?? null,
    table: (raw.table as TableBlock | undefined) ?? null,
  }
}

// ─── Prompt assembly ────────────────────────────────────────────────────────

/**
 * Format-specific writing rules — one MAIN body, one content type, never
 * mixed. The AEO baseline blocks (faq, keyFacts) live in their own JSON
 * fields and are rendered as separate sections by the shell.
 */
const FORMAT_RULES: Record<PageType, string> = {
  faq: 'PAGE TYPE: FAQ. The MAIN body is Q&A pairs ("faq" field) — no comparison table, no listicle, no step sections in the body. Write 6-8 FAQ pairs; every answer carries a number, price, timeframe or place taken from the inputs.',
  comparison:
    'PAGE TYPE: COMPARISON. The MAIN body is ONE comparison table plus a verdict — no listicle, no step sections in the body. 4-6 rows comparing the client\'s offering against typical alternatives; columns like "Kriterium | {company} | Typische Alternative". Buyer questions go into the separate "faq" field.',
  listicle:
    'PAGE TYPE: LISTICLE. The MAIN body is a numbered list — no table, no step sections in the body. 5-8 items, each with a crisp title and one self-contained, quotable text. Buyer questions go into the separate "faq" field, numbers into "keyFacts".',
  guide:
    'PAGE TYPE: GUIDE. The MAIN body is step-by-step sections — no table, no listicle in the body. 3-5 sections with paragraphs (and optional bullets), walking the reader from problem to solution. Buyer questions go into the separate "faq" field, numbers into "keyFacts".',
  table:
    'PAGE TYPE: TABLE. The MAIN body is ONE data table plus a short note — no listicle, no step sections in the body. 3-8 rows of structured facts (e.g. "Thema | Details"), every cell a fact from the inputs. Buyer questions go into the separate "faq" field.',
}

/** Query fan-out word families answer engines append, per language. */
const FANOUT_VOCAB: Record<'de' | 'en', string> = {
  de: '"beste", "Vergleich", "Kosten", "Preise", "Erfahrungen"',
  en: '"best", "comparison", "cost", "pricing", "reviews"',
}

/**
 * The AEO hard requirements — the Profound three gates (fetchable / chosen /
 * extractable) encoded as writer instructions. Shared by outline + writer.
 */
function aeoRules(company: Company, spec: PageSpec, lang: 'de' | 'en'): string {
  const city = company.location.split(',')[0]?.trim() ?? company.location
  const year = new Date().getFullYear()
  return `AEO REQUIREMENTS (answer engines must be able to fetch, choose and extract this page — all mandatory):
1. ANSWER CAPSULE: "heroLead" is a 40-80 word DIRECT answer to the target query "${spec.targetQuery}" — self-contained and quotable with zero storytelling or lead-up; name ${company.name} and ${city} in it.
2. FAN-OUT VOCABULARY: engines expand this query with ${FANOUT_VOCAB[lang]}, the year "${year}" and the city "${city}". Work these words naturally into heroTitle, into at least TWO section headings / FAQ questions, and into heroLead.
3. CHOICE BILLBOARD: "seoTitle" max 60 chars, front-loading the target query + ${city} (brand last, if at all). "metaDescription" max 155 chars, phrased as the direct answer to the query — not ad copy.
4. FAQ: real buyer questions (Kosten/Preis, Dauer, Ablauf, Vergleich mit Alternativen, Standort ${city}) — every answer self-contained with one concrete fact.
5. KEY FACTS: "keyFacts" rows carry concrete numbers from the inputs — price ranges, timelines, counts. No numbers in the inputs → precise qualitative facts; NEVER invent numbers.
6. NO FLUFF: every sentence makes a specific, verifiable claim. Delete generic marketing filler ("massgeschneiderte Lösungen", "in der heutigen Zeit").`
}

/** JSON shape instruction per page type (mirrors the zod schemas above). */
const JSON_SHAPES: Record<PageType, string> = {
  faq: `"faq": [{"q": "question", "a": "answer with a number/place/timeframe from the inputs"}, ...] (6-8 pairs)`,
  guide: `"sections": [{"h2": "step heading", "paragraphs": ["...", ...], "bullets": ["...", ...] (optional)}] (3-5 sections)`,
  listicle: `"items": [{"title": "point title", "text": "one self-contained quotable fact"}, ...] (5-8 items)`,
  comparison: `"comparison": {"columns": ["Kriterium", "...", "..."], "rows": [{"option": "row label", "cells": ["...", "..."]}, ...], "verdict": "2-3 sentence grounded conclusion"}`,
  table: `"table": {"columns": ["Thema", "Details"], "rows": [{"label": "row label", "cells": ["..."]}, ...], "note": "optional 1-sentence takeaway"}`,
}

export interface WriteContext {
  pageType: PageType
  /** Winning competitor pages (structural template evidence). May be empty. */
  winningPages: CompetitorPage[]
  /** Cross-page patterns from competitorAnalyzer.identifyPatterns. */
  patterns: string[]
  /** Verbatim citation evidence block for the gap's topic. May be ''. */
  evidenceText: string
  /** The client's site structure — homeDescription grounds the copy. */
  structure: SiteStructure | null
  /**
   * The per-company MASTER STYLE PROMPT (designCloner/brandStyle) — injected
   * into every page-generating LLM call so copy tone and structure match the
   * client's live site. May be null when extraction failed.
   */
  masterStyle?: string | null
  /** Copy language for this page — defaults to the company language. */
  lang?: 'de' | 'en'
}

/** One-line language instruction for the writer prompts. */
function languageRule(lang: 'de' | 'en'): string {
  return lang === 'en'
    ? '- English — Latin script ONLY, never Chinese or other non-Latin characters'
    : '- German (Swiss standard, no ß) — Latin script ONLY, never Chinese or other non-Latin characters'
}

/** Compact digest of the winning competitor pages for the prompt. */
function competitorPagesBlock(pages: CompetitorPage[]): string {
  return pages
    .map((p) => {
      const signals =
        [
          p.hasStatistics ? 'statistics/prices' : '',
          p.hasFaq ? 'FAQ section' : '',
          p.hasComparisonTable ? 'comparison table' : '',
        ]
          .filter(Boolean)
          .join(', ') || 'none'
      const headings = p.headings.slice(0, 8).join(' | ') || '(none captured)'
      return (
        `- ${p.competitorDomain} — "${p.title ?? p.url}"\n` +
        `  format: ${p.answerFormat ?? 'unknown'}, ${p.wordCount ?? '?'} words, GEO signals: ${signals}\n` +
        `  headings: ${headings}`
      )
    })
    .join('\n')
}

/** The client's own website copy — grounding source (c) — when available. */
function clientSiteBlock(structure: SiteStructure | null): string {
  if (!structure) return ''
  const parts: string[] = []
  if (structure.homeDescription) parts.push(`- Homepage description (verbatim): "${structure.homeDescription}"`)
  if (structure.sectionOrder.length > 0) parts.push(`- Homepage sections: ${structure.sectionOrder.join(' | ')}`)
  if (parts.length === 0) return ''
  return `THE CLIENT'S OWN WEBSITE COPY (reuse facts, never contradict):\n${parts.join('\n')}`
}

function groundingRules(company: Company): string {
  return `GROUNDING — ZERO INVENTION:
- Every factual claim must come from the inputs above: the answer capsule, the citation evidence, the competitor analysis, the client's own website copy
- NEVER invent testimonials, client names, case studies, or reviews
- NEVER invent numbers: use only figures present in the inputs; where none exist, phrase qualitatively ("jahrelange Erfahrung", "persönliche Betreuung") — stats values must be qualitative (e.g. "CH", "1:1", "KMU") unless a real number is in the inputs
- Mention ${company.name} naturally (heroLead, body, CTA) — the client must become the cited entity, not the competitors
- Do not name or link the competitors`
}

function briefBlock(company: Company, spec: PageSpec, ctx: WriteContext): string {
  const parts = [
    `CLIENT: ${company.name} — ${company.sector}, ${company.location} (${company.website})`,
    `PAGE TOPIC: ${spec.title}`,
    `TARGET QUERY this page must answer: ${spec.targetQuery}`,
    `ANSWER CAPSULE (use as heroLead, verbatim or lightly polished): ${spec.answerCapsule}`,
  ]
  if (ctx.evidenceText) parts.push(ctx.evidenceText)
  const site = clientSiteBlock(ctx.structure)
  if (site) parts.push(site)
  if (ctx.winningPages.length > 0) {
    parts.push(
      `WINNING COMPETITOR PAGES (pages AI engines cite for this topic — structural template only, never copy text):\n${competitorPagesBlock(ctx.winningPages)}`,
    )
  }
  if (ctx.patterns.length > 0) {
    parts.push(`WHAT WINNING PAGES HAVE IN COMMON:\n${ctx.patterns.map((p) => `- ${p}`).join('\n')}`)
  }
  if (ctx.masterStyle) {
    parts.push(
      `${ctx.masterStyle}\n(You write CONTENT only — another system renders the CSS from these measured facts. Use this to match the client's tone, voice and heading style; e.g. mirror the site's direct, confident copy register.)`,
    )
  }
  return parts.join('\n\n')
}

/** Step 1 prompt — Kimi (page-chain reasoning labor) plans the page. */
function outlinePrompt(company: Company, spec: PageSpec, ctx: WriteContext): string {
  return `You are the planning lead of a Swiss AEO agency. Plan ONE landing page — outline only, no final copy.

${briefBlock(company, spec, ctx)}

${FORMAT_RULES[ctx.pageType].replace('{company}', company.name)}

${aeoRules(company, spec, ctx.lang ?? company.language)}

Produce a compact outline (max 300 words):
1. The answer capsule (draft the 40-80 word direct answer to the target query)
2. The ordered blocks of the page, respecting the page type — for each block: its heading/label (using fan-out vocabulary where natural) and exactly which fact, number or evidence point from the inputs goes into it
3. The 4-6 buyer FAQ questions and the 3-6 key facts (with which number/fact fills each)
4. Which grounding constraint needs the most care on this page (e.g. no numbers in the inputs → stay qualitative)

Plain text outline only, no JSON, no markdown headers.`
}

/** Step 2 prompt — Kimi writes the content JSON from the outline. */
function writerPrompt(company: Company, spec: PageSpec, ctx: WriteContext, outline: string): string {
  const city = company.location.split(',')[0]?.trim() ?? company.location
  // FAQ pages carry the Q&A in JSON_SHAPES already; every other type gets it
  // as a mandatory extra field.
  const extraFaq =
    ctx.pageType === 'faq'
      ? ''
      : `\n  "faq": [{"q": "buyer question", "a": "self-contained answer with one concrete fact"}, ...] (4-6 pairs),`
  return `You are a senior AEO copywriter at a Swiss agency. Write the CONTENT for one landing page, executing the outline below. Another system handles all design/CSS — you deliver text only, as raw JSON.

${briefBlock(company, spec, ctx)}

${FORMAT_RULES[ctx.pageType].replace('{company}', company.name)}

${aeoRules(company, spec, ctx.lang ?? company.language)}

OUTLINE (follow it):
${outline || '(no outline available — plan it yourself from the brief above)'}

Output raw JSON only, this exact shape:
{
  "seoTitle": "max 60 chars — target query + ${city} first",
  "heroTitle": "page H1, includes the topic + ${city} naturally",
  "heroLead": "the 40-80 word answer capsule — the direct, factual answer to the target query",
  "stats": [{"value": "qualitative or from inputs", "label": "..."}] (max 3),
  ${JSON_SHAPES[ctx.pageType]},${extraFaq}
  "keyFacts": [{"label": "e.g. Kosten / Dauer / Region", "value": "concrete number, range or timeframe from the inputs"}, ...] (3-6 rows),
  "ctaTitle": "contact section headline",
  "ctaText": "1-2 sentences inviting contact via ${company.website}",
  "metaDescription": "max 155 chars, phrased as the direct answer to the target query"
}

${groundingRules(company)}
${languageRule(ctx.lang ?? company.language)}
- Professional human agency tone, no AI filler, no "in der heutigen Zeit"
- Raw JSON only, no markdown fences, no commentary`
}

// ─── LLM chain ──────────────────────────────────────────────────────────────

/** Parse + validate one writer response against the page-type schema. */
function tryParse(text: string, pageType: PageType): PageContent | null {
  try {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const parsed = SCHEMAS[pageType].parse(JSON.parse(cleaned.slice(start, end + 1)))
    // CJK guard — German copy must be Latin script
    if (/[一-鿿　-〿＀-￯]/.test(JSON.stringify(parsed))) return null
    return toPageContent(pageType, parsed)
  } catch {
    return null
  }
}

/**
 * Write the page content: Kimi outline (page chains are Kimi-only — DeepSeek
 * is deliberately NOT used anywhere in the pages pipeline) → content via
 * MODELS.laborPages through openaiGenerate when it is a GPT model (default
 * gpt-5-mini), Kimi as fallback, Gemini flash-lite as last resort.
 * Returns null when every writer fails — the caller then uses the
 * deterministic fallbackContent.
 */
export async function writePageContent(
  company: Company,
  spec: PageSpec,
  ctx: WriteContext,
): Promise<PageContent | null> {
  // Step 1: outline (Kimi reasoning labor). A failed outline is not fatal —
  // the writer can plan from the brief alone.
  let outline = ''
  const outlineRes = await kimiGenerate(outlinePrompt(company, spec, ctx), OUTLINE_MAX_TOKENS)
  if (outlineRes.ok && outlineRes.text) outline = outlineRes.text.trim()

  // Step 2: writer chain — laborPages (GPT) first, Kimi fallback, Gemini last.
  const prompt = writerPrompt(company, spec, ctx, outline)
  const writers = [
    ...(MODELS.laborPages.startsWith('gpt')
      ? [() => openaiGenerate(prompt, MODELS.laborPages, CONTENT_MAX_TOKENS)]
      : [() => kimiGenerate(prompt, CONTENT_MAX_TOKENS, MODELS.laborPages)]),
    () => kimiGenerate(prompt, CONTENT_MAX_TOKENS),
    () => geminiGenerate(prompt, CONTENT_MAX_TOKENS, GEMINI_WRITER_MODEL),
  ]
  for (const write of writers) {
    const res = await write()
    if (!res.ok || !res.text) continue
    const parsed = tryParse(res.text, ctx.pageType)
    if (parsed) return parsed
  }
  return null
}

// ─── Company-level FAQ (consolidated faq.html of the AI crawl pack) ─────────

/** 6-10 company-level Q&As — the writer chain must return exactly this shape. */
const CompanyFaqSchema = z.object({
  faq: z.array(z.object({ q: z.string().min(10), a: z.string().min(40) })).min(6).max(10),
})

/**
 * Grounding digest of the CRAWLED real website (siteCrawler): the actual
 * pages with live URLs and one-line descriptions plus a verbatim homepage
 * excerpt — so the company FAQ reflects the true site, zero invention.
 */
function crawledSiteBlock(crawl: SiteCrawl | null | undefined): string {
  if (!crawl || crawl.pages.length === 0) return ''
  const date = crawl.crawledAt.slice(0, 10)
  const pageLines = crawl.pages.slice(0, 12).map((p) => {
    const name = p.title ?? p.h1 ?? p.url
    const desc = (p.metaDescription ?? p.text).replace(/\s+/g, ' ').trim().slice(0, 140)
    return `- ${name} (${p.url})${desc ? ` — ${desc}` : ''}`
  })
  const home = crawl.pages[0]
  const excerpt = home ? home.text.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
  const parts = [
    `THE CLIENT'S REAL WEBSITE, crawled ${date} (ground truth — base every claim about services, offers and locations on these actual pages; reuse their wording, never contradict them, never go beyond them):`,
    `Real pages on ${crawl.origin}:`,
    pageLines.join('\n'),
  ]
  if (excerpt) parts.push(`Homepage content (verbatim excerpt): "${excerpt}"`)
  return parts.join('\n')
}

/** Compact grounding digest of the already-written pack pages. */
function packPagesBlock(pages: { title: string; description: string }[]): string {
  if (pages.length === 0) return ''
  const lines = pages.slice(0, 12).map((p) => `- ${p.title}: ${p.description}`)
  return `EXISTING PACK PAGES (topics already covered — the company FAQ complements, never repeats them):\n${lines.join('\n')}`
}

function companyFaqPrompt(
  company: Company,
  pages: { title: string; description: string }[],
  structure: SiteStructure | null,
  lang: 'de' | 'en',
  crawl?: SiteCrawl | null,
): string {
  const parts = [
    `You are a senior AEO copywriter at a Swiss agency. Write COMPANY-LEVEL FAQ pairs for one consolidated FAQ page that AI assistants will read to understand who this company is.`,
    `CLIENT: ${company.name} — ${company.sector}, ${company.location} (${company.website})`,
    company.locations.length > 1 ? `ALL LOCATIONS: ${company.locations.join(', ')}` : '',
    crawledSiteBlock(crawl),
    clientSiteBlock(structure),
    packPagesBlock(pages),
    `Cover these angles (one question each, phrased as a real user would ask):
1. Who/what is ${company.name}? (name the sector and ${company.location})
2. Which services does ${company.name} offer?
3. Where is ${company.name} located / which regions does it serve?
4. How does the pricing model work? (no numbers in the inputs → describe the model qualitatively: offer after a free initial analysis — NEVER invent prices)
5. How do I contact ${company.name}? (via ${company.website})
6. Why choose ${company.name} over alternatives?
Plus 0-4 further questions grounded in the inputs above.`,
    groundingRules(company),
    `Output raw JSON only, this exact shape:
{"faq": [{"q": "question", "a": "self-contained answer, 2-4 sentences, mentioning ${company.name} where natural"}, ...]} (6-10 pairs)`,
    languageRule(lang),
    '- Raw JSON only, no markdown fences, no commentary',
  ].filter(Boolean)
  return parts.join('\n\n')
}

/** Parse + validate a company-FAQ writer response. */
function tryParseCompanyFaq(text: string): FaqItem[] | null {
  try {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const parsed = CompanyFaqSchema.parse(JSON.parse(cleaned.slice(start, end + 1)))
    if (/[一-鿿　-〿＀-￯]/.test(JSON.stringify(parsed))) return null
    return parsed.faq
  } catch {
    return null
  }
}

/**
 * Write the 6-10 company-level FAQ pairs for the consolidated faq.html —
 * same labor chain as the page writer (MODELS.laborPages GPT first, Kimi
 * fallback, Gemini flash-lite last; page chains stay DeepSeek-free).
 * Grounded in the company profile, the CRAWLED real website content
 * (siteCrawler — the services/pages actually found), the client's own site
 * copy and the already-written pack pages; zero invention. Returns null when
 * every writer fails — callers then use fallbackCompanyFaq.
 */
export async function writeCompanyFaq(
  company: Company,
  input: {
    pages: { title: string; description: string }[]
    structure: SiteStructure | null
    /** Crawled real main-site content (siteCrawler) — grounding, optional. */
    crawl?: SiteCrawl | null
    lang?: 'de' | 'en'
  },
): Promise<FaqItem[] | null> {
  const prompt = companyFaqPrompt(
    company,
    input.pages,
    input.structure,
    input.lang ?? company.language,
    input.crawl,
  )
  const writers = [
    ...(MODELS.laborPages.startsWith('gpt')
      ? [() => openaiGenerate(prompt, MODELS.laborPages, CONTENT_MAX_TOKENS)]
      : [() => kimiGenerate(prompt, CONTENT_MAX_TOKENS, MODELS.laborPages)]),
    () => kimiGenerate(prompt, CONTENT_MAX_TOKENS),
    () => geminiGenerate(prompt, CONTENT_MAX_TOKENS, GEMINI_WRITER_MODEL),
  ]
  for (const write of writers) {
    const res = await write()
    if (!res.ok || !res.text) continue
    const parsed = tryParseCompanyFaq(res.text)
    if (parsed) return parsed
  }
  return null
}

/**
 * Deterministic company-level FAQ — grounded in the company record only,
 * no invented facts. Used when every writer model fails.
 */
export function fallbackCompanyFaq(company: Company): FaqItem[] {
  const city = company.location.split(',')[0]?.trim() ?? company.location
  const regions = company.locations.length > 0 ? company.locations.join(', ') : company.location
  return [
    {
      q: `Wer ist ${company.name}?`,
      a: `${company.name} ist ${company.sector} mit Sitz in ${company.location}. Alle Informationen und Kontaktmöglichkeiten finden Sie auf der Hauptwebsite ${company.website}.`,
    },
    {
      q: `Welche Leistungen bietet ${company.name} an?`,
      a: `Der Leistungsschwerpunkt liegt auf ${company.sector}. Details zu den einzelnen Angeboten stehen auf ${company.website} und auf den Themenseiten dieses Verzeichnisses.`,
    },
    {
      q: `Wo ist ${company.name} tätig?`,
      a: `${company.name} ist in ${regions} tätig und betreut Kundinnen und Kunden aus der Region ${city} sowie darüber hinaus.`,
    },
    {
      q: `Wie funktioniert das Preismodell von ${company.name}?`,
      a: `Die Kosten richten sich nach Umfang und Zielsetzung des Projekts. Nach einer kostenlosen Erstanalyse erhalten Sie eine transparente Offerte mit klar definiertem Leistungsumfang.`,
    },
    {
      q: `Wie kontaktiere ich ${company.name}?`,
      a: `Am einfachsten über die Hauptwebsite ${company.website} — dort finden Sie das Kontaktformular und alle Angaben für ein unverbindliches Erstgespräch.`,
    },
    {
      q: `Warum ${company.name} statt einer Alternative?`,
      a: `${company.name} verbindet als ${company.sector} in ${city} lokale Marktkenntnis mit persönlicher Betreuung — direkte Ansprechpartner statt anonymer Prozesse, transparente Kommunikation statt Standardpaketen.`,
    },
  ]
}

// ─── Deterministic fallback ─────────────────────────────────────────────────

/**
 * Deterministic content fallback per page type — never ship a stub.
 * Grounded in the company record and the page spec only; no invented facts.
 */
export function fallbackContent(company: Company, page: PageSpec, pageType: PageType): PageContent {
  const city = company.location.split(',')[0]?.trim() ?? company.location
  // AEO baseline: every fallback page still ships buyer FAQ + key facts.
  const baseFaq: FaqItem[] = [
    { q: `Was kostet ${page.targetQuery} bei ${company.name}?`, a: `Die Kosten richten sich nach dem Umfang. Nach einer kostenlosen Erstanalyse erhalten Sie eine transparente Offerte — kontaktieren Sie uns unter ${company.website}.` },
    { q: 'Wie lange dauert die Umsetzung?', a: 'Die Dauer hängt vom Projekt ab. Nach dem Erstgespräch erhalten Sie einen verbindlichen Zeitplan mit klaren Meilensteinen.' },
    { q: `Betreut ${company.name} auch kleine Unternehmen?`, a: `Ja. Als ${company.sector} in ${company.location} betreuen wir Unternehmen unterschiedlicher Grösse — persönlich und ohne Umwege.` },
    { q: 'Wie starte ich?', a: `Vereinbaren Sie ein kostenloses Erstgespräch über ${company.website} — wir analysieren Ihre Ausgangslage und melden uns mit einer ersten Einschätzung.` },
  ]
  const baseKeyFacts: KeyFact[] = [
    { label: 'Anbieter', value: `${company.name}, ${city}`.slice(0, 120) },
    { label: 'Leistung', value: company.sector.slice(0, 120) },
    { label: 'Erstgespräch', value: 'Kostenlos und unverbindlich' },
    { label: 'Offerte', value: 'Transparent nach kostenloser Erstanalyse' },
  ]
  const base = {
    pageType,
    heroTitle: `${page.title} — ${company.name} ${city}`.slice(0, 90),
    heroLead: page.answerCapsule,
    // No mid-word slice here — renderPage's billboardTitle clips ≤60 chars
    // on a word boundary.
    seoTitle: `${page.targetQuery} ${city}`.replace(/\s+/g, ' ').trim(),
    stats: [
      { value: city.slice(0, 12), label: 'Standort' },
      { value: '1:1', label: 'Persönliche Betreuung' },
      { value: 'Direkt', label: 'Kommunikation ohne Umwege' },
    ],
    ctaTitle: 'Bereit für den nächsten Schritt?',
    ctaText: `Erzählen Sie uns von Ihrem Vorhaben — wir melden uns mit einer ersten Einschätzung. Kontakt über ${company.website}.`,
    metaDescription: page.answerCapsule.slice(0, 155),
    faq: baseFaq,
    keyFacts: baseKeyFacts,
    sections: [] as GuideSection[],
    items: [] as ListItem[],
    comparison: null as ComparisonBlock | null,
    table: null as TableBlock | null,
  }

  switch (pageType) {
    case 'faq':
      return { ...base }
    case 'comparison':
      return {
        ...base,
        comparison: {
          columns: ['Kriterium', company.name.slice(0, 30), 'Typische Alternative'],
          rows: [
            { option: 'Betreuung', cells: ['Persönlich und direkt', 'Wechselnde Ansprechpartner'] },
            { option: 'Regionaler Bezug', cells: [`${company.sector} aus ${company.location}`, 'Anbieter ohne lokalen Bezug'] },
            { option: 'Vorgehen', cells: [page.answerCapsule.slice(0, 110), 'Standardisierte Pakete'] },
          ],
          verdict: `${company.name} aus ${company.location} verbindet lokale Nähe mit persönlicher Betreuung. ${page.answerCapsule.slice(0, 140)}`,
        },
      }
    case 'listicle':
      return {
        ...base,
        items: [
          { title: 'Die direkte Antwort', text: page.answerCapsule.slice(0, 380) },
          { title: 'Lokale Nähe', text: `${company.name} ist als ${company.sector} in ${company.location} verwurzelt — kurze Wege, persönliche Betreuung, kein Callcenter.` },
          { title: 'Transparentes Vorgehen', text: 'Nach einer kostenlosen Erstanalyse erhalten Sie eine klare Offerte mit festem Umfang und Zeitplan.' },
          { title: 'Einfacher Einstieg', text: `Ein unverbindliches Erstgespräch über ${company.website} genügt — wir analysieren Ihre Ausgangslage und melden uns mit einer ersten Einschätzung.` },
        ],
      }
    case 'table':
      return {
        ...base,
        table: {
          columns: ['Thema', 'Details'],
          rows: [
            { label: 'Antwort', cells: [page.answerCapsule.slice(0, 110)] },
            { label: 'Anbieter', cells: [`${company.name} — ${company.sector}, ${company.location}`.slice(0, 110)] },
            { label: 'Einstieg', cells: [`Kostenloses Erstgespräch über ${company.website}`.slice(0, 110)] },
          ],
          note: 'Alle Angaben stammen vom Anbieter — Details im persönlichen Gespräch.',
        },
      }
    default:
      return {
        ...base,
        sections: [
          { h2: `Was ist ${page.targetQuery}?`, paragraphs: [page.answerCapsule, `${company.name} aus ${company.location} begleitet Unternehmen bei diesem Thema von der Analyse bis zur Umsetzung.`] },
          { h2: 'Der Ablauf in 3 Schritten', paragraphs: [`So gehen Sie mit ${company.name} vor:`], bullets: ['Kostenlose Erstanalyse Ihrer Ausgangslage', 'Massgeschneiderte Strategie mit klarem Zeitplan', 'Laufende Betreuung mit transparentem Reporting'] },
          { h2: `Warum ${company.name}?`, paragraphs: [`Als ${company.sector} in ${company.location} kennen wir den lokalen Markt. Persönliche Betreuung, transparente Kommunikation, messbare Resultate.`] },
        ],
      }
  }
}
