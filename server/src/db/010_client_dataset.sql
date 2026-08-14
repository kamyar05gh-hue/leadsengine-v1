-- 010_client_dataset.sql — the "LeadEngine Data" knowledge dataset.
--
-- One CSV-shaped, head-to-toe row per company per lifecycle event: the
-- initial audit, every weekly check-up, every monthly digest, plus manual
-- collections. APPEND-ONLY — a new row is added per event and nothing is
-- ever updated, so the client's whole timeline (and the movement between
-- events) is preserved.
--
-- Every column is derived from data that already exists elsewhere in this
-- database (companies, prompt_libraries, audit_records, scores, reports,
-- action_plans, reverse_reports, content_gaps, tracking_snapshots,
-- api_cost_log, learnings). `payload` carries the full JSON of the
-- collection so a column added later can be backfilled without re-running
-- anything.

CREATE TABLE IF NOT EXISTS client_snapshots (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id              TEXT    NOT NULL REFERENCES companies(id),
  snapshot_at             TEXT    NOT NULL,
  kind                    TEXT    NOT NULL CHECK (kind IN ('audit','weekly','monthly','manual')),
  job_id                  TEXT,
  library_version         INTEGER,

  -- ─── profile: industry niche + location + avatar ─────────────────────────
  sector                  TEXT    NOT NULL DEFAULT '',
  sector_key              TEXT    NOT NULL DEFAULT '',
  niche_services          TEXT    NOT NULL DEFAULT '',   -- comma list, sector split
  locations               TEXT    NOT NULL DEFAULT '',   -- comma list
  primary_location        TEXT    NOT NULL DEFAULT '',
  avatar                  TEXT    NOT NULL DEFAULT '',   -- companies.buyer_persona
  website                 TEXT    NOT NULL DEFAULT '',
  language                TEXT    NOT NULL DEFAULT '',

  -- ─── setup: what was actually measured ───────────────────────────────────
  prompts_total           INTEGER NOT NULL DEFAULT 0,
  prompts_general         INTEGER NOT NULL DEFAULT 0,
  prompts_avatar          INTEGER NOT NULL DEFAULT 0,
  prompts_multilingual    INTEGER NOT NULL DEFAULT 0,
  engines                 TEXT    NOT NULL DEFAULT '',   -- comma list
  runs_planned            INTEGER NOT NULL DEFAULT 0,
  runs_ok                 INTEGER NOT NULL DEFAULT 0,
  runs_failed             INTEGER NOT NULL DEFAULT 0,

  -- ─── performance ─────────────────────────────────────────────────────────
  mention_rate            REAL    NOT NULL DEFAULT 0,
  citation_rate           REAL    NOT NULL DEFAULT 0,
  sov                     REAL    NOT NULL DEFAULT 0,
  avg_rank                REAL,
  top_competitor_sov      REAL    NOT NULL DEFAULT 0,
  sentiment_pos_pct       REAL,
  per_engine              TEXT    NOT NULL DEFAULT '{}', -- JSON engine -> EngineStats

  -- ─── market ──────────────────────────────────────────────────────────────
  competitors             TEXT    NOT NULL DEFAULT '',   -- comma list
  top_competitor          TEXT    NOT NULL DEFAULT '',
  citations_total         INTEGER NOT NULL DEFAULT 0,
  citations_own           INTEGER NOT NULL DEFAULT 0,
  citations_directory     INTEGER NOT NULL DEFAULT 0,
  citations_earned        INTEGER NOT NULL DEFAULT 0,
  citations_other         INTEGER NOT NULL DEFAULT 0,
  top_cited_domains       TEXT    NOT NULL DEFAULT '',   -- comma list
  visibility_citation_gap REAL    NOT NULL DEFAULT 0,    -- mention_rate - citation_rate

  -- ─── delivery: what we generated for them ────────────────────────────────
  reports_generated       INTEGER NOT NULL DEFAULT 0,
  pages_generated         INTEGER NOT NULL DEFAULT 0,
  action_plan_pages       INTEGER NOT NULL DEFAULT 0,
  directory_listings      INTEGER NOT NULL DEFAULT 0,
  entity_tasks            INTEGER NOT NULL DEFAULT 0,
  teardowns               INTEGER NOT NULL DEFAULT 0,
  content_gaps            INTEGER NOT NULL DEFAULT 0,
  pack_folder             TEXT    NOT NULL DEFAULT '',

  -- ─── movement (weekly/monthly kinds carry the deltas) ────────────────────
  mention_delta           REAL,
  citation_delta          REAL,
  sentiment_delta         REAL,
  new_competitors         TEXT    NOT NULL DEFAULT '',   -- comma list
  lost_competitors        TEXT    NOT NULL DEFAULT '',   -- comma list
  weeks_tracked           INTEGER NOT NULL DEFAULT 0,

  -- ─── efficiency ──────────────────────────────────────────────────────────
  api_calls               INTEGER NOT NULL DEFAULT 0,
  estimated_usd           REAL    NOT NULL DEFAULT 0,
  usd_per_mention_point   REAL    NOT NULL DEFAULT 0,    -- usd / max(mention_rate, .1)

  -- ─── learning: what worked / what did not ────────────────────────────────
  what_worked             TEXT    NOT NULL DEFAULT '',
  what_did_not            TEXT    NOT NULL DEFAULT '',
  lessons_count           INTEGER NOT NULL DEFAULT 0,

  -- full JSON of the whole collection (nothing is lost if a column is added)
  payload                 TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_client_snapshots_company
  ON client_snapshots (company_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_client_snapshots_sector
  ON client_snapshots (sector_key, kind);
