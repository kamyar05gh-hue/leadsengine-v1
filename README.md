# LeadEngine

**English** | [فارسی](README.fa.md)

LeadEngine is a GEO/AEO (Generative / Answer Engine Optimization) audit and monitoring platform built by Future Media. It measures how visible a brand is inside AI answer engines (ChatGPT, Gemini, Perplexity, Claude): it generates a demand-shaped prompt library for the client's niche, runs every prompt against the measured engines, verifies which cited URLs actually mention the brand, scores mention/citation/share-of-voice, reverse-engineers the competitors that win those answers, and turns the findings into executive PDF reports, an action-plan playbook, and a deployable mini-site of AEO-optimized landing pages — then keeps watching with weekly re-audits and scheduled monitors.

## Architecture

```
┌──────────────────┐        ┌───────────────────────────────────────────────┐
│    dashboard/    │  HTTP  │                 server/  (:7002)              │
│  React + Vite    │◄──────►│  Fastify API (src/api) ── zod at the edges    │
│     (:7001)      │        │        │                                      │
└──────────────────┘        │  workflow DAG (src/workflow)                  │
                            │  intake → promptgen → audit → verify → score  │
                            │  → reverse → competitors → report → actions   │
                            │  → pages  (+ completion hooks: content gaps,  │
                            │             monitoring arm)                   │
                            │        │                                      │
                            │  agents (src/agents, 24 single-purpose)       │
                            │  cron monitors (src/cron, src/tracking)       │
                            │        │                                      │
                            │  providers (src/providers)                    │
                            │   measured: chatgpt · gemini · perplexity ·   │
                            │             claude                            │
                            │   labor:    kimi · deepseek · exa · openai ·  │
                            │             gemini (never measured surfaces)  │
                            │        │                                      │
                            │  SQLite (node:sqlite, leadengine.db)          │
                            │  reports/<companyId>/  (PDFs, site/, static   │
                            │  hosting at /reports/* with AI-bot logging)   │
                            └───────────────────────────────────────────────┘
```

- **`server/`** — the live TypeScript backend (Fastify on port 7002, run with `tsx`, no build step). Everything below documents this.
- **`dashboard/`** — React 19 + Vite + Tailwind + TanStack Query SPA on port 7001. Talks to `http://localhost:7002/api` directly (override with `VITE_API_BASE_URL`; the server enables CORS).
- The project is **100% TypeScript** — server and dashboard, no Python, no native modules — so it deploys on any Node host (e.g. Hostpoint managed Node): `cd server && npm ci && npm start` plus the dashboard's static `dist/` from `npm run build`. A legacy Python `pipeline/` may exist in old working copies; it is fully superseded, excluded from this repository, and must not be extended.

## Quick start

### Prerequisites

- **Node.js ≥ 23.4** — the DB layer uses the built-in `node:sqlite` (`DatabaseSync`), no native compilation.
- **npm** — the server's `postinstall` runs `npx playwright install chromium` (used for PDF rendering and design cloning).

### Configure `server/.env`

The server loads `server/.env` at boot (first value wins; already-set process env is never overridden).

| Key | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | ChatGPT measured engine (forced web search) + `gpt-5-mini` page labor |
| `GEMINI_API_KEY` | Gemini measured engine (Google Search grounding) + vision labor |
| `PERPLEXITY_API_KEY` | Perplexity measured engine (`sonar`) + research labor |
| `ANTHROPIC_API_KEY` | Claude measured engine (web search) |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi (Moonshot) — main narrative/reasoning labor, never measured |
| `DEEPSEEK_API_KEY` | DeepSeek — cheapest labor (polish, sentiment, JSON fallback) |
| `EXA_API_KEY` | Exa search — promptgen demand validation, research (optional; promptgen degrades to LLM-only without it) |

Notable overrides (all optional, defaults in parentheses):

