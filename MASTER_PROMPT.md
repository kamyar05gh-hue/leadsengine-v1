# MASTER PROMPT: LeadEngine GEO/AEO Platform

You are building LeadEngine, an enterprise-grade Generative Engine Optimization (GEO) and Answer Engine Optimization (AEO) platform. This is a clone of Profound's methodology, built as a background process system for marketing agencies.

## MISSION

Build a complete, production-ready system that:
1. Analyzes a company's AI search visibility across ChatGPT, Gemini, Perplexity, Claude
2. Generates evidence-based reports with per-prompt verification
3. Reverse-engineers competitor citation strategies
4. Creates optimized landing pages based on citation supply chain analysis
5. Tracks changes weekly with automated monitoring
6. Provides a clean, premium dashboard for clients

## PROFOUND METHODOLOGY (from Profound University transcripts)

The system follows the SAGE framework:
- **Setup**: Configure company profile, topics, prompts, personas
- **Analyze**: Measure visibility, citations, sentiment, shopping behavior
- **Generate**: Create content optimized for AI selection
- **Engineer**: Build agents that automate the workflow

Key principles from Profound:
1. **Follow the agent**: Answer engines are LLMs + browsing. They can only use what they fetch. Content must be accessible, structured, answer-shaped.
2. **Query fan-out**: One messy human prompt becomes multiple clean searches. Track all of them.
3. **Citation supply chain**: Track which domains cite which competitors for which prompt clusters.
4. **Answer shape analysis**: Identify which formats (FAQ, table, list, statistics) get cited most.
5. **Weekly tracking**: Re-run key prompts weekly, compare to baseline, alert on changes.
6. **Evidence-based**: Every metric must be verifiable with actual prompt/answer/citation triples.

## ARCHITECTURE

```
leadengine/
├── server/                  # Backend (TypeScript + Fastify + SQLite)
│   ├── src/
│   │   ├── agents/          # AI agents (promptgen, audit, evidence, reverse engineer, etc.)
│   │   ├── api/             # HTTP API (routes, server)
│   │   ├── cron/            # Scheduled jobs (weekly tracking, monitoring)
│   │   ├── db/              # Database (schema, migrations, repository)
│   │   ├── providers/       # LLM providers (OpenAI, Gemini, Perplexity, etc.)
│   │   ├── report/          # Report generation (PDF, charts, narrative)
│   │   ├── tracking/        # Attribution tracking (snippet, referrals)
│   │   ├── workflow/        # Workflow orchestration (stages, pipeline, queue)
│   │   ├── config.ts        # Configuration
│   │   ├── types.ts         # TypeScript types (single source of truth)
│   │   └── index.ts         # Entry point
│   ├── assets/              # Screenshots, brand assets
│   ├── reports/             # Generated reports (PDFs, landing pages)
│   ├── .env                 # API keys (gitignored)
│   └── package.json
│
├── dashboard/               # Frontend (React + Vite + Tailwind + shadcn/ui)
│   ├── src/
│   │   ├── components/      # Reusable components
│   │   ├── pages/           # Page components
│   │   ├── lib/             # API client, utilities
│   │   ├── hooks/           # React hooks
│   │   └── App.tsx          # Root component
│   └── package.json
│
└── docs/                    # Documentation
    ├── API.md
    ├── ARCHITECTURE.md
    ├── DEPLOYMENT.md
    └── USER_GUIDE.md
```

## DATABASE SCHEMA

