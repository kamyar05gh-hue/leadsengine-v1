-- LeadEngine schema — SQLite (better-sqlite3, WAL mode).
-- Ordered migrations: this file is 001. Later files: 002_*.sql etc.

CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sector        TEXT NOT NULL,
  location      TEXT NOT NULL,
  website       TEXT NOT NULL,
  aliases       TEXT NOT NULL DEFAULT '[]',   -- JSON array
  domain_hints  TEXT NOT NULL DEFAULT '[]',   -- JSON array
  competitors   TEXT NOT NULL DEFAULT '[]',   -- JSON array
  buyer_persona TEXT NOT NULL DEFAULT '',
  language      TEXT NOT NULL DEFAULT 'de',
  slack_webhook TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,                 -- no FK: row precedes intake
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued|running|failed|done
  stage       TEXT NOT NULL DEFAULT 'intake',
  progress    INTEGER NOT NULL DEFAULT 0,      -- 0..100
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  TEXT NOT NULL REFERENCES jobs(id),
  stage   TEXT NOT NULL,
  message TEXT NOT NULL,
  at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_libraries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  version    INTEGER NOT NULL,
  items      TEXT NOT NULL,                    -- JSON PromptItem[]
  created_at TEXT NOT NULL,
  UNIQUE (company_id, version)
);

CREATE TABLE IF NOT EXISTS audit_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  library_id  INTEGER NOT NULL REFERENCES prompt_libraries(id),
  engine      TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  scope       TEXT NOT NULL,
  persona     TEXT NOT NULL,
  tier        TEXT NOT NULL,
  run         INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  text        TEXT,
  cited_urls  TEXT NOT NULL DEFAULT '[]',      -- JSON array
  error       TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (company_id, library_id, engine, prompt, run)
);

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  library_id  INTEGER NOT NULL REFERENCES prompt_libraries(id),
  payload     TEXT NOT NULL,                   -- JSON ScopedScore
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  scope      TEXT NOT NULL,
  lang       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'pdf',      -- pdf|playbook
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reverse_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  competitor TEXT NOT NULL,
  payload    TEXT NOT NULL,                    -- JSON ReverseReport
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  payload    TEXT NOT NULL,                    -- JSON ActionPlan (minus id/companyId)
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  scope         TEXT NOT NULL,
  mention_rate  REAL NOT NULL,
  citation_rate REAL NOT NULL,
  sov           REAL NOT NULL,
  at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  kind       TEXT NOT NULL,                    -- pageview|lead
  referrer   TEXT NOT NULL,                    -- chatgpt|perplexity|gemini|...
  page       TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',       -- JSON object
  at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_cost_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT,
  company_id TEXT,
  vendor     TEXT NOT NULL,
  model      TEXT NOT NULL,
  kind       TEXT NOT NULL,                    -- measured|labor|research
  at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_lookup
  ON audit_records (company_id, library_id, engine);
CREATE INDEX IF NOT EXISTS idx_job_events ON job_events (job_id);
CREATE INDEX IF NOT EXISTS idx_trends ON trends (company_id, scope, at);
CREATE INDEX IF NOT EXISTS idx_referrals ON referral_events (company_id, at);
