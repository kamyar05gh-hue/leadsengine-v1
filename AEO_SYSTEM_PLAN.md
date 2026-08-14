# Building the "Profound Process" In-House — System Plan

**Goal:** Replicate Profound's *operating process* (the SAGE loop: Setup → Analyze → Generate → Engineer) as an agency-side system we run in the background for clients — not rebuild the Profound platform itself.

**Status of this document:** based on (a) the full Profound 101 transcript (24 lessons), (b) independent verification of its claims against current public sources, and (c) a full scan of this repo.

---

## 1. What the transcript claims vs. what research confirms

| Profound claim | Verdict | Evidence / implication for us |
|---|---|---|
| Answer engines = LLM + browsing; agents fetch pages, extract chunks, synthesize + cite | **Confirmed** | Matches how OpenAI `web_search`, Gemini grounding, Perplexity Sonar are documented to work. |
| Query fan-out: 1 prompt → several search-shaped sub-queries | **Confirmed** | Independent measurements: ~8–11 sub-queries per prompt; Google AI Mode ~8; ChatGPT Deep Research up to hundreds. The words engines *add* ("best", "2026", "review") are target vocabulary. |
| 3 gates: fetchable → chosen (title/URL/snippet "billboard") → extractable (clean chunks) | **Confirmed as the right mental model** | Consistent with GEO research and with our existing `AI_Search_GEO_Deep_Research_Report.txt`. Keep as diagnostic framework. |
| Answers vary by platform; platform-level splits matter | **Confirmed** | Each engine has its own retrieval stack (ChatGPT→Bing, Perplexity→own index, Gemini→Google, Claude→Brave). Already reflected in our per-engine runner design. |
| "Prompt Volumes" (demand data for AI prompts) | **Real, but not replicable** | Profound licenses panel data (100M+–1.5B real conversations). No public API equivalent. We approximate it (§5.2). |
| Agent Analytics via CDN logs; GA4 blind to AI bots | **Confirmed** | Bots make raw HTTP requests, no JS. Log-based detection via UA + published IP ranges (Cloudflare "Verified Bots" does this automatically). Crawl ≠ citation: GPTBot crawls ~1,276 pages per referral; ClaudeBot ~23,951:1. |
| ChatGPT Shopping / merchant layer | **Confirmed** | Real surface, but relevant only for e-commerce/product clients. De-scope for now (§7). |
| Implicit: one run of a prompt = truth | **False — key caveat** | Answers are stochastic. Research: many prompts don't stabilize even after 20 runs; a single response is one draw from a distribution. Profound itself runs ~28 executions per prompt per period. **Sampling design is non-negotiable (§4.2).** |
| Implicit: API answers ≈ what users see | **Partly false — key caveat** | Raw API, logged-out UI, and logged-in UI (memory/personalization) diverge. API probing is the only scalable option; treat metrics as *directional*, spot-check the UI manually. We must say this to clients honestly. |

**Bottom line:** the SAGE loop and its heuristics are sound and worth copying. The two things we cannot copy are the prompt-volume panel dataset and pixel-perfect consumer-UI fidelity. Everything else is buildable on top of what we already have.

---

## 2. Where we already stand (repo scan)

The `pipeline/geo/` package is already a working Profound-core clone at small scale:

| Profound capability | Already exists here | Where |
|---|---|---|
| Multi-engine prompt execution w/ citations | ✅ ChatGPT (`web_search_preview`), Gemini (Search grounding), Claude (`web_search_20250305`) — each returns `{text, cited_urls}` | `geo/providers.py` |
| Prompt library per client, seeded on onboarding | ✅ deterministic starter prompts (best-of / reputation / category / comparison) | `api_server.py`, `config.add_custom_client` |
| Storage of runs, raw responses, citations, mentions | ✅ DuckDB: `prompts, runs, responses, citations, mentions, metrics_daily, ai_visibility_daily` | `geo/db.py` |
| Mention detection, position, sentiment | ✅ offline parser (DE/FR/EN) | `geo/parse.py` |
| Visibility / citation-rate / Share-of-AI-Voice, competitor rates | ✅ rolling 7-day windows | `geo/metrics.py` |
| Week-over-week drop alerts (±8pp) | ✅ computed at export — **but not delivered anywhere** | `geo/export.py` |
| Dashboard | ✅ React "GEO Command Center" reading `live.json` | `dashboard/` |
| One-off technical audit (robots/schema/entity/source map) | ✅ `audit.py` + PDF `report.py` | `pipeline/` |
| Client deliverable packages (site, Wikidata, PR, deploy checklist) | ✅ | `deliverables/futuremedia/` |

