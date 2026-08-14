-- Monitoring suite — scheduled tracking tables (migration 002).
-- Consumed by src/agents/{weeklyTracker,citationMonitor,contentGapAnalyzer,competitorWatcher}.ts
-- and the cron scheduler in src/cron/scheduler.ts.

CREATE TABLE IF NOT EXISTS tracking_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  week_start    TEXT NOT NULL,                 -- ISO date of the week's Monday
  mention_rate  REAL NOT NULL,                 -- 0..100, like trends.mention_rate
  citation_rate REAL NOT NULL,                 -- 0..100
  changes       TEXT NOT NULL DEFAULT '{}',    -- JSON TrackingChanges
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracking_snapshots
  ON tracking_snapshots (company_id, week_start);

CREATE TABLE IF NOT EXISTS citation_sources (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            TEXT NOT NULL REFERENCES companies(id),
  domain                TEXT NOT NULL,
  company_citations     INTEGER NOT NULL DEFAULT 0,
  competitor_citations  INTEGER NOT NULL DEFAULT 0,
  prompt_types          TEXT NOT NULL DEFAULT '[]',   -- JSON string[] ("scope/persona")
  last_seen             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  UNIQUE (company_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_citation_sources
  ON citation_sources (company_id, competitor_citations DESC);

CREATE TABLE IF NOT EXISTS content_gaps (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         TEXT NOT NULL REFERENCES companies(id),
  prompt             TEXT NOT NULL,
  reason             TEXT NOT NULL,
  recommended_format TEXT NOT NULL,              -- faq|table|comparison|listicle|guide
  status             TEXT NOT NULL DEFAULT 'open', -- open|in_progress|done|dismissed
  created_at         TEXT NOT NULL,
  UNIQUE (company_id, prompt)                    -- re-analysis stays idempotent
);
CREATE INDEX IF NOT EXISTS idx_content_gaps
  ON content_gaps (company_id, status);

CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        TEXT NOT NULL REFERENCES companies(id),
  competitor_domain TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  meta_description  TEXT NOT NULL DEFAULT '',
  headings          TEXT NOT NULL DEFAULT '[]',  -- JSON string[] (h1/h2 texts)
  pricing           TEXT NOT NULL DEFAULT '[]',  -- JSON string[] (price-looking lines)
  scraped_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots
  ON competitor_snapshots (company_id, competitor_domain, scraped_at);