| Variable | Effect |
| --- | --- |
| `LE_API_PORT` | API port (`7002`) |
| `LE_DB`, `LE_REPORTS` | DB file / reports dir paths (`server/leadengine.db`, `server/reports`) |
| `LE_ENGINES` | Enabled measured engines, comma-separated (`chatgpt,gemini,perplexity,claude`) — drop a vendor whose key is down |
| `LE_RUNS_PER_PROMPT` | Runs per prompt per engine (`2`) |
| `LE_AUDIT_CONCURRENCY` | Measured-call worker pool (`8`) |
| `LE_MAX_CALLS_PER_JOB` | Hard audit cost ceiling in calls (`1400`) |
| `LE_MODEL_OPENAI` / `LE_MODEL_GEMINI` / `LE_MODEL_PERPLEXITY` / `LE_MODEL_CLAUDE` | Measured model per engine (`gpt-4o-mini`, `gemini-2.5-flash-lite`, `sonar`, `claude-haiku-4-5-20251001`) |
| `LE_MODEL_KIMI` / `LE_MODEL_PAGES` / `LE_MODEL_POLISH` / `LE_MODEL_PROMPTGEN` / `LE_MODEL_RESEARCH` / `LE_MODEL_VISION` | Labor model routing (`kimi-k2.6`, `gpt-5-mini`, `deepseek-chat`, `kimi-k2.6`, `sonar`, `gemini-2.5-flash`) |
| `LE_SCOPE_B_LABEL` | Phrasing of the second audit scope (`DACH-Region`; set `Deutschschweiz` to target German-speaking Switzerland — DB key stays `dach`) |
| `LE_RESUME_ORPHANS` | `0` disables boot-time resume of orphaned jobs |
| `LE_AUTO_MONITORING` | `0` disables boot-time re-arming of monitors for audited companies |
| `LE_KIMI_TIMEOUT_MS` | Kimi labor call budget (`300000`) — long-form drafting needs more than the 90 s audit budget |
| `LE_KIMI_THINKING` | `1` re-enables kimi-k2.6 reasoning (off by default, ~5× slower) |
| `LE_MOCK_PROVIDERS` | `1` = deterministic fixture providers, zero network (dry runs) |
| `LE_WEEKLY_CRON` | Weekly re-audit schedule (`23 6 * * 1`) |
| `LE_CRON_*` | Per-monitor cron overrides — see [Scheduling](#scheduling--monitoring) |
| `LE_REVERSE_TOP_N` | Competitor teardown count (`5`) |
| `LE_PACK_FOLDER` | Folder name of the deployed AI crawl pack on the main domain (`ki`) |
| `LE_REPORT_SCOPE_DECKS` | `1` re-enables legacy per-scope (regional/dach) report decks |
| `LE_PROMPTGEN_MULTILINGUAL` | `0` disables the FR/IT prompt layer |
| `LE_PROJECT_VALUE_CHF`, `LE_QUERIES_MONTH`, `LE_LLM_ADOPTION` | Impact-model assumptions (150000, 400, 40) |

### Run

```bash
# backend (port 7002)
cd server
npm install
npm start            # tsx src/index.ts   (npm run dev = watch mode)

# dashboard (port 7001)
cd dashboard
npm install
npm run dev

# type gate (no emit — tsx runs TS directly)
cd server && npm run typecheck
```

Sanity check: `GET http://localhost:7002/api/health` validates every enabled engine key.

CLI (run individual stages without the API):

```bash
cd server
npm run stage -- --company <id> --stage promptgen|audit|score|report|reverse|actions|pages|weekly|all
npm run stage -- --add '{"name":"…","sector":"…","location":"…","website":"…"}'

# full dry run, zero network
LE_MOCK_PROVIDERS=1 npm run stage -- --company demo --stage all
```

## The pipeline

`POST /api/companies` (or `/api/audits` from the dashboard) creates a job and runs the DAG in `src/workflow/pipeline.ts`. Every stage is **idempotent**, so `POST /api/jobs/:id/retry` — and the boot-time orphan resume — re-enters at the failed stage without re-paying for completed work.

| Stage | What it does | Providers | Idempotency / notes |
| --- | --- | --- | --- |
| `intake` | Validate (zod `NewCompanySchema`), slugify the id, derive domain hints, persist the company | — | Pure DB write |
| `promptgen` | Build the prompt library: Exa demand harvest ("people also ask" + query fan-out + live search-volume validation) feeds a Kimi JSON draft; deterministic templates top up unfilled slots. 100 core German prompts (50 regional / 50 scope-B; 25 `general` + 25 `avatar` per scope, geo-tiered `city`→`dach`) + up to 16 FR/IT prompts | Exa (optional), Kimi (DeepSeek fallback via `jsonAgent`) | Reuses the latest library unless forced; weekly re-audits keep the same version so trends stay comparable |
| `audit` | The measured run: prompts × enabled engines × `LE_RUNS_PER_PROMPT`. Per-engine `enginePlan` quotas slice a **priority-ordered** library view (regional before DACH, `city`→`dach` tier order, personas interleaved ~50/50) so small budgets land on the most local prompts. `avatar` runs impersonate the company's real buyer persona. One retry per failed call; sentiment of each brand mention judged on a ±100-char window | Measured: chatgpt (forced search), gemini (grounded, redirect-stub resolution), perplexity, claude. Labor: DeepSeek → Gemini for sentiment | Records streamed to DB; resume skips existing `(engine, prompt, run)` keys; hard ceiling `LE_MAX_CALLS_PER_JOB` |
| `verify` | Fetch every cited URL and confirm the page actually mentions the brand → `verified_citations` ("cited" vs "verified" in reports) | HTTP fetches (citationVerifier agent) | Records with existing verification rows are skipped |
| `score` | Pure computation: per-engine + per-scope + combined mention rate, citation rate, SoV, avg rank, competitor discovery, citation classes; writes trend rows and the impact model | — | Deterministic; re-runnable |
| `reverse` | Competitor teardowns for the top `LE_REVERSE_TOP_N` (default 5) brands by mention share: why they win, tactics (content/schema/directories/earned/entity) | Perplexity research + Exa | Cached per competitor; cached rows re-validated against name-quality rules |
| `competitors` | Scrape the pages that win AI citations, analyze structure (schema markup, FAQ, comparison tables, statistics, answer format) → `competitor_pages` + cross-page patterns | HTTP scraping | Upserts on `(company_id, url)` (migration 008) |
| `report` | Persona-split narrative + executive PDF decks: `general` (market overview) and `avatar` (buyer-persona lens), each scored on its own record slice, each DE + EN. HTML → headless-Chromium PDF | Kimi narrative (DeepSeek polish/fallback) ; Playwright | Legacy per-scope decks behind `LE_REPORT_SCOPE_DECKS=1` |
| `actions` | Parallel planning agents → `ActionPlan` (page specs, JSON-LD snippets, directory listings, entity tasks, measurement setup) + designed action-plan PDFs (DE + EN) | Kimi/labor via `jsonAgent`; Playwright | Plan stored in `action_plans`, PDFs registered as `playbook` |
| `pages` | Render the plan into an **FTP-ready AI crawl pack** for a folder on the client's *main domain* (`https://<domain>/<LE_PACK_FOLDER>/`, default `ki` — a folder inherits the domain's authority; a subdomain starts from zero): cloned-design AEO pages with JSON-LD, plus `sitemap.xml`, a site-wide `graph.jsonld`, a consolidated AI FAQ (`faq.html` + bare `faq.json`), `llms.txt`, `robots.txt` and a German `DEPLOY.md` (FTP steps + CDN/log-based bot-crawl tracking). Every file backlinks the main domain | `gpt-5-mini` page labor (Gemini/Kimi fallbacks), Gemini vision | Design clone cached per company; deterministic filenames; stale files from earlier runs are removed |
| *completion hooks* | Content-gap analysis (fills the Gaps tab immediately) + arm the monitoring suite + tracking baseline snapshot from the run's own records (free) + pre-generate the AI executive summary + **retro** (see below) | — | Best-effort — never fails a finished audit |