**So the plan below is not a greenfield build — it is closing 8 specific gaps between what we have and the full SAGE loop.**

---

## 3. The system we run for clients (target state)

Per client, per week, in the background:

1. **Setup (per client, once + quarterly refresh):** topic map (coverage + depth topics), 30–80 prompts built as `base + qualifiers` (ICP / criteria / constraints / comparisons), competitor set with name-variant matching, tags (intent / campaign / experiment).
2. **Collect (daily, automated):** every tracked prompt executed **N times per week per engine** (sampling, see §4.2) across **4 surfaces**: ChatGPT, Gemini, Perplexity, Google AI Overviews. Raw responses + citations + fan-out queries + mentions stored in DuckDB.
3. **Analyze (automated + 30 min human weekly):** visibility score, visibility **rank** vs competitors, citation share, per-platform splits, citation supply-chain classification (owned / earned / social / institutional / competitive), visibility–citation gap, sentiment prompts (`evaluate <brand> on <topic>`).
4. **Generate (weekly, 1 fix per client):** the highest-leverage gap → a content brief generated from the *actually winning* cited pages (scraped + compared) → human-polished → shipped. Plus earned-media target list from citation data.
5. **Engineer (running):** weekly briefing email/Slack per client ("what moved, why, what we shipped, what's next"), drop alerts with draft diagnosis, monthly PDF report via existing `report.py`.

That *is* the Profound process, productized as an agency service.

---

## 4. Build plan — 8 gaps, in priority order

### P0 — Gap 1: Perplexity + Google AI Overviews runners (`geo/providers.py`)
Profound's "big four" is ChatGPT / Perplexity / Gemini / AI Overviews. We have 2 of 4.
- **Perplexity:** Sonar API (`PERPLEXITY_API_KEY` already declared in `config.py`). Returns `citations` (URLs) and `search_results` (title/url/date/snippet) — map to the same `{ok, text, cited_urls, raw}` shape as other runners. Model: `sonar` (cheap, high-volume).
- **Google AI Overviews / AI Mode:** no official API. Use **DataForSEO** (`serp/google/organic/live/advanced` with AIO parsing) or SerpApi's AI Mode endpoint. Extract answer text + cited links. Per-call cost — budget it (§6).
- Keep Claude runner (already built) as a 5th, lower-weight surface.
- Deliverable: `ENGINES` registry with 4–5 working runners; `validate_keys.py` extended.

### P0 — Gap 2: Sampling methodology (`geo/run_monitor.py`, `geo/config.py`)
Current: 6 prompts/day rotated by day-of-year, 1 execution each. That produces exactly the "one draw from a distribution" failure the research warns about.
- Change to: **every prompt executed R=4 runs per week per engine** (e.g., Mon–Thu, one run/day — spreads across time, which also smooths drift). A prompt's weekly visibility = % of runs where client was mentioned/cited.
- Sizing: 40 prompts × 4 engines × 4 runs = **640 executions/client/week**. That's the meaningful unit. (Profound: ~28 executions/prompt/period; academic minimum: ~8–10 runs; 4 runs × weekly aggregation over time is the cost/quality sweet spot for an agency.)
- Implement: drop day-of-year rotation; add `run_index` to `runs`; aggregate weekly in `metrics.py` (visibility %, not binary).
- Cost impact and prompt-count guidance go into client onboarding (§6).

### P0 — Gap 3: Weekly briefing + alert delivery (`geo/export.py` → new `geo/briefing.py`)
We compute WoW deltas today and drop them on the floor. This is the single highest-visibility deliverable to clients — Profound's "weekly AEO briefing agent", minus their agent builder.
- New module `geo/briefing.py`: reads `metrics_daily` + `citations`, compares week-over-week, and generates a structured brief via `claude_generate` (already in `providers.py`): rank movements, citation supply-chain changes, one diagnosis, one recommended action.
- Delivery: email (SMTP) or Slack webhook per client. Store sent briefs in DuckDB (`briefs` table) so the dashboard Reports page can render them.
- Alerts: when the existing ±8pp trigger fires, send an alert email with auto-generated diagnosis (platform split + citation delta) instead of only flagging in `live.json`.