```sql
-- Companies being audited
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  location TEXT NOT NULL,
  website TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  domain_hints TEXT NOT NULL DEFAULT '[]',
  competitors TEXT NOT NULL DEFAULT '[]',
  buyer_persona TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'de',
  slack_webhook TEXT,
  created_at TEXT NOT NULL
);

-- Workflow jobs
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'intake',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Job events (for debugging/audit trail)
CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  at TEXT NOT NULL
);

-- Prompt libraries (versioned)
CREATE TABLE prompt_libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  items TEXT NOT NULL, -- JSON PromptItem[]
  created_at TEXT NOT NULL,
  UNIQUE (company_id, version)
);

-- Audit records (raw LLM responses)
CREATE TABLE audit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  library_id INTEGER NOT NULL,
  engine TEXT NOT NULL,
  prompt TEXT NOT NULL,
  scope TEXT NOT NULL, -- regional|dach
  persona TEXT NOT NULL, -- general|avatar
  tier TEXT NOT NULL, -- city|region|canton|cantons|ch|dach
  run INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  text TEXT,
  cited_urls TEXT NOT NULL DEFAULT '[]',
  sentiment TEXT, -- positive|neutral|negative
  created_at TEXT NOT NULL,
  UNIQUE (company_id, library_id, engine, prompt, run)
);

-- Verified citations (after fetching cited pages)
CREATE TABLE verified_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_record_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  actually_cites_brand INTEGER NOT NULL,
  citation_context TEXT, -- surrounding text
  page_title TEXT,
  page_schema TEXT, -- JSON schema markup found
  verified_at TEXT NOT NULL
);

-- Scores (aggregated metrics)
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  library_id INTEGER NOT NULL,
  payload TEXT NOT NULL, -- JSON ScopedScore
  created_at TEXT NOT NULL
);

-- Reports (PDFs, landing pages)
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  lang TEXT NOT NULL,
  kind TEXT NOT NULL, -- pdf|playbook|page
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Competitor content analysis
CREATE TABLE competitor_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  competitor_domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  headings TEXT, -- JSON array
  schema_markup TEXT, -- JSON
  word_count INTEGER,
  answer_format TEXT, -- faq|table|list|prose
  has_statistics INTEGER,
  has_faq INTEGER,
  has_comparison_table INTEGER,
  scraped_at TEXT NOT NULL
);

-- Citation supply chain (which domains cite which competitors)
CREATE TABLE citation_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  company_citations INTEGER NOT NULL DEFAULT 0,
  competitor_citations INTEGER NOT NULL DEFAULT 0,
  competitors_cited TEXT NOT NULL DEFAULT '[]', -- JSON array
  prompt_types TEXT NOT NULL DEFAULT '[]', -- JSON array
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, domain)
);

-- Content gaps (prompts where client is absent but competitors present)
CREATE TABLE content_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  reason TEXT NOT NULL,
  recommended_format TEXT NOT NULL,
  competitor_urls TEXT NOT NULL DEFAULT '[]', -- JSON array of winning pages
  status TEXT NOT NULL DEFAULT 'open', -- open|in_progress|done
  created_at TEXT NOT NULL,
  UNIQUE (company_id, prompt)
);

-- Weekly tracking snapshots
CREATE TABLE tracking_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  mention_rate REAL NOT NULL,
  citation_rate REAL NOT NULL,
  sentiment_score REAL,
  changes TEXT NOT NULL, -- JSON TrackingChanges
  created_at TEXT NOT NULL
);

-- Competitor snapshots (for change detection)
CREATE TABLE competitor_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  competitor_domain TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  headings TEXT NOT NULL, -- JSON array
  pricing TEXT NOT NULL, -- JSON array
  new_pages TEXT NOT NULL DEFAULT '[]', -- JSON array
  scraped_at TEXT NOT NULL
);

-- Attribution events (from client-site tracking snippet)
CREATE TABLE referral_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- pageview|lead
  referrer TEXT NOT NULL, -- chatgpt|perplexity|gemini|...
  page TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);

-- API cost log
CREATE TABLE api_cost_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  company_id TEXT,
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL, -- measured|labor|research
  tokens_used INTEGER,
  cost_usd REAL,
  at TEXT NOT NULL
);
```

## CORE MODULES

### 1. Prompt Generation (`server/src/agents/promptGenerator.ts`)