### The learning loop (retro)

After every completed audit, `agents/retroAnalyzer.ts` distills the run into durable lessons stored in the `learnings` table: winning prompt texts become few-shot exemplars (deterministic, computed from the scored records), and one Kimi call generalizes transferable `prompt_pattern` / `pitfall` / `insight` / `action` lessons, scoped `global` or per-sector. Duplicate lessons bump a confirmation `weight` instead of piling up. The **next** run — for any company — injects the relevant lessons into prompt generation (`promptgen`) and action planning (`actionPlanner`), so the system measurably improves generation over generation. Inspect the memory via `GET /api/learnings`.

## Data model

SQLite via `node:sqlite`, WAL mode. Ordered migrations in `src/db/` (`schema.sql` = base, then `002_…` →). All access goes through `src/db/repo.ts`.

| Table | One-liner |
| --- | --- |
| `companies` | Client profile: sector, locations, aliases, domain hints, competitors, buyer persona, engine plan |
| `jobs` / `job_events` | Workflow runs (status/stage/progress 0–100) and their event log |
| `prompt_libraries` | Versioned JSON `PromptItem[]` per company |
| `audit_records` | One row per measured call — engine, prompt, scope/persona/tier, run, answer text, cited URLs, sentiment; `UNIQUE(company, library, engine, prompt, run)` powers resume |
| `verified_citations` | Fetched cited URLs with "actually cites brand" verdict + page context |
| `scores` | JSON `ScopedScore` payload (regional/dach/combined) per audit |
| `trends` | Mention/citation/SoV time series per scope |
| `reverse_reports` | Competitor teardowns (`ReverseReport` JSON) |
| `competitor_pages` | Scraped competitor pages with content-structure analysis |
| `competitor_snapshots` | Daily competitor title/meta/headings/pricing snapshots for diffing |
| `action_plans` | JSON `ActionPlan` payloads |
| `reports` | Generated file registry — `pdf` \| `playbook` \| `page` \| `digest`, with scope/lang/path |
| `content_gaps` | Prompts where competitors surface but the client doesn't, with a recommended format; `UNIQUE(company, prompt)` |
| `tracking_snapshots` | Weekly monitoring snapshots + `TrackingChanges` diff JSON |
| `citation_sources` | Domains cited for the client vs competitors (opportunity detection) |
| `referral_events` | AI-referred pageviews/leads from the client-site snippet |
| `bot_visits` | AI-crawler hits on hosted `/reports/*` pages (or forwarded server logs) |
| `freshness_checks` | Weekly content-freshness rows (`ok` \| `undated` \| `stale` \| `no-main-links`) |
| `api_cost_log` | One row per provider call (vendor, model, `measured`\|`labor`\|`research`) — no token counts |