### P1 — Gap 4: Topic / tag / competitor model (`geo/db.py`, `api_server.py`)
Profound's Setup hierarchy: category → topics (coverage vs depth) → prompts; tags slice across; competitors with name variants.
- Schema additions: `topics(id, client, name, kind[coverage|depth])`, `prompts.topic_id`, `tags`, `prompt_tags`, `competitors(client, name, variants[])`.
- Mention matching: use competitor `variants[]` (case-insensitive, e.g. "Tempur-Pedic"/"Tempur Pedic") in `parse.py` — this is Profound's "name matching" feature and directly fixes false negatives.
- Onboarding: extend the prompt seeder in `api_server.py` to generate prompts from the **base + qualifiers** framework (base category × ICP × criteria × constraint × comparison; no brand names in commercial prompts). Tag informational prompts separately so they don't dilute the commercial visibility aggregate.

### P1 — Gap 5: Citation supply-chain analytics (`geo/metrics.py`, new `geo/supply_chain.py`)
This is Profound's Analyze module — the part the instructor calls "the single most important view".
- Per topic/week: top cited **domains** and **pages**, share %, WoW trend, and whether client is **mentioned on page** (we already store mentions; join on URL).
- Domain classification table (`domain_classes`): owned / earned / social / institutional / competitive — editable per client (Profound's citation categories). Seed with rules (reddit.com→social, wikipedia.org→institutional, client domain→owned, competitors→competitive, rest→earned).
- Compute the **visibility–citation gap** per topic (high mention rate + low own-domain citation share = "earned not owned" flag → drives the Generate step).
- **Earned-media target list**: earned domains with rising share = PR outreach list. This becomes a line item in the client report ("bet on winning horses").
- Surface all of this in `live.json` + a new dashboard "Supply Chain" view.

### P1 — Gap 6: Fan-out capture + content-brief generator (`geo/providers.py`, new `geo/briefs.py`)
Profound's Generate module, adapted:
- **Fan-out capture:** Gemini grounding returns `groundingMetadata.webSearchQueries`; OpenAI's web-search tool exposes the search action/queries in `raw`. Persist these into a `fanout_queries` table. Weekly, aggregate per topic: which sub-queries dominate, which words get added ("best", "2026"). This replaces Profound's Query Fan-Out view at zero extra cost.
- **Content brief generator `geo/briefs.py`:** input = topic + target prompt. Steps: pull top-10 cited pages for that prompt (from our citation data) → scrape them (stdlib fetch is fine; pages are public) → LLM compares client page (if any) vs winners → outputs a structured brief: recommended format (listicle/guide per what's winning), required sub-questions, title/H1 guidance using fan-out vocabulary, freshness requirements, FAQ schema block. This mirrors Profound's content tool without their "hundreds of dimensions" claim — we use *our own* citation winners, which is the part that actually matters.
- **Page optimization score:** for an existing client URL, reuse the audit machinery + LLM rubric to score: fetchable (robots/SSR — we have this in `audit.py`), chosen (title/snippet match to prompt + fan-out language), extractable (answer-first chunk present, no JS-hidden content). Output = the 3-gate verdict + concrete edits. This is the "optimize a page that should be winning" workflow.

### P2 — Gap 7: Sentiment tracking (`geo/run_monitor.py`, `geo/parse.py`)
- Add auto-generated sentiment prompts per client: `evaluate <brand> on <topic>` × each competitor (Profound's exact pattern). Run 1×/week (cheap — 5–10 prompts).
- Replace keyword sentiment for these with LLM-based theme extraction (positive/negative themes + counts, e.g. "steep learning curve" ×10). Keep the citation links for each sentiment answer so we can trace narrative → source.
- **Important:** exclude sentiment prompts from visibility/citation aggregates (they always mention the brand; Profound does this too).

### P2 — Gap 8: Agent-log analytics (new `geo/botlogs.py`) — *optional tier*
Profound's Agent Analytics, thin version. Only for clients on Cloudflare (or who can export access logs):
- Pull Cloudflare analytics/logs (API) or accept a log upload; filter UA for GPTBot / ChatGPT-User / OAI-SearchBot / ClaudeBot / PerplexityBot / Google-Extended; verify against published IP ranges where feasible.
- Classify: retrieval bots (ChatGPT-User, OAI-SearchBot ≈ "citation") vs training crawlers (GPTBot, ClaudeBot). Report per-page bot attention + trend. Caveat in all client comms: crawl ≠ citation (1,276:1 ratio for GPTBot).
- Deliver as a quarterly add-on report, not the core loop.

---

## 5. Things we deliberately approximate or skip

### 5.1 Prompt Volumes (demand estimation) — approximate, label honestly
No public panel data exists. Our proxy stack:
1. Classic keyword volume for head terms (DataForSEO keyword endpoints, or client GSC).
2. **Fan-out as demand signal:** our captured fan-out queries + Google PAA (via SERP API) show what engines *actually decompose* topics into — use it to discover missed branches.
3. Intent classification of tracked prompts (commercial/informational) via the tag system.
Present to clients as *directional prioritization*, never as "X people asked this" — Profound's own numbers are modeled estimates too, just from better data.

### 5.2 Personas — simplified
Profound injects persona context into prompts to mimic memory. We can support a `persona` text field per prompt group (prepended context) — the runner already controls the full prompt. Low cost, keep. But: **2 personas max per client** — each persona multiplies sampling cost.

### 5.3 ChatGPT Shopping / merchant layer — skip for now
Relevant only to e-commerce clients; our current client profile (Swiss SMEs, media, healthcare) doesn't trigger it. Revisit if we sign a product/retail client.

### 5.4 No visual agent-builder
Profound's node-canvas is their platform play. Our "agents" are Python modules on a schedule (`run_daily.py` → cron/Task Scheduler). Same outcomes, no canvas. Don't build one.

---

## 6. Cost model (per client, per week, rough)

| Item | Volume | Est. cost |
|---|---|---|
| ChatGPT runs (gpt-4o-mini + web_search) | 40 prompts × 4 runs = 160 | tool-call fees + tokens, low single-digit $ |
| Gemini grounding | 160 | grounding billed per search query (1+ per run) |
| Perplexity sonar | 160 | ~$0.005–0.01/run class |
| DataForSEO AI Overviews | 160 | per-call SERP fee — the most expensive line; consider 2 runs/week instead of 4 |
| Brief/alert/content-gen LLM calls | ~10 | negligible |
| **Total** | | **~$10–30/client/week** depending on AIO cadence |

→ Standard tier: 30–40 prompts, 4 engines, 4 runs/week. Lite tier: 20 prompts, 3 engines (drop AIO), 2 runs/week. Price the service with 5–10× margin on infra + the human hour for the weekly drill.

---

## 7. Operating cadence (the actual service)

- **Daily (automated):** `run_daily.py` → prompt executions → parse → metrics → export → alert check.
- **Weekly (automated + 30–60 min human per client):** briefing email goes out; analyst does Profound's "weekly drill" — scan rank changes → drill to prompts → read citation supply chain → pick **one topic, one fix** → generate brief via `geo/briefs.py` → hand to content.
- **Monthly (automated):** PDF report from `report.py` extended with: rank trend, supply-chain movement, earned-media wins, shipped-content impact (experiment tags!).
- **Quarterly:** refresh topics vs fan-out discoveries; re-run `audit.py` technical audit; bot-log add-on report.

**Experiment discipline (from Lesson 11, and it's right):** before shipping a content fix, tag the target prompts (`experiment:<name>` in `prompt_tags`). 4–6 weeks later, read visibility for that slice vs baseline. This is how we *prove* impact to clients — no tag, no claim.

---

## 8. Suggested build sequence

| Phase | Scope | Why first |
|---|---|---|
| **Phase 1** (week 1–2) | Gap 1 (Perplexity+AIO runners), Gap 2 (sampling), Gap 3 (briefing delivery) | Turns existing monitoring into the real "big four" loop with reliable numbers and a client-visible weekly artifact. |
| **Phase 2** (week 3–4) | Gap 4 (topics/tags/competitors), Gap 5 (supply-chain analytics + dashboard view) | The Analyze engine; without it, briefs have no diagnosis. |
| **Phase 3** (week 5–6) | Gap 6 (fan-out capture, brief generator, page-optimization score) | The Generate engine; converts analysis into shipped work. |
| **Phase 4** (later) | Gap 7 (sentiment), Gap 8 (bot logs) | Add-on tiers / upsells. |

Phases 1–3 give us the full SAGE loop: baseline → gap → shipped action → compounding system. Phase 4 is margin.

---

## 9. What to tell clients (honesty framework)

1. Metrics are **directional and sampled** — API answers differ from logged-in consumer UIs; we mitigate with repeated sampling and weekly aggregation, and we never report single-run results.
2. Prompt-volume numbers are **estimates from proxy data**, not measured demand (true for Profound too — theirs are just better-sourced).
3. A crawl by an AI bot is **not** a citation; we report bot attention separately from answer visibility.
4. AEO results compound over weeks; the experiment-tag system is how we attribute impact.

---

*Open question for you: you mentioned having your own ideas you weren't sure about — bring them and we'll reconcile them against this plan, particularly on pricing/packaging (Lite vs Standard) and whether bot-log analytics should be in the standard tier.*