Generate prompt libraries using real search data:
- Use Exa API to find "people also ask" questions for the company's sector/location
- Use query fan-out: start with seed prompts, generate variations (pricing, comparison, local, how-to, etc.)
- Validate prompts have real search volume (use Exa's search API)
- Generate 100+ prompts per company across:
  - Scopes: regional (city/region), DACH (country-level)
  - Personas: general (consumer), avatar (buyer persona)
  - Tiers: city, region, canton, cantons, Switzerland, DACH
  - Languages: German, French, Italian (for Swiss market)
- Store in `prompt_libraries` table (versioned)

### 2. Audit Engine (`server/src/agents/auditEngine.ts`)

Run prompts through LLMs:
- Call ChatGPT (GPT-4o), Gemini (1.5 Pro with grounding), Perplexity (Sonar Pro), Claude (3.5 Sonnet)
- For each prompt, run 2-3 times to detect variance
- Extract:
  - Full AI response text
  - Cited URLs
  - Brand mentions (using company aliases)
  - Sentiment (positive/neutral/negative)
  - Shopping behavior (product recommendations with pricing)
- Store raw responses in `audit_records`
- Log API costs in `api_cost_log`

### 3. Citation Verifier (`server/src/agents/citationVerifier.ts`)

Verify every cited URL:
- Fetch the cited page (with Playwright for JS-heavy sites)
- Check if it actually mentions the brand (using aliases)
- Extract citation context (surrounding text)
- Extract page metadata (title, schema markup, headings)
- Store in `verified_citations` table
- Only count verified citations in metrics

### 4. Evidence Extractor (`server/src/agents/evidenceExtractor.ts`)

Build evidence bundles:
- Cluster prompts by topic (pricing, comparison, local, service, general)
- For each cluster, extract:
  - All prompts
  - Verbatim AI answers (first 300 chars)
  - Verified cited URLs grouped by domain
  - Mention rate, citation rate per cluster
  - Per-engine breakdown
- Build Engine × Topic visibility matrix
- Identify top 10 evidence snippets (prompt + answer + citations)

### 5. Citation Supply Chain Analyzer (`server/src/agents/citationSupplyChain.ts`)

Map the citation network:
- Group verified cited URLs by domain
- For each domain, track:
  - How many times it cites the company
  - How many times it cites each competitor
  - Which prompt clusters it appears in
- Identify "citation hubs" (domains citing multiple competitors)
- Identify "opportunity domains" (high competitor citations, zero for us)

### 6. Competitor Analyzer (`server/src/agents/competitorAnalyzer.ts`)

Reverse-engineer competitor strategies:
- For each competitor, scrape their top pages (from verified citations)
- Analyze:
  - Content structure (headings, word count)
  - Schema markup (FAQ, HowTo, Article, etc.)
  - Answer format (FAQ, table, list, prose)
  - Use of statistics, comparisons, lists
  - Internal linking structure
- Store in `competitor_pages` table
- Identify patterns: what do winning pages have in common?

### 7. Answer Shape Analyzer (`server/src/agents/answerShapeAnalyzer.ts`)

Analyze which formats get cited:
- Detect in AI answers:
  - Markdown lists
  - Tables
  - Statistics (%, CHF, numbers)
  - FAQ structures
  - Comparison tables
- Correlate with citation wins
- Output: "FAQ pages get cited 3.2x more than prose pages"

### 8. Content Gap Analyzer (`server/src/agents/contentGapAnalyzer.ts`)

Find content opportunities:
- Identify prompts where:
  - Client is not mentioned
  - Competitors are mentioned
  - AI answer is weak/generic
- For each gap, extract:
  - The prompt
  - Why it's a gap
  - Which competitor pages won (from verified citations)
  - What format would win (from answer shape analysis)
- Store in `content_gaps` table

### 9. Landing Page Generator (`server/src/agents/landingPageGenerator.ts`)

Create optimized landing pages:
- Input: content gap + competitor analysis + design tokens
- Use Gemini Vision to extract design system from client's website:
  - Take screenshots with Playwright (desktop, tablet, mobile)
  - Send to Gemini Vision API
  - Extract: colors, typography, spacing, component styles
- Generate page content using citation supply chain evidence:
  - Use winning competitor content as template
  - Include client brand naturally
  - Match winning answer format (FAQ, table, etc.)
  - Include statistics, comparisons, lists (based on answer shape analysis)
- Render with extracted design tokens
- Add schema markup (FAQPage, Article, etc.)
- Save to `reports/<companyId>/site/`
- Register in `reports` table

### 10. Report Generator (`server/src/agents/reportGenerator.ts`)

Create evidence-based PDF reports:
- Executive summary (key metrics)
- Visibility matrix (Engine × Topic)
- Evidence section:
  - Per-prompt evidence (prompt → answer → verified citations)
  - Citation supply chain visualization
  - Answer shape analysis
  - Competitor content teardown
- Content gap opportunities
- Specific recommendations:
  - "Create FAQ page for X query"
  - "Add schema markup to Y page"
  - "Get cited on Z domain"
- Landing page previews
- Next steps

### 11. Weekly Tracker (`server/src/agents/weeklyTracker.ts`)

Re-run key prompts weekly:
- Sample 15-20 key prompts from library
- Re-run through all engines
- Compare to previous week:
  - Mention rate change
  - Citation rate change
  - Sentiment change
  - New competitors appearing
  - Competitors disappearing
- Store snapshot in `tracking_snapshots`
- Send Slack/email alert if significant changes

### 12. Competitor Watcher (`server/src/agents/competitorWatcher.ts`)

Monitor competitor changes:
- Daily scrape of top 3 competitors
- Extract: title, meta, headings, pricing, new pages
- Compare to previous snapshot
- Detect changes (new content, pricing changes, new pages)
- Store in `competitor_snapshots`
- Alert on significant changes

### 13. Attribution Tracker (`server/src/tracking/`)

Track AI-driven traffic:
- Generate tracking snippet (`track.js`)
- Client installs on their website
- Track pageviews and leads from AI referrers (ChatGPT, Perplexity, Gemini)
- Store in `referral_events`
- Calculate attribution: "ChatGPT sent 47 visitors, 3 leads this month"

## API ENDPOINTS

```
# Health
GET  /api/health

# Audits (frontend compatibility)
GET  /api/audits
POST /api/audits
GET  /api/audits/:id
GET  /api/audits/:id/pdf

# Companies (backend)
POST /api/companies
GET  /api/companies
GET  /api/companies/:id

# Jobs
GET  /api/jobs/:id
POST /api/jobs/:id/retry

# Evidence
GET  /api/evidence/:companyId
GET  /api/evidence/:companyId/topics
GET  /api/evidence/:companyId/citations
GET  /api/evidence/:companyId/answer-shapes

# Monitoring
GET  /api/tracking/:companyId
GET  /api/tracking/:companyId/latest
GET  /api/citations/:companyId
GET  /api/gaps/:companyId
GET  /api/competitors/:companyId/changes
POST /api/monitoring/start/:companyId
POST /api/monitoring/stop/:companyId

# Landing pages
GET  /api/landing-pages/:companyId
POST /api/landing-pages

# Reports
GET  /api/reports/:companyId

# Design extraction
POST /api/design/extract

# Attribution
POST /api/track/pageview
POST /api/track/lead
GET  /track.js
GET  /api/companies/:id/attribution
```

## FRONTEND PAGES

1. **Dashboard** (`/`) — Overview cards, recent audits table, quick actions
2. **New Audit** (`/audits/new`) — Form to start new audit
3. **Report View** (`/reports/:id`) — Full report with evidence, citations, recommendations
4. **Tracking** (`/tracking`) — Weekly tracking charts, change alerts
5. **Citations** (`/citations`) — Citation supply chain, opportunity domains
6. **Content Gaps** (`/content-gaps`) — Gap prompts, recommended formats, create content button
7. **Landing Pages** (`/landing-pages`) — Generated pages, view/download
8. **Settings** (`/settings`) — API keys, Slack webhook, tracking snippet

## CODE QUALITY STANDARDS

1. **TypeScript strict mode** — No `any`, proper types everywhere
2. **Single source of truth** — All types in `server/src/types.ts`
3. **Repository pattern** — All database access through `server/src/db/repo.ts`
4. **Error handling** — Every async function has try/catch, errors logged and returned
5. **Comments** — Every file has a header comment explaining what it does
6. **No magic numbers** — All constants in `config.ts`
7. **Environment variables** — All API keys in `.env`, validated at startup
8. **Logging** — Every major operation logs what it's doing
9. **Idempotency** — Every operation can be safely retried
10. **Testing** — Unit tests for pure functions, integration tests for API endpoints

## API KEYS (to be added later)

The system should work with these environment variables:
```
OPENAI_API_KEY=
GEMINI_API_KEY=
PERPLEXITY_API_KEY=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
EXA_API_KEY=
SLACK_WEBHOOK_URL=
```

All API calls should check if the key exists and gracefully degrade if not.

## WORKFLOW

When a new audit is created:
1. **Intake** — Validate company data, create company record
2. **Prompt Generation** — Generate 100+ prompts using Exa + LLM
3. **Audit** — Run prompts through all engines (2-3 runs each)
4. **Citation Verification** — Fetch and verify all cited URLs
5. **Evidence Extraction** — Cluster prompts, build evidence bundle
6. **Citation Supply Chain** — Map citation network
7. **Competitor Analysis** — Scrape and analyze competitor pages
8. **Answer Shape Analysis** — Identify winning formats
9. **Content Gap Analysis** — Find opportunities
10. **Scoring** — Calculate visibility, citation, sentiment scores
11. **Report Generation** — Create PDF with evidence
12. **Landing Page Generation** — Create optimized pages for top gaps
13. **Monitoring Setup** — Start weekly tracking, citation monitoring, competitor watching

## DEPLOYMENT

- Backend: Node.js server on port 8787
- Frontend: Vite dev server on port 3000 (dev) or static files (prod)
- Database: SQLite file (`leadengine.db`)
- Reports: Static files in `server/reports/`
- Tracking snippet: Served from `/track.js`

## DELIVERABLES

1. Complete backend in `server/` (TypeScript, compiles with `npm run typecheck`)
2. Complete frontend in `dashboard/` (React, builds with `npm run build`)
3. Database schema in `server/src/db/schema.sql`
4. All API endpoints working (test with curl)
5. Documentation in `docs/`
6. README.md with setup instructions

## SUCCESS CRITERIA

- `cd server && npm run typecheck` passes
- `cd dashboard && npm run build` passes
- `curl http://localhost:7000/api/health` returns 200
- Can create a new audit via API
- Can view evidence, citations, gaps, tracking via API
- Can generate landing pages via API
- Dashboard loads and displays data
- All code is senior-level quality (clean, commented, typed)

## NOTES FOR THE AI AGENT

- Start with the database schema and types
- Build the backend modules in order (promptgen → audit → verify → evidence → supply chain → competitor → gaps → pages → report)
- Build API endpoints last (after all modules work)
- Build frontend after backend is complete
- Use the existing codebase as reference if available
- If API keys are missing, use mock providers that return realistic data
- Every module should be independently testable
- Write clean, commented, senior-level code
- Follow the exact file structure above
- Do NOT skip the citation verification step — this is critical
- Do NOT skip the competitor analysis step — this is what makes the system valuable
- Do NOT generate generic landing pages — use citation supply chain evidence
- Do NOT generate shallow reports — show actual prompt/answer/citation triples

Build the complete system now.