## API reference

All routes in `src/api/routes.ts`; the dashboard "audit" id **is** the job id.

**Companies & jobs**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/companies` | Validate, persist, start the workflow → `{ jobId }` |
| POST | `/api/companies/lookup` | Quick company research for form prefill (never throws) |
| GET | `/api/companies` | List with latest score + job summary |
| GET | `/api/companies/:id` | Detail + trends + attribution + action plan + teardowns |
| DELETE | `/api/companies/:id` | Cascade-delete DB rows + `reports/<id>/` (409 while a job is live) |
| GET | `/api/companies/:id/ai-summary` | Kimi-written executive brief — pre-generated at audit completion, served from the persistent `ai_summaries` cache |
| GET | `/api/learnings` | Retro-learning memory: distilled lessons applied to future runs |
| GET | `/api/jobs/:id` | Status/stage/progress + last 50 events (dashboard polling) |
| POST | `/api/jobs/:id/retry` | Resume a failed job at its current stage |
| POST | `/api/jobs/:id/cancel` | Mark failed / exclude from orphan resume |

**Dashboard compatibility (audits & landing pages)**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/audits` | Latest job per company, shaped as an audit (incl. stage timeline + spend) |
| POST | `/api/audits` | Create company + start workflow (engines, per-engine prompt counts, avatar) |
| GET | `/api/audits/:id` | Audit detail |
| GET | `/api/audits/:id/pdf` | Redirect to the latest PDF report |
| GET | `/api/landing-pages/:companyId` | List generated site pages |
| POST | `/api/landing-pages` | Generate one page from a content gap |

