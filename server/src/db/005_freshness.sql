-- Content freshness check-up (migration 005) — one row per checked page per
-- run. Written by src/agents/freshnessChecker.ts (Sun 07:00 cron); stale
-- pages get one row per (path, reason), clean pages a single 'ok' row.
-- Consumed by GET /api/companies/:id/freshness (latest run only).

CREATE TABLE IF NOT EXISTS freshness_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  path       TEXT NOT NULL,                 -- absolute path of the generated page
  reason     TEXT NOT NULL,                 -- ok|undated|stale|no-main-links
  detail     TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL                  -- ISO timestamp of the run
);
CREATE INDEX IF NOT EXISTS idx_freshness_checks
  ON freshness_checks (company_id, checked_at);
