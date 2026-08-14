/**
 * Central configuration — env loading, model routing, cost tiers.
 *
 * Every model choice lives in MODELS below. This is the ONLY place to
 * change which vendor/model does which job (measured engines vs labor).
 * Keys are read from server/.env (same keys as the legacy Python pipeline).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Minimal .env loader (no dependency). First wins, like the Python loader. */
function loadEnv(): void {
  const envFile = path.join(ROOT, '.env')
  if (!fs.existsSync(envFile)) return
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const key = t.slice(0, i).trim()
    const value = t.slice(i + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnv()

export const PATHS = {
  root: ROOT,
  db: process.env.LE_DB ?? path.join(ROOT, 'leadengine.db'),
  reports: process.env.LE_REPORTS ?? path.join(ROOT, 'reports'),
  fixtures: path.join(ROOT, 'fixtures'),
}

export const KEYS = {
  openai: process.env.OPENAI_API_KEY ?? '',
  gemini: process.env.GEMINI_API_KEY ?? '',
  perplexity: process.env.PERPLEXITY_API_KEY ?? '',
  anthropic: process.env.ANTHROPIC_API_KEY ?? '',
  kimi: process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '',
  deepseek: process.env.DEEPSEEK_API_KEY ?? '',
  exa: process.env.EXA_API_KEY ?? '',
}

/**
 * Model routing table — cheapest viable per role.
 * measured*: audited answer engines (what the client is scored on).
 * labor*: internal writing/research work (never a measured surface).
 */
export const MODELS = {
  measuredChatgpt: process.env.LE_MODEL_OPENAI ?? 'gpt-4o-mini',
  measuredGemini: process.env.LE_MODEL_GEMINI ?? 'gemini-2.5-flash-lite',
  measuredPerplexity: process.env.LE_MODEL_PERPLEXITY ?? 'sonar',
  measuredClaude: process.env.LE_MODEL_CLAUDE ?? 'claude-haiku-4-5-20251001', // cheapest Claude with web search
  laborNarrative: process.env.LE_MODEL_KIMI ?? 'kimi-k2.6', // Kimi = main reasoning brain, cost-efficient tier
  // Landing pages need strict style-cloning discipline; GPT-5-mini follows
  // long structured style prompts better than kimi at similar cost. ("GPT
  // nano 5.5" does not exist — gpt-5-mini is the closest real tier above
  // gpt-5-nano.) Routed to the OpenAI provider by the pages agents.
  laborPages: process.env.LE_MODEL_PAGES ?? 'gpt-5-mini',
  laborPolish: process.env.LE_MODEL_POLISH ?? 'deepseek-chat', // cheapest copy-edit; report phase stays nearly free
  laborPromptgen: process.env.LE_MODEL_PROMPTGEN ?? 'kimi-k2.6',
  laborResearch: process.env.LE_MODEL_RESEARCH ?? 'sonar',
  laborVision: process.env.LE_MODEL_VISION ?? 'gemini-2.5-flash', // screenshot → design tokens (flash is vision-capable, far cheaper than pro)
  deepseekChat: 'deepseek-chat',
  deepseekReasoner: 'deepseek-reasoner',
} as const

/** Measured engines — the audited surfaces. Kimi/DeepSeek/Exa are labor only. */
export const MEASURED_ENGINES = ['chatgpt', 'gemini', 'perplexity', 'claude'] as const
export type MeasuredEngine = (typeof MEASURED_ENGINES)[number]

/**
 * Enabled measured engines for this deployment — comma-separated override
 * (LE_ENGINES=chatgpt,gemini) for runs where a vendor key is down.
 */
export const ENABLED_ENGINES: MeasuredEngine[] = (
  process.env.LE_ENGINES ?? 'chatgpt,gemini,perplexity,claude'
)
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is MeasuredEngine => (MEASURED_ENGINES as readonly string[]).includes(s))

/** Audit execution parameters. */
export const AUDIT = {
  promptsPerScope: 50,
  runsPerPrompt: Number(process.env.LE_RUNS_PER_PROMPT ?? 2),
  scopes: ['regional', 'dach'] as const,
  /**
   * Measured-call worker pool. 8 wide spreads across 4 vendors (~2 in-flight
   * calls per vendor) — parallel enough to halve wall time, polite enough to
   * stay clear of per-vendor rate limits. Override with LE_AUDIT_CONCURRENCY.
   */
  concurrency: Number(process.env.LE_AUDIT_CONCURRENCY ?? 8),
  callTimeoutMs: 90_000,
  maxCallsPerJob: Number(process.env.LE_MAX_CALLS_PER_JOB ?? 1400),
}

/**
 * Display/phrasing label for the second audit scope (DB key stays 'dach').
 * Default 'DACH-Region'; set LE_SCOPE_B_LABEL=Deutschschweiz to target
 * German-speaking Switzerland instead of Germany/Austria phrasing.
 */
export const SCOPE_B_LABEL = process.env.LE_SCOPE_B_LABEL ?? 'DACH-Region'

/** True when scope-B means German-speaking Switzerland, not the DACH region. */
export const SCOPE_B_IS_DE_CH = /deutschschweiz/i.test(SCOPE_B_LABEL)

/** Impact model assumptions — directional, footnoted in every report. */
export const IMPACT_ASSUMPTIONS = {
  projectValueChf: Number(process.env.LE_PROJECT_VALUE_CHF ?? 150_000),
  queriesPerMonth: Number(process.env.LE_QUERIES_MONTH ?? 400),
  ctrOther: 0.04,
  conversion: 0.08,
}

/** LLM adoption among the client's audience (estimate, footnoted). */
export const LLM_ADOPTION_PCT = Number(process.env.LE_LLM_ADOPTION ?? 40)

/**
 * Folder name of the FTP-ready "AI crawl pack" on the client's MAIN domain.
 * The generated site deploys to https://<main-domain>/<PACK_FOLDER>/ — a
 * folder inherits the main domain's authority (a subdomain starts from zero),
 * so all canonical/sitemap/JSON-LD URLs are anchored there.
 */
export const PACK_FOLDER =
  (process.env.LE_PACK_FOLDER ?? 'ki').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'ki'

/** Mock mode: providers return fixture data, zero network. Used for dry runs. */
export const MOCK_PROVIDERS = process.env.LE_MOCK_PROVIDERS === '1'

export const API_PORT = Number(process.env.LE_API_PORT ?? 7002)

/** Weekly re-audit schedule (cron expression, local time). */
export const WEEKLY_CRON = process.env.LE_WEEKLY_CRON ?? '23 6 * * 1'