**Evidence layer** (pure reads of `audit_records`, no external calls)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/evidence/:companyId` | Full bundle: topic clusters, visibility matrix, snippets, supply chain, answer shapes |
| GET | `/api/evidence/:companyId/topics` | Prompt topic clusters + visibility matrix |
| GET | `/api/evidence/:companyId/citations` | Citation supply chain (domains, hubs) |
| GET | `/api/evidence/:companyId/answer-shapes` | Which answer formats win citations |
| GET | `/api/evidence/:companyId/sentiment` | Sentiment breakdown + daily trend |

**Monitoring suite**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tracking/:companyId` (`/latest`) | Weekly tracking snapshot history / latest |
| POST | `/api/tracking/:companyId/run` | Run a check-up now (live re-query; `?stored=1` = free snapshot from stored records) |
| GET | `/api/citations/:companyId` | Citation sources + opportunity domains |
| GET | `/api/gaps/:companyId` | Content-gap prompts |
| GET | `/api/competitors/:companyId/changes` | Recent competitor snapshot diffs |
| POST | `/api/monitoring/start/:companyId` · `/api/monitoring/stop/:companyId` | Arm / stop all cron monitors |

**Costs, drill-downs, tracking & misc**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/costs/summary` | Call volume + estimated spend (today/week/month/all, by vendor/model/day/company) |
| GET | `/api/companies/:id/mentions` | Every audit answer mentioning the brand (context window, sentiment) |
| GET | `/api/companies/:id/prompts` | Latest prompt library; `?refresh=1` appends new prompts |
| GET | `/api/companies/:id/files` | Categorized, deduplicated generated files |
| GET | `/api/companies/:id/freshness` | Latest content-freshness run (stale pages) |
| GET | `/api/companies/:id/attribution` | AI click/lead funnel by month |
| GET | `/api/companies/:id/ai-traffic` | AI crawler visits + AI-sourced human referrals |
| POST | `/api/track/pageview` · `/api/track/lead` | Client-site snippet events |
| POST | `/api/track/bot` | Forwarded server/CDN log of an AI-crawler visit |
| GET | `/track.js?company=<id>` | The tracking snippet itself |
| POST | `/api/design/extract` | Screenshot a URL + extract design tokens (vision) |
| GET | `/api/health` | Engine-key validation status |
| GET | `/reports/*` | Static hosting of all artifacts (+ HTML directory index; AI-bot requests logged to `bot_visits`) |

## Reports & artifacts

Everything a job produces lands in `server/reports/<companyId>/` and is registered in the `reports` table:

```
reports/<companyId>/
├── LeadEngine_Audit_<Name>_regional_general_DE.pdf   ← executive audit dossier
├── LeadEngine_Audit_<Name>_regional_general_EN.pdf     (general persona × DE/EN)
├── LeadEngine_Audit_<Name>_regional_avatar_DE.pdf    ← same, avatar persona lens
├── LeadEngine_Audit_<Name>_regional_avatar_EN.pdf
├── LeadEngine_Audit_…​.md                             ← narrative markdown twins
├── LeadEngine_ActionPlan_<Name>_DE.pdf               ← action-plan playbook
├── LeadEngine_ActionPlan_<Name>_EN.pdf
├── LeadEngine_Digest_… (weekly/monthly, from cron)
├── master-style.json / master-style.txt              ← cached design clone
└── site/                                             ← deployable mini-site
    ├── index.html, <slug>.html …                       (AEO pages w/ JSON-LD)
    ├── llms.txt                                        (AI-crawler site map)
    └── robots.txt                                      (AI bots explicitly allowed)
```

Audit dossiers render HTML → headless-Chromium PDF (`src/report/executive/`); digests use PDFKit (`src/report/digest.ts`).

## Scheduling & monitoring

Two layers, both in-process:

1. **Weekly re-audit loop** (`src/tracking/weekly.ts`, `LE_WEEKLY_CRON`, default Mon 06:23) — re-runs the audit with the *same* prompt-library version, diffs against the previous baseline, stores trend rows, and pushes a Kimi-written briefing to the company's Slack webhook if set.
2. **Monitoring suite** (`src/cron/scheduler.ts`) — per-company `node-cron` jobs, armed via `POST /api/monitoring/start/:companyId` and automatically at the end of every audit:

| Monitor | Default schedule | Override |
| --- | --- | --- |
| Weekly tracking snapshot | Mon 09:00 | `LE_CRON_WEEKLY_TRACKING` |
| Citation-source monitor | daily 00:00 | `LE_CRON_CITATIONS` |
| Content-gap analysis | Sun 18:00 | `LE_CRON_GAPS` |
| Competitor watcher | daily 03:00 | `LE_CRON_COMPETITORS` |
| Prompt refresh | every 3 days 04:30 | `LE_CRON_PROMPT_REFRESH` |
| Weekly digest PDF | Mon 08:00 | `LE_CRON_DIGEST_WEEKLY` |
| Monthly digest PDF | 1st 08:15 | `LE_CRON_DIGEST_MONTHLY` |
| Content freshness check | Sun 07:00 | `LE_CRON_FRESHNESS` |

**Boot behavior** (`src/index.ts`): jobs stuck in `running`/`queued` from a dead process are resumed (`LE_RESUME_ORPHANS=0` to disable), and monitors are re-armed for every company with a completed audit (`LE_AUTO_MONITORING=0` to disable) — the scheduler registry is in-memory, so restarts would otherwise silently kill the cadence.

## Cost model

`api_cost_log` stores one row per provider call but no token counts, so spend is a **per-call estimate** (`COST_PER_CALL_USD` in `src/api/routes.ts`):

| Vendor | Est. USD/call | Vendor | Est. USD/call |
| --- | --- | --- | --- |
| openai | 0.03 | anthropic | 0.02 |
| perplexity | 0.01 | moonshot / kimi | 0.01 |
| exa | 0.01 | google / gemini | 0.005 |
| deepseek | 0.002 | *(unknown fallback)* | 0.01 |

A typical full audit (default engine plan, 2 runs/prompt, plus labor for narrative/plan/pages) lands around **$2–2.5**; the audit stage additionally enforces the `LE_MAX_CALLS_PER_JOB` ceiling. Live numbers: `GET /api/costs/summary` or the dashboard's Costs page; per-stage spend appears in the audit timeline.

## Development notes

- **TypeScript everywhere, no build step** — `tsx` runs the server directly; `npm run typecheck` (`tsc --noEmit`) is the gate.
- **Conventions**
  - `src/db/repo.ts` is the only persistence boundary — no SQL outside `src/db/`.
  - Every provider call logs to `api_cost_log` via `logCost()`; the job runner sets the job/company context with `setCallContext()`.
  - zod validates at the API edges (`routes.ts`, `intake.ts`) and around every LLM JSON output (`jsonAgent`).
  - All model/vendor routing lives in `MODELS` in `src/config.ts` — never hardcode a model name elsewhere.
  - Providers never throw for transport errors: they return `{ ok, status, error }` (`status -1` = network/timeout).
- **Adding a measured engine**: implement `run`/`validate` in `src/providers/<engine>.ts`, register it in `getMeasuredEngines()` (`src/providers/index.ts`), extend `MEASURED_ENGINES` in `src/config.ts` and the `Engine` union in `src/types.ts`, and add a mock in `providers/mock.ts`.
- **Adding an agent**: one single-purpose module in `src/agents/`, calling labor providers through `src/providers/index.ts` (use `jsonAgent` for schema-validated JSON output). Agents must degrade gracefully — a broken labor key never fails an audit.
- **Adding a report section**: extend the view model in `src/report/executive/model.ts`, render it in `html.ts` (charts in `charts.ts`), and add both languages to `strings.ts`.
- **TypeScript-only**: the published project contains no Python and no compiled native deps; `server/package.json` pins `engines.node >= 23.4` (the `node:sqlite` requirement). Anything found in an old local `pipeline/` folder is legacy and lives outside this repo.
